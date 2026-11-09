import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  allocationIsReadyToComplete,
  allocationDefaultQuantity,
  findMatchingAllocationRow,
  getPickerTargetWarehouse,
  isActiveAllocationForBatch,
  isPickerReadyStatus,
  allocationItemBalances,
  applyHandoverQuantityMultiplier,
  canGenerateHandoverQr,
  clearCompletedHandoverCache,
  clearDeviceHandover,
  createDeviceHandoverQrPayload,
  isTerminalHandoverStatus,
  isAllocationCompleted,
  loadCompletedAllocationHistory,
  loadDeviceHandover,
  mergeHandoverDraft,
  parseAllocation,
  parseAllocationQuantityInput,
  parseHandoverItems,
  parseHandoverQr,
  pendingCheckerItems,
  reconcileHandoverServerStatus,
  saveDeviceHandover,
  saveCompletedAllocationHistory,
  preserveHandoverScanMetadata,
  validateCheckerCorrections,
  validateAllocationQuantity,
  type DeviceHandover,
  type HandoverItem,
} from "@/lib/warehouseHandover";
import { loadHandoverMutations, prepareHandoverMutation } from "@/lib/handoverMutationQueue";

const values = new Map<string, string>();
const storage = {
  getItem: vi.fn((key: string) => values.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  removeItem: vi.fn((key: string) => { values.delete(key); }),
};

const item = (overrides: Partial<HandoverItem> = {}): HandoverItem => ({
  stockEntryId: "MAT-STE-1", stockEntryRow: "row-1", jobCardId: "JC-1", workOrderId: "WO-1",
  itemCode: "FG-1", itemName: "Finished Item", recordedQuantity: 20, verifiedQuantity: 20,
  pullOutSlip: "PULL-1", correctionReason: "", uom: "PCS", modified: "2026-09-04 08:00:00", ...overrides,
});

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", storage);
});

