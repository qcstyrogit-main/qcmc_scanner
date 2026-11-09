import { describe, expect, it } from "vitest";
import { groupScannedItemsByInvTag } from "@/lib/scannedItemsByInvTag";
import type { LocalScanEntry, LocalScanTransaction } from "@/lib/scanStorage";

const entry = (location: string, transactions: Array<Pick<LocalScanTransaction, "inventoryTag" | "action" | "quantityChange">>, quantity?: number): LocalScanEntry => ({
  mode: "pcount",
  reconciliationCode: "REC-1",
  itemCode: "ITEM-A",
  itemName: "Example",
  bin: { locationId: location, locationCode: location, warehouse: "W", raw: "", stockroom: "", building: "", aisle: "", rack: "", bin: location },
  raw: "", qrQuantity: 1, multiplier: 1,
  quantity: quantity ?? transactions.reduce((total, tx) => total + (tx.action === "DEDUCT" ? -Math.abs(tx.quantityChange) : Math.abs(tx.quantityChange)), 0),
  uom: "PCS", lotNo: "", timestamp: "",
  deviceId: "",
  scanTransactions: transactions.map((tx, i) => ({
    id: location + "-" + i, timestamp: "", locationId: location, locationLabel: location,
    employeeId: "", employeeName: "", deviceId: "", runningQuantity: 0, ...tx,
  })),
});

describe("Scanned Items By Inv Tag grouping", () => {
  it("adds repeated tags across locations and keeps each location available for audit", () => {
    const first = entry("L1", [{ inventoryTag: "TAG-1", action: "ADD", quantityChange: 10 }]);
    const second = entry("L2", [{ inventoryTag: "tag-1", action: "ADD", quantityChange: 5 }]);
    const result = groupScannedItemsByInvTag([first, second]);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("TAG-1");
    expect(result[0].quantity).toBe(15);
    expect(result[0].locations.map((x) => x.entry.bin.locationCode)).toEqual(["L1", "L2"]);
  });

  it("shows net quantity after deductions, with each tag separate", () => {
    const result = groupScannedItemsByInvTag([entry("L1", [
      { inventoryTag: "A", action: "ADD", quantityChange: 20 },
      { inventoryTag: "A", action: "DEDUCT", quantityChange: -4 },
      { inventoryTag: "B", action: "ADD", quantityChange: 3 },
    ])]);
    expect(result.map((x) => [x.tag, x.quantity])).toEqual([["A", 16], ["B", 3]]);
  });

  it("keeps legacy counts with no tag visible without assigning an invented tag", () => {
    const legacy = entry("L3", [], 7);
    const result = groupScannedItemsByInvTag([legacy]);
    expect(result[0].tag).toBe("No Inv Tag");
    expect(result[0].quantity).toBe(7);
  });

  it("preserves quantities as unassigned when tagged transactions do not account for the entire saved count", () => {
    const result = groupScannedItemsByInvTag([entry("L1", [
      { inventoryTag: "TAG-1", action: "ADD", quantityChange: 10 },
    ], 13)]);
    expect(result.map((x) => [x.tag, x.quantity])).toEqual([["TAG-1", 10], ["No Inv Tag", 3]]);
    expect(result.reduce((sum, x) => sum + x.quantity, 0)).toBe(13);
  });

  it("does not mutate the original scanned entries", () => {
    const saved = [entry("L1", [{ inventoryTag: "TAG-1", action: "ADD", quantityChange: 5 }])];
    const snapshot = JSON.stringify(saved);
    groupScannedItemsByInvTag(saved);
    expect(JSON.stringify(saved)).toBe(snapshot);
  });
});
