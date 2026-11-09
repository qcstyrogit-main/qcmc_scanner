import { erpRequest, extractErrorMessage } from "@/lib/erpApi";
import { getErpMobileToken } from "@/lib/erpSession";
import { createPcountSubmissionId } from "@/lib/erpService";
import { completeOnlineRequest, prepareOnlineRequest, requireReceiveFinishedGoodsNetwork } from "@/lib/receiveFinishedGoodsOnline";

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const number = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const bool = (value: unknown) => value === true || value === 1 || value === "1";
const list = (value: unknown) => Array.isArray(value) ? value : [];

export class ManufacturingApiError extends Error {
  code: string;
  constructor(message: string, code = "") {
    super(message);
    this.name = "ManufacturingApiError";
    this.code = code;
  }
}

const call = async (endpoint: string, body: UnknownRecord) => {
  requireReceiveFinishedGoodsNetwork();
  const mobileToken = getErpMobileToken();
  if (import.meta.env.DEV) console.debug("[Manufacturing API] request", { endpoint, body });
  let response;
  try {
    response = await erpRequest(endpoint, {
      method: "POST",
      body: { ...body, ...(mobileToken ? { mobile_token: mobileToken } : {}) },
    });
  } catch {
    throw new ManufacturingApiError("Internet connection is required for Receive Finished Goods. Please reconnect and try again.", "INTERNET_REQUIRED");
  }
  const outer = record(response.data);
  const payload = record(outer.message ?? outer);
  if (import.meta.env.DEV) console.debug("[Manufacturing API] response", { endpoint, status: response.status, body: response.data });
  if (!response.ok || payload.success !== true) {
    throw new ManufacturingApiError(
      extractErrorMessage(payload, `ERPNext request failed (HTTP ${response.status})`),
      text(payload.error_code ?? payload.code)
    );
  }
  return payload;
};

export type ManufacturingSubmitResult = {
  stockEntryId: string;
  workOrderId: string;
  jobCardId: string;
  itemCount: number;
  status: string;
  docstatus: number;
  duplicateSubmission: boolean;
  submissionId: string;
};

export type FinishedItemRequirement = {
  rowId: string;
  itemCode: string;
  itemName: string;
  expectedQuantity: number;
  uom: string;
  targetWarehouse: string;
  inventoryLocation: string;
  inventoryLocationCode: string;
  requiresBatch: boolean;
  requiresSerial: boolean;
};

export type ManufactureReceiveContext = {
  stockEntryId: string;
  stockEntryType: string;
  purpose: string;
  workOrderId: string;
  jobCardId: string;
  customReferenceDocument: string;
  finishedItemCode: string;
  finishedItemName: string;
  expectedManufactureQuantity: number;
  actualWeightPerItem: number;
  docstatus: number;
  existingDraft: boolean;
  status: string;
  finishedItems: FinishedItemRequirement[];
  allocationCount: number;
  putawayAllocations: PutawayAllocation[];
  distributionMode: "parent_location" | "exact_location";
  distributionParent: DistributionParent | null;
};

export type DistributionParent = {
  locationId: string;
  locationName: string;
  warehouse: string;
};

export type PutawayAllocation = {
  allocationId: string;
  rowId: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  stockQuantity: number;
  uom: string;
  targetWarehouse: string;
  inventoryLocation: string;
  inventoryLocationName: string;
  parentLocationId: string;
  putawayRule: string;
  priority: number;
  requiresBatch: boolean;
  requiresSerial: boolean;
};

