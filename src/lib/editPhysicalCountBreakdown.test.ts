import { describe, expect, it } from "vitest";
import { calculateEditedPhysicalCount, readPhysicalCountBreakdown } from "@/lib/editPhysicalCountBreakdown";

describe("Edit physical-count pack breakdown", () => {
  it("adds loose pieces to the original multiplier result", () => {
    expect(calculateEditedPhysicalCount(1000, 52, 25)).toEqual({
      bigPackCount: 52, bigPackUnits: 52000, loosePackQuantity: 25, total: 52025,
    });
  });
  it("preserves fractional stock units and allows big-only or loose-only counts", () => {
    expect(calculateEditedPhysicalCount(500, 52, 0).total).toBe(26000);
    expect(calculateEditedPhysicalCount(500, 0, 12).total).toBe(12);
    expect(calculateEditedPhysicalCount(25, 2, 3.5).total).toBe(53.5);
    expect(() => calculateEditedPhysicalCount(500, 0, 0)).toThrow("Big Pack and Loose Pack cannot both be zero.");
  });
  it("restores saved mixed Big and Loose counts on reopening", () => {
    expect(readPhysicalCountBreakdown({
      quantityChange: 52025, qrQuantity: 1000, packageStatus: "OPENED",
      bigPackCount: 52, loosePackQuantity: 25,
    }, 1000)).toEqual({ bigPackCount: "52", loosePackQuantity: "25", legacyUnsplit: false });
  });
  it("does not invent a pack multiplier for old OPENED scans", () => {
    expect(readPhysicalCountBreakdown({
      quantityChange: 52025, qrQuantity: 1000, packageStatus: "OPENED",
    }, 1000)).toEqual({ bigPackCount: "0", loosePackQuantity: "52025", legacyUnsplit: true });
  });
  it("recovers old Big Pack-only counts from QR multiplier", () => {
    expect(readPhysicalCountBreakdown({
      quantityChange: 52000, qrQuantity: 1000, packageStatus: "COMPLETE",
    }, 1000)).toEqual({ bigPackCount: "52", loosePackQuantity: "0", legacyUnsplit: false });
  });
  it("rejects negative and nonfinite calculations", () => {
    expect(() => calculateEditedPhysicalCount(0, 52, 25)).toThrow();
    expect(() => calculateEditedPhysicalCount(1000, -1, 25)).toThrow();
    expect(() => calculateEditedPhysicalCount(1000, 52, -1)).toThrow();
    expect(() => calculateEditedPhysicalCount(1000, Infinity, 25)).toThrow();
  });
});
