import { normalizeUom } from "@/lib/uom";
import type { ScannerLocationMode } from "@/lib/scannerPreferences";
import type { PcountEntry } from "@/lib/erpService";
import type { PackageStatus } from "@/lib/packageQuantity";

export type LocalScanMode = "in" | "out" | "pcount";
export type LocalScanAction = "ADD" | "DEDUCT" | "SUBMITTED" | "CORRECTION_SUBMITTED";

export type LocalScanTransaction = {
  id: string;
  action: LocalScanAction;
  quantityChange: number;
  runningQuantity: number;
  timestamp: string;
  /** Absolute creation time for reliable latest-tag ordering across grouped rows. */
  recordedAt?: number;
  locationId: string;
  locationLabel: string;
  employeeId: string;
  employeeName: string;
  deviceId: string;
  /** Inventory Tag entered by the counter for this exact scan transaction. */
  inventoryTag?: string;
  /** Append-only local correction history, retained across Resume Work/reloads. */
  inventoryTagEditHistory?: Array<{ from: string; to: string; at: string; employeeId: string }>;
  /** Original package quantity printed in the QR, retained for audit. */
  qrQuantity?: number;
  packageStatus?: PackageStatus;
  /** Original counted number of full packs in this scan, separate from loose units. */
  bigPackCount?: number;
  /** Original loose units added to full packs in ERP Stock UOM. */
  loosePackQuantity?: number;
  /** Quantity physically remaining when an opened package is counted. */
  actualQuantity?: number;
  remainingQuantity?: number;
  /** Optional only; current packing labels do not define a package ID field. */
  packageId?: string;
};

export type LocalBinLocation = {
  raw: string;

  /**
   * Exact ERPNext Warehouse value from the Storage Location QR.
   * Example: "Stockroom - Sta Clara"
   */
  warehouse: string;

  /**
   * Legacy hierarchy fields.
   * Keep these for compatibility with the existing scanner UI.
   * Do not use stockroom as the ERPNext Warehouse value.
   */
  stockroom: string;
  building: string;
  aisle: string;
  rack: string;
  bin: string;

  /**
   * Storage Location metadata from ERPNext QR.
   */
  locationId?: string;
  locationCode?: string;
  locationName?: string;
  locationType?: string;
  locationPath?: string;
  isGroup?: number;

  /**
   * Put-away metadata from Storage Location QR.
   */
  itemCode?: string;
  storageCapacity?: number;

  /** Whether ERPNext has authoritatively validated this QR location. */
  validationStatus?: "validated" | "pending";
};

export type LocalScanEntry = {
  raw: string;
  mode: LocalScanMode;
  reconciliationCode: string;
  bin: LocalBinLocation;
  itemCode: string;
  qrQuantity: number;
  multiplier: number;
  quantity: number;
  uom: string;
  /** UOM exactly as printed in the barcode, retained for display and audit. */
  barcodeUom?: string;
  /** Authoritative ERPNext Stock UOM used during synchronization/submission. */
  authoritativeUom?: string;
  /** ERPNext stock units per one scanned barcode unit, used when UOMs differ. */
  uomConversionFactor?: number;
  lotNo: string;
  timestamp: string;
  deviceId: string;
  submittedQuantity?: number;
  /** Operator physical count acknowledged by the last successful submission. */
  submittedPhysicalCount?: number;
  /** Actual ERP stock-ledger quantity captured when this count started. */
  erpBaselineQuantity?: number;
  itemName?: string;
  scanTransactions?: LocalScanTransaction[];
  submittedTransactionCount?: number;
  /** IDs confirmed by ERPNext. New scans remain pending even if they arrive during submission. */
  submittedTransactionIds?: string[];
  syncConflict?: string;
};

const MAX_LOCAL_ENTRIES = 300;
const SCANNER_DEVICE_NAME_KEY = "qcmc.scanner.deviceName";
const SUBMISSION_TRACKING_VERSION = "1";
const LAST_SCAN_SETUP_VERSION = "1";
const PCOUNT_SESSION_VERSION = "1";
const PCOUNT_SUBMISSION_VERSION = "2";
const PCOUNT_UNAVAILABLE_VERSION = "1";

const storageKey = (employeeId: string) =>
  `qcmc.scan.entries.${employeeId}`;

const submissionTrackingKey = (employeeId: string) =>
  `qcmc.scan.submissionTracking.${employeeId}`;

const lastScanSetupKey = (employeeId: string, mode: LocalScanMode) =>
  `qcmc.scan.lastSetup.${LAST_SCAN_SETUP_VERSION}.${employeeId}.${mode}`;

const pcountSessionKey = (employeeId: string) =>
  `qcmc.pcount.session.${PCOUNT_SESSION_VERSION}.${employeeId}`;

const pcountSubmissionKey = (employeeId: string, reconciliationCode: string) =>
  `qcmc.pcount.submission.${PCOUNT_SUBMISSION_VERSION}.${employeeId}.${reconciliationCode}`;

const pcountUnavailableKey = (employeeId: string) =>
  `qcmc.pcount.unavailable.${PCOUNT_UNAVAILABLE_VERSION}.${employeeId}`;

const normalizedReconciliationCode = (value: string) => value.trim().toLocaleUpperCase();

export const hasExistingLocationCount = (
  entries: LocalScanEntry[],
  reconciliationCode: string,
  locationId: string
) => entries.some((entry) =>
  entry.mode === "pcount" &&
  normalizedReconciliationCode(entry.reconciliationCode) === normalizedReconciliationCode(reconciliationCode) &&
  entry.bin.locationId.trim().toLocaleUpperCase() === locationId.trim().toLocaleUpperCase() &&
  (entry.scanTransactions?.length || 0) > 0
);

const loadUnavailablePcountCodes = (employeeId: string): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(pcountUnavailableKey(employeeId)) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => normalizedReconciliationCode(String(value || ""))).filter(Boolean);
  } catch {
    return [];
  }
};

const saveUnavailablePcountCodes = (employeeId: string, codes: string[]) => {
  try {
    localStorage.setItem(pcountUnavailableKey(employeeId), JSON.stringify(Array.from(new Set(codes)).slice(-200)));
  } catch {
    // Availability tracking must not interrupt the scanner.
  }
};

export type LocalPcountLocation = {
  bin: LocalBinLocation;
  status: "in_progress" | "completed";
  lastScanTime: string;
  completedAt?: string;
  groupId?: string;
};

export type LocalPcountSession = {
  reconciliationCode: string;
  reconciliationWarehouse: string;
  locationMode: ScannerLocationMode;
  activeLocationMode?: ScannerLocationMode;
  activeGroupId: string;
  activeLocationId: string;
  locations: LocalPcountLocation[];
  updatedAt: string;
  /** Pending means the reconciliation was started offline and must be validated before ERP submission. */
  validationStatus?: "validated" | "pending";
};

export type PendingPcountSubmission = {
  fingerprint: string;
  sourceFingerprint?: string;
  submissionId: string;
  payload: unknown;
  queuedAt?: string;
  lastError?: string;
};

const asRecord = (
  value: unknown
): Record<string, unknown> | null =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown) =>
  typeof value === "string" ? value : "";

const readNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : 0;

const readOptionalNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;

