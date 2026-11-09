import { erpRequest, extractErrorMessage } from "@/lib/erpApi";
import { loadScannerDeviceName } from "@/lib/scanStorage";
import { getErpMobileToken } from "@/lib/erpSession";
import { createPcountSubmissionId } from "@/lib/erpService";
import { clearHandoverMutationsForReferences } from "@/lib/handoverMutationQueue";
import { completeOnlineRequest, prepareOnlineRequest, requireReceiveFinishedGoodsNetwork } from "@/lib/receiveFinishedGoodsOnline";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const bool = (value: unknown) => value === true || value === 1 || String(value).trim().toLowerCase() === "true";
const list = (value: unknown) => Array.isArray(value) ? value : [];

export class HandoverApiError extends Error {
  code: string;
  payload: RecordValue;
  constructor(message: string, code = "", payload: RecordValue = {}) {
    super(message); this.name = "HandoverApiError"; this.code = code; this.payload = payload;
  }
}

export type HandoverStatus = "OPEN" | "PENDING_CHECK" | "CHECKED" | "ALLOCATION_CREATED" | "COMPLETED" | "CANCELLED";
export const isPickerReadyStatus = (status: unknown) => ["CHECKED", "ALLOCATION_CREATED"].includes(text(status).toLocaleUpperCase());
export type HandoverItem = {
  stockEntryId: string; stockEntryRow: string; jobCardId: string; workOrderId: string; pullOutSlip: string;
  itemCode: string; itemName: string; recordedQuantity: number; verifiedQuantity: number;
  correctionReason: string; uom: string; modified: string; docstatus?: number; qrQuantity?: number; quantityMultiplier?: number;
  actualWeightPerItem?: number;
  targetWarehouse?: string;
};

const normalizeWarehouse = (value: string) => value.trim().toLocaleLowerCase().replace(/[\s-]+/g, "");

export const getPickerTargetWarehouse = (items: HandoverItem[], permittedWarehouses: string[]) => {
  const targets = Array.from(new Map(items
    .map((item) => item.targetWarehouse?.trim() || "")
    .filter(Boolean)
    .map((warehouse) => [normalizeWarehouse(warehouse), warehouse])).values());
  if (!targets.length) {
    throw new HandoverApiError("ERPNext did not return the Job Card target warehouse. Warehouse Allocation cannot continue.", "TARGET_WAREHOUSE_REQUIRED");
  }
  if (targets.length !== 1) {
    throw new HandoverApiError("The handover contains conflicting Job Card target warehouses.", "TARGET_WAREHOUSE_CONFLICT");
  }
  const permitted = permittedWarehouses.find((warehouse) => normalizeWarehouse(warehouse) === normalizeWarehouse(targets[0]));
  if (!permitted) {
    throw new HandoverApiError(`You are not permitted to create a Warehouse Allocation for ${targets[0]}.`, "WAREHOUSE_PERMISSION_DENIED");
  }
  return permitted;
};
export type DeviceHandover = {
  batchId: string; token: string; expiresAt: string; status: HandoverStatus; drafts: HandoverItem[];
  handoverQr?: string;
  warehouseMan: string; checker: string; checkerId?: string; verifiedAt?: string;
  checkerVerificationStatus?: "NONE" | "PENDING_SYNC" | "VERIFIED"; stockEntriesSubmitted?: boolean;
  submittedStockEntryIds?: string[]; picker: string; updatedAt: string;
};
export type WarehouseAllocationRow = {
  allocationId: string; sourceDocument: string; sourceRow: string; itemCode: string; itemName: string;
  uom: string; originalQuantity: number; requiredQuantity?: number; allocatedQuantity: number; suggestedLocation: string;
  actualLocation: string; targetWarehouse: string; priority: number; status: string;
};
export type WarehouseAllocation = { name: string; status: string; docstatus?: number; rows: WarehouseAllocationRow[]; stockEntriesRemainDraft: boolean };
export type CompletedAllocationHistory = {
  deviceId?: string;
  allocationName: string; batchId: string; completedAt: string; checker: string; picker: string;
  stockEntryIds: string[]; allocation: WarehouseAllocation;
};

export type ActiveWarehouseAllocation = {
  batchId: string;
  allocation: WarehouseAllocation;
  updatedAt: string;
};

export const isActiveAllocationForBatch = (active: ActiveWarehouseAllocation | null, batchId: string) =>
  Boolean(active?.allocation?.name) && text(active?.batchId).toLocaleUpperCase() === text(batchId).toLocaleUpperCase() &&
  !isAllocationCompleted(active?.allocation || null);

const STORAGE_KEY = "qcmc.warehouseHandover.v2";
const ALLOCATION_HISTORY_KEY = "qcmc.warehouseAllocation.history.v1";
const ACTIVE_ALLOCATION_KEY = "qcmc.warehouseAllocation.active.v1";
export const newWorkflowId = () => createPcountSubmissionId();
export const isTerminalHandoverStatus = (status: unknown) => ["COMPLETED", "CANCELLED"].includes(text(status).toLocaleUpperCase());
export const reconcileHandoverServerStatus = (handover: DeviceHandover, serverStatus: unknown): DeviceHandover | null => {
  const normalized = text(serverStatus).toLocaleUpperCase();
  if (!normalized) return handover;
  if (isTerminalHandoverStatus(normalized)) return null;
  return { ...handover, status: normalized as HandoverStatus, updatedAt: new Date().toISOString() };
};
export const pendingCheckerItems = (rows: HandoverItem[], status: unknown) => {
  const normalized = text(status).toLocaleUpperCase();
  if (["CHECKED", "ALLOCATION_CREATED", "COMPLETED", "CANCELLED"].includes(normalized)) return [];
  return rows.filter((row) => row.docstatus === undefined || row.docstatus === 0);
};

