import { describe, expect, it } from "vitest";
import {
  discardPendingPcountLocationCounts,
  isPendingLocalScanEntry,
  type LocalScanEntry,
  type LocalScanTransaction,
} from "./scanStorage";

const transaction = (id: string, quantityChange: number): LocalScanTransaction => ({
  id, action: "ADD", quantityChange, runningQuantity: quantityChange,
  timestamp: "12:00", locationId: "WRONG", locationLabel: "WRONG",
  employeeId: "1", employeeName: "Operator", deviceId: "Scanner A",
  inventoryTag: id === "old" ? "INV-SUBMITTED" : "INV-MISTAKE",
});

const row = (locationId: string, scans: LocalScanTransaction[], extra: Partial<LocalScanEntry> = {}): LocalScanEntry => ({
  raw: "ITEM;20;PCS;REF", mode: "pcount", reconciliationCode: "MAT-RECO-2026-00038",
  bin: { raw: locationId, warehouse: "FG - Guyong", stockroom: "", building: "", aisle: "",
    rack: "", bin: locationId, locationId },
  itemCode: "ITEM", qrQuantity: 20, multiplier: 1,
  quantity: scans.reduce((sum, tx) => sum + tx.quantityChange, 0),
  uom: "PCS", lotNo: "", timestamp: "12:00", deviceId: "Scanner A",
  scanTransactions: scans, ...extra,
});

describe("removing a wrong Physical Count location", () => {
  it("deletes all pending Inventory Tags and quantities for an unsubmitted location", () => {
    const wrong = row("WRONG", [transaction("mistake", 40)]);
    const good = row("CORRECT", [transaction("good", 20)]);
    const result = discardPendingPcountLocationCounts([wrong, good], wrong.reconciliationCode, "WRONG");
    expect(result.entries).toEqual([good]);
    expect(result.discarded).toBe(1);
  });

  it("drops an unsubmitted correction while preserving only ERP-submitted audit transactions", () => {
    const old = transaction("old", 80);
    const pending = { ...transaction("mistake", -20), action: "DEDUCT" as const };
    const mixed = row("WRONG", [old, pending], {
      quantity: 60, submittedTransactionIds: ["old"],
      submittedQuantity: 80, submittedPhysicalCount: 80,
    });
    const { entries } = discardPendingPcountLocationCounts([mixed], mixed.reconciliationCode, "WRONG");
    expect(entries).toHaveLength(1);
    expect(entries[0].quantity).toBe(80);
    expect(entries[0].scanTransactions?.map(tx => tx.id)).toEqual(["old"]);
    expect(entries[0].submittedTransactionIds).toEqual(["old"]);
    expect(isPendingLocalScanEntry(entries[0])).toBe(false);
    expect(entries[0].scanTransactions?.[0].inventoryTag).toBe("INV-SUBMITTED");
  });

  it("supports legacy submitted transaction counts and keeps other references untouched", () => {
    const old = transaction("old", 50);
    const pending = transaction("mistake", 10);
    const legacy = row("WRONG", [old, pending], {
      quantity: 60, submittedTransactionCount: 1, submittedQuantity: 50,
    });
    const other = { ...row("WRONG", [pending]), reconciliationCode: "OTHER-REF" };
    const result = discardPendingPcountLocationCounts([legacy, other], legacy.reconciliationCode, "WRONG");
    expect(result.entries[0].quantity).toBe(50);
    expect(result.entries[0].scanTransactions?.map(tx => tx.id)).toEqual(["old"]);
    expect(isPendingLocalScanEntry(result.entries[0])).toBe(false);
    expect(result.entries[1]).toEqual(other);
  });
});