/**
 * Recover the Item Code from a retained QCMC packing-label QR.
 * Format: ITEM_CODE;QUANTITY;UOM;REFERENCE
 *
 * This is intentionally conservative: it only repairs a numeric/blank saved
 * itemCode when the raw value is clearly a four-field packing label.
 */
const recoverPcountItemFromRawQr = (rawValue: string) => {
  const raw = rawValue.trim();
  const parts = raw.split(";").map((part) => part.trim());
  if (parts.length !== 4 || !parts[0]) return null;

  const quantity = Number(parts[1].replace(/,/g, ""));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  return {
    itemCode: parts[0],
    qrQuantity: quantity,
    barcodeUom: parts[2],
  };
};

const looksLikeNumericItemCode = (value: string) =>
  !value.trim() || /^[-+]?\d+(?:[.,]\d+)?$/.test(value.trim());

export type LastScanSetup = {
  mode: LocalScanMode;
  reconciliationCode: string;
  reconciliationWarehouse: string;
  bin: LocalBinLocation;
  timestamp: string;
  lastItem?: {
    itemCode: string;
    itemName?: string;
    action: "ADD" | "DEDUCT";
    quantityChange: number;
    uom: string;
    timestamp: string;
  };
};

export const saveLastScanSetup = (employeeId: string, setup: LastScanSetup) => {
  try {
    localStorage.setItem(lastScanSetupKey(employeeId, setup.mode), JSON.stringify(setup));
  } catch {
    // Scanning must continue if storage is unavailable.
  }
};

export const clearLastScanSetup = (employeeId: string, mode: LocalScanMode) => {
  try {
    localStorage.removeItem(lastScanSetupKey(employeeId, mode));
  } catch {
    // Ignore storage failures.
  }
};

export const clearPcountLastScanSetup = (employeeId: string, reconciliationCode: string) => {
  const setup = loadLastScanSetup(employeeId, "pcount");
  if (setup && normalizedReconciliationCode(setup.reconciliationCode) === normalizedReconciliationCode(reconciliationCode)) {
    clearLastScanSetup(employeeId, "pcount");
  }
};

export const loadLastScanSetup = (employeeId: string, mode: LocalScanMode): LastScanSetup | null => {
  try {
    const value = asRecord(JSON.parse(localStorage.getItem(lastScanSetupKey(employeeId, mode)) || "null"));
    const bin = asRecord(value?.bin);
    if (!value || !bin || readString(value.mode) !== mode) return null;
    const reconciliationCode = readString(value.reconciliationCode);
    const reconciliationWarehouse = readString(value.reconciliationWarehouse);
    const locationId = readString(bin.locationId);
    if (!reconciliationCode || !reconciliationWarehouse || !locationId) return null;
    const lastItemValue = asRecord(value.lastItem);
    const lastItemAction = readString(lastItemValue?.action);
    const lastItem: LastScanSetup["lastItem"] = lastItemValue && readString(lastItemValue.itemCode) && (lastItemAction === "ADD" || lastItemAction === "DEDUCT")
      ? {
          itemCode: readString(lastItemValue.itemCode),
          itemName: readString(lastItemValue.itemName),
          action: lastItemAction,
          quantityChange: readNumber(lastItemValue.quantityChange),
          uom: readString(lastItemValue.uom),
          timestamp: readString(lastItemValue.timestamp),
        }
      : undefined;
    return {
      mode,
      reconciliationCode,
      reconciliationWarehouse,
      timestamp: readString(value.timestamp),
      lastItem,
      bin: {
        raw: readString(bin.raw),
        warehouse: readString(bin.warehouse),
        stockroom: readString(bin.stockroom),
        building: readString(bin.building),
        aisle: readString(bin.aisle),
        rack: readString(bin.rack),
        bin: readString(bin.bin),
        locationId,
        locationCode: readString(bin.locationCode),
        locationName: readString(bin.locationName),
        locationType: readString(bin.locationType),
        locationPath: readString(bin.locationPath),
        isGroup: readNumber(bin.isGroup),
      },
    };
  } catch {
    return null;
  }
};

const parseSessionBin = (value: unknown): LocalBinLocation | null => {
  const bin = asRecord(value);
  if (!bin) return null;
  const locationId = readString(bin.locationId);
  const warehouse = readString(bin.warehouse);
  if (!locationId || !warehouse) return null;
  return {
    raw: readString(bin.raw),
    warehouse,
    stockroom: readString(bin.stockroom),
    building: readString(bin.building),
    aisle: readString(bin.aisle),
    rack: readString(bin.rack),
    bin: readString(bin.bin),
    locationId,
    locationCode: readString(bin.locationCode),
    locationName: readString(bin.locationName),
    locationType: readString(bin.locationType),
    locationPath: readString(bin.locationPath),
    isGroup: readNumber(bin.isGroup),
    itemCode: readString(bin.itemCode),
    storageCapacity: readNumber(bin.storageCapacity),
    validationStatus: readString(bin.validationStatus) === "pending" ? "pending" : "validated",
  };
};

export const savePcountSession = (employeeId: string, session: LocalPcountSession) => {
  try {
    localStorage.setItem(pcountSessionKey(employeeId), JSON.stringify(session));
  } catch {
    // Scanning must continue if storage is temporarily unavailable.
  }
};

export const loadPcountSession = (employeeId: string): LocalPcountSession | null => {
  try {
    const value = asRecord(JSON.parse(localStorage.getItem(pcountSessionKey(employeeId)) || "null"));
    if (!value) return null;
    const reconciliationCode = readString(value.reconciliationCode);
    const reconciliationWarehouse = readString(value.reconciliationWarehouse);
    if (!reconciliationCode) return null;
    const locations = Array.isArray(value.locations)
      ? value.locations.flatMap((candidate): LocalPcountLocation[] => {
          const row = asRecord(candidate);
          const bin = parseSessionBin(row?.bin);
          const status = readString(row?.status);
          if (!row || !bin || (status !== "in_progress" && status !== "completed")) return [];
          return [{
            bin,
            status,
            lastScanTime: readString(row.lastScanTime),
            completedAt: readString(row.completedAt) || undefined,
            groupId: readString(row.groupId) || undefined,
          }];
        })
      : [];
    const activeLocationId = readString(value.activeLocationId);
    const locationMode: ScannerLocationMode = readString(value.locationMode) === "multi" ? "multi" : "single";
    const persistedActiveMode = readString(value.activeLocationMode);
    const persistedMode: ScannerLocationMode | undefined = persistedActiveMode === "multi" || persistedActiveMode === "single"
      ? persistedActiveMode
      : undefined;

    // locationMode is only the operator's NEXT-mode preference. For unfinished
    // work, restore the mode from the active work itself before consulting that
    // preference. This also repairs older sessions saved before
    // activeLocationMode existed.
    const savedGroupId = readString(value.activeGroupId);
    const hasActiveGroup = Boolean(savedGroupId) && locations.some(
      (location) => location.groupId === savedGroupId && location.status === "in_progress"
    );
    const hasActiveSingleLocation = Boolean(activeLocationId) && locations.some(
      (location) => location.bin.locationId === activeLocationId && location.status === "in_progress"
    );
    const inferredActiveMode: ScannerLocationMode | undefined = hasActiveGroup
      ? "multi"
      : hasActiveSingleLocation
      ? "single"
      : undefined;
    const activeLocationMode: ScannerLocationMode | undefined = inferredActiveMode || persistedMode;
    const activeGroupId = activeLocationMode === "multi" && hasActiveGroup ? savedGroupId : "";
    return {
      reconciliationCode,
      reconciliationWarehouse,
      locationMode,
      ...(activeLocationMode ? { activeLocationMode } : {}),
      activeGroupId,
      activeLocationId: locations.some((location) => location.bin.locationId === activeLocationId)
        ? activeLocationId
        : "",
      locations,
      updatedAt: readString(value.updatedAt),
      validationStatus: readString(value.validationStatus) === "pending" ? "pending" : "validated",
    };
  } catch {
    return null;
  }
};