export const loadDeviceHandover = (): DeviceHandover | null => {
  try {
    const value = record(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    if (!text(value.batchId)) return null;
    if (isTerminalHandoverStatus(value.status)) { localStorage.removeItem(STORAGE_KEY); return null; }
    return {
      batchId: text(value.batchId), token: text(value.token), expiresAt: text(value.expiresAt), handoverQr: text(value.handoverQr),
      status: (text(value.status) || "OPEN") as HandoverStatus, drafts: parseHandoverItems(value.drafts, true),
      warehouseMan: text(value.warehouseMan), checker: text(value.checker), checkerId: text(value.checkerId),
      verifiedAt: text(value.verifiedAt), checkerVerificationStatus: text(value.checkerVerificationStatus) === "VERIFIED" ? "VERIFIED" : "NONE",
      stockEntriesSubmitted: bool(value.stockEntriesSubmitted), submittedStockEntryIds: list(value.submittedStockEntryIds).map(text).filter(Boolean),
      picker: text(value.picker), updatedAt: text(value.updatedAt),
    };
  } catch { return null; }
};
export const saveDeviceHandover = (handover: DeviceHandover) => { localStorage.setItem(STORAGE_KEY, JSON.stringify(handover)); return handover; };
export const clearDeviceHandover = () => localStorage.removeItem(STORAGE_KEY);

export const loadActiveWarehouseAllocation = (): ActiveWarehouseAllocation | null => {
  try {
    const value = record(JSON.parse(localStorage.getItem(ACTIVE_ALLOCATION_KEY) || "null"));
    const allocation = parseAllocation(record(value.allocation));
    if (!allocation.name || isAllocationCompleted(allocation)) {
      localStorage.removeItem(ACTIVE_ALLOCATION_KEY);
      return null;
    }
    return {
      batchId: text(value.batchId),
      allocation,
      updatedAt: text(value.updatedAt),
    };
  } catch {
    return null;
  }
};

export const saveActiveWarehouseAllocation = (batchId: string, allocation: WarehouseAllocation) => {
  if (!allocation.name || isAllocationCompleted(allocation)) {
    localStorage.removeItem(ACTIVE_ALLOCATION_KEY);
    return null;
  }
  const value: ActiveWarehouseAllocation = {
    batchId,
    allocation,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(ACTIVE_ALLOCATION_KEY, JSON.stringify(value));
  return value;
};

export const clearActiveWarehouseAllocation = (allocationName = "") => {
  if (!allocationName) {
    localStorage.removeItem(ACTIVE_ALLOCATION_KEY);
    return;
  }
  const current = loadActiveWarehouseAllocation();
  if (!current || current.allocation.name === allocationName) localStorage.removeItem(ACTIVE_ALLOCATION_KEY);
};
export const clearCompletedHandoverCache = (batchId: string, allocationId: string, stockEntryIds: string[]) => {
  const current = loadDeviceHandover();
  if (current?.batchId === batchId) clearDeviceHandover();
  clearActiveWarehouseAllocation(allocationId);
  clearHandoverMutationsForReferences([batchId, allocationId, ...stockEntryIds]);
};
export const loadCompletedAllocationHistory = (): CompletedAllocationHistory[] => {
  try {
    const values = JSON.parse(localStorage.getItem(ALLOCATION_HISTORY_KEY) || "[]");
    return Array.isArray(values) ? values.filter((value) => value?.allocationName && value?.allocation?.name) : [];
  } catch { return []; }
};
export const saveCompletedAllocationHistory = (entry: CompletedAllocationHistory) => {
  const history = loadCompletedAllocationHistory().filter((value) => value.allocationName !== entry.allocationName);
  const deviceId = entry.deviceId?.trim() || loadScannerDeviceName();
  const next = [{ ...entry, ...(deviceId ? { deviceId } : {}) }, ...history].slice(0, 50);
  localStorage.setItem(ALLOCATION_HISTORY_KEY, JSON.stringify(next));
  return next;
};

export const getDeviceCompletedAllocationHistory = async (deviceId: string): Promise<CompletedAllocationHistory[]> => {
  const payload = await call("/api/method/qcmc_logic.api.warehouse_allocation.get_device_completed_history", { device_id: deviceId });
  return list(payload.history ?? payload.completed_allocations ?? payload.rows).flatMap((candidate) => {
    const row = record(candidate);
    const allocationSource = record(row.allocation ?? row.warehouse_allocation_data);
    const allocation = parseAllocation(Object.keys(allocationSource).length ? allocationSource : row);
    if (!allocation.name || !isAllocationCompleted(allocation)) return [];
    return [{
      allocationName: allocation.name,
      deviceId,
      batchId: text(row.batch_id ?? row.handover_batch),
      completedAt: text(row.completed_at ?? row.modified ?? row.completion_date),
      checker: text(row.checker ?? row.verified_by),
      picker: text(row.picker ?? row.completed_by),
      stockEntryIds: list(row.stock_entry_ids ?? row.linked_stock_entries).map((value) =>
        typeof value === "string" ? text(value) : text(record(value).stock_entry_id ?? record(value).name)).filter(Boolean),
      allocation,
    }];
  });
};

export const mergeHandoverDraft = (handover: DeviceHandover | null, draft: HandoverItem, batchId = "") => {
  const current: DeviceHandover = handover || {
    batchId: batchId || `LOCAL-${newWorkflowId()}`, token: "", expiresAt: "", status: "OPEN", drafts: [],
    warehouseMan: "", checker: "", checkerId: "", verifiedAt: "", checkerVerificationStatus: "NONE",
    stockEntriesSubmitted: false, submittedStockEntryIds: [], picker: "", updatedAt: "",
  };
  const sameRow = (row: HandoverItem) => row.stockEntryId === draft.stockEntryId && row.stockEntryRow === draft.stockEntryRow && row.itemCode === draft.itemCode;
  const drafts = current.drafts.some(sameRow) ? current.drafts.map((row) => sameRow(row) ? {
    ...row,
    ...draft,
    jobCardId: draft.jobCardId || row.jobCardId,
    workOrderId: draft.workOrderId || row.workOrderId,
    pullOutSlip: draft.pullOutSlip || row.pullOutSlip,
    itemName: draft.itemName || row.itemName,
    uom: draft.uom || row.uom,
    modified: draft.modified || row.modified,
    qrQuantity: draft.qrQuantity ?? row.qrQuantity,
    quantityMultiplier: draft.quantityMultiplier ?? row.quantityMultiplier,
  } : row) : [...current.drafts, draft];
  return { ...current, batchId: batchId || current.batchId, token: "", expiresAt: "", status: "PENDING_CHECK" as const,
    checker: "", checkerId: "", verifiedAt: "", checkerVerificationStatus: "NONE" as const,
    stockEntriesSubmitted: false, submittedStockEntryIds: [], drafts, updatedAt: new Date().toISOString() };
};

export const canGenerateHandoverQr = (handover: DeviceHandover | null) => Boolean(
  handover && handover.status === "CHECKED" && handover.checker.trim() && handover.checkerId?.trim() && handover.stockEntriesSubmitted
);

export type AllocationItemBalance = {
  itemCode: string; uom: string; sourceDocument: string; sourceRow: string; targetWarehouse: string;
  required: number; allocated: number; remaining: number; overAllocated: number;
};
export const allocationItemBalances = (allocation: WarehouseAllocation | null): AllocationItemBalance[] => {
  if (!allocation?.rows.length) return [];
  const groups = allocation.rows.reduce((values, row) => {
    // The same Item can legitimately occur in several linked Stock Entries or
    // source rows. Required quantity belongs to that exact source line, not to
    // the Item Code globally.
    const key = [row.sourceDocument, row.sourceRow, row.itemCode, row.targetWarehouse, row.uom]
      .map((value) => value.trim().toLocaleUpperCase()).join("\u0000");
    const group = values.get(key) || { itemCode: row.itemCode, uom: row.uom, sourceDocument: row.sourceDocument,
      sourceRow: row.sourceRow, targetWarehouse: row.targetWarehouse, rows: [] as WarehouseAllocationRow[] };
    group.rows.push(row); values.set(key, group); return values;
  }, new Map<string, { itemCode: string; uom: string; sourceDocument: string; sourceRow: string; targetWarehouse: string; rows: WarehouseAllocationRow[] }>());
  return Array.from(groups.values()).map(({ itemCode, uom, sourceDocument, sourceRow, targetWarehouse, rows }) => {
    const allocated = rows.reduce((sum, row) => sum + row.allocatedQuantity, 0);
    const explicitRequired = Math.max(0, ...rows.map((row) => Number(row.requiredQuantity) || 0));
    const largestOriginal = Math.max(0, ...rows.map((row) => row.originalQuantity));
    const required = explicitRequired || Math.max(allocated, largestOriginal);
    return { itemCode, uom, sourceDocument, sourceRow, targetWarehouse, required, allocated,
      remaining: Math.max(0, required - allocated), overAllocated: Math.max(0, allocated - required) };
  });
};
export const allocationIsReadyToComplete = (allocation: WarehouseAllocation | null) =>
  Boolean(allocation?.rows.length) && allocation!.rows.every((row) => row.status.trim().toLocaleUpperCase() === "VERIFIED") &&
  allocationItemBalances(allocation).every((balance) => balance.remaining < 0.000001 && balance.overAllocated < 0.000001);
export const allocationDefaultQuantity = (row: WarehouseAllocationRow) => row.allocatedQuantity > 0 ? row.allocatedQuantity : row.originalQuantity;
export const parseAllocationQuantityInput = (value: unknown) => Number(String(value ?? "").replace(/,/g, "").trim());
export const validateAllocationQuantity = (
  allocation: WarehouseAllocation,
  row: WarehouseAllocationRow,
  quantity: number,
  destination?: { locationCode: string; storageCapacity: number }
) => {
  if (!Number.isFinite(quantity) || quantity <= 0) return "Quantity must be numeric and greater than zero.";
  if (destination && Number.isFinite(destination.storageCapacity) && destination.storageCapacity > 0 && quantity > destination.storageCapacity + 0.000001) {
    return `${destination.locationCode || "This Storage Location"}: capacity is ${destination.storageCapacity} ${row.uom}; requested quantity is ${quantity} ${row.uom}.`;
  }
  const balance = allocationItemBalances(allocation).find((value) => sameUomItem(value, row));
  if (!balance) return "Unable to determine the required Production quantity.";
  const projected = balance.allocated - row.allocatedQuantity + quantity;
  if (projected > balance.required + 0.000001) return `${row.itemCode}: total allocated quantity cannot exceed the required Production quantity of ${balance.required} ${row.uom}.`;
  return "";
};
const sameUomItem = (balance: AllocationItemBalance, row: WarehouseAllocationRow) =>
  balance.itemCode.trim().toLocaleUpperCase() === row.itemCode.trim().toLocaleUpperCase() &&
  balance.uom.trim().toLocaleUpperCase() === row.uom.trim().toLocaleUpperCase() &&
  balance.sourceDocument.trim().toLocaleUpperCase() === row.sourceDocument.trim().toLocaleUpperCase() &&
  balance.sourceRow.trim().toLocaleUpperCase() === row.sourceRow.trim().toLocaleUpperCase() &&
  balance.targetWarehouse.trim().toLocaleUpperCase() === row.targetWarehouse.trim().toLocaleUpperCase();

const stableAllocationRowKey = (row: WarehouseAllocationRow) => [
  row.sourceDocument,
  row.sourceRow,
  row.itemCode,
  row.targetWarehouse,
  row.uom,
].map((value) => value.trim().toLocaleUpperCase()).join("\u0000");

export const findMatchingAllocationRow = (
  rows: WarehouseAllocationRow[],
  selected: WarehouseAllocationRow
) => {
  const exact = rows.find((row) => row.allocationId === selected.allocationId);
  if (exact) return exact;
  const stableKey = stableAllocationRowKey(selected);
  const matches = rows.filter((row) => stableAllocationRowKey(row) === stableKey);
  return matches.length === 1 ? matches[0] : undefined;
};

export const validateCheckerCorrections = (rows: HandoverItem[]) => rows.flatMap((row) => {
  if (!Number.isFinite(row.verifiedQuantity) || row.verifiedQuantity < 0) return [`${row.itemCode}: verified quantity must be zero or greater.`];
  if (row.verifiedQuantity !== row.recordedQuantity && !row.correctionReason.trim()) return [`${row.itemCode}: enter a reason for the quantity change.`];
  return [];
});

export const getHandoverUnitQuantity = (row: HandoverItem) => {
  if (Number.isFinite(row.qrQuantity) && Number(row.qrQuantity) > 0) return Number(row.qrQuantity);
  if (Number.isFinite(row.quantityMultiplier) && Number(row.quantityMultiplier) > 0 && row.recordedQuantity > 0) {
    return row.recordedQuantity / Number(row.quantityMultiplier);
  }
  return row.recordedQuantity;
};

export const applyHandoverQuantityMultiplier = (row: HandoverItem, multiplier: number): HandoverItem => {
  const unitQuantity = getHandoverUnitQuantity(row);
  return {
    ...row,
    qrQuantity: unitQuantity,
    quantityMultiplier: multiplier,
    verifiedQuantity: unitQuantity * multiplier,
  };
};

export const preserveHandoverScanMetadata = (authoritative: HandoverItem[], local: HandoverItem[]) => authoritative.map((row) => {
  const previous = local.find((candidate) => candidate.stockEntryId === row.stockEntryId && candidate.itemCode === row.itemCode &&
    (!candidate.stockEntryRow || !row.stockEntryRow || candidate.stockEntryRow === row.stockEntryRow)) ||
    local.find((candidate) => candidate.stockEntryId === row.stockEntryId && candidate.itemCode === row.itemCode);
  if (!previous) return row;
  return {
    ...row,
    jobCardId: row.jobCardId || previous.jobCardId, workOrderId: row.workOrderId || previous.workOrderId,
    pullOutSlip: row.pullOutSlip || previous.pullOutSlip, itemName: row.itemName || previous.itemName,
    actualWeightPerItem: row.actualWeightPerItem || previous.actualWeightPerItem,
    qrQuantity: previous.qrQuantity ?? getHandoverUnitQuantity(previous),
    quantityMultiplier: previous.quantityMultiplier ?? (getHandoverUnitQuantity(previous) > 0 ? previous.verifiedQuantity / getHandoverUnitQuantity(previous) : 1),
  };
});

const call = async (endpoint: string, body: RecordValue) => {
  requireReceiveFinishedGoodsNetwork();
  const mobileToken = getErpMobileToken();
  let response;
  try {
    response = await erpRequest(endpoint, { method: "POST", body: { ...body, ...(mobileToken ? { mobile_token: mobileToken } : {}) } });
  } catch {
    throw new HandoverApiError("Internet connection is required for Receive Finished Goods. Please reconnect and try again.", "INTERNET_REQUIRED");
  }
  const outer = record(response.data); const payload = record(outer.message ?? outer);
  if (payload.duplicate_request === true) return payload;
  if (!response.ok || payload.success !== true) {
    const code = text(payload.error_code ?? payload.code);
    throw new HandoverApiError(extractErrorMessage(payload, `ERPNext request failed (HTTP ${response.status})`), code, payload);
  }
  return payload;
};

const mutationCall = async (key: string, endpoint: string, body: RecordValue, idField: "request_id" | "transaction_id", proposedId = "") => {
  const mutation = prepareOnlineRequest(key, body, idField, proposedId);
  try {
    const payload = await call(endpoint, mutation.body);
    completeOnlineRequest(key);
    return payload;
  } catch (error) {
    if (error instanceof HandoverApiError && error.code !== "INTERNET_REQUIRED") completeOnlineRequest(key);
    throw error;
  }
};

type ItemDefaults = Partial<HandoverItem>;
const firstText = (...values: unknown[]) => values.map(text).find(Boolean) || "";

export const parseHandoverItems = (value: unknown, local = false, inherited: ItemDefaults = {}): HandoverItem[] => list(value).flatMap((candidate) => {
  const row = record(candidate);
  const defaults: ItemDefaults = {
    stockEntryId: firstText(local ? row.stockEntryId : row.stock_entry_id, row.stock_entry, row.source_document, row.stockEntryId, inherited.stockEntryId),
    stockEntryRow: firstText(local ? row.stockEntryRow : row.stock_entry_row, row.source_row, row.row_name, row.stockEntryRow,
      (row.item_code || row.itemCode) ? row.name : undefined, inherited.stockEntryRow),
    jobCardId: firstText(local ? row.jobCardId : row.job_card_id, row.job_card, row.jobCardId, inherited.jobCardId),
    workOrderId: firstText(local ? row.workOrderId : row.work_order_id, row.work_order, row.workOrderId, inherited.workOrderId),
    pullOutSlip: firstText(local ? row.pullOutSlip : row.pull_out_slip, row.custom_reference_document, row.customReferenceDocument, row.pullOutSlip, inherited.pullOutSlip),
    actualWeightPerItem: number(local ? row.actualWeightPerItem : row.custom_actual_weight_per_item ?? row.actual_weight_per_item ?? inherited.actualWeightPerItem),
    itemName: firstText(local ? row.itemName : row.item_name, row.itemName, inherited.itemName),
    uom: firstText(local ? row.uom : row.stock_uom, row.uom, inherited.uom),
    modified: firstText(local ? row.modified : row.expected_modified, row.modified, inherited.modified),
    docstatus: row.docstatus === undefined ? inherited.docstatus : number(row.docstatus),
    targetWarehouse: firstText(local ? row.targetWarehouse : row.target_warehouse, row.t_warehouse, row.targetWarehouse, inherited.targetWarehouse),
  };
  const nested = row.items ?? row.finished_items ?? row.item_rows ?? row.stock_entry_items;
  const itemCode = firstText(local ? row.itemCode : row.item_code, row.itemCode, row.finished_item_code, inherited.itemCode);
  if (Array.isArray(nested) && nested.length) return parseHandoverItems(nested, local, { ...inherited, ...defaults, ...(itemCode ? { itemCode } : {}) });
  if (!defaults.stockEntryId || !itemCode) return [];
  const recordedSource = local ? row.recordedQuantity : row.recorded_quantity ?? row.qty ?? row.quantity ?? row.stock_qty ?? row.transfer_qty;
  const recorded = recordedSource === undefined ? number(inherited.recordedQuantity) : number(recordedSource);
  const verifiedSource = local ? row.verifiedQuantity : row.verified_quantity ?? row.actual_quantity;
  return [{
    stockEntryId: defaults.stockEntryId, stockEntryRow: defaults.stockEntryRow || "", jobCardId: defaults.jobCardId || "",
    workOrderId: defaults.workOrderId || "", pullOutSlip: defaults.pullOutSlip || "", itemCode,
    itemName: defaults.itemName || "", recordedQuantity: recorded,
    verifiedQuantity: verifiedSource === undefined ? (inherited.verifiedQuantity ?? recorded) : number(verifiedSource),
    correctionReason: firstText(local ? row.correctionReason : row.reason, row.correction_reason, row.correctionReason, inherited.correctionReason),
    uom: defaults.uom || "", modified: defaults.modified || "",
    actualWeightPerItem: defaults.actualWeightPerItem,
    targetWarehouse: defaults.targetWarehouse || "",
    ...(defaults.docstatus === undefined ? {} : { docstatus: defaults.docstatus }),
    ...(local && Number.isFinite(Number(row.qrQuantity)) ? { qrQuantity: number(row.qrQuantity) } : inherited.qrQuantity !== undefined ? { qrQuantity: inherited.qrQuantity } : {}),
    ...(local && Number.isFinite(Number(row.quantityMultiplier)) ? { quantityMultiplier: number(row.quantityMultiplier) } : inherited.quantityMultiplier !== undefined ? { quantityMultiplier: inherited.quantityMultiplier } : {}),
  }];
});

const mergeItemDetails = (rows: HandoverItem[]) => rows.reduce<HandoverItem[]>((merged, row) => {
  const index = merged.findIndex((existing) => existing.stockEntryId === row.stockEntryId && existing.itemCode === row.itemCode &&
    (!existing.stockEntryRow || !row.stockEntryRow || existing.stockEntryRow === row.stockEntryRow));
  if (index < 0) return [...merged, row];
  const previous = merged[index];
  merged[index] = {
    ...previous, ...row,
    stockEntryRow: row.stockEntryRow || previous.stockEntryRow, jobCardId: row.jobCardId || previous.jobCardId,
    workOrderId: row.workOrderId || previous.workOrderId, pullOutSlip: row.pullOutSlip || previous.pullOutSlip,
    itemName: row.itemName || previous.itemName, uom: row.uom || previous.uom, modified: row.modified || previous.modified,
    actualWeightPerItem: row.actualWeightPerItem || previous.actualWeightPerItem,
    targetWarehouse: row.targetWarehouse || previous.targetWarehouse,
    qrQuantity: row.qrQuantity ?? previous.qrQuantity, quantityMultiplier: row.quantityMultiplier ?? previous.quantityMultiplier,
  };
  return merged;
}, []);

const parsePayloadItems = (payload: RecordValue) => {
  const sourceRecords = list(payload.source_stock_entries ?? payload.stock_entries ?? payload.sources).map(record);
  const rows = mergeItemDetails([
    ...parseHandoverItems(sourceRecords),
    ...parseHandoverItems(payload.items ?? payload.rows),
  ]);
  return rows.map((row) => {
    const parent = sourceRecords.find((source) => firstText(source.stock_entry_id, source.stock_entry, source.source_document, source.name) === row.stockEntryId);
    const source = parent || payload;
    return {
      ...row,
      jobCardId: row.jobCardId || firstText(source.job_card_id, source.job_card, source.jobCardId),
      workOrderId: row.workOrderId || firstText(source.work_order_id, source.work_order, source.workOrderId),
      pullOutSlip: row.pullOutSlip || firstText(source.pull_out_slip, source.custom_reference_document, source.customReferenceDocument),
      actualWeightPerItem: row.actualWeightPerItem || number(source.custom_actual_weight_per_item ?? source.actual_weight_per_item),
      targetWarehouse: row.targetWarehouse || firstText(source.target_warehouse, source.t_warehouse, source.targetWarehouse),
      modified: row.modified || firstText(source.expected_modified, source.modified),
    };
  });
};

export const addStockEntryToHandover = async (batchId: string, stockEntryId: string, deviceId: string, requestId = "") => {
  const endpoint = "/api/method/qcmc_logic.api.warehouse_handover.add_stock_entry";
  const effectiveBatch = batchId.startsWith("LOCAL-") ? "" : batchId;
  const payload = await mutationCall(`add:${effectiveBatch}:${stockEntryId}`, endpoint, {
    ...(effectiveBatch ? { batch_id: effectiveBatch } : {}), stock_entry_id: stockEntryId, device_id: deviceId,
  }, "request_id", requestId);
  return {
    batchId: text(payload.batch_id), status: (text(payload.status) || "PENDING_CHECK") as HandoverStatus,
    warehouseMan: text(payload.warehouse_man), items: parsePayloadItems(payload),
  };
};

export type HandoverQrPayload = {
  type: "QCMC_WAREHOUSE_HANDOVER"; version: 1; batch_id: string; stock_entry_ids: string[];
  issued_at: string; expires_at: string; token: string;
};

export const createDeviceHandoverQrPayload = (handover: DeviceHandover): HandoverQrPayload => ({
  type: "QCMC_WAREHOUSE_HANDOVER",
  version: 1,
  batch_id: handover.batchId,
  stock_entry_ids: Array.from(new Set(handover.drafts.map((row) => row.stockEntryId).filter(Boolean))),
  issued_at: "",
  expires_at: handover.expiresAt,
  token: handover.token,
});
export const parseHandoverQr = (raw: string): HandoverQrPayload => {
  let value: RecordValue;
  try { value = record(JSON.parse(raw.trim())); } catch { throw new HandoverApiError("Invalid Warehouse Handover QR.", "INVALID_HANDOVER_QR"); }
  const ids = list(value.stock_entry_ids).map(text).filter(Boolean);
  if (value.type !== "QCMC_WAREHOUSE_HANDOVER" || number(value.version) !== 1 || !text(value.batch_id) || !text(value.token) || !ids.length) {
    throw new HandoverApiError("Invalid or incomplete Warehouse Handover QR.", "INVALID_HANDOVER_QR");
  }
  return { type: "QCMC_WAREHOUSE_HANDOVER", version: 1, batch_id: text(value.batch_id), stock_entry_ids: ids,
    issued_at: text(value.issued_at), expires_at: text(value.expires_at), token: text(value.token) };
};

export const generateHandoverQr = async (batchId: string, requestId = "") => {
  const primaryEndpoint = "/api/method/qcmc_logic.api.warehouse_handover.generate_handover_qr";
  const legacyEndpoint = "/api/method/qcmc_logic.api.warehouse_handover.generate_handover_qr_payload";
  const effectiveRequestId = requestId || newWorkflowId();
  let payload: RecordValue;
  try {
    payload = await mutationCall(`qr:${batchId}`, primaryEndpoint, { batch_id: batchId }, "request_id", effectiveRequestId);
  } catch (error) {
    const fallbackCodes = ["METHOD_NOT_FOUND", "NOT_FOUND", "404"];
    if (!(error instanceof HandoverApiError) || (!fallbackCodes.includes(error.code.toUpperCase()) && !/(method not found|404)/i.test(error.message))) throw error;
    completeOnlineRequest(`qr:${batchId}`);
    payload = await mutationCall(`qr-legacy:${batchId}`, legacyEndpoint, { batch_id: batchId }, "request_id", effectiveRequestId);
  }
  const qrObject = record(payload.qr_payload ?? payload);
  const raw = typeof payload.qr_payload === "string" ? payload.qr_payload : JSON.stringify(qrObject);
  return { raw, parsed: parseHandoverQr(raw) };
};

export const getCheckerReview = async (qr: HandoverQrPayload) => {
  const payload = await call("/api/method/qcmc_logic.api.warehouse_handover.get_checker_review", { batch_id: qr.batch_id, token: qr.token });
  return { batchId: text(payload.batch_id) || qr.batch_id, status: text(payload.status), warehouseMan: text(payload.warehouse_man),
    items: parsePayloadItems(payload) };
};

export const updateCheckedQuantities = async (batchId: string, rows: HandoverItem[], deviceId: string, requestId = "") => {
  const errors = validateCheckerCorrections(rows); if (errors.length) throw new HandoverApiError(errors[0], "INVALID_QUANTITY");
  const endpoint = "/api/method/qcmc_logic.api.warehouse_handover.update_checked_quantities";
  const fingerprint = rows.map((row) => `${row.stockEntryId}:${row.stockEntryRow}:${row.verifiedQuantity}:${row.correctionReason}:${row.modified}`).join("|");
  const payload = await mutationCall(`check:${batchId}:${fingerprint}`, endpoint, { batch_id: batchId, device_id: deviceId,
    rows: rows.map((row) => ({ stock_entry_id: row.stockEntryId, stock_entry_row: row.stockEntryRow, item_code: row.itemCode,
      verified_quantity: row.verifiedQuantity, uom: row.uom, expected_modified: row.modified,
      ...(row.verifiedQuantity !== row.recordedQuantity ? { reason: row.correctionReason.trim() } : {}) })) }, "request_id", requestId);
  return { status: text(payload.status), items: parsePayloadItems(payload) };
};

export const updateManufactureReceiveDraft = async (
  batchId: string,
  rows: HandoverItem[],
  deviceId: string,
  requestId = newWorkflowId()
) => {
  const endpoint = "/api/method/qcmc_logic.api.stock_entry_scanner.update_manufacture_receive_draft";
  const fingerprint = rows.map((row) => `${row.stockEntryId}:${row.stockEntryRow}:${row.verifiedQuantity}:${row.actualWeightPerItem || 0}:${row.uom}`).join("|");
  const payload = await mutationCall(`draft-update:${batchId}:${fingerprint}`, endpoint, {
    batch_id: batchId,
    device_id: deviceId,
    rows: rows.map((row) => ({
      stock_entry_id: row.stockEntryId,
      stock_entry_row: row.stockEntryRow,
      item_code: row.itemCode,
      quantity: row.verifiedQuantity,
      custom_actual_weight_per_item: row.actualWeightPerItem,
      uom: row.uom,
    })),
  }, "request_id", requestId);
  return { status: text(payload.status) || "Draft", items: parsePayloadItems(payload) };
};

export type CheckerConfirmation = {
  batchId: string; checker: string; checkerId: string; verifiedAt: string; status: HandoverStatus;
  stockEntryIds: string[]; stockEntriesSubmitted: boolean; submittedStockEntryIds: string[];
};

export const parseCheckerConfirmation = (payload: RecordValue): CheckerConfirmation => {
  const stockEntryIds = list(payload.stock_entry_ids ?? payload.source_stock_entries ?? payload.sources).map((value) =>
    typeof value === "string" ? text(value) : firstText(record(value).stock_entry_id, record(value).name)).filter(Boolean);
  const submittedStockEntryIds = list(payload.submitted_stock_entry_ids).map((value) =>
    typeof value === "string" ? text(value) : firstText(record(value).stock_entry_id, record(value).name)).filter(Boolean);
  return {
    batchId: text(payload.batch_id), checker: text(payload.checker), checkerId: text(payload.checker_id),
    verifiedAt: text(payload.verified_at), status: (text(payload.status) || "PENDING_CHECK") as HandoverStatus,
    stockEntryIds, stockEntriesSubmitted: bool(payload.stock_entries_submitted), submittedStockEntryIds,
  };
};

export const confirmChecker = async (batchId: string, checkerQr: string, deviceId: string, requestId = "") => {
  const endpoint = "/api/method/qcmc_logic.api.warehouse_handover.confirm_checker";
  const payload = await mutationCall(`confirm-checker:${batchId}`, endpoint, { batch_id: batchId, checker_qr: checkerQr, device_id: deviceId }, "request_id", requestId);
  return parseCheckerConfirmation(payload);
};

export const getPickerContext = async (qr: HandoverQrPayload) => {
  const payload = await call("/api/method/qcmc_logic.api.warehouse_handover.get_picker_context", { batch_id: qr.batch_id, token: qr.token });
  const checkerEmployee = record(payload.checker_employee);
  return { status: text(payload.status), warehouseMan: text(payload.warehouse_man), checker: firstText(payload.checker, checkerEmployee.full_name, checkerEmployee.name), items: parsePayloadItems(payload),
    stockEntryIds: list(payload.stock_entry_ids ?? payload.source_stock_entries ?? payload.sources).map((value) => typeof value === "string" ? value : firstText(record(value).stock_entry_id, record(value).name)).filter(Boolean),
    transactionTypes: list(payload.transaction_types ?? payload.available_transaction_types).map(text).filter(Boolean),
    warehouses: list(payload.permitted_warehouses ?? payload.warehouses).map((value) => typeof value === "string" ? value : text(record(value).name ?? record(value).warehouse)).filter(Boolean) };
};

const parseAllocationRow = (candidate: unknown): WarehouseAllocationRow | null => {
  const row = record(candidate); const allocationId = text(row.allocation_id); const itemCode = text(row.item_code);
  if (!allocationId || !itemCode) return null;
  const status = text(row.status) || "PENDING_VERIFICATION";
  const useActual = row.actual_quantity !== undefined && (Boolean(text(row.actual_location)) || status.toLocaleUpperCase() === "VERIFIED");
  return { allocationId, sourceDocument: text(row.source_document), sourceRow: text(row.source_row), itemCode, itemName: text(row.item_name),
    uom: text(row.stock_uom ?? row.uom), originalQuantity: number(row.original_quantity ?? row.required_quantity ?? row.production_quantity ?? row.allocated_quantity ?? row.suggested_quantity),
    ...(row.required_quantity === undefined && row.production_quantity === undefined && row.item_required_quantity === undefined ? {} : { requiredQuantity: number(row.required_quantity ?? row.production_quantity ?? row.item_required_quantity) }),
    allocatedQuantity: number(useActual ? row.actual_quantity : row.allocated_quantity ?? row.suggested_quantity ?? row.allocated_qty ?? row.actual_quantity ?? row.quantity ?? row.qty),
    suggestedLocation: text(row.suggested_location), actualLocation: text(row.actual_location), targetWarehouse: text(row.target_warehouse),
    priority: number(row.priority), status };
};
export const parseAllocation = (payload: RecordValue): WarehouseAllocation => {
  const nested = record(payload.allocation ?? payload.warehouse_allocation_data);
  const source = Object.keys(nested).length ? { ...payload, ...nested } : payload;
  const docstatusValue = source.docstatus;
  return {
    name: text(source.warehouse_allocation ?? source.name), status: text(source.status) || "Draft",
    ...(docstatusValue === undefined || docstatusValue === null ? {} : { docstatus: number(docstatusValue) }),
    rows: list(source.allocations ?? source.rows).map(parseAllocationRow).filter(Boolean) as WarehouseAllocationRow[],
    stockEntriesRemainDraft: source.stock_entries_remain_draft === true,
  };
};
export const isAllocationCompleted = (allocation: WarehouseAllocation | null) => Boolean(
  allocation && allocation.status.trim().toLocaleUpperCase() === "COMPLETED" && (allocation.docstatus === undefined || allocation.docstatus === 1)
);
export type WarehouseAllocationUpdate = { row: WarehouseAllocationRow; allocation: WarehouseAllocation | null };
const parseRowUpdate = (payload: RecordValue, fallback: WarehouseAllocationRow): WarehouseAllocationUpdate => {
  const row = parseAllocationRow(payload.row ?? payload.updated_row ?? payload.allocation_row ?? payload) || fallback;
  const parsed = parseAllocation(payload);
  const hasFullRows = Array.isArray(payload.rows) || Array.isArray(payload.allocations) || Array.isArray(record(payload.allocation).rows) || Array.isArray(record(payload.warehouse_allocation_data).rows);
  return { row, allocation: hasFullRows ? parsed : null };
};

export const createWarehouseAllocation = async (args: { batchId: string; token: string; transactionType: string; warehouse: string; postingDate: string; postingTime: string; deviceId: string; requestId?: string; additionalDetails?: RecordValue }) => {
  const endpoint = "/api/method/qcmc_logic.api.warehouse_allocation.create_draft";
  return parseAllocation(await mutationCall(`create-allocation:${args.batchId}:${args.transactionType}:${args.warehouse}:${args.postingDate}:${args.postingTime}`, endpoint, {
    batch_id: args.batchId, handover_token: args.token, transaction_type: args.transactionType, warehouse: args.warehouse,
    posting_date: args.postingDate, posting_time: args.postingTime, device_id: args.deviceId, additional_details: args.additionalDetails || {},
  }, "request_id", args.requestId));
};

export const verifyAllocationLocation = async (allocation: string, row: WarehouseAllocationRow, scannedLocationId: string, actualQuantity: number, deviceId: string, transactionId = "") => {
  const endpoint = "/api/method/qcmc_logic.api.warehouse_allocation.verify_location";
  const payload = await mutationCall(`verify:${allocation}:${row.allocationId}:${scannedLocationId}:${actualQuantity}`, endpoint, { warehouse_allocation: allocation,
    allocation_id: row.allocationId, scanned_location_id: scannedLocationId, item_code: row.itemCode, actual_quantity: actualQuantity,
    device_id: deviceId, timestamp: new Date().toISOString() }, "transaction_id", transactionId);
  return parseRowUpdate(payload, { ...row, allocatedQuantity: actualQuantity, actualLocation: scannedLocationId, status: "VERIFIED" });
};
export const changeAllocationLocation = async (allocation: string, row: WarehouseAllocationRow, newLocationId: string, actualQuantity: number, reason: string, deviceId: string, transactionId = "") => {
  const endpoint = "/api/method/qcmc_logic.api.warehouse_allocation.change_location";
  const payload = await mutationCall(`change-location:${allocation}:${row.allocationId}:${newLocationId}:${actualQuantity}:${reason}`, endpoint, { warehouse_allocation: allocation,
    allocation_id: row.allocationId, new_location_id: newLocationId, actual_quantity: actualQuantity, reason, device_id: deviceId }, "transaction_id", transactionId);
  return parseRowUpdate(payload, { ...row, allocatedQuantity: actualQuantity, actualLocation: newLocationId, status: "VERIFIED" });
};
export const adjustAllocationQuantity = async (allocation: string, row: WarehouseAllocationRow, actualQuantity: number, reason: string, deviceId: string, transactionId = "") => {
  const endpoint = "/api/method/qcmc_logic.api.warehouse_allocation.adjust_quantity";
  const payload = await mutationCall(`adjust:${allocation}:${row.allocationId}:${actualQuantity}:${reason}`, endpoint, { warehouse_allocation: allocation,
    allocation_id: row.allocationId, actual_quantity: actualQuantity, reason, device_id: deviceId }, "transaction_id", transactionId);
  return parseRowUpdate(payload, { ...row, allocatedQuantity: actualQuantity });
};
export const completeWarehouseAllocation = async (allocation: string, deviceId: string, requestId = "") => {
  const endpoint = "/api/method/qcmc_logic.api.warehouse_allocation.complete";
  const payload = await mutationCall(`complete:${allocation}`, endpoint, { warehouse_allocation: allocation, device_id: deviceId }, "request_id", requestId);
  const completed = parseAllocation(payload);
  if (!isAllocationCompleted(completed)) {
    throw new HandoverApiError("ERPNext did not return a completed Warehouse Allocation.", "ALLOCATION_COMPLETION_INVALID_RESPONSE", payload);
  }
  return { allocation: completed, pendingRows: list(payload.pending_rows).map(text).filter(Boolean) };
};

export const getWarehouseAllocation = async (allocation: string) => {
  const payload = await call("/api/method/qcmc_logic.api.warehouse_allocation.get_allocation", { warehouse_allocation: allocation });
  return parseAllocation(payload);
};