const parseManufactureReceiveContext = (
  payload: UnknownRecord,
  fallbackStockEntryId = ""
): ManufactureReceiveContext => {
  const distributionParentRow = record(payload.distribution_parent);
  const distributionParent = text(distributionParentRow.location_id) ? {
    locationId: text(distributionParentRow.location_id),
    locationName: text(distributionParentRow.location_name) || text(distributionParentRow.location_id),
    warehouse: text(distributionParentRow.warehouse),
  } : null;
  const requestedMode = text(payload.distribution_mode).toLocaleLowerCase();
  const distributionMode = requestedMode === "parent_location" && distributionParent
    ? "parent_location" as const
    : "exact_location" as const;
  const putawayAllocations = list(payload.putaway_allocations).map((candidate) => {
    const row = record(candidate);
    return {
      allocationId: text(row.allocation_id),
      rowId: text(row.stock_entry_row ?? row.row_name),
      itemCode: text(row.item_code),
      itemName: text(row.item_name),
      quantity: number(row.quantity ?? row.qty),
      stockQuantity: number(row.stock_quantity ?? row.quantity ?? row.qty),
      uom: text(row.stock_uom ?? row.uom),
      targetWarehouse: text(row.target_warehouse ?? row.t_warehouse ?? row.warehouse),
      inventoryLocation: text(row.inventory_location_id ?? row.inventory_location),
      inventoryLocationName: text(row.inventory_location_name ?? row.inventory_location_id ?? row.inventory_location),
      parentLocationId: text(row.parent_location_id),
      putawayRule: text(row.putaway_rule),
      priority: number(row.priority),
      requiresBatch: bool(row.requires_batch ?? row.has_batch_no),
      requiresSerial: bool(row.requires_serial_number ?? row.has_serial_no),
    };
  }).filter((row) => row.allocationId && row.rowId && row.itemCode && row.quantity > 0 && row.inventoryLocation);
  const finishedItems = list(payload.finished_items).map((candidate) => {
    const row = record(candidate);
    return {
      rowId: text(row.stock_entry_row ?? row.row_name ?? row.name),
      itemCode: text(row.item_code),
      itemName: text(row.item_name),
      expectedQuantity: number(row.expected_quantity ?? row.remaining_quantity ?? row.quantity ?? row.qty),
      uom: text(row.stock_uom ?? row.uom),
      targetWarehouse: text(row.target_warehouse ?? row.t_warehouse ?? row.warehouse),
      inventoryLocation: text(row.inventory_location ?? row.next_inventory_location ?? row.putaway_location),
      inventoryLocationCode: text(row.inventory_location_code ?? row.location_code),
      requiresBatch: bool(row.requires_batch ?? row.has_batch_no),
      requiresSerial: bool(row.requires_serial_number ?? row.has_serial_no),
    };
  }).filter((row) => row.rowId && row.itemCode && row.expectedQuantity > 0);
  const allocatedQuantity = putawayAllocations.reduce((sum, row) => sum + row.quantity, 0);
  const finishedQuantity = finishedItems.reduce((sum, row) => sum + row.expectedQuantity, 0);
  return {
    stockEntryId: text(payload.stock_entry_id ?? payload.stock_entry ?? payload.name) || fallbackStockEntryId,
    stockEntryType: text(payload.stock_entry_type),
    purpose: text(payload.purpose),
    workOrderId: text(payload.work_order_id ?? payload.work_order),
    jobCardId: text(payload.job_card_id ?? payload.job_card),
    customReferenceDocument: text(payload.custom_reference_document),
    finishedItemCode: text(payload.item_code ?? payload.finished_item_code) || putawayAllocations[0]?.itemCode || finishedItems[0]?.itemCode || "",
    finishedItemName: text(payload.item_name ?? payload.finished_item_name) || putawayAllocations[0]?.itemName || finishedItems[0]?.itemName || "",
    expectedManufactureQuantity: number(
      payload.expected_manufacture_quantity ?? payload.manufacture_quantity ??
      payload.completed_quantity ?? payload.quantity ?? allocatedQuantity ?? finishedQuantity
    ) || allocatedQuantity || finishedQuantity,
    actualWeightPerItem: number(payload.custom_actual_weight_per_item ?? payload.actual_weight_per_item),
    docstatus: number(payload.docstatus),
    existingDraft: bool(payload.existing_draft),
    status: text(payload.status),
    allocationCount: number(payload.allocation_count ?? putawayAllocations.length),
    putawayAllocations,
    distributionMode,
    distributionParent,
    finishedItems,
  };
};

export const getManufactureReceiveContext = async (stockEntryId: string): Promise<ManufactureReceiveContext> => {
  const payload = await call(
    "/api/method/qcmc_logic.api.stock_entry_scanner.get_manufacture_receive_context",
    { stock_entry_id: stockEntryId }
  );
  return parseManufactureReceiveContext(payload, stockEntryId);
};

export const validateManufactureJobCard = async (jobCardId: string) => {
  const data = await call(
    "/api/method/qcmc_logic.api.stock_entry_scanner.validate_manufacture_job_card",
    { job_card_id: jobCardId }
  );
  const authoritativeJobCard = text(data.job_card);
  if (!authoritativeJobCard) {
    throw new ManufacturingApiError(`ERPNext did not return Job Card ${jobCardId}.`, "JOB_CARD_NOT_AVAILABLE");
  }
  if (number(data.docstatus) === 2) throw new ManufacturingApiError(`Job Card ${authoritativeJobCard} is cancelled.`, "JOB_CARD_CANCELLED");
  return {
    jobCardId: authoritativeJobCard,
    workOrderId: text(data.work_order),
    itemCode: text(data.production_item),
    requiredQuantity: number(data.required_quantity),
    availableQuantity: number(data.available_quantity),
    completedQuantity: number(data.completed_quantity),
    manufacturedQuantity: number(data.manufactured_quantity),
    warehouse: text(data.warehouse),
    status: text(data.status),
    docstatus: number(data.docstatus),
  };
};