export const clearPcountSession = (employeeId: string) => {
  try {
    localStorage.removeItem(pcountSessionKey(employeeId));
  } catch {
    // Ignore storage failures.
  }
};

export const isPcountReconciliationUnavailable = (employeeId: string, reconciliationCode: string) =>
  loadUnavailablePcountCodes(employeeId).includes(normalizedReconciliationCode(reconciliationCode));

export const restorePcountToLastActivity = (employeeId: string, reconciliationCode: string) => {
  const code = normalizedReconciliationCode(reconciliationCode);
  if (!code) return;
  saveUnavailablePcountCodes(employeeId, loadUnavailablePcountCodes(employeeId).filter((value) => value !== code));
};

/**
 * Removes a closed reconciliation from resumable/retry UI state without
 * touching LocalScanEntry records or their immutable transaction history.
 */
export const removePcountFromLastActivity = (employeeId: string, reconciliationCode: string) => {
  const code = normalizedReconciliationCode(reconciliationCode);
  if (!code) return;

  saveUnavailablePcountCodes(employeeId, [...loadUnavailablePcountCodes(employeeId), code]);

  const session = loadPcountSession(employeeId);
  if (session && normalizedReconciliationCode(session.reconciliationCode) === code) {
    clearPcountSession(employeeId);
  }

  const setup = loadLastScanSetup(employeeId, "pcount");
  if (setup && normalizedReconciliationCode(setup.reconciliationCode) === code) {
    clearLastScanSetup(employeeId, "pcount");
  }

  clearPendingPcountSubmission(employeeId, reconciliationCode);
  if (code !== reconciliationCode) {
    clearPendingPcountSubmission(employeeId, code);
  }
};

export const savePendingPcountSubmission = (
  employeeId: string,
  reconciliationCode: string,
  submission: PendingPcountSubmission
) => {
  try {
    localStorage.setItem(pcountSubmissionKey(employeeId, reconciliationCode), JSON.stringify(submission));
  } catch (error) {
    throw new Error("Unable to save the Physical Count submission locally. Do not close the app; free storage and retry.", { cause: error });
  }
};

export const loadPendingPcountSubmission = (
  employeeId: string,
  reconciliationCode: string
): PendingPcountSubmission | null => {
  try {
    const value = asRecord(JSON.parse(localStorage.getItem(pcountSubmissionKey(employeeId, reconciliationCode)) || "null"));
    const fingerprint = readString(value?.fingerprint);
    const submissionId = readString(value?.submissionId);
    if (!value || !fingerprint || !submissionId) return null;
    const queuedAt = readString(value.queuedAt);
    const lastError = readString(value.lastError);
    const sourceFingerprint = readString(value.sourceFingerprint);
    return {
      fingerprint,
      submissionId,
      payload: value.payload,
      ...(sourceFingerprint ? { sourceFingerprint } : {}),
      ...(queuedAt ? { queuedAt } : {}),
      ...(lastError ? { lastError } : {}),
    };
  } catch {
    return null;
  }
};

export const clearPendingPcountSubmission = (employeeId: string, reconciliationCode: string) => {
  try {
    localStorage.removeItem(pcountSubmissionKey(employeeId, reconciliationCode));
  } catch {
    // Ignore storage failures.
  }
};

const parseTransactions = (value: unknown): LocalScanTransaction[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const row = asRecord(candidate);
    if (!row) return [];
    const action = readString(row.action);
    if (action !== "ADD" && action !== "DEDUCT" && action !== "SUBMITTED" && action !== "CORRECTION_SUBMITTED") return [];
    const packageStatusValue = readString(row.packageStatus).toLocaleUpperCase();
    const packageStatus = packageStatusValue === "COMPLETE" || packageStatusValue === "OPENED"
      ? packageStatusValue as PackageStatus
      : undefined;
    const packageId = readString(row.packageId).trim();
    const inventoryTag = readString(row.inventoryTag || row.inventory_tag).trim();
    const inventoryTagEditHistory = Array.isArray(row.inventoryTagEditHistory)
      ? row.inventoryTagEditHistory.flatMap((rawEdit) => {
          const edit = asRecord(rawEdit);
          if (!edit) return [];
          const from = readString(edit.from);
          const to = readString(edit.to);
          const at = readString(edit.at);
          const employeeId = readString(edit.employeeId);
          return to && at ? [{ from, to, at, employeeId }] : [];
        })
      : [];
    return [{
      id: readString(row.id) || `${Date.now()}-${Math.random()}`,
      action,
      quantityChange: readNumber(row.quantityChange),
      runningQuantity: readNumber(row.runningQuantity),
      timestamp: readString(row.timestamp),
      ...(readOptionalNumber(row.recordedAt) !== undefined ? { recordedAt: readOptionalNumber(row.recordedAt) } : {}),
      locationId: readString(row.locationId),
      locationLabel: readString(row.locationLabel),
      employeeId: readString(row.employeeId),
      employeeName: readString(row.employeeName),
      deviceId: readString(row.deviceId),
      ...(inventoryTag ? { inventoryTag } : {}),
      ...(inventoryTagEditHistory.length > 0 ? { inventoryTagEditHistory } : {}),
      ...(readOptionalNumber(row.qrQuantity) !== undefined ? { qrQuantity: readOptionalNumber(row.qrQuantity) } : {}),
      ...(packageStatus ? { packageStatus } : {}),
      ...(readOptionalNumber(row.bigPackCount) !== undefined ? { bigPackCount: readOptionalNumber(row.bigPackCount) } : {}),
      ...(readOptionalNumber(row.loosePackQuantity) !== undefined ? { loosePackQuantity: readOptionalNumber(row.loosePackQuantity) } : {}),
      ...(readOptionalNumber(row.actualQuantity) !== undefined ? { actualQuantity: readOptionalNumber(row.actualQuantity) } : {}),
      ...(readOptionalNumber(row.remainingQuantity) !== undefined ? { remainingQuantity: readOptionalNumber(row.remainingQuantity) } : {}),
      ...(packageId ? { packageId } : {}),
    }];
  });
};

/**
 * Normalize harmless whitespace only.
 *
 * IMPORTANT:
 * "Stockroom - Sta Clara" stays "Stockroom - Sta Clara".
 * We do NOT remove spaces around the hyphen.
 */
