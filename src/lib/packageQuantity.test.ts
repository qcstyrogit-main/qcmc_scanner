import { describe, expect, it } from "vitest";
import {
  PackageQuantityError,
  calculatePhysicalPackage,
  calculatePulloutPackage,
  createPulloutRequestSignature,
  getPackageModeDefaultInput,
  getSignedPhysicalQuantity,
} from "@/lib/packageQuantity";

describe("Physical Count package quantities", () => {
  it("counts one complete 500-piece package as 500", () => {
    expect(calculatePhysicalPackage({ qrQuantity: 500, status: "COMPLETE", input: "" })).toEqual({
      qrQuantity: 500,
      packageStatus: "COMPLETE",
      packageCount: 1,
      actualQuantity: 500,
      difference: 0,
      quantity: 500,
    });
  });

  it("counts two complete 500-piece packages as 1000", () => {
    expect(calculatePhysicalPackage({ qrQuantity: 500, status: "COMPLETE", input: "2" }).quantity).toBe(1000);
  });

  it("counts the complete location total entered in Loose Pack mode", () => {
    expect(calculatePhysicalPackage({ qrQuantity: 500, status: "OPENED", input: "2950" })).toEqual({
      qrQuantity: 500,
      packageStatus: "OPENED",
      actualQuantity: 2950,
      difference: 0,
      quantity: 2950,
    });
  });

  it("allows an opened package to contain zero remaining pieces", () => {
    expect(calculatePhysicalPackage({ qrQuantity: 500, status: "OPENED", input: "0" }).quantity).toBe(0);
  });

  it.each(["", "abc", "-1", "Infinity", "NaN"])(
    "rejects invalid Loose Pack total %j",
    (input) => expect(() => calculatePhysicalPackage({ qrQuantity: 500, status: "OPENED", input })).toThrow(PackageQuantityError)
  );

  it("signs the actual package quantity instead of the QR quantity", () => {
    expect(getSignedPhysicalQuantity(495, "ADD")).toBe(495);
    expect(getSignedPhysicalQuantity(495, "DEDUCT")).toBe(-495);
  });
});

describe("Pullout package quantities", () => {
  it("pulls the full 500 pieces from one complete package", () => {
    expect(calculatePulloutPackage({ qrQuantity: 500, mode: "FULL", input: "1" })).toEqual({
      qrQuantity: 500,
      packageStatus: "COMPLETE",
      packageCount: 1,
      pulloutQuantity: 500,
      remainingQuantity: 0,
      quantity: 500,
    });
  });

  it("pulls 5 pieces and displays 495 remaining", () => {
    expect(calculatePulloutPackage({ qrQuantity: 500, mode: "PARTIAL", input: "5" })).toEqual({
      qrQuantity: 500,
      packageStatus: "OPENED",
      pulloutQuantity: 5,
      remainingQuantity: 495,
      quantity: 5,
    });
  });

  it.each(["", "0", "-1", "abc", "501", "Infinity", "NaN"])(
    "rejects invalid partial-pullout input %j",
    (input) => expect(() => calculatePulloutPackage({ qrQuantity: 500, mode: "PARTIAL", input })).toThrow(PackageQuantityError)
  );

  it("provides mode-specific safe defaults", () => {
    expect(getPackageModeDefaultInput("FULL")).toBe("1");
    expect(getPackageModeDefaultInput("PARTIAL")).toBe("");
  });

  it("changes request identity content when a failed pullout is edited", () => {
    const original = createPulloutRequestSignature({
      itemCode: "ITEM-A", jobCardId: "JC-1", mode: "PARTIAL", qrQuantity: 500, quantity: 5, remainingQuantity: 495,
    });
    const edited = createPulloutRequestSignature({
      itemCode: "ITEM-A", jobCardId: "JC-1", mode: "PARTIAL", qrQuantity: 500, quantity: 6, remainingQuantity: 494,
    });

    expect(edited).not.toBe(original);
  });
});
