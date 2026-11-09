import { describe, expect, it } from "vitest";
import { activeInventoryTagKey, findInventoryTagItemConflict, getLatestUsedInventoryTag, validateActiveInventoryTag } from "./activeInventoryTag";
import type { LocalScanEntry } from "./scanStorage";

const entry = (tag: string, location = "A", item = "ITEM-1", submitted = false): LocalScanEntry => ({
  mode: "pcount", reconciliationCode: "REC", itemCode: item, bin: { locationId: location } as LocalScanEntry["bin"],
  lotNo: "LOT", raw: "", qrQuantity: 1, multiplier: 1, quantity: 1, uom: "PCS", timestamp: "",
  scanTransactions: [{ id: "tx1", action: "ADD", inventoryTag: tag, locationId: location, quantityChange: 1, runningQuantity: 1, timestamp: "" }],
  submittedTransactionIds: submitted ? ["tx1"] : [],
} as LocalScanEntry);

describe("latest used Inventory Tag", () => {
  it("prefills from the latest recorded scan across items within the same reconciliation", () => {
    const old = entry("TAG-001", "A", "ITEM-1");
    const newest = entry("TAG-002", "B", "ITEM-2");
    old.scanTransactions![0].timestamp = "2026-11-05T01:00:00Z";
    newest.scanTransactions![0].timestamp = "2026-11-05T02:00:00Z";
    expect(getLatestUsedInventoryTag([newest, old], "REC")).toBe("TAG-002");
    expect(getLatestUsedInventoryTag([newest, old], "OTHER-REC")).toBe("");
  });
  it("uses saved scan chronology instead of locale-formatted timestamp strings", () => {
    const newest = entry("TAG-NEW", "C", "ITEM-3");
    const older = entry("TAG-OLD", "A", "ITEM-1");
    // Locale-string comparison incorrectly treats 9 PM as later than 10 PM.
    newest.scanTransactions![0].timestamp = "10:01:00 PM";
    older.scanTransactions![0].timestamp = "9:59:00 PM";
    expect(getLatestUsedInventoryTag([newest, older], "REC")).toBe("TAG-NEW");
    const sameItem = entry("TAG-FIRST");
    sameItem.scanTransactions!.push({
      ...sameItem.scanTransactions![0], id: "tx2",
      timestamp: "11:00:00 AM", inventoryTag: "TAG-LATEST",
    });
    expect(getLatestUsedInventoryTag([sameItem], "REC")).toBe("TAG-LATEST");
  });

  it("prefills INV-008 rather than INV-006 when older Item rows are first", () => {
    const older = entry("INV-006", "L1", "ITEM-A");
    const latest = entry("INV-008", "L2", "ITEM-B");
    // Rehydrated/grouped Item rows may not be ordered by latest scan.
    older.scanTransactions![0].id = "1793924400000-old";
    older.scanTransactions![0].timestamp = "8:20:00 AM";
    latest.scanTransactions![0].id = "1793924700000-new";
    latest.scanTransactions![0].timestamp = "8:25:00 AM";
    expect(getLatestUsedInventoryTag([older, latest], "REC")).toBe("INV-008");
    expect(getLatestUsedInventoryTag([latest, older], "REC")).toBe("INV-008");
  });

  it("prefers explicit recordedAt for newly saved scan transactions", () => {
    const older = entry("INV-006", "L1", "ITEM-A");
    const latest = entry("INV-008", "L2", "ITEM-B");
    older.scanTransactions![0].recordedAt = 1793924400000;
    latest.scanTransactions![0].recordedAt = 1793924700000;
    expect(getLatestUsedInventoryTag([older, latest], "REC")).toBe("INV-008");
  });

  it("ignores zero-transaction baseline rows and blank tags", () => {
    const blank = entry("", "A", "ITEM-1");
    blank.scanTransactions![0].timestamp = "2026-11-05T03:00:00Z";
    expect(getLatestUsedInventoryTag([entry("TAG-001"), blank], "REC")).toBe("TAG-001");
  });
});

describe("active Inventory Tag safeguards", () => {
  it("keys independently by reconciliation, location, item and lot", () => {
    expect(activeInventoryTagKey("R", "A", "X", "L")).not.toBe(activeInventoryTagKey("R", "A", "Y", "L"));
    expect(activeInventoryTagKey("R", "A", "X", "L")).not.toBe(activeInventoryTagKey("R", "B", "X", "L"));
  });
  it("reuses the explicit active tag even if another tag exists in the same item/location", () => {
    expect(validateActiveInventoryTag([entry("TAG-001"), entry("TAG-002")], "REC", "A", "ITEM-1", "LOT", "TAG-002")).toBe("TAG-002");
  });
  it("does not reuse a tag belonging to another item or location", () => {
    expect(validateActiveInventoryTag([entry("TAG-001")], "REC", "B", "ITEM-1", "LOT", "TAG-001")).toBeNull();
    expect(validateActiveInventoryTag([entry("TAG-001")], "REC", "A", "ITEM-2", "LOT", "TAG-001")).toBeNull();
  });
  it("rejects submitted tags and missing active selection", () => {
    expect(validateActiveInventoryTag([entry("TAG-001", "A", "ITEM-1", true)], "REC", "A", "ITEM-1", "LOT", "TAG-001")).toBeNull();
    expect(validateActiveInventoryTag([entry("TAG-001")], "REC", "A", "ITEM-1", "LOT", undefined)).toBeNull();
  });
});

describe("Inventory Tag belongs to one Item Code per Storage Location", () => {
  it("rejects Location A / Item B / INV-001 after Item A used it there", () => {
    const used = [entry(" INV-001 ", "A", "ITEM-A", true)];
    expect(findInventoryTagItemConflict(used, "rec", "INV-001", "ITEM-B", "A"))
      .toEqual({ itemCode: "ITEM-A", locationId: "A" });
  });

  it("accepts the same Item and tag in the same location", () => {
    const used = [entry("INV-001", "A", "ITEM-A")];
    expect(findInventoryTagItemConflict(used, "REC", "INV-001", "ITEM-A", "A")).toBeNull();
  });

  it("allows the same tag on another location, even for a different item", () => {
    const used = [entry("INV-001", "A", "ITEM-A")];
    expect(findInventoryTagItemConflict(used, "REC", "INV-001", "ITEM-B", "B")).toBeNull();
    expect(findInventoryTagItemConflict(used, "REC", "INV-001", "ITEM-A", "B")).toBeNull();
    expect(findInventoryTagItemConflict(used, "OTHER-REC", "INV-001", "ITEM-B", "A")).toBeNull();
  });

  it("does not ignore same-location conflicts when transaction IDs collide", () => {
    const used = [entry("INV-001", "A", "ITEM-A"), entry("INV-001", "A", "ITEM-B")];
    expect(findInventoryTagItemConflict(used, "REC", "INV-001", "ITEM-A", "A"))
      .toEqual({ itemCode: "ITEM-B", locationId: "A" });
  });

  it("allows active tag reuse even if another location has that tag", () => {
    const first = entry("INV-001", "A", "ITEM-A");
    const second = entry("INV-001", "B", "ITEM-B");
    expect(validateActiveInventoryTag([first, second], "REC", "A", "ITEM-A", "LOT", "INV-001"))
      .toBe("INV-001");
  });

  it("rejects active tag reuse if another item owns it in the same location", () => {
    const first = entry("INV-001", "A", "ITEM-A");
    const second = entry("INV-001", "A", "ITEM-B");
    expect(validateActiveInventoryTag([first, second], "REC", "A", "ITEM-A", "LOT", "INV-001"))
      .toBeNull();
  });
});
