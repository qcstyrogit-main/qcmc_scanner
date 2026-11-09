import { beforeEach, describe, expect, it } from "vitest";
import { createPcountSubmissionId, PcountNotOpenError, PCOUNT_NOT_OPEN_MESSAGE, throwIfPcountNotOpen, type PcountEntry } from "@/lib/erpService";
import {
  buildPcountEntry,
  createPcountSourceFingerprint,
  getPcountVariance,
  getPcountNegativeCountMessage,
  getPcountNegativeCountIssue,
  PCOUNT_BLIND_CONFLICT_MESSAGE,
  PCOUNT_BLIND_CONFLICT_NOTICE,
  PCOUNT_BLIND_CONFLICT_TITLE,
  readPersistedPcountPayload,
  refreshPcountExpectedErpQuantity,
  requirePcountEntryLocation,
} from "@/lib/pcountSubmission";
import {
  getPcountInventoryTagEffectiveCount,
  loadLocalScanEntries,
  markPcountSubmissionTransactionsSubmitted,
  saveLocalScanEntries,
  type LocalScanEntry,
  type LocalScanTransaction,
} from "@/lib/scanStorage";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

beforeEach(() => storage.clear());

describe("Physical Count availability response", () => {
  it("throws the dedicated close-state error without exposing a retryable generic error", () => {
    expect(() => throwIfPcountNotOpen({
      success: false,
      error_code: "PCOUNT_NOT_OPEN",
      remove_from_last_activity: true,
    })).toThrow(PcountNotOpenError);

    try {
      throwIfPcountNotOpen({ error_code: "PCOUNT_NOT_OPEN", remove_from_last_activity: true });
    } catch (error) {
      expect(error).toMatchObject({
        code: "PCOUNT_NOT_OPEN",
        removeFromLastActivity: true,
        message: PCOUNT_NOT_OPEN_MESSAGE,
      });
    }
  });

  it("does not reject successful reconciliation contexts", () => {
    expect(() => throwIfPcountNotOpen({ success: true })).not.toThrow();
  });
});

const transaction = (
  id: string,
  action: "ADD" | "DEDUCT",
  quantity: number,
  locationId = "COLUMN-1",
  timestamp = `2026-09-01T00:00:0${id}.000Z`
): LocalScanTransaction => ({
  id,
  action,
  quantityChange: quantity,
  runningQuantity: 999999, // The builder must never trust this stale local value.
  timestamp,
  locationId,
  locationLabel: locationId,
  employeeId: "EMP-1",
  employeeName: "Stockman",
  deviceId: "S1",
});

const localEntry = (
  transactions: LocalScanTransaction[],
  locationId = "COLUMN-1",
  overrides: Partial<LocalScanEntry> = {}
): LocalScanEntry => ({
  raw: "ITEM-001;20;PCS;OLD",
  mode: "pcount",
  reconciliationCode: "MAT-RECO-1",
  bin: {
    raw: "",
    warehouse: "FG - Guyong",
    stockroom: "",
    building: "",
    aisle: "",
    rack: "",
    bin: locationId,
    locationId,
    locationCode: locationId,
  },
  itemCode: "ITEM-001",
  qrQuantity: 20,
  multiplier: transactions.length,
  quantity: 999999,
  uom: "PCS",
  authoritativeUom: "PCS",
  lotNo: "",
  timestamp: "",
  deviceId: "S1",
  submittedQuantity: 0,
  erpBaselineQuantity: 0,
  scanTransactions: transactions,
  submittedTransactionCount: 0,
  ...overrides,
});

const build = (entry: LocalScanEntry, expectedPreviousCount = 0) => buildPcountEntry({
  entry,
  warehouse: "FG - Guyong",
  expectedPreviousCount,
  expectedErpQuantity: 2500,
  authoritativeUom: "PCS",
});

