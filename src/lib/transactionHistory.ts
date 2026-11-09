import { loadScannerDeviceName } from "@/lib/scanStorage";

export type SuccessfulTransactionType = "warehouse_allocation" | "physical_count" | "location_transfer";

export type SuccessfulTransaction = {
  id: string;
  type: SuccessfulTransactionType;
  reference: string;
  completedAt: string;
  title: string;
  detail: string;
  route?: string;
  /** Scanner name recorded when this receipt was created. */
  deviceId?: string;
  items?: Array<{ itemCode: string; location: string; physicalCount: number; previousCount: number; adjustment: number; uom: string; inventoryTags: string[] }>;
};

const STORAGE_KEY = "qcmc.successfulTransactions.v1";
const FAILED_STORAGE_KEY = "qcmc.failedTransactions.v1";

export type FailedTransaction = {
  id: string;
  type: "physical_count";
  reference: string;
  failedAt: string;
  title: string;
  detail: string;
  errorCode?: string;
  errorMessage: string;
  submissionId: string;
  /** Scanner name recorded when this failed submission occurred. */
  deviceId?: string;
};

const isFailedTransaction = (value: unknown): value is FailedTransaction => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<FailedTransaction>;
  return Boolean(
    entry.id &&
    entry.type === "physical_count" &&
    entry.reference &&
    entry.failedAt &&
    entry.title &&
    entry.detail &&
    entry.errorMessage &&
    entry.submissionId
  );
};
const transactionTypes = new Set<SuccessfulTransactionType>([
  "warehouse_allocation",
  "physical_count",
  "location_transfer",
]);

const isSuccessfulTransaction = (value: unknown): value is SuccessfulTransaction => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<SuccessfulTransaction>;
  return Boolean(
    entry.id &&
    entry.reference &&
    entry.completedAt &&
    entry.title &&
    entry.detail &&
    entry.type &&
    transactionTypes.has(entry.type)
  );
};

/** Unattributed legacy receipts are hidden rather than assigned to another scanner. */
export const isTransactionForDevice = (entry: { deviceId?: string }, deviceId: string) =>
  Boolean(deviceId.trim()) && Boolean(entry.deviceId?.trim()) &&
  entry.deviceId!.trim().toLocaleUpperCase() === deviceId.trim().toLocaleUpperCase();

const formatQuantity = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 6 });

export const createPhysicalCountTransaction = ({
  reconciliationId,
  submissionId,
  itemCount,
  entries,
  completedAt = new Date().toISOString(),
}: {
  reconciliationId: string;
  submissionId: string;
  itemCount: number;
  entries: Array<{ itemCode?: string; inventoryLocation?: string; inventoryLocationCode?: string; physicalCount: number; expectedPreviousCount?: number; quantityDelta?: number; uom: string; transactions?: Array<{ inventoryTag?: string }> }>;
  completedAt?: string;
}): SuccessfulTransaction => {
  const uoms = Array.from(new Set(entries.map((entry) => entry.uom).filter(Boolean)));
  const total = entries.reduce((sum, entry) => sum + entry.physicalCount, 0);
  const quantity = uoms.length === 1 ? ` · ${formatQuantity(total)} ${uoms[0]}` : "";
  return {
    id: `physical_count:${reconciliationId}:${submissionId}`,
    type: "physical_count",
    reference: reconciliationId,
    completedAt,
    title: "Physical Count",
    detail: `${itemCount} item${itemCount === 1 ? "" : "s"}${quantity}`,
    items: entries.map((entry) => ({
      itemCode: entry.itemCode || "Unknown item",
      location: entry.inventoryLocationCode || entry.inventoryLocation || "Not stored",
      physicalCount: entry.physicalCount,
      previousCount: entry.expectedPreviousCount ?? 0,
      adjustment: entry.quantityDelta ?? (entry.physicalCount - (entry.expectedPreviousCount ?? 0)),
      uom: entry.uom,
      inventoryTags: Array.from(new Set((entry.transactions || []).map((tx) => tx.inventoryTag?.trim()).filter((tag): tag is string => Boolean(tag)))),
    })),
  };
};

export const createLocationTransferTransaction = ({
  stockEntry,
  itemCode,
  quantity,
  uom,
  sourceLocation,
  targetLocation,
  completedAt = new Date().toISOString(),
}: {
  stockEntry: string;
  itemCode: string;
  quantity: number;
  uom: string;
  sourceLocation: string;
  targetLocation: string;
  completedAt?: string;
}): SuccessfulTransaction => ({
  id: `location_transfer:${stockEntry}`,
  type: "location_transfer",
  reference: stockEntry,
  completedAt,
  title: "Transfer Location",
  detail: `${itemCode} · ${formatQuantity(quantity)} ${uom}`,
  route: `${sourceLocation} → ${targetLocation}`,
});

export const createWarehouseAllocationTransaction = ({
  allocationName,
  completedAt,
  rowCount,
  stockEntryCount,
}: {
  allocationName: string;
  completedAt: string;
  rowCount: number;
  stockEntryCount: number;
}): SuccessfulTransaction => ({
  id: `warehouse_allocation:${allocationName}`,
  type: "warehouse_allocation",
  reference: allocationName,
  completedAt,
  title: "Warehouse Allocation",
  detail: `${rowCount} location${rowCount === 1 ? "" : "s"} · ${stockEntryCount} stock entr${stockEntryCount === 1 ? "y" : "ies"}`,
});

export const loadSuccessfulTransactionHistory = (): SuccessfulTransaction[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(isSuccessfulTransaction)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  } catch {
    return [];
  }
};

export const saveSuccessfulTransaction = (entry: SuccessfulTransaction) => {
  const deviceId = entry.deviceId?.trim() || loadScannerDeviceName();
  const recorded = { ...entry, ...(deviceId ? { deviceId } : {}) };
  const history = loadSuccessfulTransactionHistory().filter((current) => current.id !== entry.id);
  const next = [recorded, ...history].sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
};

export const loadFailedTransactionHistory = (): FailedTransaction[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(FAILED_STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(isFailedTransaction)
      .sort((left, right) => right.failedAt.localeCompare(left.failedAt));
  } catch {
    return [];
  }
};

export const saveFailedPhysicalCountTransaction = ({
  reconciliationId,
  submissionId,
  locationCount,
  entryCount,
  errorCode,
  errorMessage,
  failedAt = new Date().toISOString(),
}: {
  reconciliationId: string;
  submissionId: string;
  locationCount: number;
  entryCount: number;
  errorCode?: string;
  errorMessage: string;
  failedAt?: string;
}) => {
  const entry: FailedTransaction = {
    id: `physical_count_failed:${reconciliationId}:${submissionId}`,
    type: "physical_count",
    reference: reconciliationId,
    failedAt,
    title: "Physical Count",
    detail: `${locationCount} location${locationCount === 1 ? "" : "s"} · ${entryCount} entr${entryCount === 1 ? "y" : "ies"} · No count changes applied`,
    errorCode,
    errorMessage,
    submissionId,
    ...(loadScannerDeviceName() ? { deviceId: loadScannerDeviceName() } : {}),
  };
  const history = loadFailedTransactionHistory().filter((current) => current.id !== entry.id);
  const next = [entry, ...history].sort((left, right) => right.failedAt.localeCompare(left.failedAt));
  localStorage.setItem(FAILED_STORAGE_KEY, JSON.stringify(next));
  return next;
};
