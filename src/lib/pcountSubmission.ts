import type { PcountEntry } from "@/lib/erpService";
import type { LocalScanEntry, LocalScanTransaction } from "@/lib/scanStorage";
import { normalizeUom } from "@/lib/uom";

export const PCOUNT_BLIND_CONFLICT_TITLE = "Count Synchronization Required";
export const PCOUNT_BLIND_CONFLICT_MESSAGE =
  "ERPNext could not accept this submission because the count synchronization state changed after counting began. Your scanned quantities and audit history are preserved. Refresh the synchronization data and resubmit the complete count, or cancel and review your scans.";
export const PCOUNT_BLIND_CONFLICT_NOTICE =
  "Count synchronization changed. Review before resubmitting the complete count.";

const DECIMAL_SCALE = 1_000_000;

const toUnits = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new Error(`${label} is not a valid quantity.`);
  return Math.round(value * DECIMAL_SCALE);
};

const fromUnits = (value: number) => value / DECIMAL_SCALE;

const normalizedKeyPart = (value: string) => String(value || "").trim().toLocaleUpperCase();

export const getPcountEntryKey = (entry: Pick<LocalScanEntry, "itemCode" | "bin" | "uom" | "authoritativeUom">) =>
  [
    normalizedKeyPart(entry.itemCode),
    normalizedKeyPart(entry.bin.warehouse),
    normalizedKeyPart(entry.bin.locationId || ""),
    normalizeUom(entry.authoritativeUom || entry.uom),
  ].join("\u001f");

export const getPendingPcountTransactions = (entry: LocalScanEntry) => {
  const transactions = (entry.scanTransactions || []).filter(
    (transaction): transaction is LocalScanTransaction & { action: "ADD" | "DEDUCT" } =>
      transaction.action === "ADD" || transaction.action === "DEDUCT"
  );
  const submittedIds = new Set(entry.submittedTransactionIds || []);
  if (submittedIds.size > 0) {
    return transactions.filter((transaction) => !submittedIds.has(transaction.id));
  }

  // Backward compatibility for entries saved before transaction IDs were tracked.
  return transactions.slice(Math.max(0, entry.submittedTransactionCount || 0));
};

export const getPcountStartingPhysicalCount = (entry: LocalScanEntry) => {
  // Preferred source: exact physical count acknowledged by ERPNext.
  if (entry.submittedPhysicalCount !== undefined) return entry.submittedPhysicalCount;

  const firstPending = getPendingPcountTransactions(entry)[0];
  if (firstPending) {
    const signedChange = firstPending.action === "DEDUCT"
      ? -Math.abs(firstPending.quantityChange)
      : Math.abs(firstPending.quantityChange);
    const inferred = firstPending.runningQuantity - signedChange;

    // This also repairs older/ERP-synced rows where submittedPhysicalCount was
    // not persisted but the new transaction's running quantity already starts
    // from the previous acknowledged count.
    if (Number.isFinite(inferred) && inferred >= 0) return inferred;
  }

  // ERP-synced Physical Count rows can legitimately have no local submitted
  // transaction IDs. submittedQuantity is still the acknowledged starting count.
  if (Number.isFinite(entry.submittedQuantity)) return entry.submittedQuantity || 0;

  return 0;
};

export type PcountNegativeCountIssue = {
  itemCode: string;
  location: string;
  quantity: number;
  uom: string;
};

export const getPcountNegativeCountIssue = (
  entries: LocalScanEntry[]
): PcountNegativeCountIssue | null => {
  const negative = entries.find((entry) => Number.isFinite(entry.quantity) && entry.quantity < 0);
  if (!negative) return null;
  return {
    itemCode: negative.itemCode,
    location: negative.bin.locationCode || negative.bin.locationName || negative.bin.locationId || negative.bin.bin || "unknown location",
    quantity: negative.quantity,
    uom: negative.authoritativeUom || negative.uom || negative.barcodeUom || "",
  };
};

export const getPcountNegativeCountMessage = (issue: PcountNegativeCountIssue) =>
  `${issue.itemCode} at ${issue.location} has negative count (${issue.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}${issue.uom ? ` ${issue.uom}` : ""}). Add quantity or review the scan history before submitting.`;

// Transactions are appended to local storage in scan order. Locale-formatted
// timestamps are not reliably parseable, so array order is the authoritative
// chronology and must not be rearranged during payload construction.
const sortTransactions = (transactions: ReturnType<typeof getPendingPcountTransactions>) => [...transactions];