describe("Physical Count submission payload", () => {
  it("requires a counting Storage Location before ERP baseline lookup", () => {
    const entry = localEntry([transaction("add-1", "ADD", 5)], "", {
      bin: {
        ...localEntry([]).bin,
        bin: "",
        locationId: "",
        locationCode: "",
      },
    });

    expect(() => requirePcountEntryLocation(entry)).toThrow(
      "ITEM-001: Storage Location is required. Select or scan a counting location before syncing."
    );
  });

  it("reports the exact item and location before submitting a negative local count", () => {
    const issue = getPcountNegativeCountIssue([
      localEntry([transaction("deduct-1", "DEDUCT", 10)], "BM3H4L1", {
        itemCode: "QTY #63",
        quantity: -10,
        uom: "PC",
        authoritativeUom: "PC",
      }),
    ]);

    expect(issue).toEqual({
      itemCode: "QTY #63",
      location: "BM3H4L1",
      quantity: -10,
      uom: "PC",
    });
    expect(getPcountNegativeCountMessage(issue!)).toBe(
      "QTY #63 at BM3H4L1 has negative count (-10 PC). Add quantity or review the scan history before submitting."
    );
  });

  it("uses the opened package's 495 remaining while retaining the original QR quantity of 500", () => {
    const opened = transaction("opened-1", "ADD", 495);
    Object.assign(opened, {
      qrQuantity: 500,
      packageStatus: "OPENED",
      actualQuantity: 495,
      remainingQuantity: 495,
    });

    const result = build(localEntry([opened]));

    expect(result.physicalCount).toBe(495);
    expect(result.transactions?.[0]).toMatchObject({
      quantityChange: 495,
      qrQuantity: 500,
      packageStatus: "OPENED",
      actualQuantity: 495,
      remainingQuantity: 495,
    });
  });

  it("changes the retry fingerprint when package audit data changes", () => {
    const first = transaction("opened-1", "ADD", 495);
    const second = transaction("opened-1", "ADD", 495);
    Object.assign(first, { qrQuantity: 500, packageStatus: "OPENED", actualQuantity: 495, remainingQuantity: 495 });
    Object.assign(second, { qrQuantity: 500, packageStatus: "COMPLETE", actualQuantity: 500, remainingQuantity: 0 });

    expect(createPcountSourceFingerprint("MAT-RECO-1", [localEntry([first])]))
      .not.toBe(createPcountSourceFingerprint("MAT-RECO-1", [localEntry([second])]));
  });

  it("uses +20 for one 20-PCS ADD scan", () => {
    const result = build(localEntry([transaction("1", "ADD", 20)]));
    expect(result.quantityDelta).toBe(20);
    expect(result.transactions?.[0].quantityChange).toBe(20);
  });

  it("uses +40 for two 20-PCS ADD scans", () => {
    const result = build(localEntry([transaction("1", "ADD", 20), transaction("2", "ADD", 20)]));
    expect(result.quantityDelta).toBe(40);
    expect(result.physicalCount).toBe(40);
  });

  it("normalizes ADD +40 then DEDUCT -20 to delta +20", () => {
    const result = build(localEntry([transaction("1", "ADD", 40), transaction("2", "DEDUCT", 20)]), 2000);
    expect(result.quantityDelta).toBe(20);
    expect(result.physicalCount).toBe(2020);
    expect(result.transactions?.map((value) => value.quantityChange)).toEqual([40, -20]);
  });

  it("calculates physicalCount from the expected count and delta", () => {
    expect(build(localEntry([transaction("1", "ADD", 20)]), 2000).physicalCount).toBe(2020);
  });

  it("rebuilds the final running quantity to equal physicalCount", () => {
    const result = build(localEntry([transaction("1", "ADD", 40), transaction("2", "DEDUCT", -20)]), 2000);
    expect(result.transactions?.at(-1)?.runningQuantity).toBe(result.physicalCount);
  });

  it("keeps Storage Locations as separate submission keys", () => {
    const first = localEntry([transaction("1", "ADD", 20, "COLUMN-1")], "COLUMN-1");
    const second = localEntry([transaction("2", "ADD", 40, "COLUMN-2")], "COLUMN-2");
    const firstFingerprint = createPcountSourceFingerprint("MAT-RECO-1", [first]);
    const secondFingerprint = createPcountSourceFingerprint("MAT-RECO-1", [second]);
    expect(firstFingerprint).not.toBe(secondFingerprint);
    expect([build(first), build(second)].map((value) => value.inventoryLocation)).toEqual(["COLUMN-1", "COLUMN-2"]);
  });

  it("keeps the full quantity for every item and location in a multi-location payload", () => {
    const locations = ["A", "B", "C"];
    const source = [
      ...locations.map((location, index) => localEntry(
        [transaction(`item-1-${index}`, "ADD", 1000, location)],
        location,
        { itemCode: "ITEM-001", qrQuantity: 1000, quantity: 1000 },
      )),
      ...locations.map((location, index) => localEntry(
        [transaction(`item-2-${index}`, "ADD", 25.5, location)],
        location,
        { itemCode: "ITEM-002", qrQuantity: 25.5, quantity: 25.5 },
      )),
    ];

    const rows = source.map((entry) => build(entry));

    expect(rows).toHaveLength(6);
    expect(rows.map(({ itemCode, inventoryLocation, quantity }) => ({ itemCode, inventoryLocation, quantity }))).toEqual([
      { itemCode: "ITEM-001", inventoryLocation: "A", quantity: 1000 },
      { itemCode: "ITEM-001", inventoryLocation: "B", quantity: 1000 },
      { itemCode: "ITEM-001", inventoryLocation: "C", quantity: 1000 },
      { itemCode: "ITEM-002", inventoryLocation: "A", quantity: 25.5 },
      { itemCode: "ITEM-002", inventoryLocation: "B", quantity: 25.5 },
      { itemCode: "ITEM-002", inventoryLocation: "C", quantity: 25.5 },
    ]);
  });

  it("rejects invalid history before an API payload can be submitted", () => {
    expect(() => build(localEntry([transaction("1", "DEDUCT", 20)]), 0)).toThrow(/negative/i);
    expect(() => build(localEntry([transaction("1", "ADD", 20, "COLUMN-2")]), 0)).toThrow(/belongs to COLUMN-2/i);
  });

  it("reads an offline retry as the identical frozen payload and submission ID", () => {
    const entry = build(localEntry([transaction("1", "ADD", 20)]));
    const payload = {
      reconciliation_id: "MAT-RECO-1",
      operation: "adjustment" as const,
      submission_id: "fixed-uuid",
      entries: [entry],
    };
    const retry = readPersistedPcountPayload(JSON.parse(JSON.stringify(payload)));
    expect(retry).toEqual(payload);
    expect(retry?.submission_id).toBe("fixed-uuid");
  });

  it("marks only the transactions included in a successful submission", () => {
    const stored = localEntry([transaction("1", "ADD", 20), transaction("2", "ADD", 20)]);
    saveLocalScanEntries("EMP-1", [stored]);
    const submitted = build(localEntry([transaction("1", "ADD", 20)]));
    markPcountSubmissionTransactionsSubmitted("EMP-1", "MAT-RECO-1", [submitted]);
    const saved = loadLocalScanEntries("EMP-1")[0];
    expect(saved.submittedTransactionIds).toEqual(["1"]);
    expect(createPcountSourceFingerprint("MAT-RECO-1", [saved])).toContain('"id":"2"');
    expect(createPcountSourceFingerprint("MAT-RECO-1", [saved])).not.toContain('"id":"1"');
  });

  it("uses a new submission UUID for a later Submit action", () => {
    const first = createPcountSubmissionId();
    const second = createPcountSubmissionId();
    expect(first).not.toBe(second);
  });

  it("starts a follow-up DEDUCT from the last submitted physical count", () => {
    const followUp = localEntry([transaction("deduct-1", "DEDUCT", 500)], "COLUMN-1", {
      quantity: 1000,
      submittedQuantity: 1500,
      submittedPhysicalCount: 1500,
      erpBaselineQuantity: 2000,
    });
    const result = buildPcountEntry({
      entry: followUp,
      warehouse: "FG - Guyong",
      expectedPreviousCount: followUp.submittedPhysicalCount || 0,
      expectedErpQuantity: followUp.erpBaselineQuantity || 0,
      authoritativeUom: "PCS",
    });
    expect(result.expectedPreviousCount).toBe(1500);
    expect(result.quantityDelta).toBe(-500);
    expect(result.physicalCount).toBe(1000);
    expect(result.transactions?.[0].runningQuantity).toBe(1000);
    expect(result.expectedERPQuantity).toBe(2000);
  });

  it("submits non-negative quantity even when the count adjustment is a deduction", () => {
    const followUp = localEntry([transaction("deduct-1", "DEDUCT", 500)], "COLUMN-1", {
      submittedPhysicalCount: 1500,
      erpBaselineQuantity: 2000,
    });
    const result = buildPcountEntry({
      entry: followUp,
      warehouse: "FG - Guyong",
      expectedPreviousCount: 1500,
      expectedErpQuantity: 2000,
      authoritativeUom: "PCS",
    });

    expect(result.quantityDelta).toBe(-500);
    expect(result.physicalCount).toBe(1000);
    expect(result.quantity).toBe(1000);
  });

  it("sends ERP Stock UOM separately from barcode UOM", () => {
    const result = buildPcountEntry({
      entry: localEntry([transaction("add-1", "ADD", 6400)], "COLUMN-1", {
        raw: "MNN12BSWP;6400;PCK",
        itemCode: "MNN12BSWP",
        uom: "PC",
        barcodeUom: "PCK",
        authoritativeUom: "PC",
      }),
      warehouse: "FG - Guyong",
      expectedPreviousCount: 0,
      expectedErpQuantity: 0,
      authoritativeUom: "PC",
    });

    expect(result.quantity).toBe(6400);
    expect(result.quantityDelta).toBe(6400);
    expect(result.physicalCount).toBe(6400);
    expect(result.uom).toBe("PC");
    expect(result.stockUom).toBe("PC");
  });
});

