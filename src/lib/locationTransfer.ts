import { erpRequest, extractErrorMessage } from "@/lib/erpApi";
import { getErpMobileToken } from "@/lib/erpSession";
import { createPcountSubmissionId } from "@/lib/erpService";
import { parsePackingLabelQr } from "@/lib/packingLabelQr";
import { normalizeWarehouseName, requireStorageLocationQr, type ResolvedStorageLocation } from "@/lib/storageLocationService";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const number = (value: unknown) => {
  const parsed = Number(String(value ?? "0").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
const bool = (value: unknown) => value === true || value === 1 || value === "1" || String(value ?? "").toLowerCase() === "true";
const list = (value: unknown) => Array.isArray(value) ? value : [];

export const LOCATION_TRANSFER_ONLINE_MESSAGE = "Internet connection is required for Location Transfer. Please reconnect and try again.";

export class LocationTransferError extends Error {
  code: string;
  payload: RecordValue;
  constructor(message: string, code = "", payload: RecordValue = {}) {
    super(message); this.name = "LocationTransferError"; this.code = code; this.payload = payload;
  }
}

export type TransferItemQr = { itemCode: string; batchNo: string; serialNos: string[]; rawBarcode: string };
export type TransferItemStock = {
  itemCode: string; itemName: string; uom: string; availableQuantity: number; precision: number;
  batchNo: string; serialNos: string[]; requiresBatch: boolean; requiresSerial: boolean;
};
export type LocationTransferResult = {
  stockEntry: string; itemCode: string; itemName: string; quantity: number; uom: string;
  sourceLocation: string; targetLocation: string; warehouse: string; duplicateRequest: boolean;
};

const ensureOnline = () => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new LocationTransferError(LOCATION_TRANSFER_ONLINE_MESSAGE, "INTERNET_REQUIRED");
};

const call = async (endpoint: string, body: RecordValue) => {
  ensureOnline();
  const mobileToken = getErpMobileToken();
  let response;
  try {
    response = await erpRequest(endpoint, { method: "POST", body: { ...body, ...(mobileToken ? { mobile_token: mobileToken } : {}) } });
  } catch {
    throw new LocationTransferError(LOCATION_TRANSFER_ONLINE_MESSAGE, "INTERNET_REQUIRED");
  }
  const outer = record(response.data); const payload = record(outer.message ?? outer);
  if (!response.ok || payload.success !== true) {
    throw new LocationTransferError(extractErrorMessage(payload, `ERPNext request failed (HTTP ${response.status})`), text(payload.error_code ?? payload.code), payload);
  }
  return payload;
};

export const verifyLocationTransferConnection = async () => {
  ensureOnline();
  try {
    const response = await erpRequest("/api/method/ping", { method: "GET" });
    if (!response.ok) throw new Error("offline");
  } catch { throw new LocationTransferError(LOCATION_TRANSFER_ONLINE_MESSAGE, "INTERNET_REQUIRED"); }
};

export const parseTransferItemQr = (raw: string): TransferItemQr => {
  const rawBarcode = raw.trim();
  if (!rawBarcode) throw new LocationTransferError("Scan a valid Item barcode or QR.", "ITEM_NOT_FOUND");
  if (rawBarcode.startsWith("{")) {
    try {
      const value = record(JSON.parse(rawBarcode));
      const itemCode = text(value.item_code ?? value.itemCode ?? value.code);
      const serialNos = list(value.serial_nos ?? value.serial_numbers).map(text).filter(Boolean);
      if (!itemCode) throw new Error("missing item");
      return { itemCode, batchNo: text(value.batch_no ?? value.batch), serialNos, rawBarcode };
    } catch { throw new LocationTransferError("The scanned QR does not contain an Item Code.", "ITEM_NOT_FOUND"); }
  }
  if (rawBarcode.includes(";")) {
    try {
      const label = parsePackingLabelQr(rawBarcode);
      return { itemCode: label.itemCode, batchNo: "", serialNos: [], rawBarcode };
    } catch { throw new LocationTransferError("Scan a valid Item barcode or QR.", "ITEM_NOT_FOUND"); }
  }
  return { itemCode: rawBarcode, batchNo: "", serialNos: [], rawBarcode };
};

export const validateTransferLocation = async (rawQr: string): Promise<ResolvedStorageLocation> => {
  const qr = requireStorageLocationQr(rawQr);
  const payload = await call("/api/method/qcmc_logic.api.stock_entry_scanner.get_storage_location_details", { inventory_location_id: qr.locationId });
  const location: ResolvedStorageLocation = {
    inventoryLocationId: text(payload.inventory_location_id ?? payload.location_id ?? payload.name),
    locationCode: text(payload.location_code) || qr.locationId,
    locationName: text(payload.location_name) || qr.locationId,
    locationType: text(payload.location_type), locationPath: text(payload.location_path),
    warehouse: text(payload.warehouse ?? payload.warehouse_name), isGroup: bool(payload.is_group), disabled: bool(payload.disabled),
    itemCode: text(payload.item_code), storageCapacity: number(payload.storage_capacity),
  };
  if (!location.inventoryLocationId || location.inventoryLocationId !== qr.locationId || !location.warehouse) throw new LocationTransferError(`Storage Location ${qr.locationId} was not found.`, "LOCATION_NOT_FOUND");
  if (normalizeWarehouseName(qr.warehouse) !== normalizeWarehouseName(location.warehouse)) throw new LocationTransferError(`Location ${qr.locationId} does not match its ERPNext Warehouse.`, "WAREHOUSE_MISMATCH");
  if (location.disabled) throw new LocationTransferError(`Storage Location ${qr.locationId} is disabled.`, "LOCATION_DISABLED");
  if (location.isGroup) throw new LocationTransferError(`Storage Location ${qr.locationId} is a group location and cannot hold stock.`, "LOCATION_IS_GROUP");
  return location;
};

export const loadSourceLocationStock = async (source: ResolvedStorageLocation, itemQr: TransferItemQr): Promise<TransferItemStock> => {
  const payload = await call("/api/method/qcmc_logic.api.location_transfer.get_item_stock", {
    source_location: source.inventoryLocationId, item_code: itemQr.itemCode, batch_no: itemQr.batchNo,
    serial_nos: itemQr.serialNos, scan_value: itemQr.rawBarcode, scanned_barcode: itemQr.rawBarcode,
  });
  const stock: TransferItemStock = {
    itemCode: text(payload.item_code) || itemQr.itemCode, itemName: text(payload.item_name), uom: text(payload.stock_uom ?? payload.uom),
    availableQuantity: number(payload.available_quantity), precision: Math.max(0, Math.min(9, number(payload.quantity_precision))),
    batchNo: text(payload.batch_no) || itemQr.batchNo, serialNos: list(payload.serial_nos ?? payload.serial_numbers).map(text).filter(Boolean),
    requiresBatch: bool(payload.requires_batch), requiresSerial: bool(payload.requires_serial),
  };
  if (!stock.itemCode || !stock.uom) throw new LocationTransferError("ERPNext did not return valid Item stock details.", "ITEM_NOT_FOUND");
  if (stock.availableQuantity <= 0) throw new LocationTransferError(`${stock.itemCode} has no available stock in ${source.inventoryLocationId}.`, "ITEM_NOT_IN_SOURCE_LOCATION");
  if (stock.requiresBatch && !stock.batchNo) throw new LocationTransferError("Scan an Item QR containing the required Batch Number.", "BATCH_REQUIRED");
  if (stock.requiresSerial && !stock.serialNos.length) throw new LocationTransferError("Scan an Item QR containing the required Serial Numbers.", "SERIAL_REQUIRED");
  return stock;
};

export const parseTransferQuantity = (value: unknown) => Number(String(value ?? "").replace(/,/g, "").trim());
export const validateTransferQuantity = (quantity: number, available: number, precision = 6) => {
  if (!Number.isFinite(quantity) || quantity <= 0) return "Quantity must be numeric and greater than zero.";
  const scale = 10 ** Math.max(0, Math.min(9, precision));
  if (Math.round(quantity * scale) > Math.round(available * scale)) return `Quantity cannot exceed the available ${available.toLocaleString()} in the Source Location.`;
  return "";
};

export const validateTransferDestination = async (source: ResolvedStorageLocation, target: ResolvedStorageLocation) => {
  if (source.inventoryLocationId === target.inventoryLocationId) throw new LocationTransferError("Source and Destination Locations cannot be the same.", "SOURCE_TARGET_SAME");
  if (normalizeWarehouseName(source.warehouse) !== normalizeWarehouseName(target.warehouse)) throw new LocationTransferError("Source and Destination Locations must belong to the same Warehouse.", "WAREHOUSE_MISMATCH");
};

export const createLocationTransfer = async (args: {
  item: TransferItemStock; source: ResolvedStorageLocation; target: ResolvedStorageLocation;
  quantity: number; deviceId: string; requestId: string;
}): Promise<LocationTransferResult> => {
  const payload = await call("/api/method/qcmc_logic.api.location_transfer.create_location_transfer", {
    item_code: args.item.itemCode, source_location: args.source.inventoryLocationId, target_location: args.target.inventoryLocationId,
    quantity: args.quantity, batch_no: args.item.batchNo, serial_nos: args.item.serialNos,
    device_id: args.deviceId, request_id: args.requestId,
  });
  return {
    stockEntry: text(payload.stock_entry ?? payload.stock_entry_id), itemCode: text(payload.item_code) || args.item.itemCode,
    itemName: text(payload.item_name) || args.item.itemName, quantity: number(payload.quantity) || args.quantity,
    uom: text(payload.stock_uom ?? payload.uom) || args.item.uom,
    sourceLocation: text(payload.source_location) || args.source.inventoryLocationId,
    targetLocation: text(payload.target_location) || args.target.inventoryLocationId,
    warehouse: text(payload.warehouse) || args.source.warehouse, duplicateRequest: bool(payload.duplicate_request),
  };
};

export const newLocationTransferRequestId = createPcountSubmissionId;
