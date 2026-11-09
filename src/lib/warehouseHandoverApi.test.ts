import { beforeEach, describe, expect, it, vi } from "vitest";

const { erpRequest } = vi.hoisted(() => ({ erpRequest: vi.fn() }));
vi.mock("@/lib/erpApi", () => ({
  erpRequest,
  extractErrorMessage: (payload: Record<string, unknown>, fallback: string) => String(payload.message || payload.error || fallback),
}));
vi.mock("@/lib/erpSession", () => ({ getErpMobileToken: () => "mobile-token" }));

import { createManufactureReceiveDraft, validateManufactureJobCard } from "@/lib/manufacturingService";
import { addStockEntryToHandover, completeWarehouseAllocation, confirmChecker, createWarehouseAllocation, generateHandoverQr, getCheckerReview, getDeviceCompletedAllocationHistory, getPickerContext, updateManufactureReceiveDraft, verifyAllocationLocation } from "@/lib/warehouseHandover";
import { loadHandoverMutations } from "@/lib/handoverMutationQueue";
import { clearOnlineRequestsForTests } from "@/lib/receiveFinishedGoodsOnline";

const values = new Map<string, string>();
const success = (payload: Record<string, unknown>) => ({ ok: true, status: 200, data: { message: { success: true, ...payload } } });