/**
 * Canonical warehouse comparison used only for matching.
 *
 * These are treated as the same warehouse:
 *   "Stockroom - Sta Clara"
 *   "Stockroom-StaClara"
 *
 * The original warehouse text is not modified when it is stored.
 */
export const normalizeWarehouse = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s-]+/g, "");

export const isSameWarehouse = (
  left: string,
  right: string
) =>
  normalizeWarehouse(left) === normalizeWarehouse(right);

const parseEntry = (
  value: unknown
): LocalScanEntry | null => {
  const entry = asRecord(value);
  const bin = asRecord(entry?.bin);

  if (!entry || !bin) return null;

  const mode = readString(entry.mode);

  if (
    mode !== "in" &&
    mode !== "out" &&
    mode !== "pcount"
  ) {
    return null;
  }

  const savedItemCode = readString(entry.itemCode);
  const rawQr = readString(entry.raw);
  const recoveredPcountItem =
    mode === "pcount" && looksLikeNumericItemCode(savedItemCode)
      ? recoverPcountItemFromRawQr(rawQr)
      : null;
  const itemCode = recoveredPcountItem?.itemCode || savedItemCode;
  const reconciliationCode = readString(
    entry.reconciliationCode
  );

  if (!itemCode || !reconciliationCode) {
    return null;
  }

  const quantity = readNumber(entry.quantity);
  // Older scanner builds stored the Inventory Tag on the saved entry instead
  // of (or in addition to) each scan transaction. Preserve that identity when
  // Resume Work loads old data so duplicate-tag validation still sees it after
  // an app update. New data continues to use transaction.inventoryTag.
  const legacyInventoryTag = readString(
    entry.inventoryTag || entry.inventory_tag || entry.invTag || entry.inv_tag
  ).trim();
  const parsedTransactions = parseTransactions(entry.scanTransactions);
  const scanTransactions: LocalScanTransaction[] = parsedTransactions.length > 0
    ? parsedTransactions.map((transaction) =>
        !transaction.inventoryTag && legacyInventoryTag
          ? { ...transaction, inventoryTag: legacyInventoryTag }
          : transaction
      )
    : quantity !== 0
      ? [{
          id: `legacy-${reconciliationCode}-${itemCode}-${readString(entry.timestamp)}`,
          action: quantity >= 0 ? "ADD" : "DEDUCT",
          quantityChange: quantity,
          runningQuantity: quantity,
          timestamp: readString(entry.timestamp),
          locationId: readString(bin.locationId),
          locationLabel: readString(bin.locationCode) || readString(bin.locationName) || readString(bin.locationPath) || readString(bin.bin),
          employeeId: "",
          employeeName: "",
          deviceId: readString(entry.deviceId),
          ...(legacyInventoryTag ? { inventoryTag: legacyInventoryTag } : {}),
        }]
      : [];
  const submittedQuantity = readNumber(entry.submittedQuantity);
  const legacySubmittedCount = entry.submittedTransactionCount === undefined && submittedQuantity === quantity
    ? scanTransactions.length
    : readNumber(entry.submittedTransactionCount);
  const storedSubmittedIds = Array.isArray(entry.submittedTransactionIds)
    ? entry.submittedTransactionIds.filter((id): id is string => typeof id === "string")
    : [];
  const submittedTransactionIds = storedSubmittedIds.length > 0
    ? storedSubmittedIds
    : scanTransactions
        .slice(0, legacySubmittedCount)
        .filter((transaction) => transaction.action === "ADD" || transaction.action === "DEDUCT")
        .map((transaction) => transaction.id);
  const erpBaselineQuantity = entry.erpBaselineQuantity === undefined
    ? undefined
    : readNumber(entry.erpBaselineQuantity);
  return {
    raw: rawQr,
    mode,
    reconciliationCode,

    bin: {
      raw: readString(bin.raw),

      /**
       * Use the real ERPNext Warehouse value.
       *
       * For older locally saved entries that do not yet contain
       * warehouse, fall back to stockroom only so they can still load.
       * New scans should always save bin.warehouse.
       */
      warehouse:
        readString(bin.warehouse) ||
        readString(bin.stockroom),

      stockroom: readString(bin.stockroom),
      building: readString(bin.building),
      aisle: readString(bin.aisle),
      rack: readString(bin.rack),
      bin: readString(bin.bin),

      locationId: readString(bin.locationId),
      locationCode: readString(bin.locationCode),
      locationName: readString(bin.locationName),
      locationType: readString(bin.locationType),
      locationPath: readString(bin.locationPath),

      isGroup: readNumber(bin.isGroup),

      itemCode: readString(bin.itemCode),
      storageCapacity: readNumber(
        bin.storageCapacity
      ),
    },

    itemCode,
    qrQuantity: recoveredPcountItem?.qrQuantity ?? readNumber(entry.qrQuantity),
    multiplier: readNumber(entry.multiplier),
    quantity,
    uom: readString(entry.uom),
    barcodeUom: recoveredPcountItem?.barcodeUom || readString(entry.barcodeUom) || readString(entry.uom),
    authoritativeUom: readString(entry.authoritativeUom),
    ...(readOptionalNumber(entry.uomConversionFactor) !== undefined ? { uomConversionFactor: readOptionalNumber(entry.uomConversionFactor) } : {}),
    lotNo: readString(entry.lotNo),
    timestamp: readString(entry.timestamp),
    deviceId: readString(entry.deviceId),

    submittedQuantity,
    submittedPhysicalCount: entry.submittedPhysicalCount === undefined
      ? (() => {
          const submittedIds = new Set(submittedTransactionIds);
          const lastSubmitted = [...scanTransactions]
            .reverse()
            .find((transaction) => submittedIds.has(transaction.id));
          return lastSubmitted?.runningQuantity;
        })()
      : readNumber(entry.submittedPhysicalCount),
    erpBaselineQuantity,
    itemName: readString(entry.itemName),
    scanTransactions,
    submittedTransactionCount: legacySubmittedCount,
    submittedTransactionIds,
    syncConflict: readString(entry.syncConflict),
  };
};

const migrateSubmissionTracking = (
  employeeId: string,
  entries: LocalScanEntry[]
) => {
  try {
    if (
      localStorage.getItem(
        submissionTrackingKey(employeeId)
      ) === SUBMISSION_TRACKING_VERSION
    ) {
      return entries;
    }

    const migrated = entries.map((entry) =>
      entry.mode === "pcount"
        ? {
            ...entry,
            submittedQuantity: entry.quantity,
          }
        : entry
    );

    localStorage.setItem(
      storageKey(employeeId),
      JSON.stringify(
        migrated.slice(0, MAX_LOCAL_ENTRIES)
      )
    );

    localStorage.setItem(
      submissionTrackingKey(employeeId),
      SUBMISSION_TRACKING_VERSION
    );

    return migrated;
  } catch {
    return entries;
  }
};

