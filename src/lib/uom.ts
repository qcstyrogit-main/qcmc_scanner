/** Canonical value used only for UOM compatibility checks. */
export const normalizeUom = (value: unknown) => {
  const uom = String(value || "").trim().toUpperCase();

  if (["PC", "PCS", "PCS.", "PIECE", "PIECES"].includes(uom)) {
    return "PC";
  }

  return uom;
};

export const areCompatibleUoms = (erpUom: unknown, barcodeUom: unknown) =>
  Boolean(normalizeUom(erpUom)) && normalizeUom(erpUom) === normalizeUom(barcodeUom);

/** ERPNext conversion factors are stock units per one scanned unit. */
export const getUomConversionFactor = (
  erpUom: unknown,
  barcodeUom: unknown,
  erpConversionFactor?: unknown
) => {
  if (areCompatibleUoms(erpUom, barcodeUom)) return 1;
  const factor = Number(erpConversionFactor);
  return Number.isFinite(factor) && factor > 0 ? factor : null;
};

export const getPhysicalCountUomConversionFactor = (
  erpUom: unknown,
  barcodeUom: unknown,
  erpConversionFactor?: unknown
) => {
  if (!normalizeUom(erpUom)) return null;
  if (!normalizeUom(barcodeUom)) return 1;
  return getUomConversionFactor(erpUom, barcodeUom, erpConversionFactor);
};

export const getAuthoritativeStockUom = (
  stockUom: unknown,
  erpUom: unknown,
  fallbackUom: unknown = ""
) => String(stockUom || erpUom || fallbackUom || "").trim();
