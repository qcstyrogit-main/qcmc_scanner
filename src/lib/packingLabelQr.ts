import { areCompatibleUoms, normalizeUom } from "@/lib/uom";

export type PackingLabelQr = {
  itemCode: string;
  quantity: number;
  uom: string;
  jobOrderId?: string;
  jobCardId?: string;
  /**
   * Fourth value from an older item label when it is not a Work Order.
   * It is retained for traceability only and must not be validated as a
   * Job Order, Job Card, or Batch number.
   */
  legacyValue?: string;
  rawBarcode: string;
};

export type PackingLabelParseOptions = {
  allowPlainItem?: boolean;
  allowEmptyUom?: boolean;
  plainQuantity?: number;
  plainUom?: string;
};

export const PACKING_LABEL_ERROR =
  "Invalid packing-label QR. Expected Item;Qty;UOM;Job Order;Job Card.";

export class PackingLabelQrError extends Error {
  constructor(message = PACKING_LABEL_ERROR) {
    super(message);
    this.name = "PackingLabelQrError";
  }
}

export const normalizePackingUom = (value: string) => {
  return value.trim();
};

export const areCompatiblePackingUoms = (left: string, right: string) =>
  areCompatibleUoms(left, right);

export { normalizeUom };

const looksLikeWorkOrderId = (value: string) => /^(?:MFG-)?WO-/i.test(value.trim());

const parsePackingQuantity = (value: string) => {
  const trimmed = value.trim();
  const valid = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(trimmed);
  if (!valid) return Number.NaN;
  return Number(trimmed.replace(/,/g, ""));
};

export const parsePackingLabelQr = (
  raw: string,
  options: PackingLabelParseOptions = {}
): PackingLabelQr => {
  const rawBarcode = raw.trim();
  if (!rawBarcode) throw new PackingLabelQrError();

  if (!rawBarcode.includes(";")) {
    const quantity = Number(options.plainQuantity);
    const uom = normalizePackingUom(options.plainUom || "");
    if (!options.allowPlainItem || !Number.isFinite(quantity) || quantity <= 0 || !uom) {
      throw new PackingLabelQrError();
    }
    return { itemCode: rawBarcode, quantity, uom, rawBarcode };
  }

  const fields = rawBarcode.split(";").map((field) => field.trim());
  const minimumFieldCount = options.allowEmptyUom ? 2 : 3;
  if (fields.length < minimumFieldCount || fields.length > 5) throw new PackingLabelQrError();
  const quantity = parsePackingQuantity(fields[1]);
  const uom = normalizePackingUom(fields[2] || "");
  if (!fields[0] || !Number.isFinite(quantity) || quantity <= 0 || (!uom && !options.allowEmptyUom)) {
    throw new PackingLabelQrError();
  }

  const fourthValue = fields[3] || "";
  const isFiveFieldLabel = fields.length === 5;
  const fourFieldHasWorkOrder = fields.length === 4 && looksLikeWorkOrderId(fourthValue);

  return {
    itemCode: fields[0],
    quantity,
    uom,
    ...((isFiveFieldLabel || fourFieldHasWorkOrder) && fourthValue
      ? { jobOrderId: fourthValue }
      : {}),
    ...(isFiveFieldLabel && fields[4] ? { jobCardId: fields[4] } : {}),
    ...(fields.length === 4 && fourthValue && !fourFieldHasWorkOrder
      ? { legacyValue: fourthValue }
      : {}),
    rawBarcode,
  };
};

const sameReference = (left: string, right: string) =>
  left.trim().toLocaleUpperCase() === right.trim().toLocaleUpperCase();

export const validateManufacturePackingReferences = (
  label: PackingLabelQr,
  context: { jobOrderId?: string; jobCardId?: string }
) => {
  if (label.jobOrderId && !context.jobOrderId) {
    return `This packing label references Job Order ${label.jobOrderId}, but ERPNext did not provide a Job Order for this Stock Entry.`;
  }
  if (label.jobOrderId && context.jobOrderId && !sameReference(label.jobOrderId, context.jobOrderId)) {
    return `This packing label belongs to Job Order ${label.jobOrderId}, but this Stock Entry belongs to ${context.jobOrderId}.`;
  }
  if (label.jobCardId && context.jobCardId && !sameReference(label.jobCardId, context.jobCardId)) {
    return `This packing label belongs to Job Card ${label.jobCardId}, but this Stock Entry belongs to ${context.jobCardId}.`;
  }
  return "";
};

export const applyPhysicalCountChange = (
  currentQuantity: number,
  labelQuantity: number,
  mode: "ADD" | "DEDUCT"
) => {
  const next = currentQuantity + (mode === "DEDUCT" ? -labelQuantity : labelQuantity);
  if (next < -0.000001) throw new Error("Physical count cannot become negative.");
  return Math.max(0, next);
};