export const loadLocalScanEntries = (
  employeeId: string
): LocalScanEntry[] => {
  try {
    const raw = localStorage.getItem(
      storageKey(employeeId)
    );

    if (!raw) {
      return migrateSubmissionTracking(
        employeeId,
        []
      );
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return migrateSubmissionTracking(
        employeeId,
        []
      );
    }

    const entries = parsed
      .map(parseEntry)
      .filter(
        (
          entry
        ): entry is LocalScanEntry =>
          Boolean(entry)
      );

    const migratedEntries = migrateSubmissionTracking(
      employeeId,
      entries
    );
    const loaded = consolidateLocalScanEntries(
      repairTruncatedPcountItemCodes(migratedEntries)
    );

    // Persist any safe legacy QR repair performed by parseEntry().
    try { saveLocalScanEntries(employeeId, loaded); } catch { /* retain loaded scan data */ }
    return loaded;
  } catch {
    return migrateSubmissionTracking(
      employeeId,
      []
    );
  }
};

export const saveLocalScanEntries = (
  employeeId: string,
  entries: LocalScanEntry[]
) => {
  try {
    localStorage.setItem(
      storageKey(employeeId),
      JSON.stringify(
        entries.slice(0, MAX_LOCAL_ENTRIES)
      )
    );
  } catch (error) {
    throw new Error("Unable to save scanned items locally. Keep this screen open and retry after freeing storage.", { cause: error });
  }
};

export const clearLocalScanEntries = (employeeId: string) => {
  try {
    localStorage.removeItem(storageKey(employeeId));
  } catch {
    // Ignore local storage failures so the app remains usable.
  }
};

const normalized = (value: string) =>
  value.trim().toLocaleLowerCase();

/**
 * Determines whether two scans belong to the same local line.
 *
 * Warehouse comparison now uses bin.warehouse.
 * stockroom is still compared only as legacy metadata.
 */
export const isSameLocalScanItem = (
  left: LocalScanEntry,
  right: LocalScanEntry
) => {
  const sameCore =
  left.mode === right.mode &&
  normalized(left.reconciliationCode) ===
    normalized(right.reconciliationCode) &&
  normalized(left.itemCode) ===
    normalized(right.itemCode) &&
  normalized(left.bin.locationId || "") ===
    normalized(right.bin.locationId || "") &&
  normalizeWarehouse(left.bin.warehouse || "") ===
    normalizeWarehouse(right.bin.warehouse || "") &&
  normalized(left.bin.stockroom) ===
    normalized(right.bin.stockroom) &&
  normalized(left.bin.building) ===
    normalized(right.bin.building) &&
  normalized(left.bin.aisle) ===
    normalized(right.bin.aisle) &&
  normalized(left.bin.rack) ===
    normalized(right.bin.rack) &&
  normalized(left.bin.bin) ===
    normalized(right.bin.bin);

  if (!sameCore) return false;

  // Physical Count is one direct count per Item + exact Location.
  // UOM, lot text, and QR pack quantity are audit/validation metadata,
  // not row keys. Explicit UOM conversions are validated before merging.
  if (left.mode === "pcount") return true;

  return normalizeUom(left.authoritativeUom || left.uom) ===
    normalizeUom(right.authoritativeUom || right.uom) &&
    normalized(left.lotNo) === normalized(right.lotNo) &&
    left.qrQuantity === right.qrQuantity;
};

export const mergeLocalScanEntries = (
  entries: LocalScanEntry[],
  entry: LocalScanEntry
) => {
  const matching = entries.filter(
    (current) =>
      isSameLocalScanItem(
        current,
        entry
      )
  );

  if (matching.length === 0) {
    return [entry, ...entries];
  }

  const existingMultiplier = matching.reduce(
    (total, current) =>
      total + current.multiplier,
    0
  );

  const existingQuantity = matching.reduce(
    (total, current) =>
      total + current.quantity,
    0
  );

  const submittedQuantity = matching.reduce(
    (total, current) =>
      total +
      (current.submittedQuantity || 0),
    0
  );
  const erpBaselineQuantity = entry.erpBaselineQuantity ??
    matching.find((current) => current.erpBaselineQuantity !== undefined)?.erpBaselineQuantity;

  // Preserve the last ERP-acknowledged physical count when new scans are
  // merged into an already-submitted Physical Count row.
  const submittedPhysicalCount = entry.submittedPhysicalCount ??
    matching.find((current) => current.submittedPhysicalCount !== undefined)?.submittedPhysicalCount;

  const merged: LocalScanEntry = {
    ...entry,
    itemName: entry.itemName || matching.find((current) => current.itemName)?.itemName,
    barcodeUom: entry.barcodeUom || matching.find((current) => current.barcodeUom)?.barcodeUom || entry.uom,
    authoritativeUom: entry.authoritativeUom || matching.find((current) => current.authoritativeUom)?.authoritativeUom,
    multiplier:
      existingMultiplier +
      entry.multiplier,
    quantity:
      existingQuantity +
      entry.quantity,
    submittedQuantity,
    submittedPhysicalCount,
    erpBaselineQuantity,
    scanTransactions: [
      ...matching.flatMap((current) => current.scanTransactions || []),
      ...(entry.scanTransactions || []),
    ],
    submittedTransactionCount: matching.reduce(
      (total, current) => total + (current.submittedTransactionCount || 0),
      0
    ),
    submittedTransactionIds: Array.from(new Set([
      ...matching.flatMap((current) => current.submittedTransactionIds || []),
      ...(entry.submittedTransactionIds || []),
    ])),
  };

  return [
    merged,
    ...entries.filter(
      (current) =>
        !isSameLocalScanItem(
          current,
          entry
        )
    ),
  ];
};

/**
 * Repair legacy scanner corruption where one or more leading Item Code
 * characters were lost (for example VFC8T50 -> T50 or 50).
 *
 * Safety rules:
 * - Physical Count only.
 * - Same reconciliation.
 * - The damaged Item Code must be a strict suffix of the real Item Code.
 * - The QR quantity must match.
 * - Exactly ONE full Item Code in the reconciliation may match.
 *
 * Location is intentionally NOT part of the lookup because the same damaged
 * item can occur at many Storage Locations.
 */
const repairTruncatedPcountItemCodes = (
  entries: LocalScanEntry[]
): LocalScanEntry[] => {
  const fullCandidates = entries.filter(
    (entry) =>
      entry.mode === "pcount" &&
      entry.itemCode.trim().length >= 4 &&
      !looksLikeNumericItemCode(entry.itemCode)
  );

  return entries.map((entry) => {
    if (entry.mode !== "pcount") return entry;

    const damaged = entry.itemCode.trim();
    if (!damaged || damaged.length >= 4) return entry;

    const damagedNormalized = normalized(damaged);
    const matches = fullCandidates.filter((candidate) => {
      const candidateCode = candidate.itemCode.trim();
      return (
        normalized(candidate.reconciliationCode) === normalized(entry.reconciliationCode) &&
        normalized(candidateCode) !== damagedNormalized &&
        normalized(candidateCode).endsWith(damagedNormalized) &&
        Math.abs(candidate.qrQuantity - entry.qrQuantity) < 0.000001
      );
    });

    const uniqueCodes = Array.from(
      new Map(matches.map((candidate) => [normalized(candidate.itemCode), candidate])).values()
    );
    if (uniqueCodes.length !== 1) return entry;

    const target = uniqueCodes[0];
    const rawParts = entry.raw.split(";");
    const repairedRaw =
      rawParts.length === 4
        ? [target.itemCode, rawParts[1], rawParts[2], rawParts[3]].join(";")
        : entry.raw;

    return {
      ...entry,
      raw: repairedRaw,
      itemCode: target.itemCode,
      itemName: entry.itemName || target.itemName,
      uom: entry.uom || target.uom,
      barcodeUom: entry.barcodeUom || target.barcodeUom,
      authoritativeUom: entry.authoritativeUom || target.authoritativeUom,
      uomConversionFactor: entry.uomConversionFactor ?? target.uomConversionFactor,
      lotNo: entry.lotNo || target.lotNo,
    };
  });
};