describe("warehouse handover state", () => {
  it("multiplies the scanned QR unit quantity when Review Batch is edited", () => {
    const updated = applyHandoverQuantityMultiplier(item({ recordedQuantity: 13, verifiedQuantity: 13, qrQuantity: 13, quantityMultiplier: 1 }), 5);
    expect(updated.verifiedQuantity).toBe(65);
    expect(updated.quantityMultiplier).toBe(5);
  });

  it("uses recorded quantity as the safe unit fallback when old metadata is missing", () => {
    expect(applyHandoverQuantityMultiplier(item({ recordedQuantity: 13, verifiedQuantity: 13, qrQuantity: undefined, quantityMultiplier: undefined }), 5).verifiedQuantity).toBe(65);
  });

  it("preserves QR multiplication metadata across an authoritative ERP refresh", () => {
    const local = item({ recordedQuantity: 13, verifiedQuantity: 65, qrQuantity: 13, quantityMultiplier: 5 });
    const authoritative = item({ stockEntryRow: "", recordedQuantity: 65, verifiedQuantity: 65, qrQuantity: undefined, quantityMultiplier: undefined });
    expect(preserveHandoverScanMetadata([authoritative], [local])[0]).toMatchObject({ qrQuantity: 13, quantityMultiplier: 5 });
  });

  it("persists Draft Stock Entry names for checker handover", () => {
    const handover = mergeHandoverDraft(null, item(), "HANDOVER-1");
    saveDeviceHandover(handover);
    expect(loadDeviceHandover()?.drafts[0].stockEntryId).toBe("MAT-STE-1");
    expect(loadDeviceHandover()?.status).toBe("PENDING_CHECK");
  });

  it("persists the backend-issued Handover QR across app restarts", () => {
    const handover = { ...mergeHandoverDraft(null, item(), "HANDOVER-1"), token: "signed-token",
      expiresAt: "2027-01-01T00:00:00Z", handoverQr: '{"type":"QCMC_WAREHOUSE_HANDOVER"}' };
    saveDeviceHandover(handover);
    expect(loadDeviceHandover()).toMatchObject({ token: "signed-token", handoverQr: handover.handoverQr });
  });

  it.each(["COMPLETED", "completed", "CANCELLED", "cancelled"])("excludes terminal handover status %s during hydration", (status) => {
    saveDeviceHandover({ ...mergeHandoverDraft(null, item(), "HANDOVER-1"), status: status as DeviceHandover["status"] });
    expect(loadDeviceHandover()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith("qcmc.warehouseHandover.v2");
  });

  it("excludes submitted entries and non-pending handover statuses from Checker activity", () => {
    const rows = [item({ stockEntryRow: "draft", docstatus: 0 }), item({ stockEntryRow: "submitted", docstatus: 1 }), item({ stockEntryRow: "cancelled", docstatus: 2 })];
    expect(pendingCheckerItems(rows, "PENDING_CHECK").map((row) => row.stockEntryRow)).toEqual(["draft"]);
    for (const status of ["CHECKED", "ALLOCATION_CREATED", "COMPLETED", "CANCELLED"])
      expect(pendingCheckerItems(rows, status)).toEqual([]);
  });

  it("lets authoritative server terminal status remove stale local activity", () => {
    const stale = mergeHandoverDraft(null, item(), "HANDOVER-1");
    expect(reconcileHandoverServerStatus(stale, "COMPLETED")).toBeNull();
    expect(reconcileHandoverServerStatus(stale, "allocation_created")?.status).toBe("ALLOCATION_CREATED");
    expect(isTerminalHandoverStatus("cOmPlEtEd")).toBe(true);
  });

  it("clears only cache and retries related to the completed workflow", () => {
    saveDeviceHandover(mergeHandoverDraft(null, item(), "HANDOVER-1"));
    prepareHandoverMutation("complete:WA-1", "/complete", { batch_id: "HANDOVER-1", warehouse_allocation: "WA-1", stock_entry_id: "MAT-STE-1" }, "request_id", "r1");
    prepareHandoverMutation("complete:WA-OTHER", "/complete", { batch_id: "OTHER", warehouse_allocation: "WA-OTHER" }, "request_id", "r2");
    clearCompletedHandoverCache("HANDOVER-1", "WA-1", ["MAT-STE-1"]);
    expect(loadDeviceHandover()).toBeNull();
    expect(loadHandoverMutations().map((row) => row.id)).toEqual(["r2"]);
  });

  it("does not duplicate the same Stock Entry row", () => {
    const first = mergeHandoverDraft(null, item(), "HANDOVER-1");
    const second = mergeHandoverDraft(first, item({ verifiedQuantity: 18 }), "HANDOVER-1");
    expect(second.drafts).toHaveLength(1);
    expect(second.drafts[0].verifiedQuantity).toBe(18);
  });

  it("keeps different rows from the same Stock Entry separate", () => {
    const first = mergeHandoverDraft(null, item(), "HANDOVER-1");
    const second = mergeHandoverDraft(first, item({ stockEntryRow: "row-2", itemCode: "FG-2" }), "HANDOVER-1");
    expect(second.drafts).toHaveLength(2);
  });

  it("clears only the active device handover record", () => {
    saveDeviceHandover(mergeHandoverDraft(null, item(), "HANDOVER-1"));
    clearDeviceHandover();
    expect(loadDeviceHandover()).toBeNull();
  });
});

describe("handover QR validation", () => {
  it("builds the same signed Picker payload from a verified same-device handover", () => {
    const handover = {
      ...mergeHandoverDraft(null, item(), "HANDOVER-1"),
      status: "CHECKED" as const,
      checker: "Pedro Test",
      checkerId: "EMP-CHECKER",
      stockEntriesSubmitted: true,
      token: "signed-token",
      expiresAt: "2026-09-24T18:00:00Z",
    };

    expect(createDeviceHandoverQrPayload(handover)).toMatchObject({
      type: "QCMC_WAREHOUSE_HANDOVER",
      version: 1,
      batch_id: "HANDOVER-1",
      stock_entry_ids: ["MAT-STE-1"],
      token: "signed-token",
    });
  });

  it("accepts a complete signed handover envelope", () => {
    const parsed = parseHandoverQr(JSON.stringify({
      type: "QCMC_WAREHOUSE_HANDOVER", version: 1, batch_id: "HANDOVER-1",
      stock_entry_ids: ["MAT-STE-1"], issued_at: "2026-09-04T08:00:00Z", expires_at: "2026-09-04T09:00:00Z", token: "signed-token",
    }));
    expect(parsed.batch_id).toBe("HANDOVER-1");
  });

  it.each([
    "not-json",
    JSON.stringify({ type: "QCMC_WAREHOUSE_HANDOVER", version: 1, batch_id: "HANDOVER-1", stock_entry_ids: ["MAT-STE-1"] }),
    JSON.stringify({ type: "OTHER", version: 1, batch_id: "HANDOVER-1", stock_entry_ids: ["MAT-STE-1"], token: "x" }),
  ])("rejects an invalid or incomplete handover QR", (raw) => {
    expect(() => parseHandoverQr(raw)).toThrow();
  });
});

describe("allocation completion", () => {
  const allocation = (statuses: string[]) => ({
    name: "WA-1", status: "Draft", stockEntriesRemainDraft: true, rows: statuses.map((status, index) => ({
      allocationId: `row-${index}`, sourceDocument: "MAT-STE-1", sourceRow: `${index}`,
      itemCode: "FG-1", itemName: "Finished Item", uom: "PCS", originalQuantity: 20,
      allocatedQuantity: 20, suggestedLocation: `LOC-${index}`, actualLocation: `LOC-${index}`,
      targetWarehouse: "FG - QCMC", priority: index + 1, status,
    })),
  });

  it("allows completion only when every allocation row is verified", () => {
    expect(allocationIsReadyToComplete(allocation(["VERIFIED", "VERIFIED"]))).toBe(true);
    expect(allocationIsReadyToComplete(allocation(["VERIFIED", "CONFIRMED"]))).toBe(false);
    expect(allocationIsReadyToComplete(allocation(["VERIFIED", "PENDING_VERIFICATION"]))).toBe(false);
  });

  it("does not allow an empty allocation to complete", () => {
    expect(allocationIsReadyToComplete(allocation([]))).toBe(false);
  });

  it("defaults verification to the currently allocated quantity", () => {
    expect(allocationDefaultQuantity(allocation(["PENDING_VERIFICATION"]).rows[0])).toBe(20);
  });

  it("converts plain and comma-formatted keypad quantities to numbers", () => {
    expect(parseAllocationQuantityInput("20000")).toBe(20000);
    expect(parseAllocationQuantityInput(" 20,000 ")).toBe(20000);
    expect(Number.isFinite(parseAllocationQuantityInput("20000"))).toBe(true);
  });

  it("shows remaining quantity and blocks completion until reallocation is fully verified", () => {
    const reduced = allocation(["VERIFIED"]);
    reduced.rows[0] = { ...reduced.rows[0], originalQuantity: 10000, allocatedQuantity: 5000 };
    expect(allocationItemBalances(reduced)[0]).toMatchObject({ required: 10000, allocated: 5000, remaining: 5000 });
    expect(allocationIsReadyToComplete(reduced)).toBe(false);
    reduced.rows.push({ ...reduced.rows[0], allocationId: "row-new", originalQuantity: 5000, allocatedQuantity: 5000, suggestedLocation: "LOC-2", actualLocation: "", status: "PENDING_VERIFICATION" });
    expect(allocationItemBalances(reduced)[0].remaining).toBe(0);
    expect(allocationIsReadyToComplete(reduced)).toBe(false);
    reduced.rows[1] = { ...reduced.rows[1], status: "VERIFIED", actualLocation: "LOC-2" };
    expect(allocationIsReadyToComplete(reduced)).toBe(true);
  });

  it("rejects a quantity increase that would exceed Production requirements", () => {
    const value = allocation(["PENDING_VERIFICATION"]);
    value.rows[0] = { ...value.rows[0], originalQuantity: 10000, allocatedQuantity: 10000 };
    expect(validateAllocationQuantity(value, value.rows[0], 11000)).toContain("cannot exceed");
    expect(validateAllocationQuantity(value, value.rows[0], 5000)).toBe("");
  });

  it("rejects an allocation quantity above the live Storage Location capacity", () => {
    const value = allocation(["PENDING_VERIFICATION"]);
    value.rows[0] = { ...value.rows[0], originalQuantity: 10000, allocatedQuantity: 10000 };

    expect(validateAllocationQuantity(value, value.rows[0], 10000, {
      locationCode: "GB9-STG",
      storageCapacity: 5000,
    })).toContain("capacity is 5000");
    expect(validateAllocationQuantity(value, value.rows[0], 5000, {
      locationCode: "GB9-STG",
      storageCapacity: 5000,
    })).toBe("");
  });

  it("keeps identical items from separate Stock Entry source rows independent", () => {
    const value = allocation(["PENDING_VERIFICATION", "PENDING_VERIFICATION"]);
    value.rows = value.rows.map((row, index) => ({ ...row, sourceDocument: `MAT-STE-${index + 1}`,
      sourceRow: `source-row-${index + 1}`, originalQuantity: 10000, allocatedQuantity: 10000 }));
    expect(allocationItemBalances(value)).toHaveLength(2);
    expect(allocationItemBalances(value).every((balance) => balance.required === 10000 && balance.allocated === 10000 && balance.overAllocated === 0)).toBe(true);
    expect(validateAllocationQuantity(value, value.rows[0], 10000)).toBe("");
    expect(validateAllocationQuantity(value, value.rows[1], 10000)).toBe("");
  });

  it("reopens a refreshed allocation row when ERPNext changed only its allocation ID", () => {
    const beforeRestart = allocation(["PENDING_VERIFICATION"]).rows[0];
    const refreshed = { ...beforeRestart, allocationId: "erp-regenerated-row-id" };

    expect(findMatchingAllocationRow([refreshed], beforeRestart)).toEqual(refreshed);
  });

  it("does not guess when multiple refreshed rows share the same stable source identity", () => {
    const beforeRestart = allocation(["PENDING_VERIFICATION"]).rows[0];
    const duplicates = [
      { ...beforeRestart, allocationId: "new-row-1" },
      { ...beforeRestart, allocationId: "new-row-2" },
    ];

    expect(findMatchingAllocationRow(duplicates, beforeRestart)).toBeUndefined();
  });

  it("recognizes the saved unfinished allocation for a rescanned Handover batch", () => {
    const active = { batchId: " QCMC-HANDOVER-1 ", allocation: allocation(["PENDING_VERIFICATION"]), updatedAt: "now" };

    expect(isActiveAllocationForBatch(active, "qcmc-handover-1")).toBe(true);
    expect(isActiveAllocationForBatch(active, "QCMC-HANDOVER-2")).toBe(false);
  });

  it("allows Picker resume after ERPNext marks the handover allocation as created", () => {
    expect(isPickerReadyStatus("CHECKED")).toBe(true);
    expect(isPickerReadyStatus("ALLOCATION_CREATED")).toBe(true);
    expect(isPickerReadyStatus("PENDING_CHECK")).toBe(false);
  });

  it("accepts Completed with docstatus 1 or an omitted docstatus, but rejects docstatus 0", () => {
    const value = allocation(["VERIFIED"]);
    expect(isAllocationCompleted({ ...value, status: "Completed", docstatus: 1 })).toBe(true);
    expect(isAllocationCompleted({ ...value, status: "Completed", docstatus: undefined })).toBe(true);
    expect(isAllocationCompleted({ ...value, status: "Completed", docstatus: 0 })).toBe(false);
  });

  it("keeps completed allocation history without deleting earlier finished transactions", () => {
    const first = allocation(["VERIFIED"]);
    saveCompletedAllocationHistory({ allocationName: "WA-1", batchId: "H1", completedAt: "2026-09-04T10:00:00Z", checker: "C1", picker: "P1", stockEntryIds: ["STE-1"], allocation: first });
    saveCompletedAllocationHistory({ allocationName: "WA-2", batchId: "H2", completedAt: "2026-09-04T11:00:00Z", checker: "C2", picker: "P2", stockEntryIds: ["STE-2"], allocation: { ...first, name: "WA-2" } });
    expect(loadCompletedAllocationHistory().map((entry) => entry.allocationName)).toEqual(["WA-2", "WA-1"]);
  });
});

describe("authoritative checker and allocation rules", () => {
  it("unlocks Handover QR generation only with authoritative checker identity", () => {
    const base = mergeHandoverDraft(null, item(), "HANDOVER-1");
    expect(canGenerateHandoverQr({ ...base, status: "CHECKED", checker: "Pedro Test" })).toBe(false);
    expect(canGenerateHandoverQr({ ...base, status: "PENDING_CHECK", checker: "Pedro Test", checkerId: "ASSIGN-CHECKER-00001" })).toBe(false);
    expect(canGenerateHandoverQr({ ...base, status: "CHECKED", checker: "Pedro Test", checkerId: "ASSIGN-CHECKER-00001" })).toBe(false);
    expect(canGenerateHandoverQr({ ...base, status: "CHECKED", checker: "Pedro Test", checkerId: "ASSIGN-CHECKER-00001", stockEntriesSubmitted: true })).toBe(true);
  });

  it("inherits Stock Entry metadata into nested item rows", () => {
    const rows = parseHandoverItems([{
      stock_entry_id: "MAT-STE-1", job_card: "PO-JOB00022", work_order: "MFG-WO-22",
      custom_reference_document: "PULL-22", items: [{ name: "row-1", item_code: "FG-1", item_name: "Finished Good", qty: 13, stock_uom: "PCS" }],
    }]);
    expect(rows[0]).toMatchObject({ stockEntryId: "MAT-STE-1", stockEntryRow: "row-1", jobCardId: "PO-JOB00022",
      workOrderId: "MFG-WO-22", pullOutSlip: "PULL-22", itemCode: "FG-1", itemName: "Finished Good", recordedQuantity: 13, uom: "PCS" });
  });

  it("derives the Picker warehouse from the Job Card target warehouse", () => {
    const rows = [item({ targetWarehouse: "FG - Sta Clara" }), item({ targetWarehouse: "FG-Sta Clara" })];
    expect(getPickerTargetWarehouse(rows, ["FG - Sagad", "FG - Sta Clara"])).toBe("FG - Sta Clara");
    expect(() => getPickerTargetWarehouse([item({ targetWarehouse: "" })], ["FG - Sta Clara"]))
      .toThrowError(expect.objectContaining({ code: "TARGET_WAREHOUSE_REQUIRED" }));
    expect(() => getPickerTargetWarehouse([item({ targetWarehouse: "FG - Sta Clara" }), item({ targetWarehouse: "FG - Sagad" })], ["FG - Sta Clara", "FG - Sagad"]))
      .toThrowError(expect.objectContaining({ code: "TARGET_WAREHOUSE_CONFLICT" }));
    expect(() => getPickerTargetWarehouse([item({ targetWarehouse: "FG - Sta Clara" })], ["FG - Sagad"]))
      .toThrowError(expect.objectContaining({ code: "WAREHOUSE_PERMISSION_DENIED" }));
  });

  it("requires a reason when the checker changes quantity", () => {
    expect(validateCheckerCorrections([item({ verifiedQuantity: 18 })])).toHaveLength(1);
    expect(validateCheckerCorrections([item({ verifiedQuantity: 18, correctionReason: "Physical shortage" })])).toEqual([]);
  });

  it("preserves allocation order returned by ERPNext", () => {
    const parsed = parseAllocation({ success: true, warehouse_allocation: "WA-1", rows: [
      { allocation_id: "rack-8", item_code: "FG-1", priority: 8, suggested_location: "R8", status: "PENDING_VERIFICATION" },
      { allocation_id: "rack-1", item_code: "FG-1", priority: 1, suggested_location: "R1", status: "PENDING_VERIFICATION" },
    ] });
    expect(parsed.rows.map((row) => row.allocationId)).toEqual(["rack-8", "rack-1"]);
  });
});
