import { describe, expect, it } from "vitest";
import {
  areCompatibleUoms,
  getAuthoritativeStockUom,
  getUomConversionFactor,
  getPhysicalCountUomConversionFactor,
  normalizeUom,
} from "@/lib/uom";

describe("shared UOM validation", () => {
  it.each(["PCS", "PCS.", "PIECE", "PIECES"])("treats PC and %s as equivalent", (alias) => {
    expect(normalizeUom(alias)).toBe("PC");
    expect(areCompatibleUoms("PC", alias)).toBe(true);
  });

  it("is case-insensitive and ignores surrounding spaces", () => {
    expect(areCompatibleUoms(" pc ", " pieces ")).toBe(true);
  });

  it("keeps piece-alias quantities unchanged", () => {
    expect(20 * (getUomConversionFactor("PC", "PCS") || 0)).toBe(20);
  });

  it("prefers ERPNext Stock UOM for submission", () => {
    expect(getAuthoritativeStockUom("PC", "PCS", "PIECES")).toBe("PC");
  });

  it.each(["BOX", "KG"])("rejects %s versus PC without an ERP conversion", (uom) => {
    expect(areCompatibleUoms("PC", uom)).toBe(false);
    expect(getUomConversionFactor("PC", uom)).toBeNull();
  });

  it("uses an unrelated UOM conversion only when ERP supplies a factor", () => {
    expect(getUomConversionFactor("PC", "BOX", 24)).toBe(24);
  });

  it("uses ERP Stock UOM directly when a Physical Count barcode has no UOM", () => {
    expect(getPhysicalCountUomConversionFactor("PCS", "")).toBe(1);
    expect(getPhysicalCountUomConversionFactor("", "")).toBeNull();
    expect(getPhysicalCountUomConversionFactor("PCS", "BOX", 24)).toBe(24);
  });

  it("rejects mismatched Physical Count UOM without an authoritative conversion", () => {
    expect(getPhysicalCountUomConversionFactor("PC", "PCK")).toBeNull();
    expect(getPhysicalCountUomConversionFactor("PC", "PCS")).toBe(1);
    expect(getPhysicalCountUomConversionFactor("PC", "PCK", 12)).toBe(12);
  });
});