export const consolidateLocalScanEntries = (
  entries: LocalScanEntry[]
) => {
  const consolidated: LocalScanEntry[] = [];

  for (const entry of entries) {
    const existing = consolidated.find(
      (current) =>
        isSameLocalScanItem(
          current,
          entry
        )
    );

    if (!existing) {
      consolidated.push({
        ...entry,
      });
      continue;
    }

    existing.multiplier += entry.multiplier;
    existing.quantity += entry.quantity;
    existing.itemName = entry.itemName || existing.itemName;
    existing.barcodeUom = entry.barcodeUom || existing.barcodeUom || entry.uom;
    existing.authoritativeUom = entry.authoritativeUom || existing.authoritativeUom;

    existing.submittedQuantity =
      (existing.submittedQuantity || 0) +
      (entry.submittedQuantity || 0);

    // This is a snapshot of the last acknowledged count, not an amount to sum.
    if (entry.submittedPhysicalCount !== undefined) {
      existing.submittedPhysicalCount = entry.submittedPhysicalCount;
    }
    existing.erpBaselineQuantity ??= entry.erpBaselineQuantity;
    existing.scanTransactions = [
      ...(existing.scanTransactions || []),
      ...(entry.scanTransactions || []),
    ];
    existing.submittedTransactionCount =
      (existing.submittedTransactionCount || 0) +
      (entry.submittedTransactionCount || 0);
    existing.submittedTransactionIds = Array.from(new Set([
      ...(existing.submittedTransactionIds || []),
      ...(entry.submittedTransactionIds || []),
    ]));
  }

  return consolidated;
};

export const addOrMergeLocalScanEntry = (
  employeeId: string,
  entry: LocalScanEntry
) => {
  const current =
    loadLocalScanEntries(employeeId);

  saveLocalScanEntries(
    employeeId,
    mergeLocalScanEntries(
      current,
      entry
    )
  );
};

export const addOrMergeLocalScanEntries = (
  employeeId: string,
  newEntries: LocalScanEntry[]
) => {
  if (newEntries.length === 0) return;

  let updated = loadLocalScanEntries(employeeId);
  for (const entry of newEntries) {
    updated = mergeLocalScanEntries(updated, entry);
  }

  saveLocalScanEntries(employeeId, updated);
};

/**
 * Refresh ERP-controlled metadata without touching locally collected quantity
 * or transaction history. This is safe to call after an offline row validates.
 */
export const updateValidatedLocalScanEntry = (
  employeeId: string,
  target: LocalScanEntry,
  validation: {
    authoritativeUom: string;
    itemName?: string;
    erpBaselineQuantity?: number;
    lotNo?: string;
    uomConversionFactor?: number;
  }
) => {
  const entries = loadLocalScanEntries(employeeId);
  let matched = false;
  const updated = entries.map((entry) => {
    if (!isSameLocalScanItem(entry, target)) return entry;
    matched = true;
    return {
      ...entry,
      uom: validation.authoritativeUom || entry.uom,
      authoritativeUom: validation.authoritativeUom || entry.authoritativeUom,
      uomConversionFactor: validation.uomConversionFactor ?? entry.uomConversionFactor,
      barcodeUom: entry.barcodeUom || target.barcodeUom || target.uom,
      itemName: validation.itemName || entry.itemName,
      erpBaselineQuantity: validation.erpBaselineQuantity ?? entry.erpBaselineQuantity,
      lotNo: validation.lotNo ?? entry.lotNo,
      bin: { ...entry.bin, validationStatus: "validated" as const },
    };
  });
  if (matched) saveLocalScanEntries(employeeId, updated);
  return updated;
};

const pendingCountTransactions = (entry: LocalScanEntry) => {
  const countTransactions = (entry.scanTransactions || []).filter(
    (transaction) => transaction.action === "ADD" || transaction.action === "DEDUCT"
  );
  const submittedIds = new Set(entry.submittedTransactionIds || []);
  return submittedIds.size > 0
    ? countTransactions.filter((transaction) => !submittedIds.has(transaction.id))
    : countTransactions.slice(entry.submittedTransactionCount || 0);
};

/**
 * Return the latest effective Physical Count for one Inventory Tag.
 *
 * Recount is a replacement count, so the operator-entered quantity must be
 * compared with this effective value. Submitted corrections and any still
 * pending local corrections are accumulated in transaction order. This makes
 * repeated recounts behave correctly:
 *   15,000 -> 14,000 = -1,000
 *   14,000 -> 13,500 =   -500
 *
 * A tagged recount never falls back to the entry-wide submittedPhysicalCount:
 * that value may include other Inventory Tags. If this device has no tagged
 * transaction history (for example the original count came from another
 * offline scanner), null is returned so callers can require an authoritative
 * ERP lookup instead of guessing.
 */
export const getPcountInventoryTagEffectiveCount = (
  entry: LocalScanEntry,
  inventoryTag: string
): number | null => {
  const wantedTag = inventoryTag.trim().toLocaleUpperCase();
  if (!wantedTag) return null;

  const transactions = (entry.scanTransactions || []).filter(
    (transaction) =>
      (transaction.action === "ADD" || transaction.action === "DEDUCT") &&
      (transaction.inventoryTag || "").trim().toLocaleUpperCase() === wantedTag
  );
  if (transactions.length === 0) return null;

  const submittedIds = new Set(entry.submittedTransactionIds || []);
  const hasExplicitSubmissionTracking = submittedIds.size > 0;
  const legacySubmittedCount = Math.max(0, entry.submittedTransactionCount || 0);
  const allTransactions = entry.scanTransactions || [];

  let effective = 0;
  let hasSubmittedTaggedTransaction = false;

  transactions.forEach((transaction) => {
    const originalIndex = allTransactions.findIndex(
      (candidate) => candidate.id === transaction.id
    );
    const isSubmitted = hasExplicitSubmissionTracking
      ? submittedIds.has(transaction.id)
      : originalIndex >= 0 && originalIndex < legacySubmittedCount;

    if (isSubmitted) hasSubmittedTaggedTransaction = true;
    const signed = transaction.action === "DEDUCT"
      ? -Math.abs(transaction.quantityChange)
      : Math.abs(transaction.quantityChange);
    effective += signed;
  });

  // Some older saved rows predate explicit submittedTransactionIds. When the
  // row has an ERP-acknowledged submittedPhysicalCount and every count
  // transaction belongs to this one tag, that snapshot safely anchors the tag.
  // Do not use this fallback when multiple tags share the entry.
  if (!hasSubmittedTaggedTransaction && !hasExplicitSubmissionTracking) {
    const allCountTransactions = allTransactions.filter(
      (transaction) => transaction.action === "ADD" || transaction.action === "DEDUCT"
    );
    const distinctTags = new Set(
      allCountTransactions
        .map((transaction) => (transaction.inventoryTag || "").trim().toLocaleUpperCase())
        .filter(Boolean)
    );
    const acknowledged = entry.submittedPhysicalCount ?? entry.submittedQuantity;
    if (
      acknowledged !== undefined &&
      Number.isFinite(acknowledged) &&
      distinctTags.size === 1 &&
      distinctTags.has(wantedTag)
    ) {
      const pending = pendingCountTransactions(entry).filter(
        (transaction) => (transaction.inventoryTag || "").trim().toLocaleUpperCase() === wantedTag
      );
      const pendingDelta = pending.reduce(
        (sum, transaction) => sum + (transaction.action === "DEDUCT"
          ? -Math.abs(transaction.quantityChange)
          : Math.abs(transaction.quantityChange)),
        0
      );
      // Legacy rows with no transaction submission markers cannot distinguish
      // historical scans from new pending scans. Never add the historical
      // scan quantity to an already acknowledged physical-count snapshot.
      // A zero ERP snapshot can be a baseline placeholder while the device
      // already contains unsent scans. In that case the local transactions,
      // not the placeholder, are the existing recount quantity.
      if (legacySubmittedCount === 0 && Number(acknowledged) === 0 && Math.abs(effective) > 0.000001) {
        return effective;
      }
      return legacySubmittedCount === 0 ? Number(acknowledged) : Number(acknowledged) + pendingDelta;
    }
  }

  // Local Physical Count recounts also occur before ERP submission. A saved
  // ADD/DEDUCT transaction is a real on-device count, even when its submission
  // ID has not yet been acknowledged. Use its signed quantity rather than
  // silently reporting 0 or discarding the saved calculator value.
  return Number.isFinite(effective) ? effective : null;
};