describe("Physical Count Inventory Tag recount baseline", () => {
  const tagged = (
    id: string,
    action: "ADD" | "DEDUCT",
    quantity: number,
    inventoryTag: string
  ) => ({ ...transaction(id, action, quantity), inventoryTag });

  it("uses the latest effective tagged count after a submitted recount", () => {
    const entry = localEntry([
      tagged("original", "ADD", 15000, "A4"),
      tagged("recount-1", "DEDUCT", 1000, "A4"),
    ], "COLUMN-1", {
      submittedTransactionIds: ["original", "recount-1"],
      submittedPhysicalCount: 14000,
    });

    expect(getPcountInventoryTagEffectiveCount(entry, "A4")).toBe(14000);
    expect(13500 - getPcountInventoryTagEffectiveCount(entry, "A4")!).toBe(-500);
  });

  it("includes a pending recount correction when another recount is started locally", () => {
    const entry = localEntry([
      tagged("original", "ADD", 15000, "A4"),
      tagged("recount-1", "DEDUCT", 1000, "A4"),
    ], "COLUMN-1", {
      submittedTransactionIds: ["original"],
      submittedPhysicalCount: 15000,
    });

    expect(getPcountInventoryTagEffectiveCount(entry, "A4")).toBe(14000);
  });

  it("isolates the baseline by Inventory Tag", () => {
    const entry = localEntry([
      tagged("a4", "ADD", 15000, "A4"),
      tagged("a5", "ADD", 7000, "A5"),
      tagged("a4-recount", "DEDUCT", 1000, "A4"),
    ], "COLUMN-1", {
      submittedTransactionIds: ["a4", "a5", "a4-recount"],
      submittedPhysicalCount: 21000,
    });

    expect(getPcountInventoryTagEffectiveCount(entry, "A4")).toBe(14000);
    expect(getPcountInventoryTagEffectiveCount(entry, "A5")).toBe(7000);
  });

  it("supports older single-tag rows that only have an acknowledged physical-count snapshot", () => {
    const entry = localEntry([
      tagged("legacy-a4", "ADD", 15000, "A4"),
    ], "COLUMN-1", {
      submittedTransactionIds: [],
      submittedTransactionCount: 0,
      submittedPhysicalCount: 15000,
      submittedQuantity: 15000,
    });

    expect(getPcountInventoryTagEffectiveCount(entry, "A4")).toBe(15000);
  });

  it("refuses to guess a tagged baseline when this device has no tagged submitted history", () => {
    const entry = localEntry([], "COLUMN-1", {
      submittedPhysicalCount: 15000,
      submittedQuantity: 15000,
    });

    expect(getPcountInventoryTagEffectiveCount(entry, "A4")).toBeNull();
  });
});

