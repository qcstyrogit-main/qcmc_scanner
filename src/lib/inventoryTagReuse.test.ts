import { describe, expect, it } from "vitest";
import { getReusableInventoryTag } from "@/lib/inventoryTagReuse";
import type { LocalScanEntry } from "@/lib/scanStorage";

const entry = (tag: string, overrides: Partial<LocalScanEntry> = {}): LocalScanEntry => ({
  raw: "qr", mode: "pcount", reconciliationCode: "SR-001",
  bin: { raw: "bin", warehouse: "WH", stockroom: "", building: "", aisle: "", rack: "", bin: "A", locationId: "A" },
  itemCode: "ITEM-1", qrQuantity: 10, multiplier: 1, quantity: 10,
  uom: "Nos", lotNo: "LOT-1", timestamp: "", deviceId: "device",
  scanTransactions: [{ id: "tx1", action: "ADD", quantityChange: 10, runningQuantity: 10, timestamp: "", locationId: "A", locationLabel: "A", employeeId: "E", employeeName: "E", deviceId: "device", inventoryTag: tag }],
  ...overrides,
});
const reuse = (entries: LocalScanEntry[]) => getReusableInventoryTag(entries, "SR-001", "ITEM-1", "A", "LOT-1");

describe("automatic Inventory Tag reuse", () => {
  it("reuses the only pending tag for the same item, location and lot", () => {
    expect(reuse([entry("TAG-001")])).toBe("TAG-001");
    expect(reuse([entry("tag-001"), entry("TAG-001")])).toBe("TAG-001");
  });
  it("never reuses tags from other locations, items, lots or reconciliations", () => {
    expect(reuse([entry("TAG", { bin: { ...entry("TAG").bin, locationId: "B" } })])).toBeNull();
    expect(reuse([entry("TAG", { itemCode: "ITEM-2" })])).toBeNull();
    expect(reuse([entry("TAG", { lotNo: "LOT-2" })])).toBeNull();
    expect(reuse([entry("TAG", { reconciliationCode: "SR-002" })])).toBeNull();
  });
  it("does not guess between multiple Inventory Tags", () => {
    expect(reuse([entry("TAG-A"), entry("TAG-B")])).toBeNull();
  });
  it("allows reusing an active tag when that tag also exists at another location", () => {
    const other = entry("TAG-A", { bin: { ...entry("TAG-A").bin, locationId: "B" }, scanTransactions: [{ ...entry("TAG-A").scanTransactions![0], locationId: "B" }] });
    expect(reuse([entry("TAG-A"), other])).toBe("TAG-A");
  });
  it("never reuses a submitted or missing Inventory Tag", () => {
    expect(reuse([entry("TAG-A", { submittedTransactionIds: ["tx1"] })])).toBeNull();
    expect(reuse([entry("")])).toBeNull();
  });
  it("requires a valid location and a recorded transaction", () => {
    expect(getReusableInventoryTag([entry("TAG")], "SR-001", "ITEM-1", "", "LOT-1")).toBeNull();
    expect(reuse([entry("TAG", { scanTransactions: [] })])).toBeNull();
  });
  it("rejects the tag when a different item used it at the same location", () => {
    const otherItem = entry("TAG-A", {
      itemCode: "ITEM-2",
      scanTransactions: [{ ...entry("TAG-A").scanTransactions![0], id: "tx-other", locationId: "A" }],
    });
    expect(reuse([entry("TAG-A"), otherItem])).toBeNull();
  });

});