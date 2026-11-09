import { describe, expect, it } from "vitest";
import {
  applyPhysicalCountChange,
  areCompatiblePackingUoms,
  PACKING_LABEL_ERROR,
  PackingLabelQrError,
  parsePackingLabelQr,
  validateManufacturePackingReferences,
} from "@/lib/packingLabelQr";

describe("shared packing-label QR parser", () => {
  it("parses the new five-field QR", () => {
    expect(parsePackingLabelQr(" EIEHB1BL50 ; 20 ; PC ; MFG-WO-2026-00027 ; PO-JOB00021 ")).toEqual({
      itemCode: "EIEHB1BL50",
      quantity: 20,
      uom: "PC",
      jobOrderId: "MFG-WO-2026-00027",
      jobCardId: "PO-JOB00021",
      rawBarcode: "EIEHB1BL50 ; 20 ; PC ; MFG-WO-2026-00027 ; PO-JOB00021",
    });
  });

  it("keeps the old four-field QR compatible", () => {
    const label = parsePackingLabelQr("EIEHB1BL50;20;PC;MFG-WO-2026-00027");
    expect(label.jobOrderId).toBe("MFG-WO-2026-00027");
    expect(label.jobCardId).toBeUndefined();
  });

  it("reads a legacy four-value item QR without treating its fourth value as a Job Order", () => {
    const label = parsePackingLabelQr("EIEHB1BL50;20;PC;545654");
    expect(label).toMatchObject({
      itemCode: "EIEHB1BL50",
      quantity: 20,
      uom: "PC",
      legacyValue: "545654",
    });
    expect(label.jobOrderId).toBeUndefined();
    expect(label.jobCardId).toBeUndefined();
  });

  it("accepts a legacy quantity with valid thousands separators", () => {
    expect(parsePackingLabelQr("VFP8SM25;1,000;PCS;24FP000965")).toMatchObject({
      itemCode: "VFP8SM25",
      quantity: 1000,
      uom: "PCS",
      legacyValue: "24FP000965",
    });
    expect(parsePackingLabelQr("VFP8SM25;10,000.50;PCS;24FP000965").quantity).toBe(10000.5);
  });

  it("rejects malformed quantity separators", () => {
    for (const raw of ["VFP8SM25;1,00;PCS;X", "VFP8SM25;1,0,00;PCS;X", "VFP8SM25;,1000;PCS;X"]) {
      expect(() => parsePackingLabelQr(raw)).toThrow(PACKING_LABEL_ERROR);
    }
  });

  it("accepts a plain item barcode when its existing workflow supplies defaults", () => {
    expect(parsePackingLabelQr("EIEHB1BL50", {
      allowPlainItem: true,
      plainQuantity: 1,
      plainUom: "PCS",
    })).toMatchObject({ itemCode: "EIEHB1BL50", quantity: 1, uom: "PCS" });
  });

  it("allows Physical Count to defer a missing barcode UOM to ERPNext", () => {
    expect(parsePackingLabelQr("EIEHB1BL50;20;;LEGACY", { allowEmptyUom: true }))
      .toMatchObject({ itemCode: "EIEHB1BL50", quantity: 20, uom: "" });
    expect(() => parsePackingLabelQr("EIEHB1BL50;20;;LEGACY")).toThrow(PACKING_LABEL_ERROR);
  });

  it("allows Physical Count to defer an omitted legacy UOM field to ERPNext", () => {
    expect(parsePackingLabelQr("EIEHB1BL50;20", { allowEmptyUom: true }))
      .toMatchObject({ itemCode: "EIEHB1BL50", quantity: 20, uom: "" });
    expect(() => parsePackingLabelQr("EIEHB1BL50;20")).toThrow(PACKING_LABEL_ERROR);
  });

  it("uses the first three fields as Receive Finished Goods item data", () => {
    const label = parsePackingLabelQr("EIEHB1BL50;20;PC;MFG-WO-27;PO-JOB21");
    expect({ itemCode: label.itemCode, quantity: label.quantity, uom: label.uom })
      .toEqual({ itemCode: "EIEHB1BL50", quantity: 20, uom: "PC" });
  });

  it("detects a mismatched Manufacture Job Order", () => {
    const label = parsePackingLabelQr("EIEHB1BL50;20;PC;MFG-WO-27;PO-JOB21");
    expect(validateManufacturePackingReferences(label, { jobOrderId: "MFG-WO-28" }))
      .toContain("belongs to Job Order MFG-WO-27");
  });

  it("detects a mismatched Job Card only when ERP exposes one", () => {
    const label = parsePackingLabelQr("EIEHB1BL50;20;PC;MFG-WO-27;PO-JOB21");
    expect(validateManufacturePackingReferences(label, { jobOrderId: "MFG-WO-27", jobCardId: "PO-JOB22" }))
      .toContain("belongs to Job Card PO-JOB21");
    expect(validateManufacturePackingReferences(label, { jobOrderId: "MFG-WO-27" })).toBe("");
  });

  it("lets Physical Count ignore manufacturing references", () => {
    const { itemCode, quantity, uom } = parsePackingLabelQr("EIEHB1BL50;20;PC;DELETED-WO;DELETED-JOB");
    expect({ itemCode, quantity, uom }).toEqual({ itemCode: "EIEHB1BL50", quantity: 20, uom: "PC" });
  });

  it("does not look up deleted manufacturing documents while parsing for Physical Count", () => {
    expect(() => parsePackingLabelQr("EIEHB1BL50;20;PC;MISSING-WO;MISSING-JOB")).not.toThrow();
  });

  it.each(["PC", "PCS", "PCS.", "PIECE", "PIECES"])("preserves configured UOM %s", (uom) => {
    expect(parsePackingLabelQr(`EIEHB1BL50;20;${uom};;`).uom).toBe(uom);
  });

  it("accepts compatible piece aliases without changing the barcode text", () => {
    for (const barcodeUom of ["PC", "PCS", "PCS.", "PIECE", "PIECES", " pieces "]) {
      expect(areCompatiblePackingUoms("PC", barcodeUom)).toBe(true);
    }
    expect(parsePackingLabelQr("ITEM;20;PCS;LEGACY").uom).toBe("PCS");
  });

  it("does not treat unrelated UOMs as equivalent", () => {
    expect(areCompatiblePackingUoms("PC", "BOX")).toBe(false);
    expect(areCompatiblePackingUoms("PC", "KG")).toBe(false);
  });

  it("rejects malformed and non-positive labels with a clear error", () => {
    for (const raw of ["EIEHB1BL50;0;PC;WO;JOB", "EIEHB1BL50;-1;PC;WO;JOB", "bad", "A;1;PC;WO;JOB;EXTRA"]) {
      expect(() => parsePackingLabelQr(raw)).toThrowError(new PackingLabelQrError(PACKING_LABEL_ERROR));
    }
  });

  it("ADD applies the complete label quantity", () => {
    const label = parsePackingLabelQr("EIEHB1BL50;20;PC;WO;JOB");
    expect(applyPhysicalCountChange(40, label.quantity, "ADD")).toBe(60);
  });

  it("DEDUCT subtracts the label quantity and never permits a negative count", () => {
    const label = parsePackingLabelQr("EIEHB1BL50;20;PC;WO;JOB");
    expect(applyPhysicalCountChange(40, label.quantity, "DEDUCT")).toBe(20);
    expect(() => applyPhysicalCountChange(0, label.quantity, "DEDUCT")).toThrow("cannot become negative");
  });
});