describe("PCOUNT_STOCK_CHANGED review", () => {
  it("keeps the scanner conflict copy blind", () => {
    const copy = [PCOUNT_BLIND_CONFLICT_TITLE, PCOUNT_BLIND_CONFLICT_MESSAGE, PCOUNT_BLIND_CONFLICT_NOTICE].join(" ");
    expect(copy).not.toMatch(/expected quantity|expected adjustment|variance|book quantity|ERP balance|current ERP quantity|previous ERP/i);
    expect(copy).not.toMatch(/\b\d+(?:[,.]\d+)*\b/);
  });

  const countedEntry = () => buildPcountEntry({
    entry: localEntry([transaction("count-1", "ADD", 1500)]),
    warehouse: "FG - Guyong",
    expectedPreviousCount: 0,
    expectedErpQuantity: 2500,
    authoritativeUom: "PCS",
  });

  it("preserves physicalCount when the ERP baseline refreshes", () => {
    const refreshed = refreshPcountExpectedErpQuantity([countedEntry()], {
      itemCode: "ITEM-001", warehouse: "FG - Guyong", inventoryLocation: "COLUMN-1",
    }, 2000)[0];
    expect(refreshed.physicalCount).toBe(1500);
  });

  it("preserves all scan transactions", () => {
    const original = countedEntry();
    const refreshed = refreshPcountExpectedErpQuantity([original], {
      itemCode: original.itemCode, warehouse: original.warehouse, inventoryLocation: original.inventoryLocation,
    }, 2000)[0];
    expect(refreshed.transactions).toEqual(original.transactions);
  });

  it("changes only expectedERPQuantity on the conflicted payload entry", () => {
    const original = countedEntry();
    const refreshed = refreshPcountExpectedErpQuantity([original], {
      itemCode: original.itemCode, warehouse: original.warehouse, inventoryLocation: original.inventoryLocation,
    }, 2000)[0];
    expect({ ...refreshed, expectedERPQuantity: original.expectedERPQuantity }).toEqual(original);
    expect(refreshed.expectedERPQuantity).toBe(2000);
  });

  it("calculates variance as physicalCount minus refreshed ERP quantity", () => {
    const refreshed = { ...countedEntry(), expectedERPQuantity: 2000 };
    expect(getPcountVariance(refreshed)).toBe(-500);
  });

  it("uses a new submission ID for changed request content", () => {
    expect(createPcountSubmissionId()).not.toBe(createPcountSubmissionId());
  });

  it("preserves existing transaction IDs", () => {
    const original = countedEntry();
    const refreshed = refreshPcountExpectedErpQuantity([original], {
      itemCode: original.itemCode, warehouse: original.warehouse, inventoryLocation: original.inventoryLocation,
    }, 2000)[0];
    expect(refreshed.transactions?.map(({ id }) => id)).toEqual(["count-1"]);
  });

  it("keeps the count pending when review is cancelled", () => {
    const local = localEntry([transaction("count-1", "ADD", 1500)]);
    saveLocalScanEntries("EMP-1", [local]);
    const before = createPcountSourceFingerprint("MAT-RECO-1", loadLocalScanEntries("EMP-1"));
    const after = createPcountSourceFingerprint("MAT-RECO-1", loadLocalScanEntries("EMP-1"));
    expect(after).toBe(before);
    expect(after).toContain("count-1");
  });

  it("does not change unrelated locations", () => {
    const target = countedEntry();
    const unrelated = buildPcountEntry({
      entry: localEntry([transaction("other", "ADD", 80, "COLUMN-2")], "COLUMN-2"),
      warehouse: "FG - Guyong", expectedPreviousCount: 0, expectedErpQuantity: 100, authoritativeUom: "PCS",
    });
    const refreshed = refreshPcountExpectedErpQuantity([target, unrelated], {
      itemCode: target.itemCode, warehouse: target.warehouse, inventoryLocation: target.inventoryLocation,
    }, 2000);
    expect(refreshed[1]).toBe(unrelated);
  });

  it("retains the local pending scan while offline", () => {
    const local = localEntry([transaction("offline", "ADD", 20)]);
    saveLocalScanEntries("EMP-1", [local]);
    expect(loadLocalScanEntries("EMP-1")[0].scanTransactions?.[0].id).toBe("offline");
  });

  it("never adds current ERP stock to the physical count", () => {
    const entry = countedEntry();
    expect(entry.expectedERPQuantity).toBe(2500);
    expect(entry.physicalCount).toBe(1500);
    expect(entry.physicalCount).not.toBe(4000);
  });
});