export type BuildPcountEntryOptions = {
  entry: LocalScanEntry;
  warehouse: string;
  expectedPreviousCount: number;
  expectedErpQuantity: number;
  authoritativeUom: string;
};

export const requirePcountEntryLocation = (entry: LocalScanEntry) => {
  const locationId = String(entry.bin.locationId || "").trim();
  if (!locationId) throw new Error(`${entry.itemCode}: Storage Location is required. Select or scan a counting location before syncing.`);
  return locationId;
};

export const buildPcountEntry = ({
  entry,
  warehouse,
  expectedPreviousCount,
  expectedErpQuantity,
  authoritativeUom,
}: BuildPcountEntryOptions): PcountEntry => {
  const locationId = requirePcountEntryLocation(entry);

  const source = sortTransactions(getPendingPcountTransactions(entry));
  if (source.length === 0) {
    throw new Error(`${entry.itemCode} at ${locationId}: no pending scan transactions were found.`);
  }

  let runningUnits = toUnits(expectedPreviousCount, "Expected previous count");
  const transactions: NonNullable<PcountEntry["transactions"]> = source.map((transaction) => {
    if (transaction.locationId && normalizedKeyPart(transaction.locationId) !== normalizedKeyPart(locationId)) {
      throw new Error(`${entry.itemCode} at ${locationId}: transaction ${transaction.id} belongs to ${transaction.locationId}.`);
    }
    const absoluteUnits = Math.abs(toUnits(transaction.quantityChange, `Transaction ${transaction.id}`));
    const changeUnits = transaction.action === "DEDUCT" ? -absoluteUnits : absoluteUnits;
    const nextUnits = runningUnits + changeUnits;
    if (nextUnits < 0) {
      throw new Error(`${entry.itemCode} at ${locationId}: deduction ${transaction.id} would make the physical count negative.`);
    }
    runningUnits = nextUnits;
    return {
      id: transaction.id,
      action: transaction.action,
      quantityChange: fromUnits(changeUnits),
      runningQuantity: fromUnits(runningUnits),
      timestamp: transaction.timestamp,
      employeeId: transaction.employeeId,
      employeeName: transaction.employeeName,
      deviceId: transaction.deviceId,
      locationId,
      locationLabel: transaction.locationLabel,
      ...(transaction.inventoryTag ? { inventoryTag: transaction.inventoryTag } : {}),
      ...(transaction.qrQuantity !== undefined ? { qrQuantity: transaction.qrQuantity } : {}),
      ...(transaction.packageStatus ? { packageStatus: transaction.packageStatus } : {}),
      ...(transaction.actualQuantity !== undefined ? { actualQuantity: transaction.actualQuantity } : {}),
      ...(transaction.remainingQuantity !== undefined ? { remainingQuantity: transaction.remainingQuantity } : {}),
      ...(transaction.packageId ? { packageId: transaction.packageId } : {}),
    };
  });

  const expectedUnits = toUnits(expectedPreviousCount, "Expected previous count");
  const deltaUnits = transactions.reduce(
    (total, transaction) => total + toUnits(transaction.quantityChange, `Transaction ${transaction.id}`),
    0
  );
  const physicalUnits = expectedUnits + deltaUnits;
  const finalRunningUnits = toUnits(transactions[transactions.length - 1].runningQuantity, "Final running quantity");
  if (physicalUnits !== finalRunningUnits) {
    throw new Error(`${entry.itemCode} at ${locationId}: final transaction quantity does not match the calculated physical count.`);
  }

  const quantityDelta = fromUnits(deltaUnits);
  const physicalCount = fromUnits(physicalUnits);
  const totalAdded = fromUnits(transactions.reduce(
    (sum, transaction) => sum + (transaction.action === "ADD" ? toUnits(transaction.quantityChange, transaction.id) : 0),
    0
  ));
  const totalDeducted = fromUnits(transactions.reduce(
    (sum, transaction) => sum + (transaction.action === "DEDUCT" ? Math.abs(toUnits(transaction.quantityChange, transaction.id)) : 0),
    0
  ));

  const result: PcountEntry = {
    itemCode: entry.itemCode,
    warehouse,
    inventoryLocation: locationId,
    inventoryLocationCode: entry.bin.locationCode,
    quantity: physicalCount,
    quantityDelta,
    expectedPreviousCount: fromUnits(expectedUnits),
    expectedERPQuantity: fromUnits(toUnits(expectedErpQuantity, "Expected ERP quantity")),
    physicalCount,
    stockUom: authoritativeUom,
    totalAdded,
    totalDeducted,
    transactions,
    uom: authoritativeUom,
    lotNo: entry.lotNo,
    deviceId: entry.deviceId,
    bin: { ...entry.bin, warehouse },
  };

  validatePcountEntry(result);
  return result;
};