/**
 * Remove every NOT-YET-SUBMITTED count for one Physical Count location.
 * An item can contain both ERP-acknowledged and pending Inventory Tag scans,
 * so deleting the whole row would erase useful submission/audit history.
 *
 * For mixed rows preserve only ERP-acknowledged count transactions and
 * restore the confirmed quantity snapshot. This makes the removed correction
 * ineligible for any later pending-submission build.
 */
export const discardPendingPcountLocationCounts = (
  entries: LocalScanEntry[],
  reconciliationCode: string,
  locationId: string
): { entries: LocalScanEntry[]; discarded: number; preservedSubmitted: number } => {
  const wantedReference = normalizedReconciliationCode(reconciliationCode);
  const wantedLocation = locationId.trim().toLocaleUpperCase();
  let discarded = 0;
  let preservedSubmitted = 0;
  const next = entries.flatMap((entry): LocalScanEntry[] => {
    if (entry.mode !== "pcount" ||
        normalizedReconciliationCode(entry.reconciliationCode) !== wantedReference ||
        (entry.bin.locationId || "").trim().toLocaleUpperCase() !== wantedLocation) return [entry];

    const transactions = entry.scanTransactions || [];
    const explicitIds = new Set(entry.submittedTransactionIds || []);
    const legacyCount = Math.max(0, entry.submittedTransactionCount || 0);
    const countTransactions = transactions.filter((tx) => tx.action === "ADD" || tx.action === "DEDUCT");
    const confirmedCountTransactions = countTransactions.filter((tx, countIndex) =>
      explicitIds.size > 0 ? explicitIds.has(tx.id) : countIndex < legacyCount
    );
    const retainedIds = new Set(confirmedCountTransactions.map((tx) => tx.id));
    const retained = transactions.filter((tx) =>
      tx.action === "SUBMITTED" || tx.action === "CORRECTION_SUBMITTED" || retainedIds.has(tx.id)
    );
    const discardedHere = countTransactions.length - confirmedCountTransactions.length;
    if (discardedHere > 0 || isPendingLocalScanEntry(entry)) discarded += 1;

    const hasConfirmedHistory =
      explicitIds.size > 0 ||
      legacyCount > 0 ||
      entry.submittedQuantity !== undefined ||
      entry.submittedPhysicalCount !== undefined ||
      retained.some((tx) => tx.action === "SUBMITTED" || tx.action === "CORRECTION_SUBMITTED");

    if (!hasConfirmedHistory) return [];
    preservedSubmitted += 1;
    const confirmedQuantity = entry.submittedPhysicalCount ?? entry.submittedQuantity ??
      confirmedCountTransactions.reduce((sum, tx) =>
        sum + (tx.action === "DEDUCT" ? -Math.abs(tx.quantityChange) : Math.abs(tx.quantityChange)), 0);
    return [{
      ...entry,
      quantity: confirmedQuantity,
      multiplier: entry.qrQuantity > 0 ? confirmedQuantity / entry.qrQuantity : 0,
      scanTransactions: retained,
      submittedTransactionIds: confirmedCountTransactions.map((tx) => tx.id),
      submittedTransactionCount: retained.filter((tx) => tx.action === "ADD" || tx.action === "DEDUCT").length,
      submittedQuantity: confirmedQuantity,
      submittedPhysicalCount: confirmedQuantity,
      syncConflict: "",
    }];
  });
  return { entries: next, discarded, preservedSubmitted };
};

export const isPendingLocalScanEntry = (entry: LocalScanEntry) =>
  pendingCountTransactions(entry).length > 0 ||
  ((entry.scanTransactions || []).length === 0 && Math.abs(entry.quantity - (entry.submittedQuantity || 0)) > 0.000001);

export const loadPendingLocalScanEntries = (
  employeeId: string
) =>
  loadLocalScanEntries(employeeId).filter(
    isPendingLocalScanEntry
  );