beforeEach(() => {
  values.clear(); erpRequest.mockReset(); clearOnlineRequestsForTests();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

describe("finished goods handover API contract", () => {
  it("validates a Job Card through the mobile-token endpoint instead of the resource API", async () => {
    erpRequest.mockResolvedValue(success({ job_card: "JC-1", work_order: "WO-1", production_item: "FG-1",
      required_quantity: 10000, available_quantity: 8000, completed_quantity: 2000, manufactured_quantity: 2000,
      warehouse: "WIP - QCMC", status: "Work In Progress", docstatus: 1 }));

    const context = await validateManufactureJobCard("JC-1");

    expect(erpRequest).toHaveBeenCalledWith(
      "/api/method/qcmc_logic.api.stock_entry_scanner.validate_manufacture_job_card",
      expect.objectContaining({ method: "POST", body: { job_card_id: "JC-1", mobile_token: "mobile-token" } })
    );
    expect(erpRequest.mock.calls[0][0]).not.toContain("/api/resource/Job Card/");
    expect(context).toEqual({ jobCardId: "JC-1", workOrderId: "WO-1", itemCode: "FG-1", requiredQuantity: 10000,
      availableQuantity: 8000, completedQuantity: 2000, manufacturedQuantity: 2000, warehouse: "WIP - QCMC",
      status: "Work In Progress", docstatus: 1 });
  });

  it("sends receiving quantity, device, persistent request ID, and expects no Putaway allocation", async () => {
    erpRequest.mockResolvedValue(success({ stock_entry_id: "MAT-STE-1", docstatus: 0, status: "Draft", existing_draft: false,
      job_card_id: "JC-1", work_order_id: "WO-1", finished_items: [{ stock_entry_row: "row-1", item_code: "FG-1", expected_quantity: 10000, stock_uom: "PCS" }],
      putaway_allocations: [], allocation_count: 0 }));
    const context = await createManufactureReceiveDraft("JC-1", "PULL-1", { quantity: 10000, actualWeightPerItem: 1.25, deviceId: "Scanner 1", requestId: "receive-uuid" });
    expect(erpRequest.mock.calls[0][1].body).toMatchObject({ job_card_id: "JC-1", custom_reference_document: "PULL-1", quantity: 10000, custom_actual_weight_per_item: 1.25, device_id: "Scanner 1", request_id: "receive-uuid", mobile_token: "mobile-token" });
    expect(context.putawayAllocations).toEqual([]);
  });

  it("sends complete-package audit fields with the full 500-piece movement", async () => {
    erpRequest.mockResolvedValue(success({ stock_entry_id: "MAT-STE-1", docstatus: 0, finished_items: [] }));

    await createManufactureReceiveDraft("JC-1", "PULL-1", {
      quantity: 500,
      qrQuantity: 500,
      packageStatus: "COMPLETE",
      pulloutQuantity: 500,
      remainingQuantity: 0,
      packageCount: 1,
      deviceId: "S1",
      requestId: "full-package-id",
    });

    expect(erpRequest.mock.calls[0][1].body).toMatchObject({
      quantity: 500,
      qr_quantity: 500,
      package_status: "COMPLETE",
      pullout_quantity: 500,
      remaining_quantity: 0,
      package_count: 1,
      request_id: "full-package-id",
    });
  });

  it("sends only the partial pullout quantity and its calculated remainder", async () => {
    erpRequest.mockResolvedValue(success({ stock_entry_id: "MAT-STE-2", docstatus: 0, finished_items: [] }));

    await createManufactureReceiveDraft("JC-1", "PULL-2", {
      quantity: 5,
      qrQuantity: 500,
      packageStatus: "OPENED",
      pulloutQuantity: 5,
      remainingQuantity: 495,
      deviceId: "S1",
      requestId: "partial-package-id",
    });

    expect(erpRequest.mock.calls[0][1].body).toMatchObject({
      quantity: 5,
      qr_quantity: 500,
      package_status: "OPENED",
      pullout_quantity: 5,
      remaining_quantity: 495,
      request_id: "partial-package-id",
    });
  });

  it("reuses the same receiving request ID after a transport failure", async () => {
    erpRequest.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(success({ stock_entry_id: "MAT-STE-1", docstatus: 0, finished_items: [] }));
    await expect(createManufactureReceiveDraft("JC-1", "PULL-1", { quantity: 20, deviceId: "S1" })).rejects.toThrow("Internet connection is required");
    await createManufactureReceiveDraft("JC-1", "PULL-1", { quantity: 20, deviceId: "S1" });
    expect(erpRequest.mock.calls[1][1].body.request_id).toBe(erpRequest.mock.calls[0][1].body.request_id);
  });

  it("adds subsequent Draft Stock Entries to the returned batch", async () => {
    erpRequest.mockResolvedValueOnce(success({ batch_id: "HANDOVER-1", items: [] })).mockResolvedValueOnce(success({ batch_id: "HANDOVER-1", items: [] }));
    await addStockEntryToHandover("", "MAT-STE-1", "S1", "add-1");
    await addStockEntryToHandover("HANDOVER-1", "MAT-STE-2", "S1", "add-2");
    expect(erpRequest.mock.calls[0][1].body.batch_id).toBeUndefined();
    expect(erpRequest.mock.calls[1][1].body).toMatchObject({ batch_id: "HANDOVER-1", stock_entry_id: "MAT-STE-2" });
  });

  it("loads and updates Actual Weight on the exact Stock Entry item row", async () => {
    const qr = { type: "QCMC_WAREHOUSE_HANDOVER" as const, version: 1 as const, batch_id: "HANDOVER-1", stock_entry_ids: ["MAT-STE-1"], issued_at: "", expires_at: "", token: "token" };
    const item = { stock_entry_id: "MAT-STE-1", stock_entry_row: "ROW-1", item_code: "FG-1", item_name: "Finished",
      recorded_quantity: 10000, verified_quantity: 10000, stock_uom: "PCS", custom_actual_weight_per_item: 1.25 };
    erpRequest.mockResolvedValueOnce(success({ batch_id: "HANDOVER-1", status: "PENDING_CHECK", items: [item] }));
    const review = await getCheckerReview(qr);
    expect(review.items[0]).toMatchObject({ stockEntryId: "MAT-STE-1", stockEntryRow: "ROW-1", actualWeightPerItem: 1.25 });

    erpRequest.mockResolvedValueOnce(success({ status: "Draft", items: [{ ...item, custom_actual_weight_per_item: 1.5 }] }));
    const updated = { ...review.items[0], actualWeightPerItem: 1.5 };
    const result = await updateManufactureReceiveDraft("HANDOVER-1", [updated], "S1", "weight-update-1");
    expect(erpRequest.mock.calls[1][1].body).toMatchObject({ rows: [{ stock_entry_id: "MAT-STE-1", stock_entry_row: "ROW-1",
      item_code: "FG-1", quantity: 10000, custom_actual_weight_per_item: 1.5, uom: "PCS" }] });
    expect(result.items[0].actualWeightPerItem).toBe(1.5);
  });

  it("uses the backend-issued handover token without modification", async () => {
    erpRequest.mockResolvedValue(success({ type: "QCMC_WAREHOUSE_HANDOVER", version: 1, batch_id: "HANDOVER-1",
      stock_entry_ids: ["MAT-STE-1"], issued_at: "now", expires_at: "later", token: "backend-signed-token" }));
    const qr = await generateHandoverQr("HANDOVER-1", "qr-uuid");
    expect(JSON.parse(qr.raw).token).toBe("backend-signed-token");
    expect(qr.parsed.token).toBe("backend-signed-token");
  });

  it("sends the original Assign Checker QR and returns the authoritative checker", async () => {
    const checkerQr = JSON.stringify({ type: "assign_checker", version: 1, assign_checker_id: "ASSIGN-CHECKER-00001", name: "Untrusted Name", token: "signed-token", expires_at: "2027-09-04T14:00:00" });
    erpRequest.mockResolvedValue(success({ batch_id: "HANDOVER-1", checker: "Pedro Test", checker_id: "ASSIGN-CHECKER-00001",
      verified_at: "2026-09-04T14:00:00+08:00", status: "CHECKED", stock_entry_ids: ["MAT-STE-1"],
      stock_entries_submitted: true, submitted_stock_entry_ids: ["MAT-STE-1"] }));

    const result = await confirmChecker("HANDOVER-1", checkerQr, "Scanner 1", "checker-uuid");

    expect(erpRequest.mock.calls[0][0]).toBe("/api/method/qcmc_logic.api.warehouse_handover.confirm_checker");
    expect(erpRequest.mock.calls[0][1].body).toMatchObject({
      batch_id: "HANDOVER-1",
      checker_qr: checkerQr,
      device_id: "Scanner 1",
      request_id: "checker-uuid",
    });
    expect(result).toEqual({ batchId: "HANDOVER-1", checker: "Pedro Test", checkerId: "ASSIGN-CHECKER-00001",
      verifiedAt: "2026-09-04T14:00:00+08:00", status: "CHECKED", stockEntryIds: ["MAT-STE-1"],
      stockEntriesSubmitted: true, submittedStockEntryIds: ["MAT-STE-1"] });
    expect(result.checker).not.toBe("Untrusted Name");
  });

  it("never queues Checker verification offline and reuses its in-memory ID for an on-screen retry", async () => {
    const checkerQr = JSON.stringify({ type: "assign_checker", version: 1, token: "secret-token" });
    erpRequest.mockRejectedValueOnce(new Error("offline"));
    await expect(confirmChecker("HANDOVER-1", checkerQr, "S1", "same-uuid")).rejects.toThrow("Internet connection is required");
    expect(loadHandoverMutations()).toEqual([]);

    erpRequest.mockResolvedValueOnce(success({ batch_id: "HANDOVER-1", checker: "Pedro Test", checker_id: "ASSIGN-CHECKER-00001",
      verified_at: "now", status: "CHECKED", stock_entries_submitted: true, submitted_stock_entry_ids: ["MAT-STE-1"] }));
    await confirmChecker("HANDOVER-1", checkerQr, "S1");
    expect(erpRequest.mock.calls[1][1].body).toMatchObject({ checker_qr: checkerQr, request_id: "same-uuid" });
    expect(loadHandoverMutations()).toEqual([]);
  });

  it("uses only permitted warehouses and preserves Putaway row order", async () => {
    erpRequest.mockResolvedValueOnce(success({ status: "CHECKED", permitted_warehouses: ["FG - Guyong"], transaction_types: ["Stock Entry"], items: [{ stock_entry_id: "S1", stock_entry_row: "ROW-1", job_card: "JC-1", item_code: "FG-1", qty: 1, stock_uom: "PCS", t_warehouse: "FG - Guyong" }] }));
    const qr = { type: "QCMC_WAREHOUSE_HANDOVER" as const, version: 1 as const, batch_id: "H1", stock_entry_ids: ["S1"], issued_at: "", expires_at: "", token: "token" };
    const picker = await getPickerContext(qr);
    expect(picker.warehouses).toEqual(["FG - Guyong"]);
    expect(picker.items[0].targetWarehouse).toBe("FG - Guyong");

    erpRequest.mockResolvedValueOnce(success({ warehouse_allocation: "WA-1", rows: [
      { allocation_id: "r8", item_code: "FG-1", priority: 8, status: "PENDING_VERIFICATION" },
      { allocation_id: "r1", item_code: "FG-1", priority: 1, status: "PENDING_VERIFICATION" },
    ] }));
    const allocation = await createWarehouseAllocation({ batchId: "H1", token: "token", transactionType: "Stock Entry", warehouse: "FG - Guyong", postingDate: "2026-09-04", postingTime: "08:30:00", deviceId: "S1", requestId: "allocation-uuid" });
    expect(allocation.rows.map((row) => row.allocationId)).toEqual(["r8", "r1"]);
  });

  it("loads only completed allocation history assigned to this scanner device", async () => {
    erpRequest.mockResolvedValue(success({ history: [{ warehouse_allocation: "WA-1", batch_id: "H1",
      completed_at: "2026-09-09T09:00:00+08:00", checker: "Checker 1", picker: "Picker 1",
      stock_entry_ids: ["STE-1"], status: "Completed", docstatus: 1, rows: [
        { allocation_id: "ROW-1", source_document: "STE-1", source_row: "ITEM-ROW-1", item_code: "FG-1",
          stock_uom: "PCS", required_quantity: 10, actual_quantity: 10, actual_location: "LOC-1", status: "VERIFIED" },
      ] }] }));

    const history = await getDeviceCompletedAllocationHistory("S2");

    expect(erpRequest.mock.calls[0][0]).toBe("/api/method/qcmc_logic.api.warehouse_allocation.get_device_completed_history");
    expect(erpRequest.mock.calls[0][1].body).toMatchObject({ device_id: "S2", mobile_token: "mobile-token" });
    expect(history[0]).toMatchObject({ allocationName: "WA-1", batchId: "H1", stockEntryIds: ["STE-1"],
      allocation: { status: "Completed", docstatus: 1 } });
  });

  it("accepts authoritative allocation completion with docstatus 1", async () => {
    erpRequest.mockResolvedValue(success({ warehouse_allocation: "WA-1", status: "Completed", docstatus: 1, rows: [] }));
    const result = await completeWarehouseAllocation("WA-1", "S1", "complete-uuid");
    expect(result.allocation).toMatchObject({ name: "WA-1", status: "Completed", docstatus: 1, stockEntriesRemainDraft: false });
    expect(erpRequest.mock.calls[0][1].body).toMatchObject({ warehouse_allocation: "WA-1", device_id: "S1", request_id: "complete-uuid" });
  });

  it("accepts legacy Completed success without docstatus", async () => {
    erpRequest.mockResolvedValue(success({ warehouse_allocation: "WA-1", status: "Completed", rows: [] }));
    await expect(completeWarehouseAllocation("WA-1", "S1")).resolves.toMatchObject({ allocation: { status: "Completed" } });
  });

  it("rejects a completion response that remains Draft", async () => {
    erpRequest.mockResolvedValue(success({ warehouse_allocation: "WA-1", status: "Draft", docstatus: 0 }));
    await expect(completeWarehouseAllocation("WA-1", "S1")).rejects.toMatchObject({ code: "ALLOCATION_COMPLETION_INVALID_RESPONSE" });
  });

  it("uses suggested quantity and returns newly reallocated rows immediately", async () => {
    erpRequest.mockResolvedValue(success({ warehouse_allocation: "WA-1", status: "In Progress", rows: [
      { allocation_id: "A", item_code: "FG-1", required_quantity: 10000, actual_quantity: 5000, actual_location: "LOC-A", suggested_location: "LOC-A", status: "VERIFIED", stock_uom: "PCS" },
      { allocation_id: "B", item_code: "FG-1", required_quantity: 10000, suggested_quantity: 5000, suggested_location: "LOC-B", status: "PENDING_VERIFICATION", stock_uom: "PCS" },
    ] }));
    const row = { allocationId: "A", sourceDocument: "STE-1", sourceRow: "ROW-1", itemCode: "FG-1", itemName: "Finished",
      uom: "PCS", originalQuantity: 10000, requiredQuantity: 10000, allocatedQuantity: 10000, suggestedLocation: "LOC-A", actualLocation: "",
      targetWarehouse: "FG", priority: 1, status: "PENDING_VERIFICATION" };
    const result = await verifyAllocationLocation("WA-1", row, "LOC-A", 5000, "S1", "tx-1");
    expect(result.row).toMatchObject({ allocationId: "A", allocatedQuantity: 5000, actualLocation: "LOC-A", status: "VERIFIED" });
    expect(result.allocation?.rows).toHaveLength(2);
    expect(result.allocation?.rows[1]).toMatchObject({ allocationId: "B", allocatedQuantity: 5000, status: "PENDING_VERIFICATION" });
  });
});