export const createManufactureReceiveDraft = async (
  jobCardId: string,
  customReferenceDocument: string,
  options: {
    quantity?: number;
    actualWeightPerItem?: number;
    deviceId?: string;
    requestId?: string;
    qrQuantity?: number;
    packageStatus?: "COMPLETE" | "OPENED";
    pulloutQuantity?: number;
    remainingQuantity?: number;
    packageCount?: number;
    packageId?: string;
  } = {}
): Promise<ManufactureReceiveContext> => {
  const endpoint = "/api/method/qcmc_logic.api.stock_entry_scanner.create_manufacture_receive_draft";
  const key = [
    "receive", jobCardId, customReferenceDocument, options.quantity || 0,
    options.qrQuantity ?? "", options.packageStatus || "", options.pulloutQuantity ?? "",
    options.remainingQuantity ?? "", options.packageCount ?? "", options.packageId || "",
  ].join(":");
  const mutation = prepareOnlineRequest(key, {
      job_card_id: jobCardId,
      custom_reference_document: customReferenceDocument,
      ...(options.quantity ? { quantity: options.quantity } : {}),
      ...(options.actualWeightPerItem ? { custom_actual_weight_per_item: options.actualWeightPerItem } : {}),
      ...(options.qrQuantity !== undefined ? { qr_quantity: options.qrQuantity } : {}),
      ...(options.packageStatus ? { package_status: options.packageStatus } : {}),
      ...(options.pulloutQuantity !== undefined ? { pullout_quantity: options.pulloutQuantity } : {}),
      ...(options.remainingQuantity !== undefined ? { remaining_quantity: options.remainingQuantity } : {}),
      ...(options.packageCount !== undefined ? { package_count: options.packageCount } : {}),
      ...(options.packageId ? { package_id: options.packageId } : {}),
      ...(options.deviceId ? { device_id: options.deviceId } : {}),
    }, "request_id", options.requestId);
  let payload: UnknownRecord;
  try {
    payload = await call(endpoint, mutation.body);
    completeOnlineRequest(key);
  } catch (error) {
    if (error instanceof ManufacturingApiError && error.code !== "INTERNET_REQUIRED") completeOnlineRequest(key);
    throw error;
  }
  const context = parseManufactureReceiveContext(payload);
  if (!context.stockEntryId) {
    throw new ManufacturingApiError("ERPNext did not return the Draft Stock Entry ID.", "ERP_VALIDATION_FAILED");
  }
  if (context.docstatus !== 0) {
    throw new ManufacturingApiError("ERPNext returned a non-Draft Stock Entry. Scanner processing was stopped.", "ERP_VALIDATION_FAILED");
  }
  return {
    ...context,
    customReferenceDocument: context.customReferenceDocument || customReferenceDocument,
    jobCardId: context.jobCardId || jobCardId,
  };
};

export type ManufactureReceiveEntry = {
  allocation_id?: string;
  stock_entry_row: string;
  item_code: string;
  quantity: number;
  uom: string;
  target_warehouse: string;
  inventory_location_id: string;
  parent_location_id?: string;
  batch_no: string;
  serial_numbers: string[];
  device_id: string;
  transactions?: Array<Record<string, unknown>>;
};

export const submitManufactureReceive = async (
  stockEntryId: string,
  entries: ManufactureReceiveEntry[],
  submissionId: string,
  distributionParentId?: string
): Promise<ManufacturingSubmitResult> => {
  const payload = await call(
    "/api/method/qcmc_logic.api.stock_entry_scanner.submit_manufacture_receive",
    {
      stock_entry_id: stockEntryId,
      operation: "receive_manufacture",
      submission_id: submissionId,
      ...(distributionParentId ? { distribution_parent_id: distributionParentId } : {}),
      entries,
    }
  );
  return {
    stockEntryId: text(payload.stock_entry_id ?? payload.stock_entry) || stockEntryId,
    workOrderId: text(payload.work_order_id ?? payload.work_order),
    jobCardId: text(payload.job_card_id ?? payload.job_card),
    itemCount: number(payload.item_count ?? entries.length),
    status: text(payload.status) || "Draft",
    docstatus: number(payload.docstatus),
    duplicateSubmission: bool(payload.duplicate_submission),
    submissionId: text(payload.submission_id) || submissionId,
  };
};

export const createManufacturingSubmissionId = createPcountSubmissionId;