export const validatePcountEntry = (entry: PcountEntry) => {
  const location = entry.inventoryLocation || entry.bin.locationId || "unknown location";
  const transactions = entry.transactions || [];
  if (transactions.length === 0) throw new Error(`${entry.itemCode} at ${location}: transaction history is empty.`);
  let runningUnits = toUnits(entry.expectedPreviousCount, "Expected previous count");
  let deltaUnits = 0;
  for (const transaction of transactions) {
    const expectedChangeUnits = (transaction.action === "DEDUCT" ? -1 : 1) *
      Math.abs(toUnits(transaction.quantityChange, `Transaction ${transaction.id}`));
    deltaUnits += expectedChangeUnits;
    runningUnits += expectedChangeUnits;
    if (runningUnits < 0 || runningUnits !== toUnits(transaction.runningQuantity, `Transaction ${transaction.id} running quantity`)) {
      throw new Error(`${entry.itemCode} at ${location}: transaction ${transaction.id} has an invalid running quantity.`);
    }
  }
  if (deltaUnits !== toUnits(entry.quantityDelta, "Quantity delta")) {
    throw new Error(`${entry.itemCode} at ${location}: quantity delta does not match transaction history.`);
  }
  if (runningUnits !== toUnits(entry.physicalCount, "Physical count")) {
    throw new Error(`${entry.itemCode} at ${location}: physical count does not equal expected count plus quantity delta.`);
  }
  return true;
};

export const refreshPcountExpectedErpQuantity = (
  entries: PcountEntry[],
  target: { itemCode: string; warehouse: string; inventoryLocation: string },
  currentErpQuantity: number
) => {
  let matched = false;
  const refreshed = entries.map((entry) => {
    const isTarget = normalizedKeyPart(entry.itemCode) === normalizedKeyPart(target.itemCode) &&
      normalizedKeyPart(entry.warehouse) === normalizedKeyPart(target.warehouse) &&
      normalizedKeyPart(entry.inventoryLocation) === normalizedKeyPart(target.inventoryLocation);
    if (!isTarget) return entry;
    matched = true;
    return { ...entry, expectedERPQuantity: fromUnits(toUnits(currentErpQuantity, "Current ERP quantity")) };
  });
  if (!matched) {
    throw new Error(`${target.itemCode || "Item"} at ${target.inventoryLocation || "unknown location"}: ERP stock conflict did not match a submitted entry.`);
  }
  return refreshed;
};

export const getPcountVariance = (entry: PcountEntry) =>
  fromUnits(
    toUnits(entry.physicalCount, "Physical count") -
    toUnits(entry.expectedERPQuantity || 0, "Expected ERP quantity")
  );

export const createPcountSourceFingerprint = (reconciliationId: string, entries: LocalScanEntry[]) =>
  JSON.stringify({
    reconciliationId,
    entries: entries.map((entry) => ({
      key: getPcountEntryKey(entry),
      transactions: getPendingPcountTransactions(entry).map((transaction) => ({
        id: transaction.id,
        action: transaction.action,
        quantityChange: transaction.quantityChange,
        timestamp: transaction.timestamp,
        locationId: transaction.locationId,
        ...(transaction.inventoryTag ? { inventoryTag: transaction.inventoryTag } : {}),
        ...(transaction.qrQuantity !== undefined ? { qrQuantity: transaction.qrQuantity } : {}),
        ...(transaction.packageStatus ? { packageStatus: transaction.packageStatus } : {}),
        ...(transaction.actualQuantity !== undefined ? { actualQuantity: transaction.actualQuantity } : {}),
        ...(transaction.remainingQuantity !== undefined ? { remainingQuantity: transaction.remainingQuantity } : {}),
        ...(transaction.packageId ? { packageId: transaction.packageId } : {}),
      })),
    })),
  });

export type PersistedPcountPayload = {
  reconciliation_id: string;
  operation: "adjustment";
  submission_id: string;
  entries: PcountEntry[];
};

export const readPersistedPcountPayload = (value: unknown): PersistedPcountPayload | null => {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<PersistedPcountPayload>;
  if (!payload.reconciliation_id || !payload.submission_id || !Array.isArray(payload.entries)) return null;
  payload.entries.forEach(validatePcountEntry);
  return payload as PersistedPcountPayload;
};