export const markLocalScanEntriesSubmitted = (
  employeeId: string,
  reconciliationCode: string,
  mode: LocalScanMode = "pcount"
) => {
  const entries = loadLocalScanEntries(employeeId).map((entry) => {
    if (entry.mode !== mode || entry.reconciliationCode !== reconciliationCode || !isPendingLocalScanEntry(entry)) return entry;
    const delta = entry.quantity - (entry.submittedQuantity || 0);
    const action: LocalScanAction = delta < 0 ? "CORRECTION_SUBMITTED" : "SUBMITTED";
    const submissionEvent: LocalScanTransaction = {
      id: `submitted-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      action,
      quantityChange: delta,
      runningQuantity: entry.quantity,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      locationId: entry.bin.locationId || "",
      locationLabel: entry.bin.locationCode || entry.bin.locationName || entry.bin.locationPath || entry.bin.bin,
      employeeId,
      employeeName: "",
      deviceId: entry.deviceId,
    };
    const scanTransactions = [...(entry.scanTransactions || []), submissionEvent];
    return {
      ...entry,
      submittedQuantity: entry.quantity,
      scanTransactions,
      submittedTransactionCount: scanTransactions.length,
      syncConflict: "",
    };
  });

  saveLocalScanEntries(
    employeeId,
    entries
  );
};

/** Mark only the exact transaction snapshot acknowledged by ERPNext. */
export const markPcountSubmissionTransactionsSubmitted = (
  employeeId: string,
  reconciliationCode: string,
  submittedEntries: PcountEntry[]
) => {
  const entries = loadLocalScanEntries(employeeId).map((entry) => {
    if (entry.mode !== "pcount" || normalized(entry.reconciliationCode) !== normalized(reconciliationCode)) return entry;
    const submitted = submittedEntries.find((candidate) =>
      normalized(candidate.itemCode) === normalized(entry.itemCode) &&
      normalizeWarehouse(candidate.warehouse) === normalizeWarehouse(entry.bin.warehouse) &&
      normalized(candidate.inventoryLocation) === normalized(entry.bin.locationId || "") &&
      normalizeUom(candidate.uom) === normalizeUom(entry.authoritativeUom || entry.uom)
    );
    if (!submitted) return entry;
    const includedIds = (submitted.transactions || []).map((transaction) => transaction.id);
    const submittedTransactionIds = Array.from(new Set([
      ...(entry.submittedTransactionIds || []),
      ...includedIds,
    ]));
    return {
      ...entry,
      submittedQuantity: submitted.physicalCount,
      submittedPhysicalCount: submitted.physicalCount,
      erpBaselineQuantity: submitted.expectedERPQuantity ?? entry.erpBaselineQuantity,
      submittedTransactionIds,
      syncConflict: "",
    };
  });
  saveLocalScanEntries(employeeId, entries);
};

export const markPcountBaselineRefreshRequired = (
  employeeId: string,
  reconciliationCode: string,
  target: { itemCode: string; warehouse: string; inventoryLocation: string },
  message = "Baseline refresh required."
) => {
  const entries = loadLocalScanEntries(employeeId).map((entry) => {
    const matches = entry.mode === "pcount" &&
      normalized(entry.reconciliationCode) === normalized(reconciliationCode) &&
      normalized(entry.itemCode) === normalized(target.itemCode) &&
      normalizeWarehouse(entry.bin.warehouse) === normalizeWarehouse(target.warehouse) &&
      normalized(entry.bin.locationId || "") === normalized(target.inventoryLocation);
    return matches ? { ...entry, syncConflict: message } : entry;
  });
  saveLocalScanEntries(employeeId, entries);
  return entries;
};

export type RemotePcountRow = {
  itemCode: string;
  itemName?: string;
  warehouse: string;
  inventoryLocation: string;
  inventoryLocationCode?: string;
  quantity: number;
  uom?: string;
};

const sameRemotePcountRow = (entry: LocalScanEntry, row: RemotePcountRow) =>
  normalized(entry.itemCode) === normalized(row.itemCode) &&
  normalizeWarehouse(entry.bin.warehouse || "") === normalizeWarehouse(row.warehouse || "") &&
  normalized(entry.bin.locationId || "") === normalized(row.inventoryLocation || "");

export const syncLocalPcountEntriesFromErp = (
  employeeId: string,
  reconciliationCode: string,
  remoteRows: RemotePcountRow[]
) => {
  const entries = loadLocalScanEntries(employeeId);
  if (remoteRows.length === 0) {
    const retained = entries.filter((entry) =>
      entry.mode !== "pcount" ||
      normalized(entry.reconciliationCode) !== normalized(reconciliationCode)
    );
    const clearedLocalRows = entries.length - retained.length;
    saveLocalScanEntries(employeeId, retained);
    return { conflicts: 0, rowCount: 0, clearedLocalRows };
  }

  let conflicts = 0;
  const synced = entries.map((entry) => {
    if (entry.mode !== "pcount" || normalized(entry.reconciliationCode) !== normalized(reconciliationCode)) {
      return entry;
    }
    const remote = remoteRows.find((row) => sameRemotePcountRow(entry, row));
    const erpQuantity = remote?.quantity || 0;
    const pendingTransactions = pendingCountTransactions(entry);
    const pendingDelta = pendingTransactions.reduce(
      (total, tx) => total + (tx.action === "DEDUCT" ? -Math.abs(tx.quantityChange) : Math.abs(tx.quantityChange)),
      0
    );
    // A row loaded from ERP may not have local submitted transaction IDs.
    // In that case the ERP Physical Count result itself is the acknowledged
    // starting count for any later recount/additional scan.
    const submittedPhysicalCount =
      entry.submittedPhysicalCount ??
      remote?.quantity ??
      entry.submittedQuantity ??
      0;
    const calculatedQuantity = submittedPhysicalCount + pendingDelta;
    const syncConflict = calculatedQuantity < -0.000001
      ? `ERP count is ${erpQuantity.toFixed(2)}, but pending deductions total ${Math.abs(pendingDelta).toFixed(2)}. Review this correction.`
      : "";
    if (syncConflict) conflicts += 1;
    return {
      ...entry,
      itemName: remote?.itemName || entry.itemName,
      uom: remote?.uom || entry.authoritativeUom || entry.uom,
      authoritativeUom: remote?.uom || entry.authoritativeUom,
      barcodeUom: entry.barcodeUom || entry.uom,
      quantity: Math.max(0, calculatedQuantity),
      submittedQuantity: submittedPhysicalCount,
      submittedPhysicalCount,
      erpBaselineQuantity: erpQuantity,
      syncConflict,
      bin: {
        ...entry.bin,
        locationCode: remote?.inventoryLocationCode || entry.bin.locationCode,
      },
    };
  });
  for (const remote of remoteRows) {
    const exists = synced.some((entry) => entry.mode === "pcount" && normalized(entry.reconciliationCode) === normalized(reconciliationCode) && sameRemotePcountRow(entry, remote));
    if (exists) continue;
    synced.push({
      raw: "",
      mode: "pcount",
      reconciliationCode,
      bin: {
        raw: "",
        warehouse: remote.warehouse,
        stockroom: "",
        building: "",
        aisle: "",
        rack: "",
        bin: remote.inventoryLocationCode || remote.inventoryLocation,
        locationId: remote.inventoryLocation,
        locationCode: remote.inventoryLocationCode || remote.inventoryLocation,
      },
      itemCode: remote.itemCode,
      itemName: remote.itemName || "",
      qrQuantity: 1,
      multiplier: remote.quantity,
      quantity: remote.quantity,
      uom: remote.uom || "PCS",
      barcodeUom: remote.uom || "PCS",
      authoritativeUom: remote.uom || "PCS",
      lotNo: "",
      timestamp: "",
      deviceId: "ERPNext",
      submittedQuantity: remote.quantity,
      submittedPhysicalCount: remote.quantity,
      submittedTransactionCount: 0,
      submittedTransactionIds: [],
      scanTransactions: [],
      syncConflict: "",
    });
  }
  saveLocalScanEntries(employeeId, synced);
  return { conflicts, rowCount: remoteRows.length, clearedLocalRows: 0 };
};

export const loadScannerDeviceName = () => {
  try {
    return (
      localStorage
        .getItem(
          SCANNER_DEVICE_NAME_KEY
        )
        ?.trim() || ""
    );
  } catch {
    return "";
  }
};

export const saveScannerDeviceName = (
  deviceName: string
) => {
  const cleaned =
    deviceName.trim();

  try {
    if (cleaned) {
      localStorage.setItem(
        SCANNER_DEVICE_NAME_KEY,
        cleaned
      );
    } else {
      localStorage.removeItem(
        SCANNER_DEVICE_NAME_KEY
      );
    }
  } catch {
    // Ignore local storage failures.
  }
};
