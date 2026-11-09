import { beforeEach, describe, expect, it } from "vitest";
import {
  createLocationTransferTransaction,
  createPhysicalCountTransaction,
  createWarehouseAllocationTransaction,
  loadFailedTransactionHistory,
  loadSuccessfulTransactionHistory,
  isTransactionForDevice,
  saveFailedPhysicalCountTransaction,
  saveSuccessfulTransaction,
  type SuccessfulTransaction,
} from "@/lib/transactionHistory";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  },
});

beforeEach(() => values.clear());

const transaction = (overrides: Partial<SuccessfulTransaction> = {}): SuccessfulTransaction => ({
  id: "physical_count:MAT-RECO-1:submission-1",
  type: "physical_count",
  reference: "MAT-RECO-1",
  completedAt: "2026-09-24T08:00:00.000Z",
  title: "Physical Count",
  detail: "2 items / 500 PCS",
  ...overrides,
});

describe("successful transaction history", () => {
  it("records the current scanner name and separates receipts from other scanners", () => {
    values.set("qcmc.scanner.deviceName", "SmartPDA A");
    saveSuccessfulTransaction(transaction());
    saveFailedPhysicalCountTransaction({
      reconciliationId: "MAT-RECO-2", submissionId: "failed-1", locationCount: 1,
      entryCount: 1, errorMessage: "Offline",
    });
    const success = loadSuccessfulTransactionHistory()[0];
    const failure = loadFailedTransactionHistory()[0];
    expect(success.deviceId).toBe("SmartPDA A");
    expect(failure.deviceId).toBe("SmartPDA A");
    expect(isTransactionForDevice(success, "smartpda a")).toBe(true);
    expect(isTransactionForDevice(success, "SmartPDA B")).toBe(false);
    expect(isTransactionForDevice(failure, "SmartPDA B")).toBe(false);
    expect(isTransactionForDevice({ deviceId: undefined }, "SmartPDA A")).toBe(false);
  });

  it("builds a Physical Count success card from an ERP submission", () => {
    expect(createPhysicalCountTransaction({
      reconciliationId: "MAT-RECO-1",
      submissionId: "submission-1",
      itemCount: 2,
      entries: [
        { physicalCount: 500, uom: "PCS" },
        { physicalCount: 250, uom: "PCS" },
      ],
      completedAt: "2026-09-24T08:00:00.000Z",
    })).toMatchObject({
      id: "physical_count:MAT-RECO-1:submission-1",
      reference: "MAT-RECO-1",
      detail: "2 items · 750 PCS",
    });
  });

  it("builds a Transfer Location success card with its route", () => {
    expect(createLocationTransferTransaction({
      stockEntry: "MAT-STE-2",
      itemCode: "ITEM-1",
      quantity: 10,
      uom: "PCS",
      sourceLocation: "A-01",
      targetLocation: "B-02",
      completedAt: "2026-09-24T09:00:00.000Z",
    })).toMatchObject({
      id: "location_transfer:MAT-STE-2",
      reference: "MAT-STE-2",
      detail: "ITEM-1 · 10 PCS",
      route: "A-01 → B-02",
    });
  });

  it("builds a Warehouse Allocation success card", () => {
    expect(createWarehouseAllocationTransaction({
      allocationName: "STE-ALLOC-1",
      completedAt: "2026-09-24T10:00:00.000Z",
      rowCount: 3,
      stockEntryCount: 2,
    })).toMatchObject({
      id: "warehouse_allocation:STE-ALLOC-1",
      reference: "STE-ALLOC-1",
      title: "Warehouse Allocation",
      detail: "3 locations · 2 stock entries",
    });
  });

  it("stores successful transactions newest first", () => {
    saveSuccessfulTransaction(transaction());
    saveSuccessfulTransaction(transaction({
      id: "location_transfer:MAT-STE-2",
      type: "location_transfer",
      reference: "MAT-STE-2",
      completedAt: "2026-09-24T09:00:00.000Z",
      title: "Transfer Location",
      detail: "ITEM-1 · 10 PCS",
    }));

    expect(loadSuccessfulTransactionHistory().map((entry) => entry.reference)).toEqual([
      "MAT-STE-2",
      "MAT-RECO-1",
    ]);
  });

  it("replaces a retry with the same transaction id instead of duplicating it", () => {
    saveSuccessfulTransaction(transaction());
    saveSuccessfulTransaction(transaction({ detail: "3 items / 750 PCS" }));

    expect(loadSuccessfulTransactionHistory()).toHaveLength(1);
    expect(loadSuccessfulTransactionHistory()[0].detail).toBe("3 items / 750 PCS");
  });

  it("ignores malformed stored records", () => {
    values.set("qcmc.successfulTransactions.v1", JSON.stringify([
      transaction(),
      { type: "physical_count", reference: "MISSING-ID" },
      null,
    ]));

    expect(loadSuccessfulTransactionHistory()).toEqual([transaction()]);
  });

  it("stores a failed Physical Count submission without pretending count changes were applied", () => {
    saveFailedPhysicalCountTransaction({
      reconciliationId: "MAT-RECO-2",
      submissionId: "failed-submission-1",
      locationCount: 100,
      entryCount: 117,
      errorCode: "INVALID_ITEM",
      errorMessage: "Item TEST-NONEXISTENT-999 does not exist.",
      failedAt: "2026-10-07T03:30:00.000Z",
    });

    expect(loadFailedTransactionHistory()).toEqual([
      expect.objectContaining({
        id: "physical_count_failed:MAT-RECO-2:failed-submission-1",
        reference: "MAT-RECO-2",
        detail: "100 locations · 117 entries · No count changes applied",
        errorCode: "INVALID_ITEM",
        errorMessage: "Item TEST-NONEXISTENT-999 does not exist.",
      }),
    ]);
  });

  it("replaces repeated failure history for the same submission instead of duplicating it", () => {
    saveFailedPhysicalCountTransaction({
      reconciliationId: "MAT-RECO-2",
      submissionId: "failed-submission-1",
      locationCount: 1,
      entryCount: 1,
      errorMessage: "First error",
    });
    saveFailedPhysicalCountTransaction({
      reconciliationId: "MAT-RECO-2",
      submissionId: "failed-submission-1",
      locationCount: 1,
      entryCount: 1,
      errorMessage: "Updated error",
    });

    expect(loadFailedTransactionHistory()).toHaveLength(1);
    expect(loadFailedTransactionHistory()[0].errorMessage).toBe("Updated error");
  });
});
