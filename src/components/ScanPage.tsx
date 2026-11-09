import React from "react";

// Presentation only: consistent thousands separators for Physical Count quantities.
const formatScanQuantity = (value: number): string => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
import { CalculatorReadout } from "@/components/CalculatorReadout";
import { groupScannedItemsByInvTag } from "@/lib/scannedItemsByInvTag";
import { getItemCatalogLastChecked, loadCachedItems, searchCatalogItems, synchronizeItemCatalog, type CatalogItem } from "@/lib/itemCatalog";
import "./ScanPage.compact.css";
import { App as CapacitorApp } from "@capacitor/app";
import {
  Barcode,
  CheckCircle2,
  MapPin,
  Pencil,
  Play,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import type { Employee } from "@/types";
import AppToast, { type ToastKind, type ToastNotice } from "@/components/AppToast";
import {
  type ScannerLocationMode, type ScannerPackageMode, type ScannerQuantityMode } from "@/lib/scannerPreferences";
import {
  addPcountLocationToSession,
  releaseEmptyPcountLocationsAfterScanRemoval,
  restoreEmptyCompletedPcountLocations,
  expandPcountEntryForLocations,
  getActivePcountGroupLocations,
  getMultiLocationQuantitySummary,
  getPcountSessionRestoreState,
  getEffectivePcountLocationMode,
  completePcountLocationMode,
  completeCountedInactiveRecountLocations,
  lockPcountLocationMode,
  removePcountLocationFromSession,
  validatePcountLocationGroup,
} from "@/lib/pcountLocationGroup";
import {
  applyPhysicalCountChange,
  PACKING_LABEL_ERROR,
  parsePackingLabelQr,
} from "@/lib/packingLabelQr";
import { restoreSubmittedScannerFocus, shouldCapturePageScannerKey, shouldCaptureScannerFocus } from "@/lib/scannerFocus";
import {
  createPcountSubmissionId,
  getPcountItemBaseline,
  getPcountItemDetails,
  getReconciliationContext,
  PcountNotOpenError,
  PCOUNT_NOT_OPEN_MESSAGE,
  PcountStockChangedError,
  getPcountSubmissionStatus,
  uploadPcountSubmission,
  type PcountEntry,
} from "@/lib/erpService";
import {
  addOrMergeLocalScanEntries,
  clearPcountLastScanSetup,
  clearPcountSession,
  clearPendingPcountSubmission,
  discardPendingPcountLocationCounts,
  hasExistingLocationCount,
  getPcountInventoryTagEffectiveCount,
  isPendingLocalScanEntry,
  isSameLocalScanItem,
  loadLastScanSetup,
  loadLocalScanEntries,
  loadPendingLocalScanEntries,
  loadPcountSession,
  loadPendingPcountSubmission,
  loadScannerDeviceName,
  markPcountSubmissionTransactionsSubmitted,
  markPcountBaselineRefreshRequired,
  mergeLocalScanEntries,
  removePcountFromLastActivity,
  restorePcountToLastActivity,
  saveLastScanSetup,
  saveLocalScanEntries,
  savePcountSession,
  savePendingPcountSubmission,
  updateValidatedLocalScanEntry,
  type LocalBinLocation,
  type LocalScanEntry,
  type LocalScanAction,
  type LocalScanTransaction,
  type LastScanSetup,
  type LocalPcountSession,
} from "@/lib/scanStorage";
import {
  clearStorageLocationCache,
  getBidirectionalStorageLocationRange,
  normalizeWarehouseName,
  parseStorageLocationQr,
  requireStorageLocationQr,
  resolveStorageLocationQr,
  type ResolvedStorageLocation,
  type StorageLocationQr,
} from "@/lib/storageLocationService";
import {
  loadReconciliationContextOffline,
  removeReconciliationContextOffline,
  saveReconciliationContextOffline,
} from "@/lib/offlinePcountCache";
import { getAuthoritativeStockUom } from "@/lib/uom";
import { activeInventoryTagKey, findInventoryTagItemConflict, getLatestUsedInventoryTag, validateActiveInventoryTag } from "@/lib/activeInventoryTag";
import { formatPcountUploadTimings, isMissingPcountSubmissionStatus } from "@/lib/pcountSubmissionRecovery";
import { nextEditQuantityKey } from "@/lib/editQuantityKeypad";
import { evaluateQuantityExpression } from "@/lib/quantityExpression";
import { calculateEditedPhysicalCount, readPhysicalCountBreakdown } from "@/lib/editPhysicalCountBreakdown";
import {
  createPhysicalCountTransaction,
  saveFailedPhysicalCountTransaction,
  saveSuccessfulTransaction,
} from "@/lib/transactionHistory";
import {
  calculatePhysicalPackage,
  getSignedPhysicalQuantity,
  PackageQuantityError,
  type PackageStatus,
} from "@/lib/packageQuantity";
import {
  buildPcountEntry,
  createPcountSourceFingerprint,
  getPcountNegativeCountIssue,
  getPcountNegativeCountMessage,
  getPcountStartingPhysicalCount,
  PCOUNT_BLIND_CONFLICT_MESSAGE,
  PCOUNT_BLIND_CONFLICT_NOTICE,
  PCOUNT_BLIND_CONFLICT_TITLE,
  refreshPcountExpectedErpQuantity,
} from "@/lib/pcountSubmission";

export type ScanMode = "in" | "out" | "pcount";
type ScanStep = "reconciliation" | "bin" | "item" | "invtag" | "qty";

interface ScanPageProps {
  employee: Employee;
  initialMode: ScanMode;
  sessionKey: number;
  quantityMode: ScannerQuantityMode;
  packageMode: ScannerPackageMode;
  locationMode: ScannerLocationMode;
  resumePhysicalCount?: boolean;
  onBack: () => void;
}

type BinLocation = LocalBinLocation;
type ItemScan = LocalScanEntry;

type PendingItem = {
  raw: string;
  itemCode: string;
  qrQuantity: number;
  uom: string;
  barcodeUom: string;
  authoritativeUom?: string;
  lotNo: string;
  itemName?: string;
};

type StockChangeReview = {
  previousErpQuantity: number;
  currentErpQuantity: number;
  itemCode: string;
  warehouse: string;
  inventoryLocation: string;
  uom: string;
  physicalCount: number;
  entries: PcountEntry[];
  sourceFingerprint: string;
};

type LastScanFeedback = {
  itemCode: string;
  action: "ADD" | "DEDUCT";
  quantityChange: number;
  runningQuantity: number;
  uom: string;
};

declare global {
  interface Window {
    QcmcScanner?: {
      startScan?: () => void;
      stopScan?: () => void;
      getNavigationInset?: () => number;
    };
  }
}

const modeLabels: Record<ScanMode, string> = {
  in: "IN",
  out: "OUT",
  pcount: "P. Count",
};

const normalizeWarehouse = normalizeWarehouseName;

const toCanonicalBin = (qr: StorageLocationQr, location: ResolvedStorageLocation): BinLocation => {
  const type = location.locationType.toLocaleLowerCase();
  const label = location.locationName || location.locationCode || location.inventoryLocationId;
  return {
    raw: qr.rawBarcode,
    warehouse: location.warehouse,
    locationId: location.inventoryLocationId,
    locationCode: location.locationCode,
    locationName: location.locationName,
    locationType: location.locationType,
    locationPath: location.locationPath,
    isGroup: location.isGroup ? 1 : 0,
    itemCode: location.itemCode,
    storageCapacity: location.storageCapacity,
    validationStatus: "validated",
    stockroom: "",
    building: type === "building" ? label : "",
    aisle: type === "aisle" ? label : "",
    rack: type === "rack" ? label : "",
    bin: label,
  };
};

const toOfflineBin = (qr: StorageLocationQr): BinLocation => {
  const label = qr.locationName || qr.locationCode || qr.locationId;
  const type = qr.locationType.toLocaleLowerCase();
  return {
    raw: qr.rawBarcode,
    warehouse: qr.warehouse,
    locationId: qr.locationId,
    locationCode: qr.locationCode || qr.locationId,
    locationName: qr.locationName || label,
    locationType: qr.locationType,
    locationPath: qr.locationPath,
    isGroup: qr.isGroup ? 1 : 0,
    itemCode: qr.itemCode,
    storageCapacity: qr.storageCapacity,
    validationStatus: "pending",
    stockroom: "",
    building: type === "building" ? label : "",
    aisle: type === "aisle" ? label : "",
    rack: type === "rack" ? label : "",
    bin: label,
  };
};

const isPossibleReconciliationCode = (value: string) => {
  const code = value.trim();
  return Boolean(code && code.length <= 140 && !code.includes(";") && !code.startsWith("{"));
};

const parseItem = (code: string) => {
  const raw = code.trim();

  // QCMC packing label: ITEM_CODE;QUANTITY;UOM;REFERENCE.
  // Parse it explicitly so formatted quantities such as "1,000.00" can never
  // be mistaken for the Item Code. Physical Count allows an empty QR UOM
  // because ERPNext supplies the authoritative Stock UOM during validation.
  const parts = raw.split(";").map((part) => part.trim());
  if (parts.length === 4 && parts[0]) {
    const quantity = Number(parts[1].replace(/,/g, ""));
    if (Number.isFinite(quantity) && quantity > 0) {
      return {
        itemCode: parts[0],
        qrQuantity: quantity,
        uom: parts[2],
        lotNo: "",
      };
    }
  }

  try {
    const label = parsePackingLabelQr(raw, { allowEmptyUom: true });
    return {
      itemCode: label.itemCode,
      qrQuantity: label.quantity,
      uom: label.uom,
      // Manufacturing references are intentionally ignored by Physical Count.
      lotNo: "",
    };
  } catch { return null; }
};

const getTime = () =>
  new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const getScannerDeviceName = () => {
  const savedName = loadScannerDeviceName();
  if (savedName) {
    return savedName;
  }

  return "Unset Device Name";
};

const isNetworkFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || "");
  return /cannot reach|network|timed out|timeout|failed to fetch|fetch failed|connection/i.test(message);
};



const ScanPage: React.FC<ScanPageProps> = ({ employee, initialMode, sessionKey, quantityMode, packageMode, locationMode, resumePhysicalCount = false, onBack }) => {
  const [mode, setMode] = React.useState<ScanMode>(initialMode);
  const [step, setStep] = React.useState<ScanStep>("reconciliation");
  const [scanValue, setScanValue] = React.useState("");
  const [reconciliationCode, setReconciliationCode] = React.useState("");
  const [reconciliationWarehouse, setReconciliationWarehouse] = React.useState("");
  const [currentBin, setCurrentBin] = React.useState<BinLocation | null>(null);
  const [pendingItem, setPendingItem] = React.useState<PendingItem | null>(null);
  const [manualItemOpen, setManualItemOpen] = React.useState(false);
  const [manualPackItem, setManualPackItem] = React.useState<CatalogItem | null>(null);
  const [manualItemQuery, setManualItemQuery] = React.useState("");
  const [manualCatalog, setManualCatalog] = React.useState<CatalogItem[]>([]);
  const [manualPackSize, setManualPackSize] = React.useState("");
  const [manualCatalogLoading, setManualCatalogLoading] = React.useState(false);
  const [manualCatalogProgress, setManualCatalogProgress] = React.useState(0);
  const [manualCatalogError, setManualCatalogError] = React.useState("");
  const [inventoryTag, setInventoryTag] = React.useState("");
  const [inventoryTagPopupNotice, setInventoryTagPopupNotice] = React.useState("");
  React.useEffect(() => {
    if (step !== "invtag") setInventoryTagPopupNotice("");
  }, [step]);
  const [newInventoryTagForItem, setNewInventoryTagForItem] = React.useState<string | null>(null);
  const activeInventoryTagsRef = React.useRef<Record<string, string>>({});
  React.useEffect(() => {
    activeInventoryTagsRef.current = {};
    setNewInventoryTagForItem(null);
  }, [currentBin?.locationId, reconciliationCode]);
  // Recount may only reuse an Inventory Tag already assigned to the exact
  // Item + Location. The tag is never free-text editable during recount.
  const [recountInventoryTags, setRecountInventoryTags] = React.useState<string[]>([]);
  const [recountTagOperation, setRecountTagOperation] = React.useState<"existing" | "new">("existing");
  const [recountLoadedTotal, setRecountLoadedTotal] = React.useState<number | null>(null);
  const [recountCalculatorEdited, setRecountCalculatorEdited] = React.useState(false);
  const recountCalculatorRestoreRef = React.useRef<{ status: PackageStatus; count: string; bigPacks: string } | null>(null);
  // Canonical workflow: Manual quantity + Big Pack is always the default.
  // Loose Pack is selected only for the current quantity popup.
  const [packageStatus, setPackageStatus] = React.useState<PackageStatus>("COMPLETE");
  const [retainedBigPackExpression, setRetainedBigPackExpression] = React.useState("");
  const [retainedLoosePackExpression, setRetainedLoosePackExpression] = React.useState("");
  const [entries, setEntries] = React.useState<ItemScan[]>([]);
  const [message, setMessage] = React.useState("Select a mode, then scan the reconciliation QR first.");
  // Derive directly from the current Mode prop so Automatic can never inherit stale Manual state.
  const quantityPromptEnabled = quantityMode === "manual";
  const [isScanSessionActive, setIsScanSessionActive] = React.useState(false);
  const [qtyDefaultActive, setQtyDefaultActive] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isPreparingSubmission, setIsPreparingSubmission] = React.useState(false);
  const submitPreparationRef = React.useRef(false);
  const [isAllocating, setIsAllocating] = React.useState(false);
  const [loadingOperation, setLoadingOperation] = React.useState<null | { kind: "locations" | "item"; title: string; detail: string }>(null);
  const [isResolvingLocation, setIsResolvingLocation] = React.useState(false);
  const [queuedScans, setQueuedScans] = React.useState<string[]>([]);
  const [toast, setToast] = React.useState<ToastNotice | null>(null);
  const [scanActionMode, setScanActionMode] = React.useState<"ADD" | "DEDUCT">("ADD");
  const [lastScanFeedback, setLastScanFeedback] = React.useState<LastScanFeedback | null>(null);
  const [selectedItemDetails, setSelectedItemDetails] = React.useState<ItemScan | null>(null);
  const [removeScanCandidate, setRemoveScanCandidate] = React.useState<ItemScan | null>(null);
  const [removeSelectionMode, setRemoveSelectionMode] = React.useState(false);
  const [removeSelectedKeys, setRemoveSelectedKeys] = React.useState<Set<string>>(() => new Set());
  const [editingScanTransaction, setEditingScanTransaction] = React.useState<{
    transactionId: string; bigPackCount: string; loosePackQuantity: string; inventoryTag: string; legacyUnsplit: boolean; quantityTouched: boolean;
  } | null>(null);
  const [editPackageStatus, setEditPackageStatus] = React.useState<PackageStatus>("COMPLETE");
  const [editTagHasFocus, setEditTagHasFocus] = React.useState(false);
  const [editScanPopupNotice, setEditScanPopupNotice] = React.useState("");
  // The Android IME can remain visible after leaving the editable Inventory
  // Tag field. Quantity uses only the built-in keypad, so release text input
  // focus when either calculator first opens (not on each keypad press).
  const editCalculatorOpen = Boolean(editingScanTransaction);
  React.useLayoutEffect(() => {
    if (!(step === "qty" && pendingItem) && !editCalculatorOpen) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
    // Older Android System WebViews sometimes carry a pending IME focus across
    // the modal transition. The second check releases only inherited focus.
    const frame = window.requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement && focused !== inventoryTagInputRef.current) {
        focused.blur();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step, Boolean(pendingItem), editCalculatorOpen]);
  const [editQuantityFresh, setEditQuantityFresh] = React.useState(true);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [isLoadingLastSetup, setIsLoadingLastSetup] = React.useState(false);
  const [lastSetup, setLastSetup] = React.useState<LastScanSetup | null>(() => loadLastScanSetup(employee.id, initialMode));
  const [showSubmitConfirm, setShowSubmitConfirm] = React.useState(false);
  const [showFinishLocationConfirm, setShowFinishLocationConfirm] = React.useState(false);
  const [showCountedLocations, setShowCountedLocations] = React.useState(false);
  const [showLocationProgressModal, setShowLocationProgressModal] = React.useState(false);
  const [locationToRemove, setLocationToRemove] = React.useState<{ id: string; label: string } | null>(null);
  const locationLongPressRef = React.useRef<number | null>(null);
  const [showScannedItems, setShowScannedItems] = React.useState(false);
  const [expandedScannedSkuCodes, setExpandedScannedSkuCodes] = React.useState<Set<string>>(() => new Set());
  const [scannedItemsView, setScannedItemsView] = React.useState<"location" | "tag">("location");
  const [pendingExistingLocation, setPendingExistingLocation] = React.useState<{ bin: BinLocation; requiredWarehouse: string } | null>(null);
  const [pcountSession, setPcountSession] = React.useState<LocalPcountSession | null>(() =>
    initialMode === "pcount" ? loadPcountSession(employee.id) : null
  );
  const [deviceName, setDeviceName] = React.useState("");
  const [isOffline, setIsOffline] = React.useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const [hasQueuedSubmission, setHasQueuedSubmission] = React.useState(false);
  const [stockChangeReview, setStockChangeReview] = React.useState<StockChangeReview | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const editQuantityInputRef = React.useRef<HTMLInputElement>(null);
  // Keep the calculator's insertion point at the newest digit while leaving
  // physical scanner focus and the editable Inventory Tag undisturbed.
  const moveCalculatorCaretToEnd = (field: HTMLInputElement | null) => {
    if (!field) return;
    try {
      field.setSelectionRange(field.value.length, field.value.length);
      field.scrollLeft = field.scrollWidth;
    } catch {
      // Some older Android WebViews do not expose selection on read-only inputs.
    }
  };
  React.useLayoutEffect(() => {
    if (step === "qty" && pendingItem) moveCalculatorCaretToEnd(inputRef.current);
    if (editingScanTransaction && !editTagHasFocus) moveCalculatorCaretToEnd(editQuantityInputRef.current);
  }, [step, pendingItem, scanValue, editingScanTransaction?.bigPackCount, editingScanTransaction?.loosePackQuantity, editPackageStatus, editTagHasFocus]);
  const inventoryTagInputRef = React.useRef<HTMLInputElement>(null);
  const editTagInputRef = React.useRef<HTMLInputElement>(null);
  const scanSessionTopRef = React.useRef<HTMLDivElement>(null);
  const scanListRef = React.useRef<HTMLDivElement>(null);
  const scannerBufferRef = React.useRef("");
  const scanRowLongPressRef = React.useRef<number | null>(null);
  const scanRowLongPressedRef = React.useRef(false);
  const autoQuantityAttemptRef = React.useRef("");
  const submitAttemptRef = React.useRef<{
    fingerprint: string;
    submissionId: string;
  } | null>(null);
  const itemNameCacheRef = React.useRef(new Map<string, string>());
  const itemNameLookupRef = React.useRef(new Map<string, Promise<string>>());
  const resolvingLocationRef = React.useRef(false);
  const effectiveLocationMode = getEffectivePcountLocationMode(pcountSession, locationMode);
  const activeGroupLocations = React.useMemo(
    () => getActivePcountGroupLocations(pcountSession?.locations || [], pcountSession?.activeGroupId || ""),
    [pcountSession]
  );

  React.useLayoutEffect(() => {
    if (step === "qty" && pendingItem && recountCalculatorRestoreRef.current) {
      const restored = recountCalculatorRestoreRef.current;
      recountCalculatorRestoreRef.current = null;
      setPackageStatus(restored.status);
      setRetainedBigPackExpression(restored.bigPacks);
      setRetainedLoosePackExpression(restored.status === "OPENED" ? restored.count : "");
      setScanValue(restored.count);
    } else if (step !== "qty" || !pendingItem) {
      setPackageStatus("COMPLETE");
      setRetainedBigPackExpression("");
      setRetainedLoosePackExpression("");
    }
  }, [pendingItem, step]);

  const refreshDeviceName = React.useCallback(() => {
    const nextDeviceName = getScannerDeviceName();
    setDeviceName(nextDeviceName);
    return nextDeviceName;
  }, []);
  const showToast = React.useCallback((kind: ToastKind, message: string) => {
    setToast({ id: Date.now(), kind, message });
  }, []);
  const dismissToast = React.useCallback(() => setToast(null), []);

  const getRemoveEntryKey = React.useCallback((entry: ItemScan) =>
    [
      entry.reconciliationCode.trim().toLocaleUpperCase(),
      String(entry.bin.locationId || "").trim().toLocaleUpperCase(),
      entry.itemCode.trim().toLocaleUpperCase(),
    ].join("|"), []);

  // Selection is intentionally limited to removable, not-yet-ERP-submitted
  // item/location rows. The existing bulk-remove safety check remains active.
  const selectablePendingScanKeys = React.useMemo(() =>
    new Set(entries.filter((entry) =>
      !(entry.submittedTransactionIds || []).length &&
      !(entry.submittedTransactionCount || 0) &&
      entry.submittedPhysicalCount === undefined
    ).map(getRemoveEntryKey)), [entries, getRemoveEntryKey]);

  const selectAllPendingScanItems = React.useCallback(() => {
    if (selectablePendingScanKeys.size === 0) {
      showToast("warning", "No pending scan items available to select. Submitted items are protected.");
      return;
    }
    setRemoveSelectionMode(true);
    setRemoveSelectedKeys(new Set(selectablePendingScanKeys));
  }, [selectablePendingScanKeys, showToast]);

  const cancelScanRowLongPress = React.useCallback(() => {
    if (scanRowLongPressRef.current !== null) {
      window.clearTimeout(scanRowLongPressRef.current);
      scanRowLongPressRef.current = null;
    }
  }, []);

  const startScanRowLongPress = React.useCallback((entry: ItemScan) => {
    cancelScanRowLongPress();
    scanRowLongPressedRef.current = false;
    scanRowLongPressRef.current = window.setTimeout(() => {
      scanRowLongPressRef.current = null;
      scanRowLongPressedRef.current = true;
      setRemoveSelectionMode(true);
      setRemoveSelectedKeys(new Set([getRemoveEntryKey(entry)]));
      if (navigator.vibrate) navigator.vibrate(30);
    }, 550);
  }, [cancelScanRowLongPress, getRemoveEntryKey]);

  const syncCompletedLocationsAfterScanRemoval = React.useCallback((
    removed: LocalScanEntry[],
    remaining: LocalScanEntry[],
  ): string[] => {
    const storedSession = loadPcountSession(employee.id);
    if (!storedSession) return [];
    const result = releaseEmptyPcountLocationsAfterScanRemoval(
      storedSession, removed, remaining, new Date().toISOString(),
    );
    if (result.releasedLocationIds.length === 0) return [];

    savePcountSession(employee.id, result.session);
    setPcountSession(result.session);

    // A cleared location must not remain the stale 'Load setup' target.
    const previousSetup = loadLastScanSetup(employee.id, "pcount");
    if (previousSetup &&
        previousSetup.reconciliationCode.trim().toLocaleLowerCase() === storedSession.reconciliationCode.trim().toLocaleLowerCase() &&
        result.releasedLocationIds.includes((previousSetup.bin.locationId || "").trim().toLocaleLowerCase())) {
      clearPcountLastScanSetup(employee.id, storedSession.reconciliationCode);
      setLastSetup(loadLastScanSetup(employee.id, "pcount"));
    }
    return result.releasedLocationIds;
  }, [employee.id]);

  const removePendingScanEntry = React.useCallback((target: ItemScan) => {
    const submittedIds = new Set(target.submittedTransactionIds || []);
    const hasSubmittedHistory =
      submittedIds.size > 0 ||
      (target.submittedTransactionCount || 0) > 0 ||
      target.submittedPhysicalCount !== undefined;
    if (hasSubmittedHistory) {
      showToast("warning", "This item already has ERP-submitted history and cannot be removed. Use Recount for submitted counts.");
      setRemoveScanCandidate(null);
      return;
    }

    const sameTarget = (entry: LocalScanEntry) =>
      entry.mode === "pcount" &&
      entry.reconciliationCode === target.reconciliationCode &&
      entry.itemCode.trim().toLocaleUpperCase() === target.itemCode.trim().toLocaleUpperCase() &&
      String(entry.bin.locationId || "").trim().toLocaleUpperCase() === String(target.bin.locationId || "").trim().toLocaleUpperCase();

    const allEntries = loadLocalScanEntries(employee.id);
    const removed = allEntries.filter(sameTarget);
    const updated = allEntries.filter((entry) => !sameTarget(entry));
    saveLocalScanEntries(employee.id, updated);
    const released = syncCompletedLocationsAfterScanRemoval(removed, updated);
    const visible = updated.filter((entry) => entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode);
    setEntries(visible);
    setLastScanFeedback(null);
    activeInventoryTagsRef.current = {};
    setNewInventoryTagForItem(null);
    setSelectedItemDetails(null);
    setRemoveScanCandidate(null);
    if (released.length > 0 && !currentBin) {
      setStep("bin");
      setMessage("Count removed. Scan the Storage Location again to start a new count.");
    }

    // The immutable pending upload can no longer be reused after an operator edit.
    // Clearing only its staging pointer forces the next Submit to build a fresh
    // submission ID/payload from the corrected local count.
    clearPendingPcountSubmission(employee.id, reconciliationCode);
    submitAttemptRef.current = null;
    setHasQueuedSubmission(false);
    setStockChangeReview(null);
    showToast("success", `${target.itemCode} removed from the pending Physical Count.`);
  }, [currentBin, employee.id, reconciliationCode, showToast, syncCompletedLocationsAfterScanRemoval]);

  const removeSelectedPendingEntries = React.useCallback(() => {
    if (removeSelectedKeys.size === 0) return;

    const allEntries = loadLocalScanEntries(employee.id);
    const selected = allEntries.filter((entry) =>
      entry.mode === "pcount" &&
      entry.reconciliationCode === reconciliationCode &&
      removeSelectedKeys.has(getRemoveEntryKey(entry))
    );
    const protectedEntries = selected.filter((entry) =>
      (entry.submittedTransactionIds || []).length > 0 ||
      (entry.submittedTransactionCount || 0) > 0 ||
      entry.submittedPhysicalCount !== undefined
    );
    if (protectedEntries.length > 0) {
      showToast("warning", "One or more selected items already have ERP-submitted history. Submitted counts cannot be removed here.");
      return;
    }

    const updated = allEntries.filter((entry) => !(
      entry.mode === "pcount" &&
      entry.reconciliationCode === reconciliationCode &&
      removeSelectedKeys.has(getRemoveEntryKey(entry))
    ));
    saveLocalScanEntries(employee.id, updated);
    const released = syncCompletedLocationsAfterScanRemoval(selected, updated);
    const visible = updated.filter((entry) => entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode);
    setEntries(visible);
    setLastScanFeedback(null);
    activeInventoryTagsRef.current = {};
    setNewInventoryTagForItem(null);
    if (released.length > 0 && !currentBin) {
      setStep("bin");
      setMessage("Removed counts are cleared. Scan the Storage Location again to recount.");
    }

    clearPendingPcountSubmission(employee.id, reconciliationCode);
    submitAttemptRef.current = null;
    setHasQueuedSubmission(false);
    setStockChangeReview(null);
    setSelectedItemDetails(null);
    setRemoveScanCandidate(null);
    setRemoveSelectionMode(false);
    setRemoveSelectedKeys(new Set());
    showToast("success", `${selected.length} pending item${selected.length === 1 ? "" : "s"} removed.${released.length ? ` ${released.length} empty completed location${released.length === 1 ? "" : "s"} can be scanned again.` : ""}`);
  }, [currentBin, employee.id, getRemoveEntryKey, reconciliationCode, removeSelectedKeys, showToast, syncCompletedLocationsAfterScanRemoval]);

  React.useEffect(() => {
    if (pcountSession?.activeLocationMode && pcountSession.activeLocationMode !== locationMode) {
      showToast("warning", `Current ${pcountSession.activeLocationMode === "multi" ? "Multi" : "Single"} Location work is unchanged. ${locationMode === "multi" ? "Multi" : "Single"} Location will apply after Next Location.`);
    }
  }, [locationMode, pcountSession, showToast]);

  const handlePcountNotOpen = React.useCallback((code: string) => {
    removePcountFromLastActivity(employee.id, code);
    removeReconciliationContextOffline(code);
    submitAttemptRef.current = null;
    setHasQueuedSubmission(false);
    setStockChangeReview(null);
    setPcountSession(null);
    setReconciliationCode("");
    setReconciliationWarehouse("");
    setCurrentBin(null);
    setPendingItem(null);
    setEntries([]);
    setStep("reconciliation");
    setIsScanSessionActive(false);
    setLastScanFeedback(null);
    setLastSetup(loadLastScanSetup(employee.id, "pcount"));
    setMessage(PCOUNT_NOT_OPEN_MESSAGE);
    showToast("error", PCOUNT_NOT_OPEN_MESSAGE);
  }, [employee.id, showToast]);

  const updatePcountSession = React.useCallback((
    updater: (current: LocalPcountSession | null) => LocalPcountSession | null
  ) => {
    setPcountSession((current) => {
      const updated = updater(current);
      if (updated) savePcountSession(employee.id, updated);
      else clearPcountSession(employee.id);
      return updated;
    });
  }, [employee.id]);

  React.useEffect(() => {
    clearStorageLocationCache();
  }, [sessionKey]);

  // Keep scanner focus ownership in one place. Individual scan/error paths may
  // request focus freely, but dialogs and location validation must never have
  // their controls/input focus stolen by the hidden scanner capture.
  const scannerFocusAllowedRef = React.useRef(true);
  const submittedScannerFocusPendingRef = React.useRef(false);
  const scannerFocusAllowed = shouldCaptureScannerFocus({
    resolvingLocation: isResolvingLocation,
    showingItemDetails: Boolean(selectedItemDetails),
    showingSubmitConfirmation: showSubmitConfirm || manualItemOpen || Boolean(manualPackItem),
    showingFinishLocationConfirmation: showFinishLocationConfirm,
    showingExistingLocationConfirmation: Boolean(pendingExistingLocation) || Boolean(locationToRemove),
    showingStockChangeReview: Boolean(stockChangeReview),
    submitting: isSubmitting,
    enteringManualQuantity: (step === "qty" && quantityPromptEnabled && Boolean(pendingItem)) || (step === "invtag" && Boolean(pendingItem)),
  });
  scannerFocusAllowedRef.current = scannerFocusAllowed;

  React.useLayoutEffect(() => {
    if (restoreSubmittedScannerFocus(submittedScannerFocusPendingRef.current, scannerFocusAllowed, inputRef.current)) {
      submittedScannerFocusPendingRef.current = false;
    }
  });

  const focusScanner = React.useCallback(() => {
    const applyFocus = () => {
      if (!scannerFocusAllowedRef.current) return;
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable)
      ) {
        if (activeElement !== inputRef.current) return;
      }
      const input = inputRef.current;
      if (!input || input.disabled) return;
      input.focus({ preventScroll: true });
    };
    window.requestAnimationFrame(() => {
      applyFocus();
      window.setTimeout(applyFocus, 40);
    });
  }, []);

  const refocusPhysicalCountScanner = React.useCallback(() => {
    window.setTimeout(focusScanner, 0);
  }, [focusScanner]);

  React.useEffect(() => {
    if (!scannerFocusAllowed || (!isScanSessionActive && step === "item")) return;
    focusScanner();
  }, [focusScanner, isScanSessionActive, scannerFocusAllowed, step]);

  React.useEffect(() => {
    const restoreFocus = () => focusScanner();
    const restoreVisibleFocus = () => {
      if (document.visibilityState === "visible") focusScanner();
    };
    window.addEventListener("focus", restoreFocus);
    document.addEventListener("visibilitychange", restoreVisibleFocus);
    return () => {
      window.removeEventListener("focus", restoreFocus);
      document.removeEventListener("visibilitychange", restoreVisibleFocus);
    };
  }, [focusScanner]);

  const rememberSetup = React.useCallback((
    bin: BinLocation,
    reference = reconciliationCode,
    warehouse = reconciliationWarehouse,
    lastItem?: LastScanSetup["lastItem"]
  ) => {
    if (!reference || !warehouse || !bin.locationId) return;
    const setup: LastScanSetup = {
      mode,
      reconciliationCode: reference,
      reconciliationWarehouse: warehouse,
      bin,
      timestamp: new Date().toISOString(),
      lastItem,
    };
    saveLastScanSetup(employee.id, setup);
    setLastSetup(setup);
  }, [employee.id, mode, reconciliationCode, reconciliationWarehouse]);

  const loadPreviousSetup = React.useCallback(async () => {
    if (!lastSetup || isLoadingLastSetup) return;
    setIsLoadingLastSetup(true);
    try {
      const savedSession = loadPcountSession(employee.id);
      if (savedSession?.reconciliationCode === lastSetup.reconciliationCode) {
        const restoredState = getPcountSessionRestoreState(savedSession);
        setPcountSession(savedSession);
        setReconciliationCode(savedSession.reconciliationCode);
        setReconciliationWarehouse(savedSession.reconciliationWarehouse);
        setCurrentBin(restoredState.currentBin);
        setPendingItem(null);
        setEntries(loadLocalScanEntries(employee.id).filter((entry) =>
          entry.mode === mode && entry.reconciliationCode === savedSession.reconciliationCode
        ));
        setStep(restoredState.step);
        setScanValue("");
        setQtyDefaultActive(false);
        setIsScanSessionActive(restoredState.isScanSessionActive);
        scannerBufferRef.current = "";
        setMessage(restoredState.isScanSessionActive
          ? "Multi Location restored. Continue scanning items."
          : "Multi Location restored. Continue to Items when ready.");
        showToast("success", "Last activity session restored.");
        refocusPhysicalCountScanner();
        return;
      }
      let context;
      try {
        context = await getReconciliationContext(lastSetup.reconciliationCode);
        restorePcountToLastActivity(employee.id, context.reconciliationId);
        saveReconciliationContextOffline(context);
        setIsOffline(false);
      } catch (error) {
        if (error instanceof PcountNotOpenError) {
          handlePcountNotOpen(lastSetup.reconciliationCode);
          return;
        }
        if (!isNetworkFailure(error)) throw error;
        context = loadReconciliationContextOffline(lastSetup.reconciliationCode) || {
          reconciliationId: lastSetup.reconciliationCode,
          warehouse: lastSetup.reconciliationWarehouse,
          purpose: "",
        };
        setIsOffline(true);
      }
      if (normalizeWarehouse(context.warehouse) !== normalizeWarehouse(lastSetup.bin.warehouse)) {
        throw new Error(`Saved location belongs to ${lastSetup.bin.warehouse}; the reconciliation now requires ${context.warehouse}.`);
      }
      setReconciliationCode(context.reconciliationId);
      setReconciliationWarehouse(context.warehouse);
      setCurrentBin(lastSetup.bin);
      setPendingItem(null);
      setEntries(loadLocalScanEntries(employee.id).filter((entry) => entry.mode === mode && entry.reconciliationCode === context.reconciliationId));
      setStep("item");
      setScanValue("");
      setQtyDefaultActive(false);
      scannerBufferRef.current = "";
      setMessage("Previous setup loaded. Review it, then press Start Scanning.");
      showToast("success", "Last activity setup loaded.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to load the previous setup.");
    } finally {
      setIsLoadingLastSetup(false);
    }
  }, [employee.id, handlePcountNotOpen, isLoadingLastSetup, lastSetup, mode, refocusPhysicalCountScanner, showToast]);

  const hydrateItemName = React.useCallback((itemCode: string) => {
    const cacheKey = itemCode.trim().toLocaleUpperCase();
    if (!cacheKey || itemNameCacheRef.current.has(cacheKey)) return;

    let lookup = itemNameLookupRef.current.get(cacheKey);
    if (!lookup) {
      lookup = getPcountItemDetails(itemCode)
        .then((details) => details.itemName)
        .catch(() => "")
        .finally(() => itemNameLookupRef.current.delete(cacheKey));
      itemNameLookupRef.current.set(cacheKey, lookup);
    }

    void lookup.then((itemName) => {
      if (!itemName) return;
      itemNameCacheRef.current.set(cacheKey, itemName);
      setPendingItem((current) => current?.itemCode.trim().toLocaleUpperCase() === cacheKey
        ? { ...current, itemName }
        : current);
      setEntries((current) => current.map((entry) => entry.itemCode.trim().toLocaleUpperCase() === cacheKey
        ? { ...entry, itemName }
        : entry));
      setSelectedItemDetails((current) => current?.itemCode.trim().toLocaleUpperCase() === cacheKey
        ? { ...current, itemName }
        : current);
      setLastSetup((current) => {
        if (!current?.lastItem || current.lastItem.itemCode.trim().toLocaleUpperCase() !== cacheKey) return current;
        const updated = { ...current, lastItem: { ...current.lastItem, itemName } };
        saveLastScanSetup(employee.id, updated);
        return updated;
      });

      const savedEntries = loadLocalScanEntries(employee.id);
      const updatedEntries = savedEntries.map((entry) => entry.itemCode.trim().toLocaleUpperCase() === cacheKey
        ? { ...entry, itemName }
        : entry);
      saveLocalScanEntries(employee.id, updatedEntries);
    });
  }, [employee.id]);

  React.useEffect(() => {
    for (const entry of entries) {
      if (!entry.itemName) hydrateItemName(entry.itemCode);
    }
  }, [entries, hydrateItemName]);

  React.useEffect(() => {
    refreshDeviceName();
  }, [refreshDeviceName]);

  React.useEffect(() => {
    const handleFocus = () => {
      refreshDeviceName();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshDeviceName();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshDeviceName]);

  const handleSubmitToErp = React.useCallback(async () => {
    if (!reconciliationCode || isSubmitting || submitPreparationRef.current) return;

    const incompleteLocations = (pcountSession?.locations || []).filter((location) => location.status !== "completed");
    if (incompleteLocations.length > 0 || pcountSession?.activeLocationId) {
      const names = incompleteLocations.map((location) => location.bin.locationCode || location.bin.locationId).join(", ");
      setShowCountedLocations(true);
      showToast("warning", "Complete these locations before submitting: " + (names || pcountSession?.activeLocationId) + ".");
      focusScanner();
      return;
    }

    const sessionLocationIds = new Set((pcountSession?.locations || [])
      .map((location) => String(location.bin.locationId || "").trim().toUpperCase())
      .filter(Boolean));
    // An orphaned local row can never be uploaded just because it survived in
    // audit storage. Only selected locations in THIS session are eligible.
    const eligibleForSubmission = (entry: LocalScanEntry) =>
      entry.mode === "pcount" &&
      entry.reconciliationCode.trim().toUpperCase() === reconciliationCode.trim().toUpperCase() &&
      sessionLocationIds.has(String(entry.bin.locationId || "").trim().toUpperCase());
    const conflict = entries.find((entry) => eligibleForSubmission(entry) && entry.syncConflict && isPendingLocalScanEntry(entry));
    if (conflict && !conflict.syncConflict?.startsWith("Baseline refresh required")) {
      showToast("warning", conflict.itemCode + ": " + conflict.syncConflict);
      return;
    }

    const pendingEntries = entries.filter((entry) => eligibleForSubmission(entry) && isPendingLocalScanEntry(entry));
    if (pendingEntries.length === 0) {
      showToast("warning", "No Physical Count entries are ready to submit.");
      return;
    }
    const negativeCountIssue = getPcountNegativeCountIssue(pendingEntries);
    if (negativeCountIssue) {
      setShowCountedLocations(true);
      showToast("error", getPcountNegativeCountMessage(negativeCountIssue));
      return;
    }

    const sourceFingerprint = createPcountSourceFingerprint(reconciliationCode, pendingEntries);
    const persisted = loadPendingPcountSubmission(employee.id, reconciliationCode);
    const savedPayload = persisted?.payload && typeof persisted.payload === "object" ? persisted.payload as { entries?: PcountEntry[] } : null;
    const reuse = persisted?.sourceFingerprint === sourceFingerprint &&
      !persisted?.lastError?.startsWith("NEEDS_REVIEW|") &&
      Array.isArray(savedPayload?.entries) &&
      savedPayload.entries.length > 0;

    const preparationStartedAt = performance.now();
    submitPreparationRef.current = true;
    setIsPreparingSubmission(true);
    let stagedEntries: PcountEntry[];
    try {
      // Give Android WebView a paint opportunity before building a large upload.
      // A state update alone can remain invisible during synchronous preparation.
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
      });
      // The on-screen warehouse may come from an older offline session.
      // For a NEW upload, use the warehouse that ERPNext currently assigns to
      // this reconciliation. Never rewrite an existing queued submission:
      // its idempotency key must continue to identify its original payload.
      const onlineForValidation = typeof navigator === "undefined" || navigator.onLine !== false;
      // Never make a recovered, already-accepted upload depend on a fresh
      // reconciliation-context fetch: ERP may have completed it meanwhile.
      // New uploads still verify the current authoritative warehouse.
      const verifiedContext = onlineForValidation && !reuse
        ? await getReconciliationContext(reconciliationCode)
        : null;
      const verifiedWarehouse = String(verifiedContext?.warehouse || reconciliationWarehouse || (reuse ? savedPayload?.entries?.[0]?.warehouse : "") || "").trim();
      if (!verifiedWarehouse) {
        throw new Error("ERPNext reconciliation warehouse is missing. Saved counts remain on this device.");
      }
      if (reconciliationWarehouse && normalizeWarehouse(verifiedWarehouse) !== normalizeWarehouse(reconciliationWarehouse)) {
        throw new Error(`ERPNext requires warehouse '${verifiedWarehouse}' but this saved session uses '${reconciliationWarehouse}'. Count retained; review the reconciliation before upload.`);
      }
      if (reuse && savedPayload!.entries!.some((entry) =>
        normalizeWarehouse(String(entry.warehouse || "")) !== normalizeWarehouse(verifiedWarehouse)
      )) {
        throw new Error(`Queued submission warehouse differs from ERPNext '${verifiedWarehouse}'. Queued data and submission ID were preserved; review before retrying.`);
      }
      if (reuse) {
        stagedEntries = savedPayload!.entries!;
      } else {
        stagedEntries = [];
        const repairedEntries: LocalScanEntry[] = [];
        for (const savedEntry of pendingEntries) {
          let effectiveEntry = savedEntry;
          const originalCode = String(savedEntry.itemCode || "").trim();
          if (!originalCode || /^[-+]?\d+(?:[.,]\d+)?$/.test(originalCode)) {
            const recovered = parseItem(String(savedEntry.raw || ""));
            if (recovered?.itemCode) {
              effectiveEntry = {
                ...savedEntry,
                itemCode: recovered.itemCode,
                qrQuantity: recovered.qrQuantity,
                uom: savedEntry.uom || recovered.uom,
                barcodeUom: savedEntry.barcodeUom || recovered.uom,
              };
            }
          }

          const itemCode = String(effectiveEntry.itemCode || "").trim();
          const locationId = String(effectiveEntry.bin.locationId || "").trim();
          const warehouse = verifiedWarehouse;
          if (effectiveEntry.bin.warehouse && normalizeWarehouse(effectiveEntry.bin.warehouse) !== normalizeWarehouse(warehouse)) {
            throw new Error(itemCode + " at " + locationId + ": saved Storage Location warehouse differs from ERPNext " + warehouse + ". Count retained for review.");
          }
          if (!itemCode || /^[-+]?\d+(?:[.,]\d+)?$/.test(itemCode)) throw new Error("Invalid saved Item Code. Review this saved scan before upload.");
          if (!locationId) throw new Error(itemCode + ": Storage Location is blank.");
          if (!warehouse) throw new Error(itemCode + " at " + locationId + ": reconciliation warehouse is not available locally.");

          let authoritativeUom = String(effectiveEntry.authoritativeUom || effectiveEntry.uom || "").trim();
          let expectedErpQuantity = Number(effectiveEntry.erpBaselineQuantity);

          // A recount starts from an ERP-acknowledged physical count, not the
          // baseline captured BEFORE its previous submission. Refresh only
          // that stale baseline; never rewrite the operator's recount delta.
          // If ERP has since changed independently, stop for review instead
          // of silently accepting an unrelated stock movement as our baseline.
          const submittedCount = effectiveEntry.submittedPhysicalCount ?? effectiveEntry.submittedQuantity;
          if (submittedCount !== undefined && Number.isFinite(submittedCount) &&
              (typeof navigator === "undefined" || navigator.onLine !== false)) {
            const recountBaseline = await getPcountItemBaseline(
              reconciliationCode,
              itemCode,
              warehouse,
              locationId,
              effectiveEntry.lotNo || ""
            );
            const erpNow = Number(recountBaseline.currentErpQuantity);
            if (!Number.isFinite(erpNow) || Math.abs(erpNow - submittedCount) > 0.000001) {
              throw new Error(itemCode + " at " + locationId +
                ": ERP count changed since the previous submission. Review the current ERP quantity before resubmitting; your recount remains saved.");
            }
            expectedErpQuantity = erpNow;
            authoritativeUom = getAuthoritativeStockUom(
              recountBaseline.stockUom, recountBaseline.uom, authoritativeUom
            );
            effectiveEntry = {
              ...effectiveEntry,
              erpBaselineQuantity: expectedErpQuantity,
              authoritativeUom,
              uom: authoritativeUom || effectiveEntry.uom,
            };
            repairedEntries.push(effectiveEntry);
          }

          // Repair legacy/offline rows before staging. Counts and scan transactions
          // remain untouched; only ERP-owned baseline metadata is refreshed.
          if (!authoritativeUom || !Number.isFinite(expectedErpQuantity)) {
            if (typeof navigator !== "undefined" && navigator.onLine === false) {
              throw new Error(itemCode + " at " + locationId + ": ERP baseline metadata is missing. Connect to ERP and submit again; the saved count will be kept.");
            }
            const baseline = await getPcountItemBaseline(
              reconciliationCode,
              itemCode,
              warehouse,
              locationId,
              effectiveEntry.lotNo || ""
            );
            authoritativeUom = getAuthoritativeStockUom(baseline.stockUom, baseline.uom, effectiveEntry.authoritativeUom);
            if (!authoritativeUom) {
              const details = await getPcountItemDetails(itemCode);
              if (details.itemCode.trim() !== itemCode) {
                throw new Error(itemCode + ": ERP Item details do not match the scanned item.");
              }
              authoritativeUom = getAuthoritativeStockUom(details.stockUom, details.uom);
            }
            if (!authoritativeUom) {
              throw new Error(itemCode + " at " + locationId + ": ERP Stock UOM is unavailable.");
            }
            expectedErpQuantity = baseline.currentErpQuantity;
            const barcodeUom = String(effectiveEntry.barcodeUom || "").trim();
            // Preserve historical scan metadata, but never convert new stock
            // quantities using the untrusted QR UOM or its implied factor.
            const conversionFactor = effectiveEntry.uomConversionFactor ?? 1;
            effectiveEntry = {
              ...effectiveEntry,
              uom: authoritativeUom,
              authoritativeUom,
              ...(barcodeUom ? { barcodeUom } : {}),
              ...(conversionFactor ? { uomConversionFactor: conversionFactor } : {}),
              erpBaselineQuantity: expectedErpQuantity,
              itemName: effectiveEntry.itemName || baseline.itemName,
            };
            repairedEntries.push(effectiveEntry);
          }

          if (!Number.isFinite(expectedErpQuantity)) throw new Error(itemCode + " at " + locationId + ": ERP baseline was not captured. The count remains saved locally.");
          stagedEntries.push(buildPcountEntry({
            entry: effectiveEntry,
            warehouse,
            expectedPreviousCount: getPcountStartingPhysicalCount(effectiveEntry),
            expectedErpQuantity,
            authoritativeUom,
          }));
        }

        if (repairedEntries.length > 0) {
          addOrMergeLocalScanEntries(employee.id, repairedEntries);
          setEntries(loadLocalScanEntries(employee.id).filter((entry) =>
            entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode
          ));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to prepare Physical Count upload.";
      const failedSubmissionId = reuse && persisted?.submissionId
        ? persisted.submissionId
        : createPcountSubmissionId();
      saveFailedPhysicalCountTransaction({
        reconciliationId: reconciliationCode,
        submissionId: failedSubmissionId,
        locationCount: new Set(pendingEntries.map((entry) => entry.bin.locationId).filter(Boolean)).size,
        entryCount: pendingEntries.length,
        errorCode: error instanceof PcountNotOpenError ? "PCOUNT_NOT_OPEN" : "PCOUNT_PREPARATION_FAILED",
        errorMessage: message,
      });
      submitPreparationRef.current = false;
      setIsPreparingSubmission(false);
      showToast("error", message);
      return;
    }

    const preparationMs = performance.now() - preparationStartedAt;
    submitPreparationRef.current = false;
    setIsPreparingSubmission(false);
    const submissionId = reuse ? persisted!.submissionId : createPcountSubmissionId();
    const fingerprint = JSON.stringify({ reconciliationCode, submissionId, entries: stagedEntries });
    const payload = { reconciliation_id: reconciliationCode, operation: "adjustment" as const, submission_id: submissionId, entries: stagedEntries };
    try {
    savePendingPcountSubmission(employee.id, reconciliationCode, { fingerprint, sourceFingerprint, submissionId, payload, queuedAt: reuse ? persisted?.queuedAt || new Date().toISOString() : new Date().toISOString(), ...(persisted?.lastError ? { lastError: persisted.lastError } : {}) });
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to save count locally. Upload cancelled.");
      return;
    }
    submitAttemptRef.current = { fingerprint, submissionId };
    setHasQueuedSubmission(true);

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setIsOffline(true);
      showToast("warning", "Count saved on this device. It will upload to ERP when internet returns.");
      return;
    }

    setIsSubmitting(true);
    const requestStartedAt = performance.now();
    let acceptanceMs: number | null = null;
    let recoveredExisting = false;
    try {
      // A restored queue may already be processing (or fully completed) on ERP.
      // Check the durable submission ID before repeating the large POST.
      // Only an explicit 404 permits a new send with the SAME ID and payload.
      let status: Awaited<ReturnType<typeof getPcountSubmissionStatus>> | null = null;
      if (reuse) {
        try {
          status = await getPcountSubmissionStatus(submissionId);
          recoveredExisting = true;
        } catch (statusError) {
          if (!isMissingPcountSubmissionStatus(statusError)) throw statusError;
        }
      }
      if (!status) {
        const uploadStartedAt = performance.now();
        status = await uploadPcountSubmission(reconciliationCode, stagedEntries, { operation: "adjustment", submissionId });
        acceptanceMs = performance.now() - uploadStartedAt;
      }
      setIsOffline(false);
      setMessage(recoveredExisting ? "Checking the existing ERP Physical Count submission..." : "ERP received the Physical Count. Processing...");
      // Bound the time the operator must wait in the loading overlay.
      // ERP may continue processing after this device stops polling.
      const statusDeadline = Date.now() + 30000;
      for (let attempt = 0; attempt < 12 && !["COMPLETED", "NEEDS_REVIEW", "FAILED"].includes(status.status); attempt += 1) {
        const remaining = statusDeadline - Date.now();
        if (remaining <= 0) break;
        await new Promise((resolve) => window.setTimeout(resolve, Math.min(2000, remaining)));
        if (Date.now() >= statusDeadline) break;
        status = await getPcountSubmissionStatus(submissionId);
      }

      if (status.status === "COMPLETED") {
        const totalMs = preparationMs + performance.now() - requestStartedAt;
        const timingSummary = formatPcountUploadTimings({
          preparationMs,
          acceptanceMs,
          confirmationMs: Math.max(0, performance.now() - requestStartedAt - (acceptanceMs ?? 0)),
          totalMs,
          recoveredExisting,
        });
        console.info("[QCMC Physical Count] submission completed:", timingSummary);
        const resultItemCount = Number(status.result?.item_count);
        const itemCount = Number.isFinite(resultItemCount) && resultItemCount > 0 ? resultItemCount : stagedEntries.length;
        saveSuccessfulTransaction(createPhysicalCountTransaction({ reconciliationId: reconciliationCode, submissionId: status.submissionId, itemCount, entries: stagedEntries }));
        markPcountSubmissionTransactionsSubmitted(employee.id, reconciliationCode, stagedEntries);
        clearPcountLastScanSetup(employee.id, reconciliationCode);
        clearPendingPcountSubmission(employee.id, reconciliationCode);
        clearPcountSession(employee.id);
        const warehouse = stagedEntries[0]?.warehouse || reconciliationWarehouse;
        const nextSession: LocalPcountSession = { reconciliationCode, reconciliationWarehouse: warehouse, locationMode: pcountSession?.locationMode || "single", activeGroupId: "", activeLocationId: "", locations: [], updatedAt: new Date().toISOString(), validationStatus: "validated" };
        savePcountSession(employee.id, nextSession);
        submitAttemptRef.current = null;
        setHasQueuedSubmission(false);
        setPcountSession(nextSession);
        setEntries([]);
        setCurrentBin(null);
        setPendingItem(null);
        setStep("bin");
        setScanActionMode("ADD");
        setLastScanFeedback(null);
        setShowCountedLocations(false);
        setScanValue("");
        scannerBufferRef.current = "";
        setMessage("ERP save complete. Scan the next Storage Location.");
        showToast("success", new Set(stagedEntries.map((entry) => entry.inventoryLocation)).size + " location(s), " + itemCount + " item(s) saved to " + reconciliationCode + " in " + (totalMs / 1000).toFixed(1) + "s. Scanned items cleared.");
        submittedScannerFocusPendingRef.current = true;
        return;
      }

      if (status.status === "NEEDS_REVIEW") {
        savePendingPcountSubmission(employee.id, reconciliationCode, { fingerprint, sourceFingerprint, submissionId, payload, queuedAt: persisted?.queuedAt || new Date().toISOString(), lastError: "NEEDS_REVIEW|" + (status.errorMessage || status.errorCode || "ERP validation requires review.") });
        saveFailedPhysicalCountTransaction({
          reconciliationId: reconciliationCode,
          submissionId,
          locationCount: new Set(stagedEntries.map((entry) => entry.inventoryLocation)).size,
          entryCount: stagedEntries.length,
          errorCode: status.errorCode,
          errorMessage: status.errorMessage || status.errorCode || "ERP validation requires review.",
        });
        setShowCountedLocations(true);
        if (status.errorCode === "PCOUNT_STOCK_CHANGED") {
          try {
            const details = JSON.parse(status.errorMessage || "{}") as Record<string, unknown>;
            const target = { itemCode: String(details.item_code || ""), warehouse: String(details.warehouse || stagedEntries[0]?.warehouse || ""), inventoryLocation: String(details.inventory_location || "") };
            const currentErpQuantity = Number(details.current_erp_quantity);
            const previousErpQuantity = Number(details.expected_previous_count);
            const matching = stagedEntries.find((entry) => (!target.itemCode || entry.itemCode === target.itemCode) && (!target.inventoryLocation || entry.inventoryLocation === target.inventoryLocation)) || stagedEntries[0];
            if (matching && target.itemCode && target.inventoryLocation && Number.isFinite(currentErpQuantity)) {
              const refreshedEntries = refreshPcountExpectedErpQuantity(stagedEntries, target, currentErpQuantity);
              markPcountBaselineRefreshRequired(employee.id, reconciliationCode, target, "Baseline refresh required. Review before resubmitting.");
              setEntries(loadLocalScanEntries(employee.id).filter((entry) => entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode));
              setStockChangeReview({ previousErpQuantity: Number.isFinite(previousErpQuantity) ? previousErpQuantity : matching.expectedERPQuantity || 0, currentErpQuantity, ...target, uom: matching.uom, physicalCount: matching.physicalCount, entries: refreshedEntries, sourceFingerprint });
            }
          } catch { /* keep durable submission and local count for manual review */ }
        }
        showToast("warning", status.errorCode === "PCOUNT_STOCK_CHANGED" ? PCOUNT_BLIND_CONFLICT_NOTICE : status.errorMessage || "ERP received the count but it requires review.");
        return;
      }

      if (status.status === "FAILED") {
        savePendingPcountSubmission(employee.id, reconciliationCode, { fingerprint, sourceFingerprint, submissionId, payload, queuedAt: persisted?.queuedAt || new Date().toISOString(), lastError: status.errorMessage || status.errorCode || "ERP processing failed." });
        saveFailedPhysicalCountTransaction({
          reconciliationId: reconciliationCode,
          submissionId,
          locationCount: new Set(stagedEntries.map((entry) => entry.inventoryLocation)).size,
          entryCount: stagedEntries.length,
          errorCode: status.errorCode,
          errorMessage: status.errorMessage || status.errorCode || "ERP processing failed.",
        });
        showToast("error", status.errorMessage || status.errorCode || "ERP processing failed. Count remains saved on this device.");
        return;
      }

      setHasQueuedSubmission(true);
      setMessage("ERP is still processing this submission. The count and submission ID remain saved on this device; check its status before resubmitting.");
      showToast("warning", "ERP processing is taking longer than expected. Your saved count is safe; do not submit a second copy.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Physical Count upload failed.";
      saveFailedPhysicalCountTransaction({
        reconciliationId: reconciliationCode,
        submissionId,
        locationCount: new Set(stagedEntries.map((entry) => entry.inventoryLocation)).size,
        entryCount: stagedEntries.length,
        errorCode: error instanceof PcountNotOpenError ? "PCOUNT_NOT_OPEN" : isNetworkFailure(error) ? "NETWORK_ERROR" : "PCOUNT_SUBMISSION_FAILED",
        errorMessage: message,
      });
      if (error instanceof PcountNotOpenError) { handlePcountNotOpen(reconciliationCode); return; }
      savePendingPcountSubmission(employee.id, reconciliationCode, { fingerprint, sourceFingerprint, submissionId, payload, queuedAt: persisted?.queuedAt || new Date().toISOString(), lastError: message });
      setHasQueuedSubmission(true);
      const networkFailure = isNetworkFailure(error);
      setIsOffline(networkFailure);
      showToast(
        networkFailure ? "warning" : "error",
        networkFailure
          ? "Connection to ERP was interrupted. Please check your internet or network connection, then try again. Your Physical Count is still saved on this device."
          : message
      );
    } finally {
      setIsSubmitting(false);
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          refocusPhysicalCountScanner();
        }, 0);
      });
    }
  }, [employee.id, entries, focusScanner, handlePcountNotOpen, isSubmitting, pcountSession, reconciliationCode, reconciliationWarehouse, refocusPhysicalCountScanner, showToast]);

  const resubmitAfterBaselineRefresh = React.useCallback(async () => {
    if (!stockChangeReview || isSubmitting || !reconciliationCode) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setIsOffline(true);
      showToast("warning", "Baseline refresh required. Connect to ERP before resubmitting.");
      return;
    }

    setIsSubmitting(true);
    const submissionId = createPcountSubmissionId();
    const payload = {
      reconciliation_id: reconciliationCode,
      operation: "adjustment" as const,
      submission_id: submissionId,
      entries: stockChangeReview.entries,
    };
    const fingerprint = JSON.stringify({ reconciliationCode, entries: stockChangeReview.entries });
    savePendingPcountSubmission(employee.id, reconciliationCode, {
      fingerprint,
      sourceFingerprint: stockChangeReview.sourceFingerprint,
      submissionId,
      payload,
      queuedAt: new Date().toISOString(),
    });
    try {
      let result = await uploadPcountSubmission(reconciliationCode, stockChangeReview.entries, {
        operation: "adjustment",
        submissionId,
      });
      for (let attempt = 0; attempt < 80 && !["COMPLETED", "NEEDS_REVIEW", "FAILED"].includes(result.status); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        result = await getPcountSubmissionStatus(submissionId);
      }
      if (result.status !== "COMPLETED") {
        throw new Error(
          result.errorMessage ||
          result.errorCode ||
          ("ERP submission is " + result.status.toLowerCase() + ". The local count was kept.")
        );
      }
      const completedItemCount = Number(result.result?.item_count);
      const resultItemCount = Number.isFinite(completedItemCount) && completedItemCount > 0
        ? completedItemCount
        : stockChangeReview.entries.length;
      saveSuccessfulTransaction(createPhysicalCountTransaction({
        reconciliationId: reconciliationCode,
        submissionId: result.submissionId,
        itemCount: resultItemCount,
        entries: stockChangeReview.entries,
      }));
      markPcountSubmissionTransactionsSubmitted(employee.id, reconciliationCode, stockChangeReview.entries);
      clearPendingPcountSubmission(employee.id, reconciliationCode);
      submitAttemptRef.current = null;
      setStockChangeReview(null);
      submittedScannerFocusPendingRef.current = true;
      setHasQueuedSubmission(false);
      setIsOffline(false);

      const refreshedLocal = loadLocalScanEntries(employee.id).filter(
        (entry) => entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode
      );
      const remainingPending = refreshedLocal.filter(isPendingLocalScanEntry);

      if (remainingPending.length > 0) {
        setEntries(refreshedLocal);
        const locationId = stockChangeReview.inventoryLocation;
        setMessage(`ERP saved ${locationId}. Remaining locations are still pending.`);
        showToast(
          "success",
          `${locationId} saved successfully. ${remainingPending.length} pending item row(s) remain. Press Submit to ERP to continue.`
        );
      } else {
        clearPcountLastScanSetup(employee.id, reconciliationCode);
        clearPcountSession(employee.id);
        const nextSession: LocalPcountSession = {
          reconciliationCode,
          reconciliationWarehouse,
          locationMode: pcountSession?.locationMode || "single",
          activeGroupId: "",
          activeLocationId: "",
          locations: [],
          updatedAt: new Date().toISOString(),
          validationStatus: "validated",
        };
        savePcountSession(employee.id, nextSession);
        setPcountSession(nextSession);
        setEntries([]);
        setCurrentBin(null);
        setPendingItem(null);
        setStep("bin");
        setScanActionMode("ADD");
        setLastScanFeedback(null);
        setShowCountedLocations(false);
        setMessage("ERP save complete. Scan the next Storage Location.");
        showToast("success", `${resultItemCount} item(s) saved to ${reconciliationCode}. Physical Count sync complete.`);
      }
    } catch (error) {
      if (error instanceof PcountNotOpenError) {
        handlePcountNotOpen(reconciliationCode);
        return;
      }
      if (error instanceof PcountStockChangedError) {
        const fallback = stockChangeReview.entries.find((entry) =>
          (!error.itemCode || entry.itemCode === error.itemCode) &&
          (!error.inventoryLocation || entry.inventoryLocation === error.inventoryLocation)
        ) || stockChangeReview.entries[0];
        const target = {
          itemCode: error.itemCode || fallback.itemCode,
          warehouse: error.warehouse || fallback.warehouse,
          inventoryLocation: error.inventoryLocation || fallback.inventoryLocation,
        };
        try {
          const latest = await getPcountItemBaseline(reconciliationCode, target.itemCode, target.warehouse, target.inventoryLocation, fallback.lotNo || "");
          const refreshedEntries = refreshPcountExpectedErpQuantity(stockChangeReview.entries, target, latest.currentErpQuantity);
          const refreshedTarget = refreshedEntries.find((entry) =>
            entry.itemCode === target.itemCode && entry.warehouse === target.warehouse && entry.inventoryLocation === target.inventoryLocation
          ) || fallback;
          markPcountBaselineRefreshRequired(employee.id, reconciliationCode, target, "Baseline refresh required. Review before resubmitting.");
          setStockChangeReview({
            previousErpQuantity: Number.isFinite(error.expectedErpQuantity)
              ? error.expectedErpQuantity
              : fallback.expectedERPQuantity || 0,
            currentErpQuantity: latest.currentErpQuantity,
            ...target,
            uom: refreshedTarget.uom,
            physicalCount: refreshedTarget.physicalCount,
            entries: refreshedEntries,
            sourceFingerprint: stockChangeReview.sourceFingerprint,
          });
          showToast("warning", PCOUNT_BLIND_CONFLICT_NOTICE);
        } catch (refreshError) {
          markPcountBaselineRefreshRequired(employee.id, reconciliationCode, target);
          showToast("warning", isNetworkFailure(refreshError)
            ? "Baseline refresh required. Connect to ERP before resubmitting."
            : refreshError instanceof Error ? refreshError.message : "Unable to refresh the ERP baseline.");
        }
      } else if (/transaction.*already.*submitted|already.*transaction/i.test(error instanceof Error ? error.message : String(error))) {
        showToast("error", "A scan transaction may already be submitted. Automatic retry stopped; review the audit history.");
      } else {
        showToast(isNetworkFailure(error) ? "warning" : "error", error instanceof Error ? error.message : "Resubmission failed.");
      }
    } finally {
      setIsSubmitting(false);
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          refocusPhysicalCountScanner();
        }, 0);
      });
    }
  }, [employee.id, focusScanner, handlePcountNotOpen, isSubmitting, pcountSession?.locationMode, reconciliationCode, reconciliationWarehouse, refocusPhysicalCountScanner, showToast, stockChangeReview]);

  React.useEffect(() => {
    if (!reconciliationCode) {
      setHasQueuedSubmission(false);
      return;
    }
    setHasQueuedSubmission(Boolean(loadPendingPcountSubmission(employee.id, reconciliationCode)));
  }, [employee.id, reconciliationCode]);

  React.useEffect(() => {
    const handleOffline = () => setIsOffline(true);
    const handleOnline = async () => {
      // Android/WebView reports an online interface even when ERPNext is down.
      // Do not clear a failed-ERP-request status until ERP responds successfully.
      if (reconciliationCode) {
        try {
          const context = await getReconciliationContext(reconciliationCode);
          restorePcountToLastActivity(employee.id, context.reconciliationId);
          saveReconciliationContextOffline(context);
          setIsOffline(false);
        } catch (error) {
          if (error instanceof PcountNotOpenError) {
            handlePcountNotOpen(reconciliationCode);
            return;
          }
          if (isNetworkFailure(error)) {
            setIsOffline(true);
            return;
          }
          // Auth/business errors are separate from transport reachability.
          setIsOffline(false);
        }
      } else {
        setIsOffline(false);
      }
      if (reconciliationCode && loadPendingPcountSubmission(employee.id, reconciliationCode)) {
        const requiresBaselineReview = loadLocalScanEntries(employee.id).some((entry) =>
          entry.reconciliationCode === reconciliationCode &&
          entry.syncConflict?.startsWith("Baseline refresh required")
        );
        if (requiresBaselineReview) {
          showToast("warning", "Connection restored. Review and refresh the changed ERP baseline before resubmitting.");
          return;
        }
        showToast("success", "Connection restored. Syncing the queued count with ERP...");
        window.setTimeout(() => void handleSubmitToErp(), 0);
      }
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [employee.id, handlePcountNotOpen, handleSubmitToErp, reconciliationCode, showToast]);

  React.useEffect(() => {
    if (mode !== "pcount" || !reconciliationCode || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      return;
    }

    const refreshAvailability = async () => {
      try {
        const context = await getReconciliationContext(reconciliationCode);
        restorePcountToLastActivity(employee.id, context.reconciliationId);
        saveReconciliationContextOffline(context);
        // A successful ERP request clears a failed-request indicator even when
        // Android never emitted an 'online' event after network restoration.
        setIsOffline(false);
      } catch (error) {
        if (error instanceof PcountNotOpenError) {
          handlePcountNotOpen(reconciliationCode);
        } else if (isNetworkFailure(error)) {
          setIsOffline(true);
        }
      }
    };

    void refreshAvailability();
    let nativeListener: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void refreshAvailability();
    }).then((listener) => {
      nativeListener = listener;
    });
    const handleVisible = () => {
      if (document.visibilityState === "visible") void refreshAvailability();
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      void nativeListener?.remove();
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [employee.id, handlePcountNotOpen, mode, reconciliationCode]);

  React.useEffect(() => {
    if (isScanSessionActive && step === "item" && !manualItemOpen && !isResolvingLocation && !selectedItemDetails && !showSubmitConfirm && !showFinishLocationConfirm && !pendingExistingLocation) {
      focusScanner();
    }
  }, [focusScanner, isResolvingLocation, isScanSessionActive, pendingExistingLocation, scanActionMode, selectedItemDetails, showFinishLocationConfirm, showSubmitConfirm, step, toast]);

  React.useEffect(() => {
    const restoreFocus = () => {
      if (!selectedItemDetails && !showSubmitConfirm && !showFinishLocationConfirm && !pendingExistingLocation) focusScanner();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") restoreFocus();
    };
    window.addEventListener("focus", restoreFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", restoreFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [focusScanner, pendingExistingLocation, selectedItemDetails, showFinishLocationConfirm, showSubmitConfirm]);

  React.useEffect(() => {
    setMode(initialMode);
    const persistedSession = initialMode === "pcount" ? loadPcountSession(employee.id) : null;
    const savedPhysicalCountEntries = persistedSession
      ? loadLocalScanEntries(employee.id).filter((entry) =>
          entry.mode === "pcount" &&
          entry.reconciliationCode.trim().toLocaleLowerCase() === persistedSession.reconciliationCode.trim().toLocaleLowerCase()
        )
      : [];
    // Heal sessions already affected by the old Remove Selected bug, on
    // normal app startup and Resume Work. Keep any location with local rows
    // (including submitted audit) and all current in-progress locations.
    const repaired = persistedSession
      ? restoreEmptyCompletedPcountLocations(persistedSession, savedPhysicalCountEntries, new Date().toISOString())
      : null;
    const savedSession = repaired?.session || persistedSession;
    if (savedSession && repaired?.releasedLocationIds.length) {
      savePcountSession(employee.id, savedSession);
      const previousSetup = loadLastScanSetup(employee.id, "pcount");
      if (previousSetup &&
          previousSetup.reconciliationCode.trim().toLocaleLowerCase() === savedSession.reconciliationCode.trim().toLocaleLowerCase() &&
          repaired.releasedLocationIds.includes((previousSetup.bin.locationId || "").trim().toLocaleLowerCase())) {
        clearPcountLastScanSetup(employee.id, savedSession.reconciliationCode);
      }
    }
    const activeLocation = savedSession?.locations.find(
      (location) => location.bin.locationId === savedSession.activeLocationId
    );
    const restoredGroupLocations = getActivePcountGroupLocations(savedSession?.locations || [], savedSession?.activeGroupId || "");
    const restoredState = savedSession ? getPcountSessionRestoreState(savedSession) : null;
    const isPhysicalCountResume = initialMode === "pcount" && resumePhysicalCount && Boolean(savedSession);
    // Next Location intentionally clears the active location/group. Pending
    // entries from the completed location must not be restored as the scan
    // target, or the next Storage Location QR is parsed as an item QR.
    const resumeBin = restoredState?.currentBin || null;
    const resumeToScanItems = isPhysicalCountResume && Boolean(resumeBin && restoredState?.step === "item");
    setPcountSession(savedSession);
    setStep(isPhysicalCountResume ? (resumeToScanItems ? "item" : "bin") : (restoredState?.step || "reconciliation"));
    setReconciliationCode(savedSession?.reconciliationCode || "");
    setReconciliationWarehouse(savedSession?.reconciliationWarehouse || "");
    setCurrentBin(isPhysicalCountResume ? resumeBin : (restoredState?.currentBin || null));
    setPendingItem(null);
    setScanValue("");
    setQtyDefaultActive(false);
    // Resume Work keeps the scanner ready even when Next Location already cleared the prior location.
    setIsScanSessionActive(isPhysicalCountResume ? true : (restoredState?.isScanSessionActive || false));
    setLastScanFeedback(null);
    setQueuedScans([]);
    scannerBufferRef.current = "";
    setEntries(savedPhysicalCountEntries);
    setMessage(savedSession
      ? isPhysicalCountResume && resumeToScanItems && resumeBin
        ? `${resumeBin.locationCode || resumeBin.locationId} restored. Continue reviewing or scanning unsubmitted items.`
        : savedSession.locationMode === "multi" && restoredGroupLocations.length > 0 && !savedSession.activeLocationId
        ? `${restoredGroupLocations.length} locations restored. Continue to Items when ready.`
        : activeLocation
        ? `${activeLocation.bin.locationCode || activeLocation.bin.locationId} restored. Continue scanning items.`
        : "Scan a Storage Location before scanning items."
      : `${modeLabels[initialMode]} selected. Scan the reconciliation QR first.`);
    setLastSetup(loadLastScanSetup(employee.id, initialMode));
  }, [employee.id, initialMode, resumePhysicalCount, sessionKey]);

  React.useEffect(() => {
    if (step === "qty" || (step === "item" && !isScanSessionActive)) {
      return;
    }

    focusScanner();
  }, [focusScanner, isScanSessionActive, mode, step]);

  const scanAnotherBin = () => {
    setStep("bin");
    setCurrentBin(null);
    setPendingItem(null);
    setScanValue("");
    setQtyDefaultActive(false);
    setIsScanSessionActive(false);
    setLastScanFeedback(null);
    setQueuedScans([]);
    scannerBufferRef.current = "";
    setMessage("Scan the next storage location QR.");
  };

  const scanAnotherReconciliation = () => {
    clearPcountSession(employee.id);
    setPcountSession(null);
    setStep("reconciliation");
    setReconciliationCode("");
    setReconciliationWarehouse("");
    setCurrentBin(null);
    setPendingItem(null);
    setScanValue("");
    setQtyDefaultActive(false);
    setIsScanSessionActive(false);
    setLastScanFeedback(null);
    setQueuedScans([]);
    scannerBufferRef.current = "";
    setMessage("Scan the reconciliation QR.");
  };

  const completeActiveLocationGroup = () => {
    if (effectiveLocationMode === "single" && !currentBin?.locationId) return;
    const now = new Date().toISOString();
    updatePcountSession((current) => {
      if (!current) return current;
      const completed = completePcountLocationMode(current);
      const activeMode = current.activeLocationMode || current.locationMode;
      const activeLocationIds = new Set(
        current.locations
          .filter((location) =>
            activeMode === "multi"
              ? location.groupId === current.activeGroupId && location.status === "in_progress"
              : location.bin.locationId === currentBin?.locationId
          )
          .map((location) => String(location.bin.locationId || "").trim().toLocaleUpperCase())
      );
      const scannedLocationIds = new Set(
        loadLocalScanEntries(employee.id)
          .filter((entry) => entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode)
          .filter((entry) => (entry.scanTransactions || []).some((transaction) =>
            transaction.action === "ADD" || transaction.action === "DEDUCT"
          ))
          .map((entry) => String(entry.bin.locationId || "").trim().toLocaleUpperCase())
      );

      return {
        ...completed,
        locations: current.locations.flatMap((location) => {
          const locationId = String(location.bin.locationId || "").trim().toLocaleUpperCase();
          if (!activeLocationIds.has(locationId)) return [location];

          // Next Location must not mark an empty location as counted. Remove it
          // from the session so scanning the same location again is allowed.
          if (!scannedLocationIds.has(locationId)) return [];

          return [{
            ...location,
            status: "completed" as const,
            completedAt: now,
            lastScanTime: location.lastScanTime || now,
          }];
        }),
        updatedAt: now,
      };
    });
    // Start the next-location cycle from a clean transient scanner state. The
    // completed session keeps its reference and completed locations, while
    // completePcountLocationMode clears the old active group/location so the
    // next scan cannot accidentally reuse them. The next cycle will lock to
    // pcountSession.locationMode when its first location is scanned.
    const nextMode = "multi";
    setShowFinishLocationConfirm(false);
    setShowCountedLocations(false);
    setPendingExistingLocation(null);
    setSelectedItemDetails(null);
    setCurrentBin(null);
    setPendingItem(null);
    setStep("bin");
    setIsScanSessionActive(true);
    setScanActionMode("ADD");
    setLastScanFeedback(null);
    setQueuedScans([]);
    setQtyDefaultActive(false);
    setScanValue("");
    scannerBufferRef.current = "";
    setMessage("Location count completed. Scan one or more Storage Locations, then scan an Item.");
    focusScanner();
  };

  const reopenLocation = (locationId: string, fallbackBin?: BinLocation) => {
    const savedLocation = pcountSession?.locations.find((candidate) => candidate.bin.locationId === locationId);
    const bin = savedLocation?.bin || fallbackBin;
    if (!bin) return;
    const now = new Date().toISOString();
    const recountGroupId = `recount-${Date.now()}`;
    updatePcountSession((current) => {
      if (!current) return current;
      // The previously active location may have finished counting but still
      // be flagged in_progress. Complete it when actual scans exist, leaving
      // any genuinely empty location unfinished for explicit operator review.
      const reconciled = completeCountedInactiveRecountLocations(
        current, loadLocalScanEntries(employee.id), locationId, now
      );
      const existingLocation = reconciled.locations.find((candidate) => candidate.bin.locationId === locationId);
      return {
        ...reconciled,
        // Recount remains available for a location that was already submitted
        // to ERP. Local/unsubmitted mistakes are corrected from Scan Details
        // with the pencil editor instead of creating a second scan transaction.
        locationMode: "single",
        activeLocationMode: "single",
        activeGroupId: recountGroupId,
        activeLocationId: locationId,
        locations: existingLocation
          ? reconciled.locations.map((candidate) => candidate.bin.locationId === locationId
              ? { ...candidate, bin, groupId: recountGroupId, status: "in_progress", completedAt: undefined }
              : candidate)
          : [...reconciled.locations, { bin, groupId: recountGroupId, status: "in_progress", lastScanTime: now }],
        updatedAt: now,
      };
    });
    setCurrentBin(bin);
    setPendingItem(null);
    setStep("item");
    setIsScanSessionActive(true);
    setScanActionMode("ADD");
    setLastScanFeedback(null);
    setScanValue("");
    scannerBufferRef.current = "";
    setMessage(`${bin.locationCode || locationId} reopened for recount. Submitted counts can be corrected here; local/unsubmitted scans should be edited with the pencil in Items.`);
    refocusPhysicalCountScanner();
  };

  const selectPhysicalCountLocation = React.useCallback((bin: BinLocation, requiredWarehouse: string) => {
    const now = new Date().toISOString();
    if (effectiveLocationMode === "multi") {
      const activeGroupId = pcountSession?.activeGroupId || `group-${Date.now()}`;
      const base: LocalPcountSession = pcountSession && pcountSession.reconciliationCode === reconciliationCode
        ? { ...lockPcountLocationMode(pcountSession, "multi"), activeGroupId }
        : {
            reconciliationCode,
            reconciliationWarehouse: requiredWarehouse,
            locationMode: "multi",
            activeLocationMode: "multi",
            activeGroupId,
            activeLocationId: "",
            locations: [],
            updatedAt: now,
            validationStatus: "pending",
          };
      const result = addPcountLocationToSession(base, bin, requiredWarehouse, now);
      updatePcountSession(() => result.session);
      setCurrentBin(null);
      setPendingItem(null);
      setStep("bin");
      setQtyDefaultActive(false);
      const locationLabel = bin.locationCode || bin.locationId;
      const duplicateMessage = result.reason === "already_counted"
        ? `${locationLabel} was already counted in this Physical Count.`
        : `${locationLabel} is already selected.`;
      setMessage(result.added
        ? `${locationLabel} selected. Scan another location or scan an Item to begin counting.`
        : duplicateMessage);
      if (!result.added) showToast("warning", duplicateMessage);
      refocusPhysicalCountScanner();
      return;
    }
    updatePcountSession((current) => {
      const base = current && current.reconciliationCode === reconciliationCode
        ? lockPcountLocationMode(current, "single")
        : {
            reconciliationCode,
            reconciliationWarehouse: requiredWarehouse,
            locationMode: "single" as const,
            activeLocationMode: "single" as const,
            activeGroupId: "",
            activeLocationId: "",
            locations: [],
            updatedAt: now,
            validationStatus: "pending" as const,
          };
      const existingLocation = base.locations.find((location) => location.bin.locationId === bin.locationId);
      return {
        ...base,
        reconciliationWarehouse: base.reconciliationWarehouse || requiredWarehouse,
        activeLocationId: bin.locationId || "",
        locations: existingLocation
          ? base.locations.map((location) => location.bin.locationId === bin.locationId
              ? { ...location, bin, status: "in_progress" as const, completedAt: undefined }
              : location)
          : [...base.locations, { bin, status: "in_progress" as const, lastScanTime: now }],
        updatedAt: now,
      };
    });
    setCurrentBin(bin);
    rememberSetup(bin, reconciliationCode, requiredWarehouse);
    setPendingItem(null);
    setStep("item");
    setQtyDefaultActive(false);
    setMessage(isScanSessionActive
      ? `${bin.locationCode || bin.locationId} selected. Scan items at this location.`
      : `${bin.locationType ? `${bin.locationType} ` : "Location "}${bin.bin} selected. Review the setup, then press Start Scanning.`);
  }, [effectiveLocationMode, isScanSessionActive, pcountSession, reconciliationCode, refocusPhysicalCountScanner, rememberSetup, showToast, updatePcountSession]);

  const continueMultiLocationItems = () => {
    const firstLocation = activeGroupLocations[0];
    if (!firstLocation) return;
    updatePcountSession((current) => current ? {
      ...current,
      activeLocationMode: "multi",
      activeLocationId: firstLocation.bin.locationId || "",
      updatedAt: new Date().toISOString(),
    } : current);
    setCurrentBin(firstLocation.bin);
    setStep("item");
    setIsScanSessionActive(true);
    setMessage(activeGroupLocations.length > 1
      ? `${activeGroupLocations.length} locations active. Quantity applies to all selected locations.`
      : `${firstLocation.bin.locationCode || firstLocation.bin.locationId} active. Continue scanning items.`);
    focusScanner();
  };

  const cancelLocationLongPress = () => {
    if (locationLongPressRef.current !== null) {
      window.clearTimeout(locationLongPressRef.current);
      locationLongPressRef.current = null;
    }
  };

  const requestRemoveMultiLocation = (locationId: string, label: string) => {
    cancelLocationLongPress();
    if (!locationId) return;
    setLocationToRemove({ id: locationId, label });
  };

  const startLocationLongPress = (locationId: string, label: string) => {
    cancelLocationLongPress();
    locationLongPressRef.current = window.setTimeout(() => {
      locationLongPressRef.current = null;
      requestRemoveMultiLocation(locationId, label);
      if (navigator.vibrate) navigator.vibrate(30);
    }, 550);
  };

  const removeMultiLocation = (locationId: string) => {
    if (isSubmitting || isPreparingSubmission) {
      showToast("warning", "Wait until the current submission finishes before removing a location.");
      return;
    }
    const selected = pcountSession?.locations.find((location) =>
      String(location.bin.locationId || "").trim().toUpperCase() === locationId.trim().toUpperCase()
    );
    if (!selected) {
      setLocationToRemove(null);
      showToast("warning", "This location is not in the selected Physical Count locations.");
      return;
    }
    // A completed badge is a local workflow state, not necessarily an ERP
    // submission. Confirmed ERP history is protected by the discard helper.
    const matchesLocation = (entry: LocalScanEntry) =>
      entry.mode === "pcount" &&
      entry.reconciliationCode.trim().toUpperCase() === reconciliationCode.trim().toUpperCase() &&
      String(entry.bin.locationId || "").trim().toUpperCase() === locationId.trim().toUpperCase();
    const all = loadLocalScanEntries(employee.id);
    const locationEntries = all.filter(matchesLocation);
    // Confirmed ERP records must remain in the audit trail, but unsubmitted
    // item quantities AND Inventory Tags for this accidentally selected
    // location must be removed from the next ERP submission.
    const cleaned = discardPendingPcountLocationCounts(all, reconciliationCode, locationId);
    if (locationEntries.length > 0) {
      try {
        saveLocalScanEntries(employee.id, cleaned.entries);
      } catch (error) {
        showToast("error", error instanceof Error ? error.message : "Unable to save the corrected local count.");
        return;
      }
      setEntries(cleaned.entries.filter((entry) =>
        entry.mode === "pcount" && entry.reconciliationCode.trim().toUpperCase() === reconciliationCode.trim().toUpperCase()
      ));
      activeInventoryTagsRef.current = {};
      setNewInventoryTagForItem(null);
      setSelectedItemDetails(null);
    }
    // Always invalidate a staged payload, even if the removed location had
    // zero saved rows. It must never be retried after the selection changes.
    clearPendingPcountSubmission(employee.id, reconciliationCode);
    submitAttemptRef.current = null;
    setHasQueuedSubmission(false);
    setStockChangeReview(null);
    setLastScanFeedback(null);
    const remainingActive = activeGroupLocations.filter((location) =>
      String(location.bin.locationId || "").trim().toUpperCase() !== locationId.trim().toUpperCase()
    );
    updatePcountSession((current) => {
      if (!current) return current;
      const next = removePcountLocationFromSession(current, locationId);
      const removedActiveId = String(current.activeLocationId || "").trim().toUpperCase() === locationId.trim().toUpperCase();
      return removedActiveId && remainingActive.length > 0
        ? { ...next, activeLocationId: remainingActive[0].bin.locationId || "" }
        : next;
    });
    setLocationToRemove(null);
    const removedCurrent = String(currentBin?.locationId || "").trim().toUpperCase() === locationId.trim().toUpperCase();
    if (removedCurrent) {
      setCurrentBin(remainingActive[0]?.bin || null);
      setPendingItem(null);
      setInventoryTag("");
      setScanValue("");
      scannerBufferRef.current = "";
    }
    if (remainingActive.length === 0 && removedCurrent) {
      setStep("bin");
      setMessage("Location removed. Scan the next Storage Location QR.");
    } else {
      setMessage("Location removed from the active selection. Continue scanning.");
    }
    if (cleaned.discarded > 0) {
      showToast("success", `Location removed. Discarded unsubmitted scans for ${selected.bin.locationCode || selected.bin.locationId}; they will not be sent to ERP.`);
    } else if (cleaned.preservedSubmitted > 0) {
      showToast("warning", "Location removed from active scanning. Only previously ERP-submitted history remains.");
    }
    refocusPhysicalCountScanner();
  };

  const startScanning = async () => {
    if (!reconciliationCode || !currentBin || step !== "item" || isSyncing) return;

    setIsSyncing(true);
    setToast(null);
    setLastScanFeedback(null);
    setMessage("Starting blind physical count...");
    try {
      // Blind count: never load or display ERP on-hand quantities. Existing
      // pending operator scans remain visible; ERP baselines are fetched
      // silently per unknown Item + Location when the barcode is scanned.
      const loadedEntries = loadPendingLocalScanEntries(employee.id).filter(
        (entry) => entry.mode === mode && entry.reconciliationCode === reconciliationCode
      );
      setEntries(loadedEntries);
      setSelectedItemDetails(null);
      setQueuedScans([]);
      setIsScanSessionActive(true);
      setScanActionMode("ADD");
      setScanValue("");
      scannerBufferRef.current = "";
      setMessage("Scanner ready. Blind count active—scan item barcodes.");
      window.requestAnimationFrame(() => {
        scanSessionTopRef.current?.scrollIntoView({ block: "start" });
        focusScanner();
      });
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Unable to start the blind count.");
      setMessage("Could not start scanning. Try Start Scanning again.");
    } finally {
      setIsSyncing(false);
    }
  };

  const returnToSetup = React.useCallback(() => {
    setIsScanSessionActive(false);
    setQueuedScans([]);
    setScanValue("");
    scannerBufferRef.current = "";
    setMessage("Scanning paused. Review the setup or change the location.");
  }, []);

  React.useEffect(() => {
    let listener: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;
    let cancelled = false;
    void CapacitorApp.addListener("backButton", () => {
      if (manualPackItem) {
        setManualPackItem(null);
        setManualCatalogError("");
        setManualItemOpen(true);
        return;
      }
      if (manualItemOpen) {
        setManualItemOpen(false);
        setManualItemQuery("");
        refocusPhysicalCountScanner();
        return;
      }
      if (pendingExistingLocation) {
        setPendingExistingLocation(null);
        setMessage("Scan another Storage Location.");
        focusScanner();
        return;
      }
      if (showFinishLocationConfirm) {
        setShowFinishLocationConfirm(false);
        return;
      }
      if (showSubmitConfirm) {
        setShowSubmitConfirm(false);
        return;
      }
      if (selectedItemDetails) {
        setSelectedItemDetails(null);
        return;
      }
      if (showScannedItems) {
        setShowScannedItems(false);
        setRemoveSelectionMode(false);
        setRemoveSelectedKeys(new Set());
        refocusPhysicalCountScanner();
        return;
      }
      if (isScanSessionActive) {
        returnToSetup();
        return;
      }
      onBack();
    }).then((handle) => {
      if (cancelled) {
        void handle.remove();
        return;
      }
      listener = handle;
    });

    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, [focusScanner, isScanSessionActive, manualItemOpen, manualPackItem, onBack, pendingExistingLocation, refocusPhysicalCountScanner, returnToSetup, selectedItemDetails, showFinishLocationConfirm, showSubmitConfirm, showScannedItems]);

  const getRecountInventoryTags = React.useCallback((itemCode: string, locationId: string) => {
    const tags = new Map<string, string>();
    let hasHistoricalBlankTag = false;
    const wantedItem = itemCode.trim().toLocaleUpperCase();
    const wantedLocation = locationId.trim().toLocaleUpperCase();

    for (const entry of loadLocalScanEntries(employee.id)) {
      if (entry.mode !== "pcount" || entry.reconciliationCode !== reconciliationCode) continue;
      if (entry.itemCode.trim().toLocaleUpperCase() !== wantedItem) continue;

      const transactions = entry.scanTransactions || [];
      const entryLocation = String(entry.bin.locationId || "").trim().toLocaleUpperCase();
      const entryMatchesLocation = entryLocation === wantedLocation;

      // A submitted recount must be able to recover the original tag even when
      // the entry-level location metadata was refreshed/merged after ERP sync.
      // Transaction.locationId is the immutable scan-time location, so use it
      // as an additional authoritative match instead of rejecting the entry
      // before its submitted transactions are inspected.
      const matchingTransactions = transactions.filter((transaction) => {
        const transactionLocation = String(transaction.locationId || entry.bin.locationId || "")
          .trim()
          .toLocaleUpperCase();
        return transactionLocation === wantedLocation;
      });

      if (
        entryMatchesLocation &&
        matchingTransactions.length === 0 &&
        transactions.length === 0 &&
        (entry.quantity || entry.submittedPhysicalCount || entry.submittedQuantity)
      ) {
        hasHistoricalBlankTag = true;
      }

      for (const transaction of matchingTransactions) {
        const tag = String(transaction.inventoryTag || "").trim();
        if (!tag) {
          hasHistoricalBlankTag = true;
          continue;
        }
        tags.set(tag.toLocaleUpperCase(), tag);
      }

      // Compatibility for older locally-saved rows whose scan transactions did
      // not persist locationId but whose entry itself is the recounted location.
      if (entryMatchesLocation && matchingTransactions.length === 0) {
        for (const transaction of transactions) {
          if (String(transaction.locationId || "").trim()) continue;
          const tag = String(transaction.inventoryTag || "").trim();
          if (!tag) {
            hasHistoricalBlankTag = true;
            continue;
          }
          tags.set(tag.toLocaleUpperCase(), tag);
        }
      }
    }

    const values = Array.from(tags.values());
    if (hasHistoricalBlankTag) values.push("");
    return values;
  }, [employee.id, reconciliationCode]);

  const processScan = React.useCallback(
    async (rawCode: string, packageBreakdown?: { bigPackCount: number; loosePackQuantity: number }) => {
      if (pendingExistingLocation) {
        return;
      }
      if (resolvingLocationRef.current) {
        return;
      }

      if (isAllocating) {
        const queuedCode = rawCode.trim();
        if (queuedCode) {
          setQueuedScans((current) => [...current, queuedCode].slice(-20));
        }
        return;
      }

      const code = rawCode.trim();
      if (!code) return;

      if (step === "reconciliation") {
        if (parseStorageLocationQr(code) || parseItem(code)) {
          setMessage("Scan the reconciliation QR first. Location and item QR codes are not accepted yet.");
          setScanValue("");
          setQtyDefaultActive(false);
          refocusPhysicalCountScanner();
          return;
        }

        setMessage("Checking reconciliation and warehouse...");
        setScanValue("");
        setQtyDefaultActive(false);

        let context: Awaited<ReturnType<typeof getReconciliationContext>>;
        let contextValidation: "validated" | "pending" = "validated";
        try {
          context = await getReconciliationContext(code);
          restorePcountToLastActivity(employee.id, context.reconciliationId);
          saveReconciliationContextOffline(context);
          setIsOffline(false);
        } catch (error) {
          if (error instanceof PcountNotOpenError) {
            handlePcountNotOpen(code);
            return;
          }
          if (!isNetworkFailure(error) || !isPossibleReconciliationCode(code)) {
            setReconciliationCode("");
            setReconciliationWarehouse("");
            setMessage(error instanceof Error ? error.message : "Unable to validate reconciliation.");
            return;
          }
          const cached = loadReconciliationContextOffline(code);
          context = cached || { reconciliationId: code, warehouse: "", purpose: "" };
          contextValidation = cached ? "validated" : "pending";
          setIsOffline(true);
          showToast("warning", cached
            ? "ERP is offline. Using the previously validated reconciliation setup."
            : "ERP is offline. The reconciliation will be validated before submission.");
        }

        setReconciliationCode(context.reconciliationId);
        if (
          reconciliationWarehouse &&
          normalizeWarehouse(reconciliationWarehouse) !== normalizeWarehouse(context.warehouse)
        ) {
          clearStorageLocationCache();
        }
        setReconciliationWarehouse(context.warehouse);
        const newSession: LocalPcountSession = {
          reconciliationCode: context.reconciliationId,
          reconciliationWarehouse: context.warehouse,
          // Physical Count now starts in automatic location-selection mode.
          // One selected location becomes Single when the first item is scanned;
          // two or more selected locations become Multi.
          locationMode: "multi",
          activeGroupId: `group-${Date.now()}`,
          activeLocationId: "",
          locations: [],
          updatedAt: new Date().toISOString(),
          validationStatus: contextValidation,
        };
        setPcountSession(newSession);
        savePcountSession(employee.id, newSession);
        setCurrentBin(null);
        setPendingItem(null);
        setEntries(
          loadLocalScanEntries(employee.id).filter(
            (entry) => entry.mode === mode && entry.reconciliationCode === context.reconciliationId
          )
        );
        setStep("bin");
        setScanValue("");
        setQtyDefaultActive(false);
        scannerBufferRef.current = "";
        setMessage(context.warehouse
          ? `Reconciliation selected. Required warehouse: ${context.warehouse}. Scan its storage location QR.`
          : "Reconciliation saved offline. Scan the Storage Location QR; ERP validation will run before submission.");
        return;
      }

      if (step === "bin") {
        const scannedItemWhileSelectingMultiLocations = parseItem(code);
        if (scannedItemWhileSelectingMultiLocations && effectiveLocationMode === "multi" && activeGroupLocations.length > 0) {
          const firstLocation = activeGroupLocations[0];
          updatePcountSession((current) => current ? {
            ...current,
            // Location selection is an explicit Multi workflow. Keep it Multi
            // even when only one location is selected (for missed-location continuation).
            activeLocationMode: "multi",
            activeLocationId: firstLocation.bin.locationId || "",
            updatedAt: new Date().toISOString(),
          } : current);
          setCurrentBin(firstLocation.bin);
          setStep("item");
          setIsScanSessionActive(true);
          setQueuedScans((current) => [...current, code]);
          setScanValue("");
          setQtyDefaultActive(false);
          scannerBufferRef.current = "";
          setMessage(activeGroupLocations.length > 1
            ? `${activeGroupLocations.length} locations active. Quantity applies to all selected locations.`
            : `${firstLocation.bin.locationCode || firstLocation.bin.locationId} active. Continue scanning items.`);
          refocusPhysicalCountScanner();
          return;
        }
        if (scannedItemWhileSelectingMultiLocations) {
          setMessage("Scan a Storage Location before scanning items.");
          setScanValue("");
          refocusPhysicalCountScanner();
          return;
        }
        let qr: StorageLocationQr;
        try {
          qr = requireStorageLocationQr(code);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Invalid Storage Location QR.");
          setScanValue("");
          refocusPhysicalCountScanner();
          return;
        }

        resolvingLocationRef.current = true;
        setIsResolvingLocation(true);
        setMessage("Checking location…");
        setScanValue("");
        scannerBufferRef.current = "";
        try {
          let bin: BinLocation;
          try {
            const resolved = await resolveStorageLocationQr(qr);
            if (resolved.isGroup || resolved.locationType.trim().toLocaleLowerCase() === "building") {
              throw new Error(`Storage Location ${resolved.inventoryLocationId} is a group. Scan a leaf counting location.`);
            }
            bin = toCanonicalBin(qr, resolved);
            setIsOffline(false);
          } catch (error) {
            if (!isNetworkFailure(error)) throw error;
            if (qr.isGroup || qr.locationType.trim().toLocaleLowerCase() === "building") {
              throw new Error(`Storage Location ${qr.locationId} is a group. Scan a leaf counting location.`);
            }
            bin = toOfflineBin(qr);
            setIsOffline(true);
            showToast("warning", `${qr.locationId} saved offline. ERP will validate it before submission.`);
          }

          const requiredWarehouse = reconciliationWarehouse || bin.warehouse;
          if (normalizeWarehouse(bin.warehouse) !== normalizeWarehouse(requiredWarehouse)) {
            throw new Error(
              `Wrong warehouse. This location belongs to ${bin.warehouse}; ` +
              `the reconciliation requires ${requiredWarehouse}.`
            );
          }
          if (!reconciliationWarehouse) setReconciliationWarehouse(requiredWarehouse);
          if (hasExistingLocationCount(loadLocalScanEntries(employee.id), reconciliationCode, bin.locationId)) {
            setPendingExistingLocation({ bin, requiredWarehouse });
            setMessage("Existing count found. Confirm whether to continue this location.");
            refocusPhysicalCountScanner();
            return;
          }
          if (effectiveLocationMode === "multi" && activeGroupLocations.length === 1) {
            const fromBin = activeGroupLocations[0].bin;
            const rangeIds = getBidirectionalStorageLocationRange(
              fromBin.locationId || "",
              bin.locationId || ""
            );

            if (rangeIds.length > 1) {
              setMessage(`Building From–To range: ${fromBin.locationCode || fromBin.locationId} → ${bin.locationCode || bin.locationId}…`);
              setLoadingOperation({
                kind: "locations",
                title: "Loading locations",
                detail: `Checking ${rangeIds.length} locations from ${rangeIds[0]} to ${rangeIds.at(-1)}…`,
              });
              let nextSession = pcountSession;
              const activeGroupId = pcountSession?.activeGroupId || `group-${Date.now()}`;
              if (!nextSession) throw new Error("Physical Count session is not available.");

              for (const locationId of rangeIds.slice(1)) {
                let rangeBin: BinLocation;
                if (locationId.toLocaleUpperCase() === String(bin.locationId || "").trim().toLocaleUpperCase()) {
                  rangeBin = bin;
                } else {
                  const rangeQr: StorageLocationQr = {
                    ...qr,
                    rawBarcode: qr.rawBarcode,
                    locationId,
                    locationCode: locationId,
                    locationName: locationId,
                    locationPath: "",
                    itemCode: "",
                    storageCapacity: 0,
                    isGroup: false,
                  };
                  try {
                    const resolvedRangeLocation = await resolveStorageLocationQr(rangeQr);
                    if (resolvedRangeLocation.isGroup || resolvedRangeLocation.locationType.trim().toLocaleLowerCase() === "building") {
                      throw new Error(`Storage Location ${locationId} is not a leaf counting location.`);
                    }
                    rangeBin = toCanonicalBin(rangeQr, resolvedRangeLocation);
                  } catch (rangeError) {
                    if (!isNetworkFailure(rangeError)) throw rangeError;
                    // Physical Count is offline-capable. Intermediate From–To
                    // locations have no QR of their own, so derive their local
                    // identity from the validated/scanned endpoint metadata and
                    // defer authoritative ERP validation until submission.
                    rangeBin = toOfflineBin(rangeQr);
                    setIsOffline(true);
                  }
                }

                if (normalizeWarehouse(rangeBin.warehouse) !== normalizeWarehouse(requiredWarehouse)) {
                  throw new Error(`Storage Location ${locationId} belongs to a different warehouse.`);
                }
                if (hasExistingLocationCount(loadLocalScanEntries(employee.id), reconciliationCode, rangeBin.locationId)) {
                  throw new Error(`Storage Location ${locationId} was already counted in this Physical Count.`);
                }

                const added = addPcountLocationToSession(
                  { ...lockPcountLocationMode(nextSession, "multi"), activeGroupId },
                  rangeBin,
                  requiredWarehouse,
                  new Date().toISOString()
                );
                if (!added.added && added.reason !== "already_selected") {
                  throw new Error(`Storage Location ${locationId} cannot be added to this From–To range.`);
                }
                nextSession = added.session;
              }

              updatePcountSession(() => nextSession);
              setLoadingOperation(null);
              setCurrentBin(null);
              setPendingItem(null);
              setStep("bin");
              setQtyDefaultActive(false);
              setMessage(`${rangeIds.length} locations selected: ${rangeIds[0]} → ${rangeIds.at(-1)}. Scan an Item or press Start Items.`);
              refocusPhysicalCountScanner();
              return;
            }
          }

          selectPhysicalCountLocation(bin, requiredWarehouse);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unable to validate this Storage Location.";
          if (errorMessage.startsWith("Wrong warehouse.")) {
            setMessage("");
            showToast("warning", errorMessage);
          } else {
            setMessage(errorMessage);
          }
          refocusPhysicalCountScanner();
        } finally {
          setLoadingOperation(null);
          resolvingLocationRef.current = false;
          setIsResolvingLocation(false);
        }
        return;
      }

      if (!reconciliationCode) {
        setStep("reconciliation");
        setCurrentBin(null);
        setPendingItem(null);
        setMessage("Scan the reconciliation QR first.");
        setScanValue("");
        setQtyDefaultActive(false);
        scannerBufferRef.current = "";
        refocusPhysicalCountScanner();
        return;
      }

      // Physical Count: a different Storage Location QR completes the previous
      // active location/group and starts the new location automatically.
      // Validate the incoming QR FIRST; never close a count for an invalid scan.
      const nextLocationQr = mode === "pcount" && step === "item" ? parseStorageLocationQr(code) : null;
      // A new valid Storage Location QR closes the current From-To group
      // locally and opens a NEW group for that location. Existing item scans
      // remain assigned to each prior location; no ERP submission occurs here.
      // Re-scanning a location already in the active group is a no-op below.
      if (nextLocationQr) {
        resolvingLocationRef.current = true;
        setIsResolvingLocation(true);
        setScanValue("");
        scannerBufferRef.current = "";
        try {
          let nextBin: BinLocation;
          try {
            const resolved = await resolveStorageLocationQr(nextLocationQr);
            if (resolved.isGroup || resolved.locationType.trim().toLowerCase() === "building") {
              throw new Error("Scan a leaf Storage Location, not a building/group.");
            }
            nextBin = toCanonicalBin(nextLocationQr, resolved);
            setIsOffline(false);
          } catch (error) {
            if (!isNetworkFailure(error)) throw error;
            if (nextLocationQr.isGroup || nextLocationQr.locationType.trim().toLowerCase() === "building") {
              throw new Error("Scan a leaf Storage Location, not a building/group.");
            }
            nextBin = toOfflineBin(nextLocationQr);
            setIsOffline(true);
          }

          const oldLocationIds = (effectiveLocationMode === "multi"
            ? activeGroupLocations.map((location) => location.bin.locationId || "")
            : [currentBin?.locationId || ""]).filter(Boolean);
          const sameActiveLocation = oldLocationIds.some((id) =>
            id.trim().toUpperCase() === nextBin.locationId.trim().toUpperCase()
          );
          if (sameActiveLocation) {
            setMessage(`${nextBin.locationCode || nextBin.locationId} is already active. Continue scanning items.`);
            return;
          }
          if (normalizeWarehouse(nextBin.warehouse) !== normalizeWarehouse(reconciliationWarehouse)) {
            throw new Error(`Wrong warehouse. ${nextBin.locationCode || nextBin.locationId} belongs to ${nextBin.warehouse}; expected ${reconciliationWarehouse}.`);
          }
          const saved = loadLocalScanEntries(employee.id);
          const alreadyCompleted = (pcountSession?.locations || []).some((location) =>
            String(location.bin.locationId || "").trim().toUpperCase() === nextBin.locationId.trim().toUpperCase() &&
            location.status === "completed"
          );
          if (alreadyCompleted || hasExistingLocationCount(saved, reconciliationCode, nextBin.locationId)) {
            setPendingExistingLocation({ bin: nextBin, requiredWarehouse: reconciliationWarehouse });
            setMessage("Location already counted. Use Recount Location to correct an existing count.");
            return;
          }

          const now = new Date().toISOString();
          const countedIds = new Set(saved.filter((entry) =>
            entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode &&
            (entry.scanTransactions || []).some((tx) => tx.action === "ADD" || tx.action === "DEDUCT")
          ).map((entry) => String(entry.bin.locationId || "").trim().toUpperCase()));

          updatePcountSession((current) => {
            if (!current) return current;
            const finished = completePcountLocationMode(current);
            const previousIds = new Set(oldLocationIds.map((id) => id.trim().toUpperCase()));
            const nextLocations = current.locations.flatMap((location) => {
              const id = String(location.bin.locationId || "").trim().toUpperCase();
              if (!previousIds.has(id) || location.status !== "in_progress") return [location];
              // An empty location is released, never counted without a scan.
              return countedIds.has(id)
                ? [{ ...location, status: "completed" as const, completedAt: now, lastScanTime: location.lastScanTime || now }]
                : [];
            });
            const nextGroup = `group-${Date.now()}`;
            const fresh = addPcountLocationToSession(
              { ...finished, locations: nextLocations, activeGroupId: nextGroup,
                activeLocationMode: "multi", activeLocationId: "", updatedAt: now },
              nextBin, reconciliationWarehouse, now
            );
            if (!fresh.added) return current;
            return { ...fresh.session, activeLocationMode: "multi",
              activeLocationId: nextBin.locationId || "", updatedAt: now };
          });
          setCurrentBin(nextBin);
          setPendingItem(null);
          setInventoryTag("");
          setRecountInventoryTags([]);
          setStep("item");
          setIsScanSessionActive(true);
          setScanActionMode("ADD");
          setLastScanFeedback(null);
          setQtyDefaultActive(false);
          setQueuedScans([]);
          setMessage(`${nextBin.locationCode || nextBin.locationId} detected. Previous location completed; scan items here.`);
          rememberSetup(nextBin, reconciliationCode, reconciliationWarehouse);
        } catch (error) {
          showToast("warning", error instanceof Error ? error.message : "Unable to change Storage Location.");
        } finally {
          resolvingLocationRef.current = false;
          setIsResolvingLocation(false);
          refocusPhysicalCountScanner();
        }
        return;
      }

      const activeScanBin = effectiveLocationMode === "multi" ? currentBin || activeGroupLocations[0]?.bin || null : currentBin;
      if (!activeScanBin) {
        setStep("bin");
        setPendingItem(null);
        setMessage("Scan the storage location QR first.");
        setScanValue("");
        setQtyDefaultActive(false);
        scannerBufferRef.current = "";
        refocusPhysicalCountScanner();
        return;
      }

      if (step === "qty") {
        if (!pendingItem) {
          setStep("item");
          setMessage("Scan item barcode first.");
          setScanValue("");
          setQtyDefaultActive(false);
          scannerBufferRef.current = "";
          refocusPhysicalCountScanner();
          return;
        }

        const recoverFromAutomaticQuantityError = () => {
          setQtyDefaultActive(false);
          if (!quantityPromptEnabled) {
            autoQuantityAttemptRef.current = "";
            setPendingItem(null);
            setStep("item");
            setScanValue("");
            scannerBufferRef.current = "";
          }
        };

        let packageQuantity: ReturnType<typeof calculatePhysicalPackage>;
        try {
          const normalizedQuantityInput = code.trim().replace(/,/g, "");
          packageQuantity = calculatePhysicalPackage({
            qrQuantity: pendingItem.qrQuantity,
            // A combined Big + Loose quantity is already in Stock UOM.
            // Treat it as an opened count even if the operator saved while
            // viewing Big Pack, to avoid multiplying the QR pack size twice.
            status: packageBreakdown && packageBreakdown.loosePackQuantity > 0 ? "OPENED" : packageStatus,
            input: normalizedQuantityInput,
          });
        } catch (error) {
          setMessage(error instanceof PackageQuantityError ? error.message : "Invalid quantity.");
          recoverFromAutomaticQuantityError();
          refocusPhysicalCountScanner();
          return;
        }

        const quantity = packageQuantity.quantity;
        const multiplier = "packageCount" in packageQuantity ? packageQuantity.packageCount : 1;
        const currentDeviceName = refreshDeviceName();

        if (!activeScanBin.locationId) {
          setMessage("The scanned Storage Location does not have a location ID.");
          recoverFromAutomaticQuantityError();
          refocusPhysicalCountScanner();
          return;
        }
        const locationLabel = activeScanBin.locationCode || activeScanBin.locationName || activeScanBin.locationPath || activeScanBin.bin;
        const baseEntry: LocalScanEntry = {
          raw: pendingItem.raw,
          mode,
          reconciliationCode,
          bin: activeScanBin,
          itemCode: pendingItem.itemCode,
          itemName: pendingItem.itemName || itemNameCacheRef.current.get(pendingItem.itemCode.trim().toLocaleUpperCase()),
          qrQuantity: pendingItem.qrQuantity,
          multiplier,
          quantity,
          uom: pendingItem.uom,
          barcodeUom: pendingItem.barcodeUom,
          authoritativeUom: pendingItem.authoritativeUom,
          lotNo: pendingItem.lotNo,
          timestamp: getTime(),
          deviceId: currentDeviceName,
        };
        const authoritativeEntries = loadLocalScanEntries(employee.id);
        const existing = authoritativeEntries.find((entry) => isSameLocalScanItem(entry, baseEntry));
        const currentQuantity = existing?.quantity || 0;
        const recounting = Boolean(pcountSession?.activeGroupId?.startsWith("recount-")) && recountInventoryTags.length > 0 && recountTagOperation === "existing";

        // A recount is a replacement physical count for the existing
        // Item + Location + Inventory Tag, not another ADD scan.
        //
        // Example:
        //   submitted A4 = 15,000
        //   recount A4   = 14,000
        //   transaction delta = -1,000 and final count = 14,000.
        //
        // Recount compares the operator's complete new physical quantity with
        // the latest effective count for this exact Inventory Tag. The helper
        // includes submitted corrections plus any still-pending local recount,
        // so repeated recounts use the latest result instead of the original
        // submitted quantity.
        let effectiveAction: "ADD" | "DEDUCT" = scanActionMode;
        let signedQuantity = getSignedPhysicalQuantity(quantity, scanActionMode);
        let recountPreviousQuantity: number | undefined;

        if (recounting) {
          if (!existing) {
            showToast("warning", "Unable to recover the existing count for this recount.");
            recoverFromAutomaticQuantityError();
            refocusPhysicalCountScanner();
            return;
          }

          const selectedTag = inventoryTag.trim();
          const effectiveCount = getPcountInventoryTagEffectiveCount(existing, selectedTag);
          if (effectiveCount === null) {
            showToast("warning", "Unable to recover the submitted Inventory Tag count on this scanner. Reconnect to ERP before recounting it.");
            recoverFromAutomaticQuantityError();
            refocusPhysicalCountScanner();
            return;
          }

          recountPreviousQuantity = effectiveCount;
          const correctionDelta = quantity - effectiveCount;

          // No quantity correction is needed. Do not create a zero-value
          // transaction that may be rejected by submission validation.
          if (Math.abs(correctionDelta) < 0.000001) {
            setPendingItem(null);
            setInventoryTag("");
            setRecountInventoryTags([]);
            setStep("item");
            setScanValue("");
            setQtyDefaultActive(false);
            setPackageStatus("COMPLETE");
            scannerBufferRef.current = "";
            setMessage(`No change. ${pendingItem.itemCode} remains ${formatScanQuantity(quantity)} ${pendingItem.uom} for Inv Tag ${selectedTag || "(historical blank)"}.`);
            refocusPhysicalCountScanner();
            return;
          }

          effectiveAction = correctionDelta < 0 ? "DEDUCT" : "ADD";
          signedQuantity = correctionDelta;
        }

        const runningQuantity = currentQuantity + signedQuantity;
        if (runningQuantity < -0.000001) {
          showToast("warning", `Recount correction would make the count negative. Current count is ${formatScanQuantity(currentQuantity)} ${pendingItem.uom}.`);
          recoverFromAutomaticQuantityError();
          refocusPhysicalCountScanner();
          return;
        }

        const transactionTime = getTime();
        const directEntry: LocalScanEntry = {
          ...baseEntry,
          multiplier: signedQuantity < 0 ? -Math.abs(multiplier) : Math.abs(multiplier),
          quantity: signedQuantity,
          timestamp: transactionTime,
          scanTransactions: [{
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            recordedAt: Date.now(),
            action: effectiveAction,
            quantityChange: signedQuantity,
            runningQuantity,
            timestamp: transactionTime,
            locationId: activeScanBin.locationId,
            locationLabel,
            employeeId: employee.id,
            employeeName: employee.full_name,
            deviceId: currentDeviceName,
            inventoryTag: inventoryTag.trim(),
            qrQuantity: packageQuantity.qrQuantity,
            packageStatus: packageQuantity.packageStatus,
            ...(packageBreakdown ? {
              bigPackCount: packageBreakdown.bigPackCount,
              loosePackQuantity: packageBreakdown.loosePackQuantity,
            } : {}),
            // Keep the complete recounted physical quantity for audit/UI while
            // quantityChange carries only the correction sent to ERP.
            actualQuantity: recounting ? quantity : packageQuantity.actualQuantity,
            ...(recountPreviousQuantity !== undefined
              ? { recountPreviousQuantity, recountPhysicalCount: quantity }
              : {}),
            // Physical Count does not calculate a remaining package balance.
          }],
        };

        if (effectiveLocationMode === "multi") {
          const groupLocations = getActivePcountGroupLocations(pcountSession?.locations || [], pcountSession?.activeGroupId || "");
          if (groupLocations.length === 0) {
            setMessage("No locations are selected. Return to the Location step.");
            refocusPhysicalCountScanner();
            return;
          }
          const expandedEntries = expandPcountEntryForLocations(
            directEntry,
            groupLocations,
            (locationId) => `${Date.now()}-${locationId}-${Math.random().toString(36).slice(2)}`,
          ).map((entry) => {
            const existingForLocation = authoritativeEntries.find((existingEntry) => isSameLocalScanItem(existingEntry, entry));
            const locationRunningQuantity = applyPhysicalCountChange(existingForLocation?.quantity || 0, quantity, scanActionMode);
            return {
              ...entry,
              scanTransactions: (entry.scanTransactions || []).map((transaction) => ({ ...transaction, runningQuantity: locationRunningQuantity })),
            };
          });
          addOrMergeLocalScanEntries(employee.id, expandedEntries);
          // A one-location group uses the multi-mode storage path. Remember its
          // successfully recorded tag so subsequent Automatic scans can reuse it.
          // Never auto-activate a tag spanning multiple locations or a recount.
          if (groupLocations.length === 1 && !recounting && effectiveAction === "ADD" && inventoryTag.trim()) {
            activeInventoryTagsRef.current[activeInventoryTagKey(reconciliationCode, groupLocations[0].bin.locationId || "", pendingItem.itemCode, pendingItem.lotNo)] = inventoryTag.trim();
          }
          const refreshedEntries = loadLocalScanEntries(employee.id).filter((entry) =>
            entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode
          );
          setEntries(refreshedEntries);
          const scanTime = new Date().toISOString();
          updatePcountSession((current) => current ? {
            ...current,
            locations: current.locations.map((location) => location.groupId === current.activeGroupId
              ? { ...location, lastScanTime: scanTime, completedAt: undefined }
              : location),
            updatedAt: scanTime,
          } : current);
          const summary = getMultiLocationQuantitySummary(signedQuantity, groupLocations.length);
          setLastScanFeedback({
            itemCode: pendingItem.itemCode,
            action: scanActionMode,
            quantityChange: summary.totalQuantity,
            runningQuantity: summary.totalQuantity,
            uom: pendingItem.uom,
          });
          if (scanActionMode === "DEDUCT") setScanActionMode("ADD");
          setPendingItem(null);
          setInventoryTag("");
          setStep("item");
          setScanValue("");
          setQtyDefaultActive(false);
          setPackageStatus("COMPLETE");
          scannerBufferRef.current = "";
          setMessage(`${formatScanQuantity(Math.abs(signedQuantity))} ${pendingItem.uom} recorded at each of ${groupLocations.length} locations.`);
          refocusPhysicalCountScanner();
          return;
        }

        const updatedAuthoritative = mergeLocalScanEntries(authoritativeEntries, directEntry);
        const updatedEntry = updatedAuthoritative.find((entry) => isSameLocalScanItem(entry, baseEntry)) || directEntry;
        setEntries((current) => [updatedEntry, ...current.filter((entry) => !isSameLocalScanItem(entry, baseEntry))]);
        addOrMergeLocalScanEntries(employee.id, [directEntry]);
        if (!recounting && effectiveAction === "ADD" && inventoryTag.trim()) {
          activeInventoryTagsRef.current[activeInventoryTagKey(reconciliationCode, activeScanBin.locationId || "", pendingItem.itemCode, pendingItem.lotNo)] = inventoryTag.trim();
        }
        rememberSetup(activeScanBin, reconciliationCode, reconciliationWarehouse, {
          itemCode: pendingItem.itemCode,
          itemName: pendingItem.itemName,
          action: effectiveAction,
          quantityChange: signedQuantity,
          uom: pendingItem.uom,
          timestamp: new Date().toISOString(),
        });
        const completedAction = effectiveAction;
        setLastScanFeedback({
          itemCode: pendingItem.itemCode,
          action: completedAction,
          quantityChange: signedQuantity,
          runningQuantity,
          uom: pendingItem.uom,
        });
        const scanTime = new Date().toISOString();
        updatePcountSession((current) => current ? {
          ...current,
          activeLocationId: activeScanBin.locationId || "",
          locations: current.locations.map((location) =>
            location.bin.locationId === activeScanBin.locationId
              ? { ...location, status: "in_progress", lastScanTime: scanTime, completedAt: undefined }
              : location
          ),
          updatedAt: scanTime,
        } : current);
        if (completedAction === "DEDUCT") setScanActionMode("ADD");
        setPendingItem(null);
        setInventoryTag("");
        setStep("item");
        setScanValue("");
        setQtyDefaultActive(false);
        setPackageStatus("COMPLETE");
        scannerBufferRef.current = "";
        // The green Last Scan card below is the authoritative success feedback.
        // Keep the blue status area empty to avoid showing the same scan twice.
        setMessage("");
        return;

      }

      if (!isScanSessionActive) {
        setMessage("Setup is ready. Press Start Scanning before scanning items.");
        setScanValue("");
        scannerBufferRef.current = "";
        return;
      }

      const item = parseItem(code);
      if (!item) {
        setMessage(PACKING_LABEL_ERROR);
        setScanValue("");
        refocusPhysicalCountScanner();
        return;
      }

      const itemCacheKey = item.itemCode.trim().toLocaleUpperCase();
      let baselineItemName = itemNameCacheRef.current.get(itemCacheKey);
      let authoritativeBatchNo = "";
      let authoritativeUom = item.uom;
      let hasAuthoritativeUom = false;
      let effectiveQrQuantity = item.qrQuantity;
      if (effectiveLocationMode === "multi") {
        if (activeGroupLocations.length === 0) {
          setStep("bin");
          setCurrentBin(null);
          setMessage("Scan at least one Storage Location before scanning items.");
          return;
        }
        setIsAllocating(true);
        setLoadingOperation({
          kind: "item",
          title: "Checking item",
          detail: `Validating ${item.itemCode} across ${activeGroupLocations.length} locations before Inv Tag…`,
        });
        setMessage(`Validating ${item.itemCode} for ${activeGroupLocations.length} locations...`);
        try {
          const authoritativeEntries = loadLocalScanEntries(employee.id);
          const validations = await validatePcountLocationGroup(activeGroupLocations, async (location) => {
            const locationId = location.bin.locationId || "";
            const probe: LocalScanEntry = {
              raw: code, mode, reconciliationCode, bin: location.bin, itemCode: item.itemCode,
              itemName: baselineItemName, qrQuantity: item.qrQuantity, multiplier: 0, quantity: 0,
              uom: "", barcodeUom: item.uom, lotNo: item.lotNo, timestamp: getTime(),
              deviceId: refreshDeviceName(),
            };
            const existing = authoritativeEntries.find((entry) => isSameLocalScanItem(entry, probe));
            if (existing) {
              // Repeat scans may find legacy/offline rows without a Stock UOM.
              // Resolve the authoritative Item UOM and repair only metadata;
              // never reset recorded counts or scan transactions.
              let stockUom = existing.authoritativeUom || "";
              if (!stockUom && (typeof navigator === "undefined" || navigator.onLine !== false)) {
                const details = await getPcountItemDetails(item.itemCode);
                if (details.itemCode.trim() !== item.itemCode.trim()) {
                  throw new Error(`${item.itemCode}: ERPNext Item details do not match the scanned item.`);
                }
                stockUom = getAuthoritativeStockUom(details.stockUom, details.uom);
              }
              // QR UOM is informational only. QR quantity is already expressed
              // in the item's ERP Stock UOM for new counts.
              const validConversionFactor = 1;
              if (!existing.authoritativeUom && stockUom) {
                updateValidatedLocalScanEntry(employee.id, existing, {
                  authoritativeUom: stockUom,
                  uomConversionFactor: validConversionFactor,
                });
              }
              return {
                entry: { ...existing, uom: stockUom, authoritativeUom: stockUom, uomConversionFactor: validConversionFactor },
                conversionFactor: validConversionFactor,
              };
            }
            try {
              const baseline = await getPcountItemBaseline(reconciliationCode, item.itemCode, reconciliationWarehouse, locationId, "");
              if (normalizeWarehouse(baseline.warehouse) !== normalizeWarehouse(reconciliationWarehouse)) {
                throw new Error(`ERPNext returned warehouse ${baseline.warehouse}; expected ${reconciliationWarehouse}.`);
              }
              if (baseline.inventoryLocation.trim() !== locationId.trim()) {
                throw new Error(`ERPNext returned location ${baseline.inventoryLocation}; expected ${locationId}.`);
              }
              // Some ERPNext baseline responses omit Stock UOM. Resolve it from
              // the authoritative Item endpoint before validating conversion.
              let stockUom = getAuthoritativeStockUom(baseline.stockUom, baseline.uom);
              if (!stockUom) {
                const details = await getPcountItemDetails(item.itemCode);
                if (details.itemCode.trim() !== item.itemCode.trim()) {
                  throw new Error(`${item.itemCode}: ERPNext Item details do not match the scanned item.`);
                }
                stockUom = getAuthoritativeStockUom(details.stockUom, details.uom);
              }
              // Treat the scanned pack quantity as ERP stock units, irrespective of QR UOM.
              const validConversionFactor = 1;
              return {
                conversionFactor: validConversionFactor,
                entry: {
                  ...probe, uom: stockUom, authoritativeUom: stockUom, itemName: baseline.itemName || baselineItemName,
                  lotNo: baseline.batchNo, submittedQuantity: 0, erpBaselineQuantity: baseline.currentErpQuantity,
                  uomConversionFactor: validConversionFactor,
                  scanTransactions: [], submittedTransactionCount: 0,
                } satisfies LocalScanEntry,
              };
            } catch (error) {
              if (!isNetworkFailure(error)) {
                throw new Error(`${location.bin.locationCode || locationId}: ${error instanceof Error ? error.message : "validation failed"}`);
              }
              setIsOffline(true);
              return { conversionFactor: 1, entry: { ...probe, submittedQuantity: 0, scanTransactions: [], submittedTransactionCount: 0 } };
            }
          });
          const first = validations[0];
          const expectedUom = first.entry.authoritativeUom || first.entry.uom;
          if (validations.some((result) => (result.entry.authoritativeUom || result.entry.uom) !== expectedUom || result.conversionFactor !== first.conversionFactor)) {
            throw new Error(`${item.itemCode} has inconsistent UOM conversion across the selected locations.`);
          }
          const newBaselines = validations.map((result) => result.entry).filter((entry) =>
            !authoritativeEntries.some((existing) => isSameLocalScanItem(existing, entry))
          );
          if (newBaselines.length > 0) addOrMergeLocalScanEntries(employee.id, newBaselines);
          setEntries(loadLocalScanEntries(employee.id).filter((entry) => entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode));
          baselineItemName = first.entry.itemName || baselineItemName;
          authoritativeBatchNo = first.entry.lotNo || "";
          authoritativeUom = expectedUom;
          hasAuthoritativeUom = Boolean(first.entry.authoritativeUom);
          effectiveQrQuantity = item.qrQuantity * first.conversionFactor;
          setPendingItem({
            raw: code, ...item, qrQuantity: effectiveQrQuantity, uom: authoritativeUom,
            barcodeUom: item.uom, ...(hasAuthoritativeUom ? { authoritativeUom } : {}),
            lotNo: authoritativeBatchNo, itemName: baselineItemName,
          });
          const preferredPackageStatus: PackageStatus = "COMPLETE";
          setPackageStatus(preferredPackageStatus);
        setRetainedBigPackExpression("");
          hydrateItemName(item.itemCode);
          autoQuantityAttemptRef.current = "";
          setRecountInventoryTags([]);
          const singleGroupLocationId = activeGroupLocations.length === 1 ? activeGroupLocations[0].bin.locationId || "" : "";
          const forceNewTagKey = `${singleGroupLocationId}|${item.itemCode.trim().toLocaleUpperCase()}`;
          const forcedNewTag = newInventoryTagForItem === forceNewTagKey;
          const activeKey = activeInventoryTagKey(reconciliationCode, singleGroupLocationId, item.itemCode, authoritativeBatchNo);
          const reusableTag = quantityMode === "automatic" && scanActionMode === "ADD" && singleGroupLocationId && !forcedNewTag && !pcountSession?.activeGroupId?.startsWith("recount-")
            ? validateActiveInventoryTag(loadLocalScanEntries(employee.id), reconciliationCode, singleGroupLocationId, item.itemCode, authoritativeBatchNo, activeInventoryTagsRef.current[activeKey])
            : null;
          if (forcedNewTag) setNewInventoryTagForItem(null);
          setInventoryTag(reusableTag || getLatestUsedInventoryTag(loadLocalScanEntries(employee.id), reconciliationCode));
          setStep(reusableTag ? "qty" : "invtag");
          setScanValue("");
          setQtyDefaultActive(false);
          setMessage(reusableTag ? `${item.itemCode} · Inv Tag ${reusableTag} reused.` : `${item.itemCode} scanned for ${activeGroupLocations.length} locations. Enter Inv Tag.`);
        } catch (error) {
          showToast("error", error instanceof Error ? error.message : "Unable to validate the selected locations.");
          setMessage("Item was not recorded for any selected location.");
          setScanValue("");
          scannerBufferRef.current = "";
          refocusPhysicalCountScanner();
        } finally {
          setLoadingOperation(null);
          setIsAllocating(false);
        }
        return;
      }
      const baselineProbe: LocalScanEntry = {
        raw: code,
        mode,
        reconciliationCode,
        bin: activeScanBin,
        itemCode: item.itemCode,
        itemName: baselineItemName,
        qrQuantity: item.qrQuantity,
        multiplier: 0,
        quantity: 0,
        uom: "",
        barcodeUom: item.uom,
        lotNo: item.lotNo,
        timestamp: getTime(),
        deviceId: refreshDeviceName(),
      };
      const existingBaseline = loadLocalScanEntries(employee.id).find((entry) => isSameLocalScanItem(entry, baselineProbe));
      if (!existingBaseline) {
        setIsAllocating(true);
        setMessage(`Validating ${item.itemCode} with ERPNext...`);
        try {
          const baseline = await getPcountItemBaseline(
            reconciliationCode,
            item.itemCode,
            reconciliationWarehouse,
            activeScanBin.locationId || "",
            ""
          );
          if (normalizeWarehouse(baseline.warehouse) !== normalizeWarehouse(reconciliationWarehouse)) {
            throw new Error(`ERPNext returned warehouse ${baseline.warehouse}; expected ${reconciliationWarehouse}.`);
          }
          if (baseline.inventoryLocation.trim() !== (activeScanBin.locationId || "").trim()) {
            throw new Error(`ERPNext returned location ${baseline.inventoryLocation}; expected ${activeScanBin.locationId}.`);
          }
          const erpStockUom = getAuthoritativeStockUom(baseline.stockUom, baseline.uom);
          if (!erpStockUom) {
            throw new Error(`${item.itemCode}: ERPNext Stock UOM is unavailable.`);
          }
          const conversionFactor = 1;
          authoritativeUom = erpStockUom;
          hasAuthoritativeUom = true;
          effectiveQrQuantity = item.qrQuantity;
          baselineItemName = baseline.itemName || baselineItemName;
          authoritativeBatchNo = baseline.batchNo;
          if (baselineItemName) itemNameCacheRef.current.set(itemCacheKey, baselineItemName);
          const seededBaseline: LocalScanEntry = {
            ...baselineProbe,
            uom: authoritativeUom,
            barcodeUom: item.uom,
            authoritativeUom,
            ...(conversionFactor ? { uomConversionFactor: conversionFactor } : {}),
            itemName: baselineItemName,
            lotNo: authoritativeBatchNo,
            // Physical Count is what the operator actually scans, not ERP stock
            // plus scans. Keep the ERP quantity only as the concurrency baseline.
            quantity: 0,
            submittedQuantity: 0,
            erpBaselineQuantity: baseline.currentErpQuantity,
            scanTransactions: [],
            submittedTransactionCount: 0,
          };
          addOrMergeLocalScanEntries(employee.id, [seededBaseline]);
          setEntries((current) => [seededBaseline, ...current.filter((entry) => !isSameLocalScanItem(entry, seededBaseline))]);
          setIsOffline(false);
        } catch (error) {
          if (!isNetworkFailure(error)) {
            showToast("error", error instanceof Error ? error.message : "Unable to load the current ERPNext quantity.");
            setMessage("Item was not recorded. Scan it again after the ERPNext baseline is available.");
            setScanValue("");
            scannerBufferRef.current = "";
            return;
          }
          const offlineBaseline: LocalScanEntry = {
            ...baselineProbe,
            quantity: 0,
            submittedQuantity: 0,
            scanTransactions: [],
            submittedTransactionCount: 0,
          };
          addOrMergeLocalScanEntries(employee.id, [offlineBaseline]);
          setEntries((current) => [offlineBaseline, ...current.filter((entry) => !isSameLocalScanItem(entry, offlineBaseline))]);
          setIsOffline(true);
          showToast("warning", `${item.itemCode} saved offline. Item and UOM will be validated before ERP submission.`);
        } finally {
          setIsAllocating(false);
        }
      } else {
        baselineItemName = existingBaseline.itemName || baselineItemName;
        authoritativeBatchNo = existingBaseline.lotNo || "";
        authoritativeUom = existingBaseline.authoritativeUom || existingBaseline.uom || "";
        hasAuthoritativeUom = Boolean(authoritativeUom);
        // Never use the QR UOM to convert the pack count.
        effectiveQrQuantity = item.qrQuantity;
      }
      // A recount should retain the original counted pack size. A generic
      // item barcode can report 1 even when the submitted packing label had
      // a larger unit multiplier; silently treating that as one unit changes
      // the physical total and the recount delta.
      const recountingItem = Boolean(pcountSession?.activeGroupId?.startsWith("recount-")) && getRecountInventoryTags(item.itemCode, activeScanBin.locationId || "").length > 0;
      if (recountingItem && existingBaseline && Number.isFinite(existingBaseline.qrQuantity) && existingBaseline.qrQuantity > 0) {
        // Recount is a correction to an already counted item. Keep the
        // original counted item's pack multiplier, not a new QR's default 1.
        if (effectiveQrQuantity !== existingBaseline.qrQuantity) {
          showToast("warning", `Recount uses original pack size: ${existingBaseline.qrQuantity} ${authoritativeUom} per Big Pack.`);
        }
        effectiveQrQuantity = existingBaseline.qrQuantity;
      }
      setPendingItem({
        raw: code,
        ...item,
        qrQuantity: effectiveQrQuantity,
        uom: authoritativeUom,
        barcodeUom: item.uom,
        ...(hasAuthoritativeUom ? { authoritativeUom } : {}),
        lotNo: authoritativeBatchNo,
        itemName: baselineItemName,
      });
      const preferredPackageStatus: PackageStatus = "COMPLETE";
      setPackageStatus(preferredPackageStatus);
      hydrateItemName(item.itemCode);
      autoQuantityAttemptRef.current = "";
      const recounting = Boolean(pcountSession?.activeGroupId?.startsWith("recount-"));
      if (recounting) {
        const existingTags = getRecountInventoryTags(item.itemCode, activeScanBin.locationId || "");
        if (existingTags.length === 0) {
          // An uncounted item in a revisited location is a new count, not a recount.
          setRecountInventoryTags([]);
          setRecountTagOperation("new");
          setInventoryTag(getLatestUsedInventoryTag(loadLocalScanEntries(employee.id), reconciliationCode));
          setStep("invtag");
          setMessage(`${item.itemCode} is new to this location. Confirm the latest Inv Tag or enter another.`);
          setScanValue("");
          setQtyDefaultActive(false);
          scannerBufferRef.current = "";
          return;
        }
        setRecountInventoryTags(existingTags);
        setRecountTagOperation("existing");
        setInventoryTag(existingTags.length === 1 ? existingTags[0] : existingTags.find(Boolean) || "");
        setStep("invtag");
        setMessage(existingTags.length === 1
          ? `${item.itemCode} recount. Inv Tag is locked.`
          : `${item.itemCode} has multiple existing Inv Tags. Select the tag to recount.`);
      } else {
        const activeKey = activeInventoryTagKey(reconciliationCode, activeScanBin.locationId || "", item.itemCode, authoritativeBatchNo);
        const reusableTag = quantityMode === "automatic" && scanActionMode === "ADD" && newInventoryTagForItem !== `${activeScanBin.locationId || ""}|${item.itemCode.trim().toLocaleUpperCase()}` && activeGroupLocations.length <= 1
          ? validateActiveInventoryTag(loadLocalScanEntries(employee.id), reconciliationCode, activeScanBin.locationId || "", item.itemCode, authoritativeBatchNo, activeInventoryTagsRef.current[activeKey])
          : null;
        setRecountInventoryTags([]);
        if (newInventoryTagForItem === `${activeScanBin.locationId || ""}|${item.itemCode.trim().toLocaleUpperCase()}`) setNewInventoryTagForItem(null);
        setInventoryTag(reusableTag || getLatestUsedInventoryTag(loadLocalScanEntries(employee.id), reconciliationCode));
        // Automatic repeat scans of the same item/location/lot may add to the
        // sole pending tag. Ambiguous, submitted and recount tags still require
        // explicit Inventory Tag confirmation and normal duplicate safeguards.
        setStep(reusableTag ? "qty" : "invtag");
        setMessage(reusableTag ? `${item.itemCode} · Inv Tag ${reusableTag} reused.` : `${item.itemCode} scanned. Enter Inv Tag.`);
      }
      setScanValue("");
      setQtyDefaultActive(false);
      scannerBufferRef.current = "";
    },
    [activeGroupLocations, currentBin, effectiveLocationMode, employee.full_name, employee.id, handlePcountNotOpen, hydrateItemName, isAllocating, isScanSessionActive, mode, packageStatus, pcountSession, pendingExistingLocation, pendingItem, inventoryTag, quantityPromptEnabled, reconciliationCode, reconciliationWarehouse, refocusPhysicalCountScanner, refreshDeviceName, rememberSetup, scanActionMode, selectPhysicalCountLocation, showToast, step, updatePcountSession, getRecountInventoryTags, newInventoryTagForItem, recountInventoryTags, recountTagOperation]
  );

  React.useEffect(() => {
    if (step !== "invtag" || !pendingItem) return;

    scannerBufferRef.current = "";
    const focusInventoryTag = () => {
      inventoryTagInputRef.current?.focus({ preventScroll: true });
    };
    const frame = window.requestAnimationFrame(focusInventoryTag);
    const timer = window.setTimeout(focusInventoryTag, 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [pendingItem, step]);

  React.useEffect(() => {
    if (quantityMode !== "automatic" || step !== "qty" || !pendingItem || isAllocating) {
      return;
    }

    const attemptKey = `${reconciliationCode}|${currentBin?.locationId || ""}|${pendingItem.raw}`;
    if (autoQuantityAttemptRef.current === attemptKey) {
      return;
    }

    autoQuantityAttemptRef.current = attemptKey;
    void processScan("1");
  }, [currentBin?.locationId, isAllocating, pendingItem, processScan, quantityMode, reconciliationCode, step]);

  React.useEffect(() => {
    if (!isScanSessionActive || isAllocating || step !== "item" || queuedScans.length === 0) {
      return;
    }

    const [nextScan] = queuedScans;
    setQueuedScans((current) => current.slice(1));
    void processScan(nextScan);
  }, [isAllocating, isScanSessionActive, processScan, queuedScans, step]);

  React.useEffect(() => {
    const handleNativeScan = (event: Event) => {
      // Inventory Tag is operator text entry. Never let the hardware scanner
      // interrupt the dialog or steal its keyboard focus.
      if (step === "invtag" || manualItemOpen || manualPackItem) return;
      const scanEvent = event as CustomEvent<{ code?: string }>;
      processScan(scanEvent.detail?.code || "");
    };

    window.addEventListener("qcmc-scanner-data", handleNativeScan);
    return () => window.removeEventListener("qcmc-scanner-data", handleNativeScan);
  }, [manualItemOpen, manualPackItem, processScan, step]);

  const syncManualItems = async () => {
    if (manualCatalogLoading) return;
    setManualCatalogLoading(true);
    setManualCatalogError("");
    setManualCatalogProgress(0);
    try {
      await synchronizeItemCatalog(setManualCatalogProgress);
      setManualCatalog(await loadCachedItems());
    } catch (error) {
      setManualCatalogError(error instanceof Error ? error.message : "Item catalog synchronization failed.");
      // An interrupted sync may still have usable earlier cached pages.
      try { setManualCatalog(await loadCachedItems()); } catch { /* retain existing */ }
    } finally {
      setManualCatalogLoading(false);
    }
  };

  const openManualItemSearch = () => {
    if (!reconciliationCode || (!currentBin && !activeGroupLocations.length)) return;
    // After selecting a location, the location-selection screen may still be
    // at step "bin". Move into Items before opening Manual FG Search.
    if (step === "bin" && activeGroupLocations.length) {
      continueMultiLocationItems();
    } else if (step === "bin" && currentBin) {
      setStep("item");
      setIsScanSessionActive(true);
    } else if (step !== "item") {
      return;
    }
    setManualItemOpen(true);
    setManualItemQuery("");
    setManualPackSize("1");
    setManualCatalogError("");
    void Promise.all([loadCachedItems(), getItemCatalogLastChecked()]).then(([items, checkedAt]) => {
      setManualCatalog(items);
      if ((!items.length || Date.now() - checkedAt > 24 * 60 * 60 * 1000) &&
          (typeof navigator === "undefined" || navigator.onLine !== false)) {
        void syncManualItems();
      }
    }).catch((error) => setManualCatalogError(error instanceof Error ? error.message : "Cannot load offline items."));
  };

  const closeManualItemSearch = () => {
    setManualItemOpen(false);
    setManualItemQuery("");
    setManualPackSize("");
    refocusPhysicalCountScanner();
  };

  const chooseManualItem = (selectedItem: CatalogItem) => {
    if (!selectedItem.stockUom.trim() || selectedItem.itemCode.includes(";") || selectedItem.stockUom.includes(";")) {
      setManualCatalogError("This item has an invalid Stock UOM or unsupported barcode delimiters.");
      return;
    }
    setManualCatalogError("");
    setManualPackSize("1");
    setManualItemOpen(false);
    setManualPackItem(selectedItem);
  };

  const returnToManualItemSearch = () => {
    setManualPackItem(null);
    setManualCatalogError("");
    setManualItemOpen(true);
  };

  const confirmManualPackSize = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!manualPackItem) return;
    const packSize = Number(manualPackSize.trim());
    if (!Number.isFinite(packSize) || packSize <= 0) {
      setManualCatalogError("Enter a positive quantity per Big Pack. Use 1 when counting individual stock units.");
      return;
    }
    const code = `${manualPackItem.itemCode};${packSize};${manualPackItem.stockUom};MANUAL`;
    itemNameCacheRef.current.set(manualPackItem.itemCode.trim().toLocaleUpperCase(), manualPackItem.itemName);
    setManualPackItem(null);
    setManualItemQuery("");
    setManualPackSize("");
    setManualCatalogError("");
    // Reuse the exact QR path: Inventory Tag, Quantity, recount and validation.
    void processScan(code);
  };
  const manualMatches = React.useMemo(
    () => searchCatalogItems(manualCatalog, manualItemQuery, 30),
    [manualCatalog, manualItemQuery]
  );

  const handleKeyDown = (event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "preventDefault">) => {
    if (step !== "qty") {
      if (event.key === "Enter") {
        event.preventDefault();
        const bufferedCode = scannerBufferRef.current || scanValue;
        scannerBufferRef.current = "";
        setScanValue("");
        processScan(bufferedCode);
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete" || event.key === "Escape") {
        event.preventDefault();
        scannerBufferRef.current = "";
        setScanValue("");
        return;
      }

      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        scannerBufferRef.current += event.key;
      }

      return;
    }

    if (step === "qty" && qtyDefaultActive && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      setScanValue(event.key);
      setQtyDefaultActive(false);
      return;
    }

    if (event.key !== "Enter") return;

    event.preventDefault();
    processScan(scanValue);
  };

  React.useEffect(() => {
    if (mode !== "pcount") return;
    const capturePageScan = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const editableTarget = Boolean(target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], .scan-confirm-backdrop'));
      if (!shouldCapturePageScannerKey({
        allowed: scannerFocusAllowedRef.current && !resolvingLocationRef.current && step !== "qty" && step !== "invtag",
        scannerTarget: event.target === inputRef.current,
        editableTarget,
        key: event.key,
        hasBuffer: Boolean(scannerBufferRef.current),
        modified: event.ctrlKey || event.metaKey || event.altKey,
      })) return;
      // Android keyboard scanners can keep sending keys to the page/button
      // after the submit dialog disappears. Use the same buffer as the input.
      event.stopPropagation();
      handleKeyDown(event);
      focusScanner();
    };
    window.addEventListener("keydown", capturePageScan, true);
    return () => window.removeEventListener("keydown", capturePageScan, true);
  });

  const handleInputFocus = () => {
    if (step === "qty" && qtyDefaultActive) {
      inputRef.current?.select();
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (step !== "qty") {
      return;
    }
    setRecountCalculatorEdited(true);

    if (step === "qty" && qtyDefaultActive) {
      const value = event.target.value;
      setQtyDefaultActive(false);
      setScanValue(value === "0" ? "" : value.replace(/^0/, ""));
      return;
    }

    setScanValue(event.target.value);
  };

  const cancelQuantity = () => {
    autoQuantityAttemptRef.current = "";

    // Reaching Quantity does not mean the count was committed. In Multi mode
    // item validation has already seeded zero-quantity baseline placeholders
    // for the selected locations. If the operator cancels Quantity, remove
    // only those untouched placeholders just like cancelling Inv Tag.
    if (pendingItem && effectiveLocationMode === "multi") {
      const wantedItem = pendingItem.itemCode.trim().toLocaleUpperCase();
      const activeLocationIds = new Set(
        activeGroupLocations
          .map((location) => String(location.bin.locationId || "").trim().toLocaleUpperCase())
          .filter(Boolean)
      );
      const allEntries = loadLocalScanEntries(employee.id);
      const cleaned = allEntries.filter((entry) => {
        if (
          entry.mode !== "pcount" ||
          entry.reconciliationCode !== reconciliationCode ||
          entry.itemCode.trim().toLocaleUpperCase() !== wantedItem ||
          !activeLocationIds.has(String(entry.bin.locationId || "").trim().toLocaleUpperCase())
        ) return true;

        const hasRealCountTransaction = (entry.scanTransactions || []).some(
          (tx) => tx.action === "ADD" || tx.action === "DEDUCT"
        );
        const hasSubmittedHistory =
          (entry.submittedTransactionIds || []).length > 0 ||
          (entry.submittedTransactionCount || 0) > 0 ||
          entry.submittedPhysicalCount !== undefined;
        return hasRealCountTransaction || hasSubmittedHistory || Math.abs(entry.quantity) > 0.000001;
      });
      if (cleaned.length !== allEntries.length) {
        saveLocalScanEntries(employee.id, cleaned);
        setEntries(cleaned.filter((entry) =>
          entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode
        ));
      }
    }

    setPendingItem(null);
    setInventoryTag("");
    setStep("item");
    setScanValue("");
    setQtyDefaultActive(false);
    setPackageStatus("COMPLETE");
    setRetainedBigPackExpression("");
    scannerBufferRef.current = "";
    setMessage("Quantity entry cancelled. Scan an item barcode.");
    refocusPhysicalCountScanner();
  };

  const cancelInventoryTag = () => {
    autoQuantityAttemptRef.current = "";

    // Multi-location item validation seeds zero-quantity baseline rows before
    // the Inv Tag is confirmed. Cancelling here means the item was never
    // actually counted, so remove only those unsubmitted zero-transaction
    // placeholders. Real scans/submitted history are never touched.
    if (pendingItem && effectiveLocationMode === "multi") {
      const wantedItem = pendingItem.itemCode.trim().toLocaleUpperCase();
      const activeLocationIds = new Set(
        activeGroupLocations
          .map((location) => String(location.bin.locationId || "").trim().toLocaleUpperCase())
          .filter(Boolean)
      );
      const allEntries = loadLocalScanEntries(employee.id);
      const cleaned = allEntries.filter((entry) => {
        if (
          entry.mode !== "pcount" ||
          entry.reconciliationCode !== reconciliationCode ||
          entry.itemCode.trim().toLocaleUpperCase() !== wantedItem ||
          !activeLocationIds.has(String(entry.bin.locationId || "").trim().toLocaleUpperCase())
        ) return true;

        const hasRealCountTransaction = (entry.scanTransactions || []).some(
          (tx) => tx.action === "ADD" || tx.action === "DEDUCT"
        );
        const hasSubmittedHistory =
          (entry.submittedTransactionIds || []).length > 0 ||
          (entry.submittedTransactionCount || 0) > 0 ||
          entry.submittedPhysicalCount !== undefined;
        return hasRealCountTransaction || hasSubmittedHistory || Math.abs(entry.quantity) > 0.000001;
      });
      if (cleaned.length !== allEntries.length) {
        saveLocalScanEntries(employee.id, cleaned);
        setEntries(cleaned.filter((entry) =>
          entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode
        ));
      }
    }

    setPendingItem(null);
    setInventoryTag("");
    setRecountInventoryTags([]);
    setStep("item");
    setScanValue("");
    setQtyDefaultActive(false);
    scannerBufferRef.current = "";
    setMessage("Inv Tag entry cancelled. Scan an item barcode.");
    refocusPhysicalCountScanner();
  };

  const confirmInventoryTag = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!pendingItem) return;
    setInventoryTagPopupNotice("");

    const recounting = Boolean(pcountSession?.activeGroupId?.startsWith("recount-")) && recountInventoryTags.length > 0 && recountTagOperation === "existing";
    const tag = inventoryTag.trim();
    // The same Inv Tag may be reused for another item at a different
    // location, but never for a different item within this location.
    const savedTagEntries = loadLocalScanEntries(employee.id);
    const targetLocations = activeGroupLocations.length > 0
      ? activeGroupLocations.map((location) => location.bin.locationId || "")
      : [currentBin?.locationId || ""];
    const conflictingTag = targetLocations
      .map((locationId) => findInventoryTagItemConflict(
        savedTagEntries, reconciliationCode, tag, pendingItem.itemCode, locationId,
      ))
      .find((conflict) => Boolean(conflict));
    if (conflictingTag) {
      const warning = `Inv Tag ${tag} is already used for item ${conflictingTag.itemCode} at Storage Location ${conflictingTag.locationId}.`;
      setInventoryTagPopupNotice(warning);
      return;
    }
    // Recounts still need to target an existing recorded tag for the item.
    if (recounting) {
      const allowed = recountInventoryTags.some((existingTag) =>
        existingTag.trim().toLocaleUpperCase() === tag.toLocaleUpperCase()
      );
      if (!allowed) {
        setInventoryTagPopupNotice("Recount must use an existing Inv Tag for this item.");
        return;
      }
    } else if (!tag) {
      setInventoryTagPopupNotice("Inv Tag is required.");
      return;
    }

    let previousRecountQuantity: number | null = null;
    if (recounting) {
      const existingCount = loadLocalScanEntries(employee.id).find((entry) =>
        entry.mode === "pcount" &&
        entry.reconciliationCode === reconciliationCode &&
        entry.itemCode.trim().toLocaleUpperCase() === pendingItem.itemCode.trim().toLocaleUpperCase() &&
        String(entry.bin.locationId || "").trim().toLocaleUpperCase() === String(currentBin?.locationId || "").trim().toLocaleUpperCase()
      );
      previousRecountQuantity = existingCount ? getPcountInventoryTagEffectiveCount(existingCount, tag) : null;
      if (previousRecountQuantity === null || !Number.isFinite(previousRecountQuantity) || previousRecountQuantity < 0) {
        setInventoryTagPopupNotice("Existing recount quantity is unavailable for this Inv Tag. Refresh the saved count before continuing.");
        return;
      }
    }

    const packSize = pendingItem.qrQuantity;
    // Restore the original calculator values when the last saved count has a
    // trustworthy breakdown. Correction transactions store a delta, so never
    // interpret their quantityChange as the complete recount total.
    const savedTransactions = recounting
      ? loadLocalScanEntries(employee.id)
          .filter((entry) => entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode &&
            entry.itemCode.trim().toUpperCase() === pendingItem.itemCode.trim().toUpperCase())
          .flatMap((entry) => (entry.scanTransactions || []).filter((tx) =>
            (tx.action === "ADD" || tx.action === "DEDUCT") &&
            (tx.inventoryTag || "").trim().toUpperCase() === tag.toUpperCase() &&
            String(tx.locationId || entry.bin.locationId || "").trim().toUpperCase() ===
              String(currentBin?.locationId || "").trim().toUpperCase()))
          .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")))
      : [];
    const originalSplit = savedTransactions.find((tx) =>
      tx.bigPackCount !== undefined && tx.loosePackQuantity !== undefined &&
      Number.isFinite(tx.bigPackCount) && Number.isFinite(tx.loosePackQuantity) &&
      Math.abs(((tx.bigPackCount || 0) * packSize + (tx.loosePackQuantity || 0)) -
        (previousRecountQuantity ?? 0)) < 0.000001);
    const oldBigPacks = recounting && previousRecountQuantity !== null && packSize > 0
      ? originalSplit ? Number(originalSplit.bigPackCount) : Math.floor((previousRecountQuantity + 1e-8) / packSize)
      : 1;
    const oldLooseUnits = recounting && previousRecountQuantity !== null
      ? originalSplit ? Number(originalSplit.loosePackQuantity) : Math.max(0, Number((previousRecountQuantity - oldBigPacks * packSize).toFixed(6)))
      : 0;
    if (recounting) {
      recountCalculatorRestoreRef.current = {
        status: oldLooseUnits > 0 ? "OPENED" : "COMPLETE",
        bigPacks: oldLooseUnits > 0 ? String(oldBigPacks) : "",
        count: String(oldLooseUnits > 0 ? oldLooseUnits : oldBigPacks),
      };
    } else {
      recountCalculatorRestoreRef.current = null;
    }
    setRecountLoadedTotal(recounting ? previousRecountQuantity : null);
    setRecountCalculatorEdited(false);
    setInventoryTag(tag);
    setStep("qty");
    setPackageStatus(recounting && oldLooseUnits > 0 ? "OPENED" : "COMPLETE");
    setRetainedBigPackExpression(recounting && oldLooseUnits > 0 ? String(oldBigPacks) : "");
    setRetainedLoosePackExpression(recounting && oldLooseUnits > 0 ? String(oldLooseUnits) : "");
    setScanValue(recounting
      ? String(oldLooseUnits > 0 ? oldLooseUnits : oldBigPacks)
      : "0");
    setQtyDefaultActive(!recounting && quantityMode === "manual");
    scannerBufferRef.current = "";
    setMessage(recounting
      ? `Previously counted: ${previousRecountQuantity} ${pendingItem.uom} (${oldBigPacks} × ${packSize}${oldLooseUnits > 0 ? ` + ${oldLooseUnits} loose` : ""}). Update the quantity if needed.`
      : quantityMode === "manual"
        ? `${pendingItem.itemCode} · Inv Tag ${tag || "(historical blank)"}. Enter quantity.`
        : ""
    );
  };

  const confirmQuantity = (event?: React.FormEvent) => {
    event?.preventDefault();

    if (isAllocating) {
      return;
    }

    // An untouched existing recount is already correct. Never submit a zero
    // caused by a temporarily empty calculator input as a replacement count.
    if (recountLoadedTotal !== null && recountTagOperation === "existing" && !recountCalculatorEdited) {
      setPendingItem(null);
      setInventoryTag("");
      setRecountInventoryTags([]);
      setRecountLoadedTotal(null);
      setStep("item");
      setScanValue("");
      setMessage("No change to the existing recount quantity.");
      refocusPhysicalCountScanner();
      return;
    }

    const value = scanValue.trim();

    if (!value) {
      setMessage("Invalid qty. Enter a number greater than 0.");
      return;
    }

    try {
      const calculatedValue = evaluateQuantityExpression(value, true);
      if (!Number.isFinite(calculatedValue) || calculatedValue < 0) {
        setMessage("Invalid qty. Quantity cannot be negative.");
        return;
      }
      // Zero Big Packs is a valid intermediate value when the item consists
      // only of loose pieces. Require a positive combined total before saving.
      if (packageStatus === "COMPLETE" && calculatedValue === 0 && !retainedLoosePackExpression.trim()) {
        setRetainedBigPackExpression("0");
        setPackageStatus("OPENED");
        setScanValue(retainedLoosePackExpression || "0");
        setQtyDefaultActive(false);
        setMessage("Big Pack: 0. Enter the Loose Pack quantity.");
        return;
      }
      // Both tabs retain independent expressions. Save both even when OK is
      // pressed after returning to Big Pack; never silently drop Loose Pack.
      if ((packageStatus === "OPENED" || retainedLoosePackExpression.trim()) && pendingItem) {
        const bigPackCount = packageStatus === "COMPLETE"
          ? calculatedValue
          : retainedBigPackExpression.trim()
            ? evaluateQuantityExpression(retainedBigPackExpression, true)
            : 0;
        const loosePackQuantity = packageStatus === "OPENED"
          ? calculatedValue
          : evaluateQuantityExpression(retainedLoosePackExpression || "0", true);
        if (!Number.isFinite(bigPackCount) || bigPackCount < 0) {
          setMessage("Invalid qty. Big Pack must be zero or greater.");
          return;
        }
        const totalPhysicalQuantity = (bigPackCount * pendingItem.qrQuantity) + loosePackQuantity;
        if (!Number.isFinite(totalPhysicalQuantity) || totalPhysicalQuantity <= 0) {
          setMessage("Invalid qty. Total physical quantity must be greater than 0.");
          return;
        }
        // With zero loose units and Big Pack selected, retain the existing
        // multiplier processing path so the QR quantity is applied once.
        if (packageStatus === "COMPLETE" && loosePackQuantity === 0) {
          void processScan(String(bigPackCount), { bigPackCount, loosePackQuantity: 0 });
        } else {
          void processScan(String(totalPhysicalQuantity), { bigPackCount, loosePackQuantity });
        }
        return;
      }
      void processScan(String(calculatedValue), { bigPackCount: calculatedValue, loosePackQuantity: 0 });
    } catch (error) {
      setMessage(`Invalid qty. ${error instanceof Error ? error.message : "Check the calculation."}`);
    }
  };

  const enterQuantityKey = (key: string) => {
    setRecountCalculatorEdited(true);
    setQtyDefaultActive(false);
    setMessage("");
    setScanValue((current) => {
      if (key === "clear") return "";
      if (key === "backspace") return current.slice(0, -1);

      const normalizedKey = key === "×" ? "*" : key === "÷" ? "/" : key;
      const isOperator = ["+", "-", "*", "/"].includes(normalizedKey);

      if (isOperator) {
        if (!current) return "";
        if (/[+\-*/.]$/.test(current)) {
          if (/[+\-*/]$/.test(current)) return `${current.slice(0, -1)}${normalizedKey}`;
          return current;
        }
        return `${current}${normalizedKey}`;
      }

      const currentNumber = current.split(/[+\-*/]/).pop() || "";
      if (normalizedKey === ".") {
        if (currentNumber.includes(".")) return current;
        return currentNumber ? `${current}.` : `${current}0.`;
      }

      if (qtyDefaultActive || current === "0") return normalizedKey;
      return `${current}${normalizedKey}`;
    });
  };

  // Edit uses a separate quantity buffer: never modify an active scan or its
  // calculator while the Scan Items history editor is open.
  const enterEditQuantityKey = (key: string) => {
    const field = editPackageStatus === "COMPLETE" ? "bigPackCount" : "loosePackQuantity";
    setEditingScanTransaction((current) => current
      ? { ...current, [field]: nextEditQuantityKey(current[field], key, editQuantityFresh), quantityTouched: true }
      : current);
    setEditQuantityFresh(false);
  };

  const selectQuantityPackageStatus = (status: PackageStatus) => {
    // Each tab has its own expression. Switching tabs is navigation, not
    // Clear: retain both inputs so the operator can review/edit either count.
    if (status === packageStatus) return;
    setRecountCalculatorEdited(true);
    setMessage("");
    if (status === "OPENED") {
      setRetainedBigPackExpression(scanValue);
      setPackageStatus("OPENED");
      setScanValue(retainedLoosePackExpression || "0");
      setQtyDefaultActive(false);
      return;
    }
    setRetainedLoosePackExpression(scanValue);
    setPackageStatus("COMPLETE");
    setScanValue(retainedBigPackExpression || "0");
    setQtyDefaultActive(false);
  };

  const activeStep = step === "reconciliation" ? 1 : step === "bin" ? 2 : 3;
  const stepInstruction =
    step === "reconciliation"
      ? { title: "Scan reconciliation", detail: "Scan the reconciliation QR to begin this count." }
      : step === "bin"
        ? {
            title: "Scan storage location",
            detail: `Scan a location in ${reconciliationWarehouse || "the reconciliation warehouse"}.`,
          }
        : {
            title: isScanSessionActive ? "Scan items" : "Setup complete",
            detail: isScanSessionActive
              ? quantityPromptEnabled
                ? "Scan an item barcode. You will confirm its quantity next."
                : "Scan continuously. Each scan adds the quantity printed in the QR."
              : "Review the reference, location, and quantity mode, then start scanning.",
          };
  let quantityPreview = 0;
  let packageQuantityError = "";
  if (pendingItem && scanValue.trim()) {
    try {
      const calculatedInput = evaluateQuantityExpression(scanValue, true);
      // Zero Big Packs is permitted while preparing a loose-only count.
      if (packageStatus === "COMPLETE" && calculatedInput === 0) {
        quantityPreview = 0;
      } else {
        const calculation = calculatePhysicalPackage({
          qrQuantity: pendingItem.qrQuantity,
          status: packageStatus,
          input: String(calculatedInput),
        });
        quantityPreview = calculation.quantity;
      }
    } catch (error) {
      packageQuantityError = error instanceof Error ? error.message : "Invalid quantity.";
    }
  }
  let retainedBigPackCount = 0;
  let retainedBigPackUnits = 0;
  if (pendingItem && retainedBigPackExpression.trim()) {
    try {
      retainedBigPackCount = evaluateQuantityExpression(retainedBigPackExpression, true);
      retainedBigPackUnits = retainedBigPackCount * pendingItem.qrQuantity;
    } catch {
      retainedBigPackCount = 0;
      retainedBigPackUnits = 0;
    }
  }
  let retainedLoosePackUnits = 0;
  if (pendingItem && retainedLoosePackExpression.trim()) {
    try {
      retainedLoosePackUnits = evaluateQuantityExpression(retainedLoosePackExpression, true);
    } catch {
      retainedLoosePackUnits = 0;
    }
  }
  // The preview stays accurate on either tab, including when the operator
  // goes back to Big Pack after having entered Loose Pack pieces.
  const combinedQuantityPreview = packageStatus === "OPENED"
    ? retainedBigPackUnits + quantityPreview
    : quantityPreview + retainedLoosePackUnits;

  // The scan list belongs to the CURRENT Physical Count session, not every
  // historical row saved on this device. Removing a completed location can
  // preserve ERP-submitted audit rows, but those rows must not remain as
  // phantom "Current physical count: 0.00" cards or inflate scan totals.
  const visibleCountEntries = React.useMemo(() => {
    if (mode !== "pcount") return entries;
    const selectedIds = new Set((pcountSession?.locations || [])
      .map((location) => String(location.bin.locationId || "").trim().toUpperCase())
      .filter(Boolean));
    return entries.filter((entry) =>
      entry.mode === "pcount" &&
      entry.reconciliationCode.trim().toUpperCase() === reconciliationCode.trim().toUpperCase() &&
      selectedIds.has(String(entry.bin.locationId || "").trim().toUpperCase()) &&
      // Rows with no counted transaction and no physical quantity are not scans.
      ((entry.scanTransactions || []).some((tx) => tx.action === "ADD" || tx.action === "DEDUCT") ||
        Math.abs(entry.quantity) > 0.000001)
    );
  }, [entries, mode, pcountSession?.locations, reconciliationCode]);
  const pendingEntryCount = visibleCountEntries.filter(isPendingLocalScanEntry).length;
  const pendingQuantityTotal = visibleCountEntries.reduce(
    (total, entry) => total + entry.quantity,
    0
  );
  const skuCount = new Set(visibleCountEntries.map((entry) => entry.itemCode)).size;
  // Combining quantities expressed in different Stock UOMs is misleading.
  const hasMixedScanUom = new Set(visibleCountEntries.map((entry) => (entry.uom || "").trim().toUpperCase()).filter(Boolean)).size > 1;
  const transactionCount = visibleCountEntries.reduce((total, entry) => total + (entry.scanTransactions || []).length, 0);
  const countedLocations = React.useMemo(() => (pcountSession?.locations || []).flatMap((location) => {
    const locationEntries = entries.filter((entry) =>
      entry.bin.locationId === location.bin.locationId &&
      (entry.scanTransactions || []).some((tx) => tx.action === "ADD" || tx.action === "DEDUCT")
    );
    const isActive =
      location.bin.locationId === currentBin?.locationId ||
      (effectiveLocationMode === "multi" &&
        location.groupId === pcountSession?.activeGroupId &&
        location.status !== "completed");

    // Do not show stale 0-item locations after an item is cancelled/removed.
    // Keep a genuinely active location visible while the operator is still
    // scanning it, but completed/progress locations require real scan data.
    if (locationEntries.length === 0 && !isActive) return [];

    return [{
      ...location,
      skuCount: new Set(locationEntries.map((entry) => entry.itemCode)).size,
      totalUnits: locationEntries.reduce((sum, entry) => sum + entry.quantity, 0),
    }];
  }), [currentBin?.locationId, effectiveLocationMode, entries, pcountSession]);
  const completedLocationCount = countedLocations.filter((location) => location.status === "completed").length;
  const activeLocationCount = countedLocations.filter((location) => location.status !== "completed").length;
  // Review UI is shown only when the stored session has genuinely completed
  // every location. Display state must never bypass ERP submission guards.
  // navigator.onLine tracks the device's network interface; isOffline also
  // tracks failed ERPNext requests. Keep those meanings separate in the badge.
  const isDeviceOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  const isPcountReviewStage = isScanSessionActive && mode === "pcount" &&
    !currentBin && activeGroupLocations.length === 0 &&
    !pcountSession?.activeLocationId &&
    Boolean(pcountSession?.locations?.length) &&
    (pcountSession?.locations || []).every((location) => location.status === "completed") &&
    (pendingEntryCount > 0 || hasQueuedSubmission);
  const reviewedLocationCount = (pcountSession?.locations || []).filter((location) => location.status === "completed").length;
  const uniformScanUom = entries.length > 0 && entries.every((entry) =>
    Boolean(entry.uom?.trim()) &&
    entry.uom.trim().toUpperCase() === entries[0].uom.trim().toUpperCase()
  ) ? entries[0].uom.trim() : "";
  const isStaleCompletedLocationMessage = /^Location count completed\. Scan one or more Storage Locations, then scan an item\.$/i.test(message.trim());
  const isRecountMode = Boolean(pcountSession?.activeGroupId?.startsWith("recount-"));
  const orderedProgressLocations = React.useMemo(() => {
    const active: typeof countedLocations = [];
    const completed: typeof countedLocations = [];
    for (const location of countedLocations) {
      const isActive =
        location.bin.locationId === currentBin?.locationId ||
        (effectiveLocationMode === "multi" &&
          location.groupId === pcountSession?.activeGroupId &&
          location.status !== "completed");
      (isActive ? active : completed).push(location);
    }
    return [...active, ...completed.slice().reverse()];
  }, [countedLocations, currentBin?.locationId, effectiveLocationMode, pcountSession?.activeGroupId]);
  const visibleProgressLocations = orderedProgressLocations;
  const latestUsedInvTag = React.useMemo(() =>
    getLatestUsedInventoryTag(entries, reconciliationCode), [entries, reconciliationCode]);
  const activeTagItemCode = lastScanFeedback?.itemCode || "";
  const activeTagEntries = entries.filter((entry) =>
    entry.mode === "pcount" &&
    entry.reconciliationCode === reconciliationCode &&
    entry.itemCode.trim().toLocaleUpperCase() === activeTagItemCode.trim().toLocaleUpperCase() &&
    entry.bin.locationId === currentBin?.locationId
  );
  const activeTagValues = Array.from(new Set(activeTagEntries.flatMap((entry) =>
    (entry.scanTransactions || []).map((transaction) => transaction.inventoryTag?.trim()).filter((tag): tag is string => Boolean(tag))
  )));
  const activeTagKey = activeInventoryTagKey(reconciliationCode, currentBin?.locationId || "", activeTagItemCode, activeTagEntries[0]?.lotNo || "");
  const activeTagLabel = activeInventoryTagsRef.current[activeTagKey] || (activeTagValues.length > 1 ? "Select tag" : "None");
  const showPcountActionDock = isScanSessionActive && mode === "pcount" && Boolean(
    currentBin || activeGroupLocations.length > 0 || pendingEntryCount > 0 || hasQueuedSubmission
  );
  const hideScannerCapture = step !== "qty";
  const groupedScanItems = React.useMemo(() => {
    const groups = new Map<string, { itemCode: string; itemName: string; total: number; uom: string; entries: ItemScan[] }>();
    for (const entry of visibleCountEntries) {
      const existing = groups.get(entry.itemCode);
      if (existing) {
        existing.total += entry.quantity;
        existing.itemName ||= entry.itemName || "";
        existing.entries.push(entry);
      } else {
        groups.set(entry.itemCode, {
          itemCode: entry.itemCode,
          itemName: entry.itemName || "",
          total: entry.quantity,
          uom: entry.uom,
          entries: [entry],
        });
      }
    }
    return Array.from(groups.values());
  }, [visibleCountEntries]);

  return (
    <>
      <style>{`
        .scan-page {
          width: 100%;
          min-height: inherit;
          display: flex;
          flex-direction: column;
          gap: 14px;
          font-family: 'Sora', sans-serif;
          scroll-margin-top: 12px;
        }

        .scan-remove-selection-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 9px 12px;
          border-bottom: 1px solid hsl(var(--border));
          background: hsl(var(--primary) / 0.06);
          font-size: 12px;
        }
        .scan-remove-selection-bar > div {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 0 0 auto;
        }
        .scan-remove-selection-bar button {
          width: auto;
          min-width: 0;
          min-height: 34px;
          padding: 0 10px;
          border: 1px solid hsl(var(--border));
          border-radius: 8px;
          background: hsl(var(--card));
          font-weight: 800;
          white-space: nowrap;
        }
        .scan-remove-selection-bar button.is-danger {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          width: auto;
          min-width: 112px;
          border-color: #fecaca;
          background: #fee2e2;
          color: #991b1b;
        }
        .scan-remove-check {
          display: grid;
          place-items: center;
          flex: 0 0 22px;
          width: 22px;
          height: 22px;
          margin-right: 8px;
          border: 2px solid #94a3b8;
          border-radius: 6px;
          color: white;
          font-size: 14px;
          font-weight: 900;
        }
        .scan-remove-check.is-selected {
          border-color: hsl(var(--primary));
          background: hsl(var(--primary));
        }

        .scan-panel {
          background: hsl(var(--card));
          border: 1px solid hsl(var(--primary) / 0.15);
          border-radius: 18px;
          position: relative;
          overflow: hidden;
        }

        .scan-hero {
          padding: 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }
        .scan-title {
          font-size: 22px;
          font-weight: 800;
          color: hsl(var(--foreground));
        }
        .scan-sub {
          margin-top: 5px;
          font-size: 12px;
          color: hsl(var(--muted-foreground));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .scan-icon {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          background: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.82));
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 8px 20px hsl(var(--primary) / 0.24);
        }

        .scan-context {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          padding: 0 18px 18px;
        }
        .scan-context-card {
          border: 1px solid hsl(var(--border));
          border-radius: 12px;
          padding: 12px;
          background: hsl(var(--foreground) / 0.025);
        }
        .scan-context-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 800;
          color: hsl(var(--muted-foreground));
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .scan-context-main {
          margin-top: 8px;
          font-size: 14px;
          font-weight: 800;
          color: hsl(var(--foreground));
        }
        .scan-context-detail {
          margin-top: 4px;
          font-size: 12px;
          color: hsl(var(--muted-foreground));
          line-height: 1.45;
        }

        .scan-capture {
          padding: 16px 18px 18px;
          border-top: 1px solid hsl(var(--border));
        }
        .scan-focus-header {
          padding: 15px 18px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 4px 10px;
          border-bottom: 1px solid hsl(var(--border));
          background: linear-gradient(135deg, hsl(var(--primary) / 0.1), hsl(var(--primary) / 0.035));
        }
        .scan-focus-copy {
          display: contents;
        }
        .scan-focus-title {
          grid-column: 1;
          grid-row: 1;
          min-width: 0;
          font-size: 18px;
          font-weight: 800;
          color: hsl(var(--foreground));
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .scan-connectivity {
          grid-column: 1 / -1;
          display: inline-flex;
          align-items: center;
          width: fit-content;
          margin-top: 7px;
          padding: 4px 8px;
          border-radius: 999px;
          background: hsl(142 71% 45% / 0.12);
          color: hsl(142 64% 30%);
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .scan-connectivity.is-offline {
          background: hsl(38 92% 50% / 0.14);
          color: hsl(28 85% 34%);
        }

        /* Warehouse-first scan state: make the next action obvious at a glance. */
        .scan-page.is-scanning .scan-focus-header {
          padding: 12px 14px 11px;
          border: 1px solid #bfd7ff;
          border-bottom-color: #d8e6fb;
          background: linear-gradient(180deg, #f4f8ff 0%, #ffffff 100%);
        }
        .scan-page.is-scanning .scan-focus-title {
          font-size: 20px;
          line-height: 1.15;
          letter-spacing: -0.02em;
        }
        .scan-page.is-scanning .scan-ready-dot {
          width: 12px;
          height: 12px;
          flex-basis: 12px;
          box-shadow: 0 0 0 5px hsl(142 71% 45% / 0.16);
        }
        .scan-page.is-scanning .scan-focus-location {
          max-width: 100%;
          margin-top: 5px;
          font-size: 14px;
          line-height: 1.25;
        }
        .scan-page.is-scanning .scan-focus-reference {
          margin-top: 3px;
          font-size: 10px;
          line-height: 1.25;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .scan-page.is-scanning .scan-connectivity {
          margin-top: 5px;
          padding: 3px 7px;
          font-size: 8px;
        }
        .scan-ready-dot {
          width: 10px;
          height: 10px;
          flex: 0 0 10px;
          border-radius: 50%;
          background: hsl(142 71% 45%);
          box-shadow: 0 0 0 5px hsl(142 71% 45% / 0.14);
        }
        .scan-focus-location {
          margin-top: 7px;
          max-width: 245px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
          font-weight: 800;
          color: hsl(var(--primary));
        }
        .scan-focus-reference {
          grid-column: 1 / -1;
          grid-row: 2;
          margin-top: 4px;
          max-width: none;
          overflow: visible;
          text-overflow: clip;
          white-space: nowrap;
          font-size: clamp(8px, 2.8vw, 11px);
          line-height: 1.3;
          color: hsl(var(--muted-foreground));
        }
        .scan-pause-button {
          min-height: 40px;
          padding: 0 13px;
          border: 1px solid hsl(var(--border));
          border-radius: 11px;
          background: hsl(var(--background));
          color: hsl(var(--foreground));
          font-family: 'Sora', sans-serif;
          font-size: 12px;
          font-weight: 800;
        }
        .scan-session-tabs {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          padding: 0 10px;
          border-bottom: 1px solid hsl(var(--border));
          background: hsl(var(--card));
        }
        .scan-session-tab {
          min-height: 44px;
          border: 0;
          border-bottom: 3px solid transparent;
          background: transparent;
          color: hsl(var(--muted-foreground));
          font-family: 'Sora', sans-serif;
          font-size: 11px;
          font-weight: 800;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .scan-session-tab.is-active {
          border-bottom-color: hsl(var(--primary));
          color: hsl(var(--primary));
        }
        .scan-session-tab span {
          min-width: 20px;
          height: 20px;
          padding: 0 5px;
          border-radius: 999px;
          background: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
          font-size: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .scan-session-tab-static {
          cursor: default;
        }
        .scan-start-button {
          width: 100%;
          min-height: 58px;
          margin-top: 14px;
          border: 0;
          border-radius: 14px;
          background: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.82));
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          font-family: 'Sora', sans-serif;
          font-size: 16px;
          font-weight: 800;
          box-shadow: 0 10px 24px hsl(var(--primary) / 0.25);
        }
        .scan-input-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: hsl(var(--muted-foreground));
          margin-bottom: 9px;
        }
        .scan-step-pill {
          border-radius: 999px;
          padding: 5px 10px;
          background: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
          font-size: 11px;
          font-weight: 800;
          text-transform: none;
          letter-spacing: 0;
        }
        .scan-input {
          width: 100%;
          min-height: 50px;
          border: 1px solid hsl(var(--border));
          border-radius: 12px;
          background: hsl(var(--foreground) / 0.04);
          color: hsl(var(--foreground));
          font-size: 15px;
          font-family: 'JetBrains Mono', monospace;
          outline: none;
          padding: 12px 14px;
        }
        .scan-input:focus {
          border-color: hsl(var(--primary) / 0.55);
          background: hsl(var(--primary) / 0.05);
        }
        .scan-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 12px;
        }
        .scan-action {
          border: 1px solid hsl(var(--border));
          border-radius: 10px;
          background: hsl(var(--background));
          color: hsl(var(--foreground));
          min-height: 40px;
          padding: 0 12px;
          font-family: 'Sora', sans-serif;
          font-size: 12px;
          font-weight: 800;
          display: inline-flex;
          align-items: center;
          gap: 7px;
        }
        .scan-action-danger {
          color: hsl(0 72% 48%);
        }
        .scan-message {
          margin-top: 10px;
          font-size: 12px;
          color: hsl(var(--muted-foreground));
          line-height: 1.5;
        }

        .scan-status {
          padding: 16px 18px;
          display: flex;
          align-items: center;
          gap: 12px;
          border-top: 1px solid hsl(var(--border));
          min-height: 70px;
        }
        .scan-status-icon {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          background: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .scan-status-code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 14px;
          font-weight: 800;
          color: hsl(var(--foreground));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .scan-status-meta {
          margin-top: 3px;
          font-size: 12px;
          color: hsl(var(--muted-foreground));
        }

        .scan-history {
          flex: 1;
          min-height: 170px;
          padding: 4px;
          overflow: hidden;
        }
        .scan-history-row {
          padding: 14px;
          border-bottom: 1px solid hsl(var(--border));
        }
        .scan-history-row:last-child {
          border-bottom: 0;
        }
        .scan-history-main {
          min-width: 0;
        }
        .scan-history-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .scan-history-code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          font-weight: 700;
          color: hsl(var(--foreground));
        }
        .scan-history-quantity {
          flex: 0 0 auto;
          font-size: 14px;
          font-weight: 800;
          color: hsl(var(--foreground));
        }
        .scan-history-location {
          display: inline-flex;
          align-items: center;
          max-width: 100%;
          margin-top: 8px;
          padding: 5px 8px;
          border-radius: 8px;
          background: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
          font-size: 11px;
          font-weight: 800;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .scan-history-detail {
          margin-top: 3px;
          font-size: 11px;
          color: hsl(var(--muted-foreground));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .scan-history-time {
          font-size: 11px;
          color: hsl(var(--muted-foreground));
          text-align: right;
        }
        .scan-submit-dock {
          position: sticky;
          bottom: 10px;
          z-index: 20;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 12px;
          margin: 0 4px 4px;
          padding: 12px;
          border: 1px solid hsl(var(--primary) / 0.22);
          border-radius: 15px;
          background: hsl(var(--card) / 0.96);
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
          backdrop-filter: blur(12px);
        }
        .scan-submit-count {
          font-size: 13px;
          font-weight: 800;
          color: hsl(var(--foreground));
        }
        .scan-submit-total {
          margin-top: 3px;
          font-size: 10px;
          color: hsl(var(--muted-foreground));
        }
        .scan-submit-button {
          min-height: 46px;
          padding: 0 16px;
          border: 0;
          border-radius: 12px;
          background: hsl(var(--primary));
          color: white;
          font-family: 'Sora', sans-serif;
          font-size: 12px;
          font-weight: 800;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .scan-submit-button:disabled {
          opacity: 0.62;
        }
        .scan-page.is-scanning .scan-submit-dock {
          gap: 8px;
        }
        .scan-page.is-scanning .scan-submit-button {
          min-height: 52px;
          border-radius: 13px;
          font-size: 13px;
          font-weight: 900;
        }
        .scan-page.is-scanning .scan-finish-location {
          min-height: 52px;
          margin-top: 0;
          border-width: 2px;
          border-radius: 13px;
          font-size: 12px;
        }
        .scan-empty {
          min-height: 160px;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 20px;
          font-size: 13px;
          color: hsl(var(--muted-foreground));
        }
        .scan-confirm-backdrop {
          position: fixed;
          inset: 0;
          z-index: 90;
          background: rgba(15, 23, 42, 0.38);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
        }
        .scan-confirm-dialog {
          width: min(100%, 340px);
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 16px;
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
          padding: 18px;
        }
        .scan-confirm-title {
          font-size: 17px;
          font-weight: 800;
          color: hsl(var(--foreground));
        }
        .scan-confirm-text {
          margin-top: 6px;
          font-size: 12px;
          line-height: 1.5;
          color: hsl(var(--muted-foreground));
        }
        .scan-confirm-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 18px;
        }
        .scan-confirm-button {
          min-height: 42px;
          border-radius: 11px;
          border: 1px solid hsl(var(--border));
          background: hsl(var(--background));
          color: hsl(var(--foreground));
          font-family: 'Sora', sans-serif;
          font-size: 13px;
          font-weight: 800;
        }
        .scan-confirm-button-primary {
          border-color: transparent;
          background: hsl(0 72% 48%);
          color: white;
        }
        .scan-qty-dialog {
          width: min(100%, 380px);
        }
        .scan-qty-item {
          margin-top: 14px;
          padding: 12px;
          border: 1px solid hsl(var(--border));
          border-radius: 12px;
          background: hsl(var(--muted) / 0.45);
        }
        .scan-qty-item-code {
          font-size: 15px;
          font-weight: 800;
          color: hsl(var(--foreground));
        }
        .scan-qty-item-detail {
          margin-top: 3px;
          font-size: 12px;
          color: hsl(var(--muted-foreground));
        }
        .scan-package-status {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-top: 10px;
        }
        .scan-package-status button {
          min-height: 42px;
          padding: 8px;
          border: 1px solid hsl(var(--border));
          border-radius: 10px;
          background: hsl(var(--background));
          color: hsl(var(--foreground));
          font: 800 12px 'Sora', sans-serif;
        }
        .scan-package-status button.is-active {
          border-color: hsl(var(--primary));
          background: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
        }
        .scan-package-summary {
          display: grid;
          gap: 5px;
          margin-top: 8px;
          padding: 9px 10px;
          border-radius: 11px;
          background: hsl(var(--primary) / 0.08);
        }
        .scan-package-summary span {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          color: hsl(var(--muted-foreground));
          font-size: 10px;
          font-weight: 700;
        }
        .scan-package-summary strong {
          color: hsl(var(--foreground));
          text-align: right;
        }
        .scan-qty-label {
          display: block;
          margin-top: 16px;
          font-size: 12px;
          font-weight: 800;
          color: hsl(var(--foreground));
        }
        .scan-qty-input {
          width: 100%;
          min-height: 54px;
          margin-top: 7px;
          padding: 0 14px;
          border: 1px solid hsl(var(--border));
          border-radius: 12px;
          background: hsl(var(--background));
          color: hsl(var(--foreground));
          font-family: 'Sora', sans-serif;
          font-size: 22px;
          font-weight: 800;
          text-align: center;
          outline: none;
        }
        .scan-qty-keypad {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin-top: 10px;
        }
        .scan-qty-key {
          min-height: 48px;
          border: 1px solid hsl(var(--border));
          border-radius: 12px;
          background: hsl(var(--background));
          color: hsl(var(--foreground));
          font-family: 'Sora', sans-serif;
          font-size: 18px;
          font-weight: 800;
        }
        .scan-qty-key:active {
          border-color: hsl(var(--primary) / 0.45);
          background: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
        }
        .scan-qty-key-muted {
          font-size: 12px;
          color: hsl(var(--muted-foreground));
        }
        .scan-qty-input:focus {
          border-color: hsl(var(--primary));
          box-shadow: 0 0 0 3px hsl(var(--primary) / 0.14);
        }
        .scan-qty-error {
          margin-top: 8px;
          color: hsl(0 72% 48%);
          font-size: 12px;
          font-weight: 700;
        }
        .scan-qty-button-primary {
          border-color: transparent;
          background: hsl(var(--primary));
          color: white;
        }
        .scan-mode-badge {
          display: inline-flex;
          align-items: center;
          margin-top: 6px;
          border-radius: 999px;
          padding: 5px 9px;
          background: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
          font-size: 11px;
          font-weight: 800;
        }
        .scan-workflow {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
          padding: 0 18px 18px;
        }
        .scan-workflow-step {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
          color: hsl(var(--muted-foreground));
          font-size: 10px;
          font-weight: 700;
        }
        .scan-workflow-number {
          width: 24px;
          height: 24px;
          flex: 0 0 24px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid hsl(var(--border));
          border-radius: 50%;
          background: hsl(var(--background));
          font-size: 10px;
          font-weight: 800;
        }
        .scan-workflow-step.is-active {
          color: hsl(var(--foreground));
        }
        .scan-workflow-step.is-active .scan-workflow-number {
          border-color: hsl(var(--primary));
          background: hsl(var(--primary));
          color: white;
        }
        .scan-workflow-step.is-done .scan-workflow-number {
          border-color: hsl(142 71% 45% / 0.35);
          background: hsl(142 71% 45% / 0.12);
          color: hsl(142 71% 36%);
        }
        .scan-session-summary {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding: 0 18px 18px;
        }
        .scan-session-item {
          min-width: 0;
          padding: 10px 12px;
          border: 1px solid hsl(var(--border));
          border-radius: 11px;
          background: hsl(var(--foreground) / 0.025);
        }
        .scan-session-label {
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: hsl(var(--muted-foreground));
        }
        .scan-session-value {
          margin-top: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          font-weight: 800;
          color: hsl(var(--foreground));
        }
        .scan-instruction-kicker {
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: hsl(var(--primary));
        }
        .scan-instruction-title {
          margin-top: 5px;
          font-size: 20px;
          font-weight: 800;
          color: hsl(var(--foreground));
        }
        .scan-instruction-detail {
          margin-top: 5px;
          font-size: 12px;
          line-height: 1.5;
          color: hsl(var(--muted-foreground));
        }
        .scan-last-activity {
          margin-bottom: 14px;
          padding: 12px;
          border: 1px solid #d8dfeb;
          border-radius: 12px;
          background: #f7f9fc;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 12px;
        }
        .scan-last-activity-label { color: #fb6107; font-size: 9px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
        .scan-last-activity-reference { margin-top: 4px; overflow: hidden; color: #14213d; font: 800 12px Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
        .scan-last-activity-location { margin-top: 3px; overflow: hidden; color: #596277; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .scan-last-activity-item { margin-top: 6px; color: #14213d; font-size: 10px; font-weight: 800; }
        .scan-last-activity-item strong { color: #16834a; }
        .scan-last-activity-item.is-deduct strong { color: #c1272d; }
        .scan-last-activity-item-name { margin-top: 2px; overflow: hidden; color: #6b7280; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
        .scan-last-activity-time { margin-top: 3px; color: #7a8397; font-size: 9px; }
        .scan-last-activity-button { min-height: 38px; padding: 0 12px; border: 1px solid #fb6107; border-radius: 9px; background: #fff; color: #d75000; font: 800 11px 'Sora', sans-serif; white-space: nowrap; }
        .scan-input-wrap {
          position: relative;
          margin-top: 14px;
        }
        .scan-input-wrap .scan-input {
          padding-left: 44px;
        }
        .scan-input-wrap.is-focus-only {
          position: fixed;
          left: -10px;
          bottom: 0;
          width: 1px;
          height: 1px;
          min-height: 1px;
          margin: 0;
          padding: 0;
          overflow: hidden;
          opacity: .01;
          pointer-events: none;
        }
        .scan-input-wrap.is-focus-only .scan-input {
          width: 1px;
          height: 1px;
          min-height: 0;
          padding: 0;
          border: 0;
        }
        .scan-input-wrap.is-focus-only .scan-input-icon {
          display: none;
        }
        .scan-input-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: hsl(var(--primary));
          pointer-events: none;
        }
        .scan-actions-secondary {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-top: 12px;
        }
        .scan-actions-secondary .scan-action {
          justify-content: center;
        }
        .scan-actions-secondary .scan-action-sync { grid-column: 1 / -1; }
        .scan-action:disabled {
          opacity: 0.42;
          cursor: not-allowed;
        }
        .scan-spin { animation: scanSpin .8s linear infinite; }
        @keyframes scanSpin { to { transform: rotate(360deg); } }
        .scan-action-primary {
          width: 100%;
          min-height: 48px;
          justify-content: center;
          margin-top: 12px;
          border-color: transparent;
          background: hsl(var(--primary));
          color: white;
          font-size: 13px;
        }
        .scan-feedback {
          margin-top: 12px;
          border-radius: 10px;
          padding: 10px 12px;
          background: hsl(var(--primary) / 0.07);
          color: hsl(var(--foreground));
          font-size: 11px;
          line-height: 1.45;
        }
        .scan-current-location {
          margin-bottom: 10px;
          padding: 10px 12px;
          border: 1px solid hsl(214 78% 58% / 0.35);
          border-radius: 12px;
          background: hsl(214 78% 58% / 0.09);
        }
        .scan-current-location-label {
          color: hsl(var(--muted-foreground));
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        .scan-current-location-id {
          margin-top: 3px;
          color: hsl(var(--foreground));
          font: 800 15px 'JetBrains Mono', monospace;
          overflow-wrap: anywhere;
        }
        .scan-current-location-path {
          margin-top: 3px;
          color: hsl(var(--muted-foreground));
          font-size: 10px;
          line-height: 1.4;
          overflow-wrap: anywhere;
        }
        .scan-finish-location {
          width: 100%;
          min-height: 46px;
          margin-top: 10px;
          border: 1px solid hsl(214 78% 58% / .35);
          border-radius: 11px;
          background: #fff;
          color: hsl(214 78% 42%);
          font: 800 12px 'Sora', sans-serif;
        }
        .scan-location-summary { padding: 10px 12px 0; }
        .scan-location-summary-toggle {
          width: calc(100% - 24px);
          min-height: 44px;
          margin: 10px 12px 0;
          padding: 0 12px;
          border: 1px solid #cbd8eb;
          border-radius: 11px;
          background: #f3f7fd;
          color: #14213d;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font: 900 10px 'Sora', sans-serif;
          text-transform: uppercase;
          letter-spacing: .04em;
          cursor: pointer;
        }
        .scan-location-summary-toggle span {
          min-width: 22px;
          padding: 3px 7px;
          border-radius: 999px;
          background: #dce9ff;
          color: #2559a7;
          text-align: center;
        }
        .scan-location-summary-title { color: #14213d; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; }
        .scan-location-card { margin-top: 8px; padding: 11px; border: 1px solid #dfe4ec; border-radius: 11px; background: #fff; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 6px 10px; }
        .scan-location-card.is-active { border: 2px solid #7ca7ef; padding: 10px; background: #f1f6ff; box-shadow: 0 3px 10px rgba(37,89,167,.08); }
        .scan-location-card-id { color: #14213d; font: 900 12px Consolas, monospace; overflow-wrap: anywhere; }
        .scan-location-card-path { grid-column: 1 / -1; color: #6b7280; font-size: 10px; line-height: 1.35; overflow-wrap: anywhere; }
        .scan-location-card-stats { grid-column: 1 / -1; color: #3b4a6b; font-size: 10px; font-weight: 700; }
        .scan-location-card-status { align-self: start; padding: 4px 8px; border-radius: 999px; background: #e4f3e9; color: #16834a; font-size: 8px; font-weight: 900; text-transform: uppercase; }
        .scan-location-card.is-active .scan-location-card-status { background: #dce9ff; color: #2559a7; }
        .scan-location-reopen { grid-column: 1 / -1; justify-self: start; min-height: 36px; padding: 0 11px; border: 1px solid #cbd5e1; border-radius: 9px; background: #f8fafc; color: #14213d; font: 800 10px 'Sora', sans-serif; }
        .scan-last-success {
          margin-top: 10px;
          padding: 11px 12px;
          border: 1px solid hsl(142 71% 45% / 0.3);
          border-radius: 12px;
          background: hsl(142 71% 45% / 0.1);
          color: hsl(142 71% 34%);
          display: flex;
          align-items: center;
          gap: 10px;
          animation: scanSuccessIn 180ms ease-out both;
        }
        .scan-last-success.is-deduct {
          border-color: hsl(0 75% 52% / 0.3);
          background: hsl(0 75% 52% / 0.08);
          color: hsl(0 70% 40%);
        }
        @keyframes scanSuccessIn {
          from { opacity: 0; transform: translateY(-3px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .scan-last-main {
          min-width: 0;
          flex: 1;
        }
        .scan-last-label {
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .scan-last-code {
          margin-top: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: hsl(var(--foreground));
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          font-weight: 800;
        }
        .scan-last-quantity {
          flex: 0 0 auto;
          color: hsl(var(--foreground));
          font-size: 13px;
          font-weight: 800;
        }
        .scan-last-running {
          margin-top: 2px;
          color: hsl(var(--muted-foreground));
          font-size: 10px;
          font-weight: 700;
        }
        .scan-page.is-scanning .scan-last-success {
          margin: 8px 10px 2px;
          padding: 10px 11px;
          border-width: 2px;
          border-radius: 11px;
        }
        .scan-page.is-scanning .scan-last-label {
          font-size: 8px;
          letter-spacing: .07em;
        }
        .scan-page.is-scanning .scan-last-code {
          font-size: 14px;
        }
        .scan-page.is-scanning .scan-last-quantity {
          font-size: 15px;
        }
        .scan-quantity-option {
          margin-top: 12px;
          padding: 14px 16px;
          border: 2px solid hsl(142 71% 40% / 0.65);
          border-radius: 14px;
          background: hsl(142 71% 45% / 0.12);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          cursor: pointer;
          box-shadow: 0 5px 14px hsl(142 71% 35% / 0.1);
        }
        .scan-quantity-option.is-enabled {
          border-color: hsl(var(--primary) / 0.72);
          background: hsl(var(--primary) / 0.12);
          box-shadow: 0 5px 14px hsl(var(--primary) / 0.12);
        }
        .scan-quantity-option-copy {
          min-width: 0;
        }
        .scan-quantity-option-title {
          display: block;
          font-size: 14px;
          font-weight: 800;
          color: hsl(var(--foreground));
        }
        .scan-quantity-option-detail {
          display: block;
          margin-top: 3px;
          font-size: 12px;
          line-height: 1.4;
          color: hsl(var(--muted-foreground));
        }
        .scan-quantity-switch {
          appearance: none;
          width: 46px;
          height: 26px;
          border: 0;
          border-radius: 999px;
          background: hsl(var(--muted-foreground) / 0.55);
          position: relative;
          flex: 0 0 auto;
          transition: background 160ms ease;
          cursor: pointer;
        }
        .scan-quantity-switch::after {
          content: "";
          position: absolute;
          width: 20px;
          height: 20px;
          top: 3px;
          left: 3px;
          border-radius: 50%;
          background: white;
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.2);
          transition: transform 160ms ease;
        }
        .scan-quantity-switch:checked {
          background: hsl(var(--primary));
        }
        .scan-quantity-switch:checked::after {
          transform: translateX(20px);
        }
        .scan-quantity-switch:focus-visible {
          outline: 3px solid hsl(var(--primary) / 0.25);
          outline-offset: 2px;
        }
        .scan-quantity-option.is-auto .scan-quantity-switch:checked {
          background: hsl(142 71% 34%);
        }
        .scan-list-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 13px 14px 9px;
          border-bottom: 1px solid hsl(var(--border));
        }
        .scan-list-title {
          font-size: 13px;
          font-weight: 800;
          color: hsl(var(--foreground));
        }
        .scan-list-subtitle {
          margin-top: 2px;
          font-size: 9px;
          color: hsl(var(--muted-foreground));
        }
        .scan-list-count {
          border-radius: 999px;
          padding: 4px 8px;
          background: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
          font-size: 10px;
          font-weight: 800;
        }
        .scan-qty-total {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 12px;
          padding: 11px 12px;
          border-radius: 11px;
          background: hsl(var(--primary) / 0.08);
          color: hsl(var(--foreground));
          font-size: 12px;
          font-weight: 700;
        }
        .scan-qty-total strong {
          color: hsl(var(--primary));
          font-size: 15px;
        }

        /* Industrial scanner redesign */
        .scan-page {
          max-width: 430px;
          gap: 12px;
          color: #14213d;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        }
        .scan-panel {
          border-color: #e4e0d4;
          border-radius: 18px;
          background: #fff;
          box-shadow: 0 14px 34px rgba(20,33,61,.1);
        }
        .scan-hero {
          min-height: 94px;
          padding: 18px;
          background: #14213d;
          color: #fff;
        }
        .scan-focus-copy, .scan-hero-copy { min-width: 0; flex: 1; }
        .scan-header-back {
          width: 36px;
          height: 36px;
          flex: 0 0 36px;
          border: 1px solid rgba(255,255,255,.16);
          border-radius: 10px;
          background: rgba(255,255,255,.1);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .scan-header-back:active { background: rgba(255,255,255,.2); }
        .scan-header-back + div { min-width: 0; flex: 1; }
        .scan-title {
          color: #fff;
          font-family: Impact, "Arial Narrow", sans-serif;
          font-size: 25px;
          font-weight: 700;
          letter-spacing: .045em;
          line-height: 1;
          text-transform: uppercase;
        }
        .scan-sub { margin-top: 7px; color: #b9c2dc; font-size: 12px; }
        .scan-mode-badge {
          margin-top: 7px;
          padding: 4px 8px;
          background: rgba(251,97,7,.2);
          color: #ffd3b9;
          font-size: 10px;
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        .scan-icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: rgba(255,255,255,.1);
          box-shadow: none;
        }
        .scan-workflow {
          gap: 0;
          padding: 18px 12px 16px;
          background: #fff;
        }
        .scan-workflow-step {
          position: relative;
          flex-direction: column;
          gap: 6px;
          color: #6b7280;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .04em;
          text-align: center;
          text-transform: uppercase;
        }
        .scan-workflow-step:not(:first-child)::before {
          content: "";
          position: absolute;
          top: 14px;
          right: calc(50% + 16px);
          width: calc(100% - 32px);
          height: 2px;
          background: #e4e0d4;
        }
        .scan-workflow-number {
          width: 30px;
          height: 30px;
          flex-basis: 30px;
          z-index: 1;
          border: 2px solid #e4e0d4;
          background: #e4e0d4;
          color: #6b7280;
          font-size: 12px;
        }
        .scan-workflow-step.is-active .scan-workflow-number {
          border-color: #fb6107;
          background: #fb6107;
          color: #fff;
        }
        .scan-workflow-step.is-done .scan-workflow-number {
          border-color: #1b7a43;
          background: #1b7a43;
          color: #fff;
        }
        .scan-session-summary { gap: 10px; padding: 0 16px 18px; }
        .scan-session-item { padding: 12px 13px; border-color: #e4e0d4; border-radius: 12px; background: #fff; }
        .scan-session-label { color: #6b7280; font-size: 10px; }
        .scan-session-value { color: #14213d; font-family: Consolas, monospace; font-size: 12px; }
        .scan-capture { padding: 17px 16px 18px; border-color: #e4e0d4; }
        .scan-instruction-kicker { color: #c24c05; font-size: 11px; letter-spacing: .1em; }
        .scan-instruction-title {
          color: #14213d;
          font-family: Impact, "Arial Narrow", sans-serif;
          font-size: 27px;
          letter-spacing: .025em;
          text-transform: uppercase;
        }
        .scan-instruction-detail { color: #6b7280; font-size: 13px; }
        .scan-input { min-height: 52px; border-color: #e4e0d4; background: #f4f2ec; color: #14213d; font-family: Consolas, monospace; }
        .scan-input:focus { border-color: #fb6107; background: #fffbf8; box-shadow: 0 0 0 3px rgba(251,97,7,.12); }
        .scan-input-icon { color: #c24c05; }
        .scan-mode-control {
          margin-bottom: 10px;
          padding: 10px;
          border: 2px solid #8bd2a7;
          border-radius: 12px;
          background: #eef9f2;
        }
        .scan-mode-control.is-deduct { border-color: #f3a0a4; background: #fff0f0; }
        .scan-mode-label { color: #6b7280; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .scan-mode-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }
        .scan-mode-button {
          min-height: 40px;
          border: 1px solid #b9d9c5;
          border-radius: 9px;
          background: #fff;
          color: #176137;
          font: 800 11px Inter, sans-serif;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .scan-mode-button.is-active { border-color: #16834a; background: #16834a; color: #fff; }
        .scan-mode-deduct { border-color: #e7b2b5; color: #a21f27; }
        .scan-mode-deduct.is-active { border-color: #c1272d; background: #c1272d; color: #fff; }
        .scan-mode-help { margin-top: 6px; color: #596277; font-size: 9px; line-height: 1.35; }
        .scan-feedback { padding: 12px 14px; border-radius: 12px; background: #e4eefa; color: #124a82; font-size: 12px; }
        .scan-quantity-option {
          border: 1px solid #bee3cc;
          border-radius: 12px;
          background: #e4f3e9;
          box-shadow: none;
        }
        .scan-quantity-option.is-enabled { border-color: #f0ccad; background: #ffe8da; box-shadow: none; }
        .scan-quantity-option-title { color: #14213d; font-size: 14px; }
        .scan-quantity-switch:checked { background: #fb6107; }
        .scan-start-button,
        .scan-action-primary {
          min-height: 54px;
          border-radius: 12px;
          background: #fb6107;
          box-shadow: 0 9px 22px rgba(251,97,7,.22);
          font-family: inherit;
        }
        .scan-action { min-height: 44px; border-color: #e4e0d4; border-radius: 11px; background: #fff; color: #14213d; font-family: inherit; }
        .scan-action-danger { color: #c1272d; }
        .scan-focus-header {
          min-height: 94px;
          padding: 18px;
          border: 0;
          background: #14213d;
          color: #fff;
        }
        .scan-focus-title { color: #fff; font-family: Impact, "Arial Narrow", sans-serif; font-size: 22px; letter-spacing: .035em; text-transform: uppercase; }
        .scan-focus-location { color: #ffd3b9; }
        .scan-focus-reference { color: #b9c2dc; font-family: Consolas, monospace; font-size: 11px; }
        .scan-ready-badge {
          align-self: flex-end;
          margin-bottom: 2px;
          padding: 6px 9px;
          border: 0;
          border-radius: 999px;
          background: rgba(255,255,255,.12);
          color: #fff;
          font: 800 10px Inter, sans-serif;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .scan-header-mode {
          grid-column: 2;
          grid-row: 1;
          flex: 0 0 auto;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 5px;
          padding: 4px;
          border-radius: 10px;
          background: rgba(255,255,255,.1);
        }
        .scan-header-mode-button {
          width: 42px;
          min-height: 35px;
          padding: 0 8px;
          border: 1px solid rgba(255,255,255,.28);
          border-radius: 7px;
          background: transparent;
          color: #dce4f5;
          font: 900 9px 'Sora', sans-serif;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
        }
        .scan-header-mode-button.is-active { border-color: #37c779; background: #16834a; color: #fff; }
        .scan-header-mode-button.is-deduct.is-active { border-color: #ff9ba0; background: #c1272d; }
        .scan-focus-mode-status { grid-column: 1 / -1; margin-top: 3px; color: #aebbd1; font-size: 9px; line-height: 1.25; }
        .scan-pause-button { min-height: 44px; border-color: rgba(255,255,255,.18); background: rgba(255,255,255,.1); color: #fff; font-family: inherit; }
        .scan-session-tabs { border-color: #e4e0d4; }
        .scan-session-tab { min-height: 48px; color: #6b7280; font-family: inherit; }
        .scan-session-tab.is-active { border-bottom-color: #fb6107; color: #c24c05; }
        .scan-session-tab span { background: #ffe8da; color: #c24c05; }
        .scan-totals-strip {
          display: grid;
          grid-template-columns: repeat(3,minmax(0,1fr));
          border-bottom: 1px solid #e4e0d4;
          background: #f4f2ec;
        }
        .scan-total-cell { min-width: 0; padding: 13px 8px; text-align: center; }
        .scan-total-cell + .scan-total-cell { border-left: 1px solid #e4e0d4; }
        .scan-total-cell span { display: block; color: #6b7280; font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
        .scan-total-cell strong { display: block; margin-top: 4px; overflow: hidden; color: #14213d; font-size: 17px; text-overflow: ellipsis; }
        .scan-total-highlight strong { color: #fb6107; }
        .scan-list-header { padding: 14px; border-color: #e4e0d4; }
        .scan-list-title { color: #14213d; font-size: 15px; }
        .scan-list-count { background: #ffe8da; color: #c24c05; }
        .scan-history { padding: 0; }
        .scan-sku-group {
          margin: 10px 12px 0;
          overflow: hidden;
          border: 1px solid #e4e0d4;
          border-radius: 11px;
          background: #fff;
        }
        .scan-sku-group:last-child { margin-bottom: 12px; }
        .scan-sku-header {
          padding: 10px 12px;
          border-bottom: 1px solid #e4e0d4;
          color: #14213d;
          font-family: Consolas, monospace;
          font-size: 12px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .scan-sku-header strong { color: #14213d; font-size: 14px; }
        .scan-sku-header small { color: #6b7280; font-size: 9px; font-weight: 700; }
        .scan-sku-identity { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .scan-sku-name { overflow: hidden; color: #6b7280; font-family: 'Sora', sans-serif; font-size: 9px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
        .scan-history-row { width: 100%; margin: 0; padding: 12px; border: 0; border-bottom: 1px solid #e4e0d4; background: #fff; text-align: left; cursor: pointer; }
        .scan-history-row:active { background: #f4f8ff; }
        .scan-history-main { width: 100%; }
        .scan-history-top { align-items: flex-start; }
        .scan-history-code { color: #475569; font-family: inherit; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
        .scan-history-quantity { color: #14213d; font-size: 15px; font-weight: 900; white-space: nowrap; }
        .scan-history-location { max-width: 100%; margin-top: 7px; padding: 5px 8px; background: #eef4ff; color: #2559a7; font-size: 10px; }
        .scan-history-detail { margin-top: 4px; color: #6b7280; font-size: 10px; }
        .scan-page.is-scanning .scan-sku-group { border-color: #dce3ed; box-shadow: 0 2px 8px rgba(20,33,61,.05); }
        .scan-page.is-scanning .scan-sku-header { padding: 11px 12px; background: #f8fafc; }
        .scan-page.is-scanning .scan-sku-header > strong { font-size: 15px; white-space: nowrap; }
        .scan-page.is-scanning .scan-sku-identity > span:first-child { font-size: 13px; }
        .scan-page.is-scanning .scan-sku-name { max-width: 230px; font-size: 10px; }
        .scan-last-success { border-color: #bee3cc; background: #e4f3e9; color: #155a32; }
        .scan-submit-dock {
          bottom: 8px;
          margin: 0;
          border-color: #e4e0d4;
          border-radius: 15px;
          background: rgba(255,255,255,.97);
          box-shadow: 0 14px 34px rgba(20,33,61,.18);
        }
        .scan-submit-button { min-height: 48px; border-radius: 12px; background: #fb6107; font-family: inherit; }
        .scan-confirm-dialog { border-color: #e4e0d4; border-radius: 18px; }
        .scan-confirm-button,
        .scan-qty-input,
        .scan-qty-key { border-color: #e4e0d4; background: #f4f2ec; color: #14213d; font-family: inherit; }
        .scan-confirm-button-primary { background: #c1272d; color: #fff; }
        .scan-qty-button-primary { background: #fb6107; color: #fff; }
        .scan-detail-backdrop {
          padding: 0;
          background: hsl(var(--card));
          align-items: stretch;
          justify-content: stretch;
          overflow: hidden;
        }
        .scan-detail-dialog {
          width: 100vw;
          max-width: none;
          height: 100vh;
          height: 100dvh;
          max-height: 100dvh;
          box-sizing: border-box;
          padding: calc(10px + env(safe-area-inset-top, 0px)) max(10px, env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) max(10px, env(safe-area-inset-left, 0px));
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border: 0;
          border-radius: 0;
          box-shadow: none;
        }
        .scan-detail-dialog .scan-confirm-title { flex: 0 0 auto; font-size: 19px; line-height: 1.2; }
        .scan-detail-dialog .scan-confirm-text { flex: 0 0 auto; margin-top: 3px; font-size: 12px; line-height: 1.35; }
        .scan-detail-summary { flex: 0 0 auto; margin-top: 8px; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 6px; }
        .scan-detail-stat strong { white-space: nowrap; }
        .scan-detail-transaction { position: relative; padding-right: 42px; }
        .scan-detail-edit-button {
          position: absolute; top: 10px; right: 8px; width: 32px; height: 32px;
          border: 1px solid #d8dee8; border-radius: 9px; background: #fff;
          display: inline-flex; align-items: center; justify-content: center;
          color: #374151; cursor: pointer;
        }
        .scan-detail-edit-button:disabled { opacity: .35; cursor: not-allowed; }
        .scan-edit-qty-input {
          width: 100%; min-height: 46px; border: 1px solid #cbd5e1; border-radius: 10px;
          padding: 0 12px; font-size: 18px; font-weight: 800; box-sizing: border-box;
        }
        .scan-qty-package-toggle {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          width: 100%;
          margin: 10px 0 12px;
          padding: 4px;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          background: #f8fafc;
          box-sizing: border-box;
        }
        .scan-qty-package-button {
          min-width: 0;
          min-height: 42px;
          padding: 9px 10px;
          border: 1px solid transparent;
          border-radius: 9px;
          background: transparent;
          color: #475569;
          font: inherit;
          font-size: 14px;
          font-weight: 800;
          line-height: 1.1;
          text-align: center;
          white-space: nowrap;
          cursor: pointer;
          box-sizing: border-box;
        }
        .scan-qty-package-button.is-active {
          background: #1677ff;
          border-color: #1677ff;
          color: #ffffff;
          box-shadow: none;
        }
        .scan-qty-package-button:focus-visible {
          outline: 2px solid currentColor;
          outline-offset: 2px;
        }
        /* Keep the complete quantity workflow visible on handheld scanners. */
        .scan-confirm-dialog.scan-qty-dialog-compact {
          width: min(92vw, 390px);
          max-height: calc(100dvh - 16px);
          overflow: hidden;
          padding: 12px;
          border-radius: 18px;
          box-sizing: border-box;
        }
        .scan-qty-dialog-compact .scan-confirm-title {
          margin-bottom: 2px;
          font-size: 18px;
          line-height: 1.15;
        }
        .scan-qty-dialog-compact .scan-confirm-text {
          margin: 0 0 6px;
          font-size: 11px;
          line-height: 1.2;
        }
        .scan-qty-dialog-compact .scan-qty-item {
          padding: 8px 10px;
          margin-bottom: 6px;
          border-radius: 10px;
        }
        .scan-qty-dialog-compact .scan-qty-item-code {
          font-size: 14px;
          line-height: 1.15;
        }
        .scan-qty-dialog-compact .scan-qty-item-detail {
          margin-top: 2px;
          font-size: 11px;
          line-height: 1.15;
        }
        .scan-qty-dialog-compact .scan-qty-package-toggle {
          min-height: 0;
          margin: 5px 0 6px !important;
          padding: 3px !important;
          gap: 5px !important;
        }
        .scan-qty-dialog-compact .scan-qty-package-button {
          min-height: 32px !important;
          padding: 5px 8px !important;
          font-size: 12px !important;
        }
        .scan-qty-dialog-compact .scan-qty-label {
          margin: 0 0 3px;
          font-size: 11px;
          line-height: 1.1;
        }
        .scan-qty-dialog-compact .scan-qty-input {
          min-height: 42px;
          height: 42px;
          padding: 5px 10px;
          font-size: 24px;
          line-height: 1;
          border-radius: 10px;
        }
        .scan-qty-dialog-compact .scan-qty-keypad {
          gap: 5px;
          margin-top: 6px;
        }
        .scan-qty-dialog-compact .scan-qty-key {
          min-height: 58px;
          height: 58px;
          padding: 6px;
          border-radius: 11px;
          font-size: 22px;
          line-height: 1;
        }
        .scan-qty-dialog-compact .scan-qty-total {
          min-height: 0;
          margin-top: 6px;
          padding: 6px 8px;
          border-radius: 9px;
          font-size: 11px;
          line-height: 1.15;
        }
        .scan-qty-dialog-compact .scan-qty-total strong {
          font-size: 13px;
          white-space: nowrap;
        }
        .scan-qty-dialog-compact .scan-confirm-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
          margin-top: 7px;
        }
        .scan-qty-dialog-compact .scan-confirm-button {
          width: 100%;
          min-height: 36px;
          padding: 6px 10px;
          font-size: 12px;
        }

        /* Extra compression for the short 640px-class scanner viewport. */
        @media (max-height: 680px) {
          .scan-confirm-dialog.scan-qty-dialog-compact {
            padding: 9px 10px;
            max-height: calc(100dvh - 8px);
            border-radius: 14px;
          }
          .scan-qty-dialog-compact .scan-confirm-text {
            margin-bottom: 4px;
          }
          .scan-qty-dialog-compact .scan-qty-item {
            padding: 6px 8px;
            margin-bottom: 4px;
          }
          .scan-qty-dialog-compact .scan-qty-package-toggle {
            margin: 3px 0 4px !important;
          }
          .scan-qty-dialog-compact .scan-qty-package-button {
            min-height: 29px !important;
            padding: 3px 6px !important;
          }
          .scan-qty-dialog-compact .scan-qty-input {
            min-height: 36px;
            height: 36px;
            font-size: 21px;
          }
          .scan-qty-dialog-compact .scan-qty-keypad {
            gap: 4px;
            margin-top: 4px;
          }
          .scan-qty-dialog-compact .scan-qty-key {
            min-height: 50px;
            height: 50px;
            font-size: 20px;
          }
          .scan-qty-dialog-compact .scan-qty-total {
            margin-top: 4px;
            padding: 4px 7px;
          }
          .scan-qty-dialog-compact .scan-confirm-actions {
            margin-top: 4px;
          }
          .scan-qty-dialog-compact .scan-confirm-button {
            min-height: 32px;
            padding: 4px 8px;
          }
        }
        .scan-detail-stat { min-width: 0; padding: 8px 6px; border-radius: 9px; background: #f4f2ec; }
        .scan-detail-stat span { display: block; color: #6b7280; font-size: 9px; font-weight: 800; text-transform: uppercase; }
        .scan-detail-stat strong { display: block; margin-top: 3px; color: #14213d; font-size: 13px; line-height: 1.2; overflow-wrap: anywhere; }
        .scan-detail-meta { flex: 0 0 auto; margin-top: 7px; color: #596277; font-size: 11px; line-height: 1.4; }
        .scan-detail-history { min-height: 72px; flex: 1 1 auto; margin-top: 7px; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; border: 1px solid #e4e0d4; border-radius: 10px; }
        .scan-detail-transaction { padding: 9px; display: grid; grid-template-columns: max-content max-content; justify-content: start; align-items: center; gap: 5px 10px; border-bottom: 1px solid #e4e0d4; font-size: 12px; line-height: 1.3; }
        .scan-detail-transaction:last-child { border-bottom: 0; }
        .scan-detail-transaction > span:first-child { white-space: nowrap; }
        .scan-detail-action { min-width: 0; width: max-content; height: auto; min-height: 0; justify-self: start; align-self: center; padding: 3px 6px; border-radius: 5px; background: #eef1f5; font-size: 10px; font-weight: 900; line-height: 1; letter-spacing: .02em; white-space: nowrap; }
        .scan-detail-action.is-add { color: #16834a; }
        .scan-detail-action.is-deduct { color: #c1272d; }
        .scan-detail-action.is-submitted { background: #e8eef9; color: #254a87; }
        .scan-detail-action.is-correction_submitted { background: #fff0e8; color: #b84b10; }
        .scan-detail-running { grid-column: 1 / -1; color: #14213d; font-size: 12px; font-weight: 800; }
        .scan-detail-location { grid-column: 1 / -1; color: #6b7280; font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
        .scan-detail-close { flex: 0 0 auto; width: 100%; min-height: 42px; margin-top: 7px; font-size: 14px; }

        .scan-page.is-scanning { gap: 0; }
        .scan-page.is-scanning > .scan-panel:first-child { display: contents; }
        .scan-page.is-scanning .scan-focus-header {
          order: 1;
          border-radius: 18px 18px 0 0;
        }
        .scan-page.is-scanning .scan-session-tabs { display: none; }
        .scan-page.is-scanning .scan-history {
          order: 2;
          border-radius: 0;
          box-shadow: none;
        }
        .scan-page.is-scanning .scan-list-header { display: none; }
        .scan-page.is-scanning .scan-capture {
          order: 3;
          border: 1px solid #e4e0d4;
          border-top: 0;
          border-radius: 0 0 18px 18px;
          background: #fff;
          box-shadow: 0 14px 34px rgba(20,33,61,.1);
        }
        .scan-page.is-scanning .scan-last-success { display: flex; }
        .scan-page.is-scanning .scan-submit-dock {
          order: 4;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          margin-top: 10px;
          padding: 0;
          border: 0;
          background: transparent;
          box-shadow: none;
        }
        .scan-page.is-scanning .scan-submit-button { width: 100%; background: #fb6107; }
        .scan-page.is-scanning .scan-submit-dock > button:only-child { grid-column: 1 / -1; }
        .scan-page.is-scanning .scan-finish-location {
          min-width: 0;
          margin: 0;
          padding: 0 8px;
          line-height: 1.25;
        }

        /* Fixed viewport scan workspace */
        .scan-page {
          width: 100%;
          max-width: none;
          height: 100%;
          min-height: 0;
          margin: 0;
          overflow: hidden;
        }
        .scan-page.is-setup .scan-panel {
          width: 100%;
          height: 100%;
          min-height: 0;
          border: 0;
          border-radius: 0;
          box-shadow: none;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .scan-page.is-setup .scan-capture {
          min-height: 0;
          flex: 1 1 auto;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding-bottom: calc(18px + env(safe-area-inset-bottom));
        }
        .scan-page.is-setup .scan-start-button {
          flex: 0 0 auto;
          margin-bottom: 8px;
        }
        .scan-page.is-setup .scan-actions-secondary {
          position: static;
          z-index: auto;
          margin: 8px 0 0;
          padding: 0;
          border-top: 1px solid #e4e0d4;
          padding-top: 8px;
          background: transparent;
        }
        .scan-page.is-scanning {
          display: flex;
          flex-direction: column;
          position: relative;
          overflow-y: auto;
          overscroll-behavior: contain;
        }
        .scan-page.is-scanning.has-action-dock {
          padding-bottom: 0;
        }
        .scan-page.is-scanning .scan-focus-header {
          flex: 0 0 auto;
          border-radius: 0;
        }
        .scan-page.is-scanning .scan-history {
          min-height: clamp(180px, 32dvh, 280px);
          flex: 1 0 clamp(180px, 32dvh, 280px);
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          border: 0;
        }
        .scan-page.is-scanning .scan-totals-strip {
          position: sticky;
          top: 0;
          z-index: 5;
        }
        .scan-page.is-scanning .scan-capture {
          flex: 0 0 auto;
          border-right: 0;
          border-bottom: 0;
          border-left: 0;
          border-radius: 0;
          box-shadow: none;
        }
        .scan-page.is-scanning .scan-submit-dock {
          position: absolute;
          right: 0;
          bottom: 0;
          left: 0;
          margin: 0;
          padding: 8px 12px max(8px, env(safe-area-inset-bottom));
          border-top: 1px solid #e4e0d4;
          border-radius: 0;
          background: #fff;
          box-shadow: 0 -8px 22px rgba(20,33,61,.08);
          z-index: 30;
        }
        .scan-page.is-scanning .scan-submit-dock > button {
          min-width: 0;
          min-height: 50px;
          margin: 0;
          font-size: 11px;
          font-weight: 900;
          white-space: normal;
        }
        .scan-page.is-scanning .scan-finish-location {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        @media (min-width: 768px) {
          .scan-page {
            max-width: none;
            margin: 0;
          }
          .scan-context {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }

        @media (max-width: 430px) {
          .scan-hero,
          .scan-capture,
          .scan-status {
            padding-left: 14px;
            padding-right: 14px;
          }
          .scan-context {
            padding-left: 14px;
            padding-right: 14px;
          }
          .scan-submit-dock { bottom: 6px; }
          .scan-workflow,
          .scan-session-summary {
            padding-left: 14px;
            padding-right: 14px;
          }
          .scan-workflow-step {
            flex-direction: column;
            text-align: center;
            gap: 5px;
          }
        }

        /* Readability baseline for warehouse operators. */
        .scan-sub, .scan-feedback, .scan-instruction-detail,
        .scan-session-label, .scan-session-value, .scan-mode-help,
        .scan-history-detail, .scan-detail-meta, .scan-detail-location,
        .scan-location-card-path, .scan-location-card-stats,
        .scan-last-activity-location, .scan-last-activity-item-name,
        .scan-last-activity-time { font-size: 13px; line-height: 1.5; }
        .scan-instruction-kicker, .scan-mode-label, .scan-total-cell span,
        .scan-sku-header small, .scan-detail-stat span,
        .scan-detail-action, .scan-location-card-status,
        .scan-last-activity-label { font-size: 11px; }
        .scan-sku-name, .scan-last-activity-item,
        .scan-location-summary-title { font-size: 13px; }
        .scan-detail-transaction, .scan-detail-running { font-size: 14px; }
        .scan-page button, .scan-page input, .scan-page select,
        .scan-page textarea { font-size: 15px; }
        .scan-page.is-scanning .scan-submit-dock > button { min-height: 54px; font-size: 14px; }

        /* Physical Count UX safety layer: readable, wrapped, no label overlap. */
        .scan-focus-copy,
        .scan-hero-copy,
        .scan-history-main,
        .scan-sku-identity,
        .scan-current-location,
        .scan-last-main,
        .scan-location-card,
        .scan-detail-dialog {
          min-width: 0;
        }
        .scan-title,
        .scan-focus-title,
        .scan-focus-reference,
        .scan-current-location-id,
        .scan-current-location-path,
        .scan-history-code,
        .scan-history-location,
        .scan-sku-header span,
        .scan-last-code,
        .scan-last-running,
        .scan-location-card-id,
        .scan-location-card-path,
        .scan-session-value {
          overflow-wrap: anywhere;
        }
        .scan-session-summary,
        .scan-totals-strip {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        .scan-detail-summary {
          width: 100%;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .scan-workflow {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        .scan-workflow-step {
          min-width: 0;
        }
        .scan-workflow-step:not(:first-child)::before {
          z-index: 0;
          pointer-events: none;
        }
        .scan-workflow-number {
          position: relative;
          z-index: 2;
        }
        .scan-workflow-step > span:last-child {
          position: relative;
          z-index: 2;
          max-width: 100%;
          padding: 1px 3px;
          background: #fff;
          line-height: 1.25;
          overflow-wrap: anywhere;
        }
        .scan-history-top,
        .scan-sku-header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: start;
        }
        .scan-history-quantity,
        .scan-sku-header strong {
          text-align: right;
          white-space: nowrap;
        }
        .scan-total-cell,
        .scan-session-item,
        .scan-detail-stat {
          min-width: 0;
        }
        .scan-total-cell strong,
        .scan-detail-stat strong {
          overflow-wrap: anywhere;
          text-overflow: clip;
        }
        .scan-quantity-option {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
        }
        .scan-quantity-option > span {
          min-width: 0;
        }
        .scan-actions-secondary,
        .scan-confirm-actions,
        .scan-submit-dock {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .scan-action,
        .scan-start-button,
        .scan-submit-button,
        .scan-finish-location,
        .scan-confirm-button,
        .scan-qty-key {
          line-height: 1.25;
          white-space: normal;
        }
        .scan-confirm-dialog {
          max-height: calc(100dvh - 36px);
          overflow-y: auto;
        }
        .scan-qty-dialog {
          display: flex;
          flex-direction: column;
          max-height: calc(100dvh - 20px);
          overflow-y: auto;
          padding: 14px;
        }
        .scan-qty-dialog .scan-confirm-title {
          font-size: 16px;
          line-height: 1.15;
        }
        .scan-qty-dialog .scan-confirm-text {
          margin-top: 3px;
          font-size: 11px;
          line-height: 1.35;
        }
        .scan-qty-dialog .scan-qty-item {
          margin-top: 8px;
          padding: 9px 10px;
        }
        .scan-qty-dialog .scan-qty-item-code {
          font-size: 13px;
        }
        .scan-qty-dialog .scan-qty-item-detail {
          font-size: 11px;
          line-height: 1.3;
        }
        .scan-qty-dialog .scan-qty-label {
          margin-top: 8px;
          font-size: 11px;
        }
        .scan-qty-dialog .scan-package-status {
          margin-top: 7px;
        }
        .scan-qty-dialog .scan-package-status button {
          min-height: 36px;
          font-size: 10px;
        }
        .scan-qty-dialog .scan-qty-input {
          min-height: 44px;
          margin-top: 4px;
          font-size: 20px;
        }
        .scan-qty-dialog .scan-qty-keypad {
          gap: 6px;
          margin-top: 7px;
        }
        .scan-qty-dialog .scan-qty-key {
          min-height: 37px;
          border-radius: 9px;
          font-size: 16px;
        }
        .scan-qty-dialog > .scan-qty-key {
          margin-top: 6px !important;
          min-height: 34px;
          font-size: 11px;
        }
        .scan-qty-dialog .scan-qty-total {
          margin-top: 7px;
          padding: 8px 10px;
        }
        .scan-qty-dialog .scan-qty-total span {
          font-size: 10px;
        }
        .scan-qty-dialog .scan-qty-total strong {
          font-size: 12px;
        }
        .scan-qty-dialog .scan-confirm-actions {
          flex: 0 0 auto;
          margin-top: 8px;
          gap: 8px;
        }
        .scan-qty-dialog .scan-confirm-button {
          min-height: 40px;
        }
        @media (max-width: 380px) {
          .scan-session-summary {
            grid-template-columns: 1fr;
          }
          /* Keep audit totals horizontal on scanner-width screens. Stacking these
             three cards was making the item-detail dialog taller than the viewport. */
          .scan-detail-summary {
            width: 100%;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 4px;
          }
          .scan-detail-stat { padding: 7px 4px; }
          .scan-detail-stat span { font-size: 9px; }
          .scan-detail-stat strong { font-size: 12px; }
          .scan-workflow-step {
            flex-direction: column;
            text-align: center;
            gap: 5px;
          }
          .scan-history-top,
          .scan-sku-header {
            grid-template-columns: 1fr;
          }
          .scan-history-quantity,
          .scan-sku-header strong {
            text-align: left;
            white-space: normal;
          }
          .scan-actions-secondary,
          .scan-confirm-actions,
          .scan-submit-dock {
            grid-template-columns: 1fr;
          }
        }
        @media (max-height: 650px) {
          .scan-confirm-backdrop {
            padding: 10px;
            align-items: flex-start;
          }
          .scan-qty-dialog {
            max-height: calc(100dvh - 20px);
            padding: 12px;
          }
          .scan-qty-dialog .scan-confirm-text {
            display: none;
          }
          .scan-qty-dialog .scan-qty-item {
            margin-top: 7px;
            padding: 8px 9px;
          }
          .scan-qty-dialog .scan-qty-input {
            min-height: 40px;
          }
          .scan-qty-dialog .scan-qty-key {
            min-height: 34px;
          }
          .scan-qty-dialog > .scan-qty-key {
            min-height: 31px;
          }
          .scan-qty-dialog .scan-confirm-button {
            min-height: 38px;
          }
        }
        @media (max-height: 700px) {
          .scan-hero, .scan-focus-header { min-height: 72px; padding-top: 12px; padding-bottom: 12px; }
          .scan-workflow { padding-top: 10px; padding-bottom: 10px; }
          .scan-session-summary { padding-bottom: 10px; }
          .scan-capture { padding-top: 10px; padding-bottom: 10px; }
          .scan-instruction-title { font-size: 22px; }
          .scan-quantity-option { padding: 10px 12px; }
          .scan-feedback { padding: 8px 10px; }
        }

        /* 2026 Physical Count mobile UX refresh */
        .scan-progress-board {
          padding: 12px 14px;
          border-bottom: 1px solid #dfe5ef;
          background: #f8fbff;
        }
        .scan-progress-top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .scan-progress-top > div { min-width:0; display:flex; flex-direction:column; gap:3px; }
        .scan-progress-kicker { color:#65738c; font-size:9px; font-weight:900; letter-spacing:.07em; text-transform:uppercase; }
        .scan-progress-top strong { color:#14213d; font-size:13px; }
        .scan-progress-state { flex:0 0 auto; padding:5px 8px; border-radius:999px; background:#e4f3e9; color:#16834a; font-size:8px; font-weight:900; letter-spacing:.05em; }
        .scan-progress-state.is-recount { background:#fff0cc; color:#9a5a00; }
        .scan-progress-pills {
          display: flex;
          gap: 6px;
          width: 100%;
          min-width: 0;
          max-width: 100%;
          margin-top: 9px;
          overflow-x: auto;
          overflow-y: hidden;
          touch-action: pan-x;
          overscroll-behavior-x: contain;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
          padding-bottom: 5px;
        }
        .scan-progress-view-all {
          flex: 0 0 auto;
          border: 0;
          background: transparent;
          color: #2157a6;
          font: inherit;
          font-size: 10px;
          font-weight: 800;
          padding: 6px;
          cursor: pointer;
        }
        .scan-progress-pill, .scan-progress-more { flex:0 0 auto; max-width:132px; padding:6px 8px; border:1px solid #dce3ee; border-radius:8px; background:#fff; color:#526079; font:800 9px 'JetBrains Mono', monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .scan-progress-pill.is-done { border-color:#bfe5cd; background:#e9f7ee; color:#16834a; }
        .scan-progress-pill.is-active { border-color:#8bb4f6; background:#eaf2ff; color:#2157a6; box-shadow:inset 0 0 0 1px #8bb4f6; }
        .scan-current-location { border-color:#d8e5f7; background:#fffaf0; box-shadow:0 4px 14px rgba(20,33,61,.06); }
        .scan-current-location-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .scan-recount-badge { padding:4px 7px; border-radius:999px; background:#fff0cc; color:#9a5a00; font-size:8px; font-weight:900; letter-spacing:.05em; }
        .scan-current-location-id { font-size:17px; }
        .scan-header-mode { min-width:158px; grid-template-columns:1fr 1fr; background:rgba(255,255,255,.12); }
        .scan-header-mode-button { width:auto; min-height:38px; padding:0 10px; font-size:9px; }
        .scan-page.is-scanning .scan-focus-header { background:linear-gradient(135deg,#0759ad,#06427f); }
        .scan-page.is-scanning .scan-capture { padding:12px 14px 14px; }
        .scan-page.is-scanning .scan-history { border:1px solid #e4e0d4; border-top:0; }
        .scan-page.is-scanning .scan-totals-strip { background:#f8fafc; }
        .scan-page.is-scanning .scan-submit-dock { position:sticky; bottom:max(8px, env(safe-area-inset-bottom, 0px)); z-index:8; padding:7px; border:1px solid #dfe5ef; border-radius:15px; background:rgba(255,255,255,.96); box-shadow:0 10px 30px rgba(20,33,61,.16); backdrop-filter:blur(10px); }
        .scan-page.is-scanning .scan-finish-location { min-height:50px; border-color:#b9d0f4; background:#edf4ff; color:#1457a6; }
        .scan-page.is-scanning .scan-submit-button { min-height:50px; background:#0969da; }
        .scan-last-success { box-shadow:0 5px 16px rgba(22,131,74,.09); }
        .scan-last-code { font-size:15px; }
        .scan-last-quantity { font-size:14px; font-weight:900; }
        .scan-review-reference { margin-top:4px; color:#2559a7; font:800 12px 'JetBrains Mono', monospace; }
        .scan-review-stats { margin-top:12px; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; }
        .scan-review-stats > div { min-width:0; padding:9px 5px; border-radius:10px; background:#f4f7fb; text-align:center; }
        .scan-review-stats span { display:block; color:#6b7280; font-size:8px; font-weight:800; text-transform:uppercase; }
        .scan-review-stats strong { display:block; margin-top:3px; color:#14213d; font-size:13px; overflow:hidden; text-overflow:ellipsis; }
        .scan-review-list { max-height:34dvh; margin-top:10px; overflow-y:auto; border:1px solid #e4e8ef; border-radius:11px; }
        /* Review has a fixed action footer: only the completed-location list scrolls. */
        .scan-confirm-backdrop.scan-review-backdrop {
          padding:8px;
          padding-top:max(8px, env(safe-area-inset-top, 0px));
          padding-bottom:max(8px, env(safe-area-inset-bottom, 0px));
          box-sizing:border-box;
        }
        .bp-root .scan-confirm-dialog.scan-review-dialog {
          display:flex;
          flex-direction:column;
          width:min(100%, 440px);
          height:min(640px, calc(100vh - 24px));
          height:min(640px, calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
          max-height:calc(100vh - 24px);
          max-height:calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
          padding:14px;
          /* Fallback for older Android WebViews without dynamic viewport units. */
          overflow-y:auto;
          overscroll-behavior:contain;
          box-sizing:border-box;
        }
        .scan-review-dialog .scan-review-list {
          flex:0 1 auto;
          min-height:0;
          max-height:30vh;
          max-height:30dvh;
          overflow-y:auto;
          overscroll-behavior:contain;
          -webkit-overflow-scrolling:touch;
        }
        .scan-review-dialog .scan-review-note { flex-shrink:0; }
        .scan-review-dialog .scan-confirm-actions {
          position:sticky;
          bottom:0;
          z-index:2;
          flex-shrink:0;
          margin-top:10px;
          padding-top:8px;
          padding-bottom:max(8px, env(safe-area-inset-bottom, 0px));
          border-top:1px solid #e4e8ef;
          background:hsl(var(--card));
        }
        .scan-review-dialog .scan-confirm-actions .scan-confirm-button { min-height:46px; }
        @media (max-height: 650px) {
          .bp-root .scan-confirm-dialog.scan-review-dialog { padding:10px 12px; }
          .scan-review-dialog .scan-review-stats { margin-top:7px; }
          .scan-review-dialog .scan-review-stats > div { padding:6px 3px; }
          .scan-review-dialog .scan-review-note { margin-top:6px; padding:6px 8px; }
        }
        .scan-review-location { padding:9px 10px; display:flex; align-items:center; gap:9px; border-bottom:1px solid #edf0f4; color:#16834a; }
        .scan-review-location:last-child { border-bottom:0; }
        .scan-review-location > div { min-width:0; display:flex; flex:1; flex-direction:column; gap:2px; }
        .scan-review-location strong { color:#14213d; font:800 11px 'JetBrains Mono', monospace; overflow-wrap:anywhere; }
        .scan-review-location span { color:#6b7280; font-size:9px; }
        .scan-review-note { margin-top:10px; padding:9px 10px; border-radius:9px; background:#fff8e8; color:#7c5700; font-size:9px; line-height:1.4; }
        .scan-review-submit {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        @media (max-width: 380px) {
          .scan-focus-header { align-items:flex-start; }
          .scan-header-mode { min-width:132px; }
          .scan-header-mode-button { padding:0 6px; }
          .scan-focus-mode-status { max-width:180px; }
          .scan-review-stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
        }

        /* Quantity calculator: fixed 4-column calculator layout. */
        .scan-qty-dialog .scan-qty-keypad {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
          gap: 7px;
        }
        .scan-qty-dialog .scan-qty-key {
          width: 100%;
          min-width: 0;
        }
        .scan-qty-dialog .scan-qty-clear {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          min-height: 42px;
          margin-top: 8px;
          padding: 9px 12px;
          border: 1px solid #b9d5fa;
          border-radius: 10px;
          background: #edf5ff;
          color: #075cbd;
          font-size: 13px;
          font-weight: 800;
          line-height: 1.2;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .scan-qty-dialog .scan-qty-clear:active {
          background: #dcecff;
          border-color: #75acf6;
        }
        .scan-qty-dialog .scan-qty-clear:focus-visible {
          outline: 3px solid #8dbfff;
          outline-offset: 2px;
        }

        .scan-qty-dialog .scan-qty-total,
        .scan-qty-dialog .scan-package-summary {
          margin-top: 7px;
        }
        /* Three scan metrics must stay aligned and the quantity must never wrap digit-by-digit. */
        .scan-page.is-scanning .scan-totals-strip {
          grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        }
        .scan-page.is-scanning .scan-total-cell { min-width: 0; padding-left: 4px; padding-right: 4px; }
        .scan-page.is-scanning .scan-total-cell strong {
          width: 100%; overflow: visible; text-overflow: clip; white-space: nowrap;
          font-size: clamp(13px, 4vw, 17px); line-height: 1.15;
        }
        .scan-page.is-scanning .scan-total-cell span { line-height: 1.2; }

        /* Stable active-first Location Progress. The whole card opens the full list. */
        .scan-progress-button {
          width: 100%;
          display: block;
          border: 0;
          border-radius: 0;
          font-family: inherit;
          text-align: left;
          cursor: pointer;
          appearance: none;
        }
        .scan-progress-button:active { background: #f1f6fd; }
        .scan-progress-view-all {
          flex: 0 0 auto;
          color: #2157a6;
          font-size: 9px;
          font-weight: 900;
          white-space: nowrap;
        }
        /* Keep the final Location Progress rule scrollable on Android.
           An earlier overflow:hidden declaration masked overflow-x:auto
           and prevented touch swiping even with touch-action:pan-x. */
        .scan-progress-pills {
          min-height: 29px;
          overflow-x: auto;
          overflow-y: hidden;
          touch-action: pan-x;
          overscroll-behavior-x: contain;
          -webkit-overflow-scrolling: touch;
        }
        .scan-location-progress-dialog {
          width: min(94vw, 430px);
          max-height: min(82dvh, 720px);
          display: flex;
          flex-direction: column;
        }
        .scan-location-modal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .scan-location-modal-close {
          width: 34px;
          height: 34px;
          flex: 0 0 auto;
          border: 1px solid hsl(var(--border));
          border-radius: 9px;
          background: hsl(var(--background));
          color: hsl(var(--foreground));
          font-size: 22px;
          line-height: 1;
        }
        .scan-location-progress-list {
          min-height: 0;
          margin: 12px 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          border: 1px solid #e1e7ef;
          border-radius: 12px;
          background: #fff;
        }
        .scan-location-progress-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 11px;
          border-bottom: 1px solid #edf0f4;
        }
        .scan-location-progress-row:last-child { border-bottom: 0; }
        .scan-location-progress-row.is-active { background: #eaf2ff; }
        .scan-location-progress-row.is-done { background: #f5fbf7; }
        .scan-location-progress-row.is-active.is-done { background: #eaf2ff; }
        .scan-location-progress-index {
          width: 24px;
          height: 24px;
          flex: 0 0 24px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background: #eef2f7;
          color: #526079;
          font-size: 9px;
          font-weight: 900;
        }
        .scan-location-progress-row.is-active .scan-location-progress-index {
          background: #0969da;
          color: #fff;
        }
        .scan-location-progress-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .scan-location-progress-copy strong {
          color: #14213d;
          font: 800 11px 'JetBrains Mono', monospace;
          overflow-wrap: anywhere;
        }
        .scan-location-progress-copy span {
          color: #6b7280;
          font-size: 9px;
          line-height: 1.35;
        }
      `}</style>

      {(loadingOperation || isPreparingSubmission || isSubmitting) && (
        <div className="mfg-loading-overlay scan-submit-loading-overlay" role="status" aria-live="assertive" aria-label={loadingOperation?.title || (isPreparingSubmission ? "Preparing Physical Count" : stockChangeReview ? "Resubmitting Physical Count" : "Submitting Physical Count")}>
          <div className="mfg-loading-card scan-submit-loading-card">
            <span className="mfg-loading-spinner scan-submit-loading-spinner" aria-hidden="true" />
            <strong>{loadingOperation?.title || (isPreparingSubmission ? "Preparing Physical Count" : stockChangeReview ? "Resubmitting Physical Count" : "Submitting Physical Count")}</strong>
            <small>{loadingOperation?.detail || (isPreparingSubmission ? "Checking saved scans and ERPNext warehouse..." : "Please wait for ERPNext.")}</small>
          </div>
        </div>
      )}

      <section ref={scanSessionTopRef} className={`scan-page ${isScanSessionActive ? "is-scanning" : "is-setup"} ${showPcountActionDock ? "has-action-dock" : ""} ${!isScanSessionActive && mode === "pcount" ? "is-pcount-setup-redesign" : ""} ${isScanSessionActive && mode === "pcount" ? "is-pcount-redesign" : ""} ${isPcountReviewStage ? "is-review-stage" : ""}`} onClick={focusScanner} onPointerUpCapture={() => window.setTimeout(focusScanner, 0)}>
        {locationToRemove && (
          <div className="scan-confirm-backdrop scan-remove-location-backdrop" onClick={() => setLocationToRemove(null)}>
            <div className="scan-confirm-dialog scan-remove-location-dialog" role="alertdialog" aria-modal="true" aria-labelledby="scan-remove-location-title" aria-describedby="scan-remove-location-detail" onClick={(event) => event.stopPropagation()}>
              <div className="scan-confirm-title" id="scan-remove-location-title">Remove Location?</div>
              <div className="scan-confirm-text" id="scan-remove-location-detail">
                Remove <strong>{locationToRemove.label}</strong> from active scanning and discard all of its unsubmitted item quantities, Inventory Tags, and recount corrections? This cannot be undone. Previously ERP-submitted records will remain in the audit history.
              </div>
              <div className="scan-confirm-actions">
                <button type="button" className="scan-confirm-button" onClick={() => setLocationToRemove(null)}>Cancel</button>
                <button type="button" className="scan-confirm-button scan-remove-location-confirm" onClick={() => removeMultiLocation(locationToRemove.id)}>Remove</button>
              </div>
            </div>
          </div>
        )}
        <div className="scan-panel">
          {!isScanSessionActive ? (
            <>
            <div className="scan-hero scan-setup-hero">
            {mode === "pcount" && <button type="button" className="scan-setup-back" aria-label="Back to Inventory" onClick={(event) => { event.stopPropagation(); onBack(); }}>‹</button>}
            <div className="scan-hero-copy">
              <h1 className="scan-title">
                {mode === "pcount" ? "Physical Count" : mode === "in" ? "Receive Stock" : "Issue Stock"}
              </h1>
              <p className="scan-sub">{employee.full_name} · {deviceName}</p>
            </div>
            <div className="scan-icon">
              <Barcode size={24} />
            </div>
          </div>

          <div className="mfg-workflow qcmc-scan-workflow scan-setup-workflow" aria-label={`Step ${activeStep} of 3`}>
            {["Reference", "Location", "Items"].map((label, index) => {
              const number = index + 1;
              const stateClass = number < activeStep ? "is-done" : number === activeStep ? "is-active" : "";
              return (
                <div className={`mfg-workflow-step ${stateClass}`} key={label}>
                  <span className="scan-workflow-number">{number < activeStep ? "✓" : number}</span>
                  <strong>{label}</strong>
                </div>
              );
            })}
          </div>

            <div className="scan-session-summary scan-setup-summary">
              <div className="scan-session-item scan-setup-summary-card">
                <span className="scan-setup-summary-icon"><Barcode size={20} aria-hidden="true"/></span>
                <div className="scan-setup-summary-copy">
                  <div className="scan-session-label">Reference</div>
                  <div className="scan-session-value">{reconciliationCode || "Not scanned"}</div>
                  {reconciliationWarehouse && <div className="scan-setup-summary-note">Warehouse: {reconciliationWarehouse}</div>}
                </div>
              </div>
              <div className="scan-session-item scan-setup-summary-card">
                <span className="scan-setup-summary-icon"><MapPin size={20} aria-hidden="true"/></span>
                <div className="scan-setup-summary-copy">
                  <div className="scan-session-label">Storage Location</div>
                  <div className="scan-session-value">
                    {effectiveLocationMode === "multi" && activeGroupLocations.length > 0
                      ? `${activeGroupLocations.length} locations selected`
                      : currentBin
                      ? currentBin.locationCode || currentBin.locationId || currentBin.locationPath || currentBin.bin
                      : "Not scanned"}
                  </div>
                  {currentBin && <div className="scan-setup-summary-note">{currentBin.locationPath || currentBin.locationName || currentBin.bin}</div>}
                </div>
              </div>
            </div>
            </>
          ) : (
            <div className="scan-focus-header">
              {mode === "pcount" ? (
                <>
                  <div className="scan-redesign-appbar">
                    <button type="button" className="scan-redesign-back" aria-label="Back to Inventory" onClick={(event) => { event.stopPropagation(); onBack(); }}>‹</button>
                    <strong>Physical Count</strong>
                    <span className="scan-redesign-mode">{quantityMode === "automatic" ? "Automatic" : "Manual"}</span>
                  </div>
                  <div className="scan-redesign-reference-card">
                    <span className="scan-redesign-reference-icon"><Barcode size={19} aria-hidden="true" /></span>
                    <strong className="scan-focus-reference">{reconciliationCode}</strong>
                    <span
                      className={`scan-redesign-save-status ${hasQueuedSubmission || isDeviceOffline || isOffline ? "is-pending" : pendingEntryCount > 0 ? "is-saved" : "is-ready"}`}
                      title={isDeviceOffline ? "Device reports no network connection; scans are saved on this device."
                        : isOffline ? "The last ERPNext network request failed. Internet access may still be available; local counts are safe."
                        : "Scans are stored on this device until ERPNext confirms submission."}
                    >
                      {hasQueuedSubmission ? "Waiting for ERP sync"
                        : isDeviceOffline ? "Offline · saved locally"
                        : isOffline ? "ERP issue · saved locally"
                        : pendingEntryCount > 0 ? "Saved on device" : "Ready to scan"}
                    </span>
                  </div>
                </>
              ) : (
                <div className="scan-focus-copy">
                  <div className="scan-focus-title">Scan Items</div>
                  <div className="scan-focus-reference">{reconciliationCode}</div>
                  {(isOffline || hasQueuedSubmission) && (
                    <div className="scan-connectivity is-offline">
                      {hasQueuedSubmission ? "Saved offline · waiting to sync" : "Offline · scans save on device"}
                    </div>
                  )}
                  <div className="scan-focus-mode-status">Scan to add · Edit quantity from Items</div>
                </div>
              )}
            </div>
          )}

          {isScanSessionActive && (
            <div className="scan-session-tabs" aria-label="Scanning session navigation">
              <button type="button" className="scan-session-tab is-active" onClick={() => scanSessionTopRef.current?.scrollIntoView({ block: "start" })}>
                Scan
              </button>
              <button type="button" className="scan-session-tab" onClick={() => scanListRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })}>
                Items <span>{entries.length}</span>
              </button>
              <div className="scan-session-tab scan-session-tab-static">
                Locations <span>{countedLocations.length}</span>
              </div>
            </div>
          )}

          {isScanSessionActive && mode === "pcount" && !isPcountReviewStage && (
            <div className="scan-redesign-location" aria-label="Current Storage Location">
              <span className="scan-redesign-location-icon" aria-hidden="true">⌖</span>
              <div className="scan-redesign-location-copy">
                <span className="scan-current-location-label">
                  {!currentBin && activeGroupLocations.length === 0 ? "Location Count"
                    : effectiveLocationMode === "multi" && activeGroupLocations.length > 1 ? "Current Location Group" : "Current Location"}
                  {isRecountMode ? " · RECOUNT" : ""}
                </span>
                <strong className="scan-current-location-id">
                  {effectiveLocationMode === "multi" && activeGroupLocations.length > 1
                    ? `${activeGroupLocations.length} Locations Selected`
                    : currentBin?.locationCode || currentBin?.locationId || "Select a Storage Location"}
                </strong>
                <span className="scan-current-location-path">
                  {effectiveLocationMode === "multi" && activeGroupLocations.length > 1
                    ? `${activeGroupLocations.slice(0, 3).map((location) => location.bin.locationCode || location.bin.locationId).join(" · ")}${activeGroupLocations.length > 3 ? ` · +${activeGroupLocations.length - 3} more` : ""}`
                    : currentBin ? "Scan items for this location" : "Scan a Storage Location to continue counting"}
                </span>
              </div>
            </div>
          )}

          {isScanSessionActive && mode === "pcount" && (
            <div className="scan-progress-board" aria-label="Physical Count location progress">
              <div className="scan-progress-top">
                <div>
                  <span className="scan-progress-kicker">Location Progress</span>
                  <strong className={isPcountReviewStage ? "scan-progress-complete-summary" : ""}>
                    {isPcountReviewStage
                      ? `✓ ${reviewedLocationCount}/${pcountSession?.locations.length || reviewedLocationCount} Completed`
                      : `${completedLocationCount} completed${activeLocationCount > 0 ? ` · ${activeLocationCount} active` : ""}`}
                  </strong>
                </div>
                <button type="button" className="scan-progress-view-all" onClick={() => setShowLocationProgressModal(true)} aria-label="View all counted locations">View all · {countedLocations.length}</button>
              </div>
              {visibleProgressLocations.length > 0 && (
                <div className="scan-progress-pills" role="region" aria-label="Locations, swipe horizontally to see all" tabIndex={0}>
                  {visibleProgressLocations.map((location, index) => {
                    const active =
                      location.bin.locationId === currentBin?.locationId ||
                      (effectiveLocationMode === "multi" &&
                        location.groupId === pcountSession?.activeGroupId &&
                        location.status !== "completed");
                    return (
                      <button
                        type="button"
                        className={`scan-progress-pill scan-progress-pill-removable ${location.status === "completed" ? "is-done" : ""} ${active ? "is-active" : ""}`}
                        key={location.bin.locationId}
                        title={`Long press to remove ${location.bin.locationCode || location.bin.locationId}`}
                        aria-label={`Long press to remove location ${location.bin.locationCode || location.bin.locationId}: ${location.status === "completed" ? "completed" : active ? "active" : "in progress"}`}
                        onPointerDown={(event) => {
                          if (event.pointerType === "mouse" && event.button !== 0) return;
                          startLocationLongPress(location.bin.locationId || "", location.bin.locationCode || location.bin.locationId || "");
                        }}
                        onPointerUp={cancelLocationLongPress}
                        onPointerCancel={cancelLocationLongPress}
                        onPointerLeave={cancelLocationLongPress}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          requestRemoveMultiLocation(location.bin.locationId || "", location.bin.locationCode || location.bin.locationId || "");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            requestRemoveMultiLocation(location.bin.locationId || "", location.bin.locationCode || location.bin.locationId || "");
                          }
                        }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {location.status === "completed" ? "✓" : active ? "●" : ""} {location.bin.locationCode || `L${index + 1}`}
                      </button>
                    );
                  })}
                  {countedLocations.length > visibleProgressLocations.length && (
                    <span className="scan-progress-more">+{countedLocations.length - visibleProgressLocations.length}</span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="scan-capture">
            {isScanSessionActive && mode === "pcount" && !isPcountReviewStage && (
              <div className="scan-redesign-ready-card" aria-live="polite">
                <Barcode size={34} strokeWidth={1.7} aria-hidden="true" />
                <strong>{step === "item" ? "Ready to Scan Item" : step === "invtag" ? "Confirm Inventory Tag" : step === "qty" ? "Confirm Quantity" : !currentBin && activeGroupLocations.length === 0 && (pendingEntryCount > 0 || hasQueuedSubmission) ? "Ready to Review" : "Scan next location"}</strong>
                <span>{step === "item"
                  ? "Scan the barcode using your scanner"
                  : step === "invtag" || step === "qty"
                    ? "Complete the open popup to continue"
                    : "Follow the current scanning step"}</span>
              </div>
            )}
            {effectiveLocationMode === "single" && isScanSessionActive && currentBin && mode !== "pcount" && (
              <div className="scan-current-location" aria-label="Current Storage Location">
                <div className="scan-current-location-heading">
                  <div className="scan-current-location-label">Current Location</div>
                  {isRecountMode && <span className="scan-recount-badge">RECOUNT</span>}
                </div>
                <div className="scan-current-location-id">{currentBin.locationCode || currentBin.locationId}</div>
                <div className="scan-current-location-path">{currentBin.locationPath || currentBin.locationName || currentBin.bin}</div>
              </div>
            )}
            {!isScanSessionActive && step === "reconciliation" && lastSetup && (
              <div className="scan-last-activity" onClick={(event) => event.stopPropagation()}>
                <div>
                  <div className="scan-last-activity-label">Last activity</div>
                  <div className="scan-last-activity-reference">{lastSetup.reconciliationCode}</div>
                  <div className="scan-last-activity-location">
                    {lastSetup.bin.locationCode || lastSetup.bin.locationName || lastSetup.bin.locationPath || lastSetup.bin.bin}
                  </div>
                  {lastSetup.lastItem && (
                    <>
                      <div className={`scan-last-activity-item is-${lastSetup.lastItem.action.toLowerCase()}`}>
                        Last item: {lastSetup.lastItem.itemCode} · <strong>{lastSetup.lastItem.action} {lastSetup.lastItem.quantityChange > 0 ? "+" : ""}{formatScanQuantity(lastSetup.lastItem.quantityChange)} {lastSetup.lastItem.uom}</strong>
                      </div>
                      {lastSetup.lastItem.itemName && <div className="scan-last-activity-item-name">{lastSetup.lastItem.itemName}</div>}
                    </>
                  )}
                  <div className="scan-last-activity-time">
                    {(lastSetup.lastItem?.timestamp || lastSetup.timestamp) ? new Date(lastSetup.lastItem?.timestamp || lastSetup.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Previous session"}
                  </div>
                </div>
                <button type="button" className="scan-last-activity-button" onClick={() => void loadPreviousSetup()} disabled={isLoadingLastSetup}>
                  {isLoadingLastSetup ? "Loading..." : "Load setup"}
                </button>
              </div>
            )}
            {!isScanSessionActive && <div className="scan-setup-instruction">
              <div className="scan-instruction-kicker">Step {activeStep} of 3</div>
              <div className="scan-instruction-title">{stepInstruction.title}</div>
              <div className="scan-instruction-detail">{stepInstruction.detail}</div>
              {mode === "pcount" && step === "bin" && <div className="scan-setup-location-status">
                {activeGroupLocations.length > 0
                  ? `${activeGroupLocations.length} location${activeGroupLocations.length === 1 ? "" : "s"} selected`
                  : currentBin ? "1 location selected" : "0 locations selected"}
              </div>}
            </div>}
            {!isScanSessionActive && mode === "pcount" && step === "bin" && !currentBin && activeGroupLocations.length === 0 && (
              <button type="button" className="scan-setup-scan-ready" onClick={(event) => { event.stopPropagation(); focusScanner(); }}
                aria-label="Focus hardware scanner to scan Storage Location QR">
                <Barcode size={25} aria-hidden="true"/>
                <span>Ready to Scan Location QR</span>
                <small>Use the handheld scanner. Items cannot start until a location is selected.</small>
              </button>
            )}
            {!isScanSessionActive && step === "bin" && effectiveLocationMode === "multi" && (
              <div className="scan-multi-location-picker">
                <div className="scan-list-title">{activeGroupLocations.length} locations selected</div>
                <div className="scan-location-summary">
                  {activeGroupLocations.map((location) => (
                    <div
                      className="scan-location-card scan-location-longpress"
                      key={location.bin.locationId}
                      role="button"
                      tabIndex={0}
                      aria-label={`Long press to remove location ${location.bin.locationCode || location.bin.locationId}`}
                      onPointerDown={(event) => {
                        if (event.pointerType === "mouse" && event.button !== 0) return;
                        startLocationLongPress(location.bin.locationId || "", location.bin.locationCode || location.bin.locationId || "");
                      }}
                      onPointerUp={cancelLocationLongPress}
                      onPointerCancel={cancelLocationLongPress}
                      onPointerLeave={cancelLocationLongPress}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        cancelLocationLongPress();
                        requestRemoveMultiLocation(location.bin.locationId || "", location.bin.locationCode || location.bin.locationId || "");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          requestRemoveMultiLocation(location.bin.locationId || "", location.bin.locationCode || location.bin.locationId || "");
                        }
                      }}
                    >
                      <div className="scan-location-card-id">{location.bin.locationCode || location.bin.locationId}</div>
                      <div className="scan-location-card-path">{location.bin.locationPath || location.bin.locationName || location.bin.bin}</div>
                      <div className="scan-location-hold-hint">Long press to remove location</div>
                    </div>
                  ))}
                </div>
                <button type="button" className="scan-start-button" disabled={activeGroupLocations.length === 0} onClick={continueMultiLocationItems}>
                  <Play size={20} fill="currentColor" /> Start Items ({activeGroupLocations.length} location{activeGroupLocations.length === 1 ? "" : "s"})
                </button>
              </div>
            )}
            {!isScanSessionActive && step === "item" && currentBin && (
              <button type="button" className="scan-start-button" onClick={() => void startScanning()} disabled={isSyncing}>
                <Play size={20} fill="currentColor" />
                {isSyncing ? "Preparing scanner..." : "Start Scanning"}
              </button>
            )}
            {(isScanSessionActive || step !== "item") && <div className={`scan-input-wrap ${hideScannerCapture ? "is-focus-only" : ""}`}>
              <Barcode className="scan-input-icon" size={18} />
              <input
                id="scanner-input"
                ref={inputRef}
                className="scan-input"
                value={scanValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={handleInputFocus}
                onBlur={() => window.setTimeout(() => {
                  if (!selectedItemDetails && !showSubmitConfirm && !showFinishLocationConfirm && !pendingExistingLocation) focusScanner();
                }, 0)}
                placeholder={isResolvingLocation ? "Checking location…" : "Waiting for scanner..."}
                aria-label={stepInstruction.title}
                autoCapitalize="off"
                autoCorrect="off"
                inputMode="none"
                readOnly
                disabled={isResolvingLocation}
              />
            </div>}
            {mode === "pcount" && quantityMode === "automatic" && isScanSessionActive && step === "item" && currentBin && activeTagItemCode && (
              <div className="scan-redesign-tag-card" aria-label="Active Inventory Tag">
                <span className="scan-redesign-tag-icon" aria-hidden="true">◇</span>
                <div>
                  <strong>{activeTagLabel !== "None" && activeTagLabel !== "Select tag" && newInventoryTagForItem !== `${currentBin.locationId || ""}|${activeTagItemCode.trim().toLocaleUpperCase()}`
                    ? `Active Inv Tag: ${activeTagLabel}`
                    : "Inventory Tag will be requested"}</strong>
                  <span>{activeTagItemCode} · Same item only</span>
                </div>
              </div>
            )}
            {mode === "pcount" && reconciliationCode && !isPcountReviewStage && (currentBin || activeGroupLocations.length > 0) && (
              <button type="button" className="scan-manual-item-open" onClick={openManualItemSearch}>
                <span aria-hidden="true">⌕</span> Enter FG Item Code / Description
              </button>
            )}
            {mode === "pcount" && quantityMode !== "automatic" && isScanSessionActive && step === "item" && (
              <div className="scan-redesign-tag-card">
                <span className="scan-redesign-tag-icon" aria-hidden="true">◇</span>
                <div><strong>Inventory Tag</strong><span>Enter or confirm after scanning each item</span></div>
              </div>
            )}
            {toast ? (
              <AppToast toast={toast} onClose={() => setToast(null)} />
            ) : message && !(isPcountReviewStage && isStaleCompletedLocationMessage) ? (
              <div className="scan-feedback" role="status">{message}</div>
            ) : null}
            {isScanSessionActive && lastScanFeedback && !isPcountReviewStage && (
              <div className={`scan-last-success is-${lastScanFeedback.action.toLowerCase()}`} aria-live="polite">
                <CheckCircle2 size={20} />
                <div className="scan-last-main">
                  <div className="scan-last-label">{lastScanFeedback.action === "ADD" ? "Last scan recorded" : "Last deduction recorded"}</div>
                  <div className="scan-last-code">{lastScanFeedback.itemCode}</div>
                  <div className="scan-last-running">Current counted quantity: {lastScanFeedback.runningQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} {lastScanFeedback.uom}</div>
                </div>
                <div className="scan-last-quantity">{lastScanFeedback.quantityChange > 0 ? "+" : ""}{lastScanFeedback.quantityChange.toLocaleString(undefined, { maximumFractionDigits: 2 })} {lastScanFeedback.uom}</div>
              </div>
            )}
            {!isScanSessionActive && <div className="scan-actions-secondary">
              <button type="button" className="scan-action" onClick={scanAnotherReconciliation}>
                <CheckCircle2 size={15} />
                New Reference
              </button>
              <button type="button" className="scan-action" onClick={scanAnotherBin} disabled={!reconciliationCode}>
                <RotateCcw size={15} />
                Change Location
              </button>
            </div>}
          </div>
        </div>

        {isScanSessionActive && (mode !== "pcount" || showScannedItems) && <div ref={scanListRef} role={mode === "pcount" ? "dialog" : undefined} aria-modal={mode === "pcount" ? true : undefined} aria-label={mode === "pcount" ? "Scanned Items" : undefined} className={`scan-panel scan-history ${mode === "pcount" ? "scan-items-fullscreen" : ""} ${showScannedItems ? "is-expanded" : ""}`}>
          <div className={mode === "pcount" ? "scan-items-fixed-top" : "scan-items-normal-top"}>
          {mode === "pcount" && <div className="scan-items-fullscreen-header">
            <div><strong>Scanned Items</strong><span>{visibleCountEntries.length} saved item rows · {reconciliationCode}</span></div>
            <button type="button" onClick={() => { setShowScannedItems(false); setRemoveSelectionMode(false); setRemoveSelectedKeys(new Set()); refocusPhysicalCountScanner(); }} aria-label="Close Scanned Items">✕ Close</button>
          </div>}
          <div className="scan-totals-strip" aria-label="Scan totals">
            <div className="scan-total-cell">
              <span>Scans</span>
              <strong>{transactionCount}</strong>
            </div>
            <div className="scan-total-cell">
              <span>SKUs</span>
              <strong>{skuCount}</strong>
            </div>
            <div className="scan-total-cell scan-total-highlight">
              <span>Total units</span>
              <strong>{hasMixedScanUom ? "Mixed UOM" : pendingQuantityTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              {uniformScanUom && !hasMixedScanUom && <small className="scan-total-uom">{uniformScanUom}</small>}
            </div>
          </div>
          </div>
          {mode === "pcount" && <div className="scan-items-view-selector" role="group" aria-label="Scanned Items view">
            <button type="button" className={scannedItemsView === "location" ? "is-active" : ""} aria-pressed={scannedItemsView === "location"} onClick={() => setScannedItemsView("location")}>By Location</button>
            <button type="button" className={scannedItemsView === "tag" ? "is-active" : ""} aria-pressed={scannedItemsView === "tag"} onClick={() => setScannedItemsView("tag")}>By Inv Tag</button>
          </div>}
          <div className="scan-list-header">
            <div>
              <div className="scan-list-title">Scanned items</div>
              <div className="scan-list-subtitle">Saved on this device as you scan</div>
            </div>
            {mode !== "pcount" && <button
              type="button"
              className="scan-redesign-view-items"
              aria-expanded={showScannedItems}
              aria-label={showScannedItems ? "Hide Scanned Items" : "View and edit Scanned Items"}
              onClick={(event) => { event.stopPropagation(); setShowScannedItems((visible) => !visible); }}
            >
              {showScannedItems ? "Hide" : "View / Edit"} <span className="scan-list-count">{visibleCountEntries.length}</span>
            </button>}
          </div>
          {removeSelectionMode && (
            <div className="scan-remove-selection-bar">
              <strong>{removeSelectedKeys.size} selected</strong>
              <div>
                <button
                  type="button"
                  className="scan-select-all-pending"
                  onClick={(event) => { event.stopPropagation(); selectAllPendingScanItems(); }}
                  disabled={selectablePendingScanKeys.size === 0}
                  aria-label={`Select all ${selectablePendingScanKeys.size} pending scanned items`}
                >
                  Select All{selectablePendingScanKeys.size ? ` (${selectablePendingScanKeys.size})` : ""}
                </button>
                <button type="button" onClick={() => { setRemoveSelectionMode(false); setRemoveSelectedKeys(new Set()); }}>Cancel</button>
                <button
                  type="button"
                  className="is-danger"
                  disabled={removeSelectedKeys.size === 0}
                  onClick={() => {
                    const first = entries.find((entry) => removeSelectedKeys.has(getRemoveEntryKey(entry)));
                    if (first) setRemoveScanCandidate(first);
                  }}
                >
                  <Trash2 size={14} /> Remove Selected
                </button>
              </div>
            </div>
          )}
          {visibleCountEntries.length > 0 ? (
            groupedScanItems.map((group) => (
              <div className="scan-sku-group" key={group.itemCode}>
                <button
                  type="button"
                  className={`scan-sku-header ${mode === "pcount" ? "scan-sku-toggle" : ""}`}
                  aria-expanded={mode === "pcount" ? expandedScannedSkuCodes.has(group.itemCode) : undefined}
                  aria-controls={mode === "pcount" ? `scan-sku-details-${group.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined}
                  tabIndex={mode === "pcount" ? 0 : -1}
                  onClick={() => {
                    if (mode !== "pcount") return;
                    setExpandedScannedSkuCodes((current) => {
                      const next = new Set(current);
                      if (next.has(group.itemCode)) next.delete(group.itemCode);
                      else next.add(group.itemCode);
                      return next;
                    });
                  }}
                >
                  <span className="scan-sku-identity">
                    <span>{group.itemCode}</span>
                    {group.itemName && <span className="scan-sku-name">{group.itemName}</span>}
                  </span>
                  <span className="scan-sku-heading-right"><strong>{formatScanQuantity(group.total)} <small>{group.uom}</small></strong>{mode === "pcount" && <span className="scan-sku-chevron" aria-hidden="true">{expandedScannedSkuCodes.has(group.itemCode) ? "▴" : "▾"}</span>}</span>
                </button>
                {(mode !== "pcount" || expandedScannedSkuCodes.has(group.itemCode)) && <div id={`scan-sku-details-${group.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_")}`} className="scan-sku-details">
                {mode === "pcount" && scannedItemsView === "tag" ? (
                  <div className="scan-tag-groups">
                    <div className="scan-tag-columns"><span>Inv Tag</span><span>Qty</span></div>
                    {groupScannedItemsByInvTag(group.entries).map((tagGroup) => (
                      <details className="scan-tag-group" key={tagGroup.tag}>
                        <summary className="scan-tag-summary">
                          <span className="scan-tag-label">{tagGroup.tag}</span>
                          <strong>{formatScanQuantity(tagGroup.quantity)} <small>{group.uom}</small></strong>
                        </summary>
                        <div className="scan-tag-location-list">
                          {tagGroup.locations.map(({ entry, quantity }, index) => (
                            <button type="button" className="scan-tag-location-row" key={`${entry.timestamp}-${entry.bin.locationId}-${index}`}
                              onClick={() => setSelectedItemDetails(entry)}>
                              <span>{entry.bin.locationCode || entry.bin.locationName || entry.bin.locationPath || entry.bin.locationId || entry.bin.bin}</span>
                              <strong>{formatScanQuantity(quantity)} {entry.uom}</strong>
                              <small>View audit / edit</small>
                            </button>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                ) : group.entries.slice(0, removeSelectionMode ? undefined : 30).map((entry, index) => (
                  <button
                    type="button"
                    className="scan-history-row"
                    key={`${entry.timestamp}-${entry.raw}-${index}`}
                    onPointerDown={() => startScanRowLongPress(entry)}
                    onPointerUp={cancelScanRowLongPress}
                    onPointerCancel={cancelScanRowLongPress}
                    onPointerLeave={cancelScanRowLongPress}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      cancelScanRowLongPress();
                      scanRowLongPressedRef.current = true;
                      setRemoveSelectionMode(true);
                      setRemoveSelectedKeys(new Set([getRemoveEntryKey(entry)]));
                    }}
                    onClick={() => {
                      if (scanRowLongPressedRef.current) {
                        scanRowLongPressedRef.current = false;
                        return;
                      }
                      if (removeSelectionMode) {
                        const key = getRemoveEntryKey(entry);
                        setRemoveSelectedKeys((current) => {
                          const next = new Set(current);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        });
                        return;
                      }
                      setSelectedItemDetails(entry);
                    }}
                  >
                    {removeSelectionMode && (
                      <span className={`scan-remove-check${removeSelectedKeys.has(getRemoveEntryKey(entry)) ? " is-selected" : ""}`} aria-hidden="true">
                        {removeSelectedKeys.has(getRemoveEntryKey(entry)) ? "✓" : ""}
                      </span>
                    )}
                    <div className="scan-history-main">
                      <div className="scan-history-top">
                        <div className="scan-history-code">Current physical count</div>
                        <div className="scan-history-quantity">{formatScanQuantity(entry.quantity)} {entry.uom}</div>
                      </div>
                      <div className="scan-history-detail">
                        {(entry.scanTransactions || []).length} scan transaction{(entry.scanTransactions || []).length === 1 ? "" : "s"} · Tap for audit history
                      </div>
                      <div className="scan-history-location">
                        {entry.bin.locationCode || entry.bin.locationName || entry.bin.locationPath || entry.bin.bin}
                      </div>
                    </div>
                  </button>
                ))}
                </div>}
              </div>
            ))
          ) : (
            <div className="scan-empty">No items scanned yet. Complete the steps above to begin.</div>
          )}
          {mode !== "pcount" && countedLocations.length > 0 && (
            <button
              type="button"
              className="scan-location-summary-toggle"
              aria-expanded={showCountedLocations}
              onClick={() => setShowCountedLocations((visible) => !visible)}
            >
              {showCountedLocations ? "Hide Counted Locations" : "Counted Locations"}
              <span>{countedLocations.length}</span>
            </button>
          )}
          {mode !== "pcount" && showCountedLocations && countedLocations.length > 0 && (
            <div className="scan-location-summary">
              {countedLocations.map((location) => {
                const isActive = location.bin.locationId === currentBin?.locationId;
                return (
                  <div className={`scan-location-card ${isActive ? "is-active" : ""}`} key={location.bin.locationId}>
                    <div className="scan-location-card-id">{location.bin.locationCode || location.bin.locationId}</div>
                    <div className="scan-location-card-status">{isActive ? "In Progress" : location.status === "completed" ? "Completed" : "In Progress"}</div>
                    <div className="scan-location-card-path">{location.bin.locationPath || location.bin.locationName || location.bin.bin}</div>
                    <div className="scan-location-card-stats">
                      {location.skuCount} SKU{location.skuCount === 1 ? "" : "s"} · {location.totalUnits.toLocaleString(undefined, { maximumFractionDigits: 2 })} units · Last scan {location.lastScanTime ? new Date(location.lastScanTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </div>
                    {effectiveLocationMode === "single" && !isActive && (
                      <button type="button" className="scan-location-reopen" onClick={() => reopenLocation(location.bin.locationId || "")}>
                        Edit / Reopen
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>}
        {showPcountActionDock && (
          <div className="scan-submit-dock">
            <button
              type="button"
              className="scan-redesign-items-button"
              aria-expanded={showScannedItems}
              onClick={(event) => {
                event.stopPropagation();
                setShowScannedItems((visible) => !visible);
                window.requestAnimationFrame(() => scanListRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
              }}
            >
              <Pencil size={15} aria-hidden="true" />
              {showScannedItems ? "Hide Scanned Items" : "View Scanned Items"}
            </button>

            {(pendingEntryCount > 0 || hasQueuedSubmission) && <button type="button" className="scan-submit-button" onClick={() => {
              // Earlier builds could leave a previously counted location
              // active when Recount Location opened another location. Repair
              // only rows with actual saved count transactions; never silently
              // complete an empty location just to allow submission.
              const repairedSession = pcountSession?.activeGroupId?.startsWith("recount-")
                ? completeCountedInactiveRecountLocations(
                    pcountSession, loadLocalScanEntries(employee.id),
                    currentBin?.locationId || "", new Date().toISOString()
                  )
                : pcountSession;
              if (repairedSession && repairedSession !== pcountSession) {
                updatePcountSession(() => repairedSession);
              }
              const incomplete = (repairedSession?.locations || []).filter((location) => location.status !== "completed");
              const activeIds = new Set((effectiveLocationMode === "multi"
                ? activeGroupLocations.map((location) => location.bin.locationId || "")
                : [currentBin?.locationId || ""]).map((id) => id.trim().toUpperCase()).filter(Boolean));
              const otherIncomplete = incomplete.filter((location) =>
                !activeIds.has(String(location.bin.locationId || "").trim().toUpperCase())
              );
              if (otherIncomplete.length > 0) {
                setShowCountedLocations(true);
                showToast("warning", `Complete these locations before submitting: ${otherIncomplete.map((location) => location.bin.locationCode || location.bin.locationId).join(", ")}.`);
                return;
              }
              // Review & Submit is the explicit final-location completion;
              // switching to a different location remains automatic on QR scan.
              if (activeIds.size > 0 && incomplete.length > 0) completeActiveLocationGroup();
              setShowSubmitConfirm(true);
            }} disabled={isSubmitting}>
              <Send size={16} />
              {isSubmitting ? "Submitting" : hasQueuedSubmission ? "Retry ERP Sync" : "Review & Submit"}
            </button>}
          </div>
        )}
      </section>

      {showFinishLocationConfirm && (
        <div className="scan-confirm-backdrop" onClick={() => setShowFinishLocationConfirm(false)}>
          <div className="scan-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="finish-location-title" onClick={(event) => event.stopPropagation()}>
            <div id="finish-location-title" className="scan-confirm-title">Finish this location?</div>
            <div className="scan-confirm-text">Finish counting this location and scan the next location?</div>
            <div className="scan-confirm-actions">
              <button type="button" className="scan-confirm-button" onClick={() => setShowFinishLocationConfirm(false)}>
                Continue Counting
              </button>
              <button type="button" className="scan-confirm-button scan-confirm-button-primary" onClick={completeActiveLocationGroup}>
                Yes, Scan Next Location
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingExistingLocation && (
        <div className="scan-confirm-backdrop" onClick={() => {
          setPendingExistingLocation(null);
          setMessage("Scan another Storage Location.");
          focusScanner();
        }}>
          <div className="scan-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="existing-count-title" aria-describedby="existing-count-description" onClick={(event) => event.stopPropagation()}>
            <div id="existing-count-title" className="scan-confirm-title">Location Already Counted</div>
            <div id="existing-count-description" className="scan-confirm-text">
              {pendingExistingLocation.bin.locationCode || pendingExistingLocation.bin.locationId} was already counted in this Physical Count. If its count has already been submitted to ERP, use Recount Location to create a new correction count. For scans that are still local/unsubmitted, close this dialog and use the pencil in Items to edit the quantity directly.
            </div>
            <div className="scan-confirm-actions">
              <button type="button" className="scan-confirm-button" onClick={() => {
                setPendingExistingLocation(null);
                setMessage("Scan another Storage Location.");
                focusScanner();
              }}>
                Cancel
              </button>
              <button type="button" className="scan-confirm-button scan-confirm-button-primary" onClick={() => {
                const pending = pendingExistingLocation;
                setPendingExistingLocation(null);
                reopenLocation(pending.bin.locationId || "", pending.bin);
              }}>
                Recount Location
              </button>
            </div>
          </div>
        </div>
      )}

      {showSubmitConfirm && (
        <div className="scan-confirm-backdrop scan-review-backdrop" onClick={() => setShowSubmitConfirm(false)}>
          <div className="scan-confirm-dialog scan-review-dialog" role="dialog" aria-modal="true" aria-labelledby="submit-items-title" onClick={(event) => event.stopPropagation()}>
            <div id="submit-items-title" className="scan-confirm-title">Review Physical Count</div>
            <div className="scan-review-reference">{reconciliationCode}</div>
            <div className="scan-review-stats">
              <div><span>Locations</span><strong>{countedLocations.length}</strong></div>
              <div><span>SKUs</span><strong>{skuCount}</strong></div>
              <div><span>Scans</span><strong>{transactionCount}</strong></div>
              <div><span>Total Qty</span><strong>{pendingQuantityTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
            </div>
            <div className="scan-review-list">
              {countedLocations.map((location) => (
                <div className="scan-review-location" key={location.bin.locationId}>
                  <CheckCircle2 size={17} />
                  <div>
                    <strong>{location.bin.locationCode || location.bin.locationId}</strong>
                    <span>{location.skuCount} SKU{location.skuCount === 1 ? "" : "s"} · {location.totalUnits.toLocaleString(undefined, { maximumFractionDigits: 2 })} units</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="scan-review-note">Review the locations and final counted quantities before sending to ERP.</div>
            <div className="scan-confirm-actions">
              <button type="button" className="scan-confirm-button" onClick={() => setShowSubmitConfirm(false)}>
                Keep scanning
              </button>
              <button type="button" className="scan-confirm-button scan-qty-button-primary scan-review-submit" onClick={() => {
                setShowSubmitConfirm(false);
                void handleSubmitToErp();
              }}>
                <Send size={15} /> Submit to ERP
              </button>
            </div>
          </div>
        </div>
      )}

      {stockChangeReview && (
        <div className="scan-confirm-backdrop">
          <div className="scan-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="stock-changed-title">
            <div id="stock-changed-title" className="scan-confirm-title">{PCOUNT_BLIND_CONFLICT_TITLE}</div>
            <div className="scan-confirm-text">
              {PCOUNT_BLIND_CONFLICT_MESSAGE}
            </div>
            <div className="scan-confirm-actions">
              <button type="button" className="scan-confirm-button" disabled={isSubmitting} onClick={() => {
                setStockChangeReview(null);
                setShowCountedLocations(true);
                showToast("warning", `${stockChangeReview.inventoryLocation} requires review.`);
              }}>
                Cancel and Review
              </button>
              <button type="button" className="scan-confirm-button scan-confirm-button-primary" disabled={isSubmitting} onClick={() => void resubmitAfterBaselineRefresh()}>
                {isSubmitting ? "Resubmitting..." : "Refresh and Resubmit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedItemDetails && (() => {
        const history = selectedItemDetails.scanTransactions || [];
        const totalAdded = history.reduce((sum, tx) => {
          if (tx.action !== "ADD") return sum;
          // Added always shows the current/final positive scan quantity.
          // Example: 12,000 edited to 11,000 => Added 11,000.
          //          12,000 edited to 13,000 => Added 13,000.
          return sum + Math.abs(tx.quantityChange);
        }, 0);
        const totalDeducted = history.reduce((sum, tx) => {
          if (tx.action === "DEDUCT") return sum + Math.abs(tx.quantityChange);
          const editedOriginal = Number((tx as typeof tx & { editedOriginalQuantity?: number }).editedOriginalQuantity);
          if (tx.action === "ADD" && Number.isFinite(editedOriginal)) {
            // Only a downward edit contributes a correction to Deducted.
            return sum + Math.max(0, Math.abs(editedOriginal) - Math.abs(tx.quantityChange));
          }
          return sum;
        }, 0);
        const formatQty = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const submittedIds = new Set(selectedItemDetails.submittedTransactionIds || []);
        return (
          <div className="scan-confirm-backdrop scan-detail-backdrop" onClick={() => setSelectedItemDetails(null)}>
            <div className="scan-confirm-dialog scan-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="item-detail-title" onClick={(event) => event.stopPropagation()}>
              <div id="item-detail-title" className="scan-confirm-title">{selectedItemDetails.itemCode}</div>
              <div className="scan-confirm-text">Item name: {selectedItemDetails.itemName || "Not provided by barcode"}</div>
              <div className="scan-detail-summary">
                <div className="scan-detail-stat"><span>Added</span><strong>+{formatQty(totalAdded)}</strong></div>
                <div className="scan-detail-stat"><span>Deducted</span><strong>-{formatQty(totalDeducted)}</strong></div>
                <div className="scan-detail-stat"><span>Net count</span><strong>{formatQty(selectedItemDetails.quantity)} {selectedItemDetails.uom}</strong></div>
              </div>
              <div className="scan-detail-meta">
                Location: {selectedItemDetails.bin.locationCode || selectedItemDetails.bin.locationName || selectedItemDetails.bin.locationPath || selectedItemDetails.bin.bin}<br />
                {selectedItemDetails.barcodeUom && selectedItemDetails.authoritativeUom && selectedItemDetails.barcodeUom.trim().toUpperCase() !== selectedItemDetails.authoritativeUom.trim().toUpperCase() && <>
                  Barcode UOM: {selectedItemDetails.barcodeUom} · ERP Stock UOM: {selectedItemDetails.authoritativeUom}<br />
                </>}
                First scan: {history[0]?.timestamp || selectedItemDetails.timestamp} · Last scan: {history.at(-1)?.timestamp || selectedItemDetails.timestamp}<br />
                Scanner: {selectedItemDetails.deviceId || "Unknown"}
              </div>
              <div className="scan-detail-history">
                {history.map((tx) => (
                  <div className="scan-detail-transaction" key={tx.id}>
                    <button
                      type="button"
                      className="scan-detail-edit-button"
                      aria-label={`Edit quantity and Inv Tag for ${tx.inventoryTag?.trim() || selectedItemDetails.itemCode}`}
                      title={submittedIds.has(tx.id) ? "Already submitted to ERP" : "Edit scanned quantity and Inv Tag"}
                      disabled={isSubmitting || submittedIds.has(tx.id) || tx.action === "SUBMITTED" || tx.action === "CORRECTION_SUBMITTED"}
                      onClick={() => {
                        const originalStatus: PackageStatus = tx.packageStatus === "OPENED" ? "OPENED" : "COMPLETE";
                        setEditPackageStatus(originalStatus);
                        setEditTagHasFocus(false);
                        setEditScanPopupNotice("");
                        setEditQuantityFresh(true);
                        const savedBreakdown = readPhysicalCountBreakdown(tx, selectedItemDetails.qrQuantity || 1);
                        setEditingScanTransaction({
                          transactionId: tx.id,
                          ...savedBreakdown,
                          quantityTouched: false,
                          inventoryTag: tx.inventoryTag || "",
                        });
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <div className={`scan-detail-action is-${tx.action.toLowerCase()}`}>{tx.action}</div>
                    <div className="scan-detail-qty">{tx.quantityChange >= 0 ? "+" : ""}{formatQty(tx.quantityChange)} {selectedItemDetails.uom}</div>
                    <div className="scan-detail-tag">Inv Tag: {tx.inventoryTag?.trim() || "—"}</div>
                    {(tx.inventoryTagEditHistory || []).map((correction, index) => (
                      <div className="scan-detail-tag" key={`${tx.id}-invtag-edit-${index}`}>
                        Corrected Inv Tag: {correction.from || "(blank)"} → {correction.to} · {correction.at} · {correction.employeeId}
                      </div>
                    ))}
                    <div className="scan-detail-running">Running count: {formatQty(tx.runningQuantity)} {selectedItemDetails.uom} · {tx.timestamp}</div>
                  </div>
                ))}
              </div>
              <div className="scan-confirm-actions">
                <button type="button" className="scan-confirm-button" onClick={() => setSelectedItemDetails(null)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {editingScanTransaction && selectedItemDetails && (() => {
        const tx = (selectedItemDetails.scanTransactions || []).find((candidate) => candidate.id === editingScanTransaction.transactionId);
        if (!tx) return null;
        const qrQuantity = Number(tx.qrQuantity || selectedItemDetails.qrQuantity || 1);
        let editBreakdown: ReturnType<typeof calculateEditedPhysicalCount> | null = null;
        try {
          const bigPackCount = editingScanTransaction.bigPackCount.trim()
            ? evaluateQuantityExpression(editingScanTransaction.bigPackCount, true) : 0;
          const loosePackQuantity = editingScanTransaction.loosePackQuantity.trim()
            ? evaluateQuantityExpression(editingScanTransaction.loosePackQuantity, true) : 0;
          editBreakdown = calculateEditedPhysicalCount(qrQuantity, bigPackCount, loosePackQuantity);
        } catch {
          // Incomplete/invalid calculator inputs cannot be saved.
        }
        const preview = editBreakdown?.total ?? Number.NaN;
        return (
          <div className="scan-confirm-backdrop scan-edit-backdrop" onClick={() => setEditingScanTransaction(null)}>
            <form className={`scan-confirm-dialog scan-edit-dialog scan-qty-dialog scan-qty-dialog-compact ${editTagHasFocus ? "is-editing-tag" : ""}`}
              role="dialog" aria-modal="true" aria-labelledby="scan-edit-dialog-title"
              onSubmit={(event) => {
              event.preventDefault();
              setEditScanPopupNotice("");
              if (!Number.isFinite(preview) || preview < 0) {
                setEditScanPopupNotice("Enter a valid non-negative quantity before saving.");
                return;
              }
              const all = loadLocalScanEntries(employee.id);
              const matchingEntry = all.find((entry) =>
                entry.mode === "pcount" &&
                entry.reconciliationCode === reconciliationCode &&
                entry.itemCode === selectedItemDetails.itemCode &&
                String(entry.bin.locationId || "") === String(selectedItemDetails.bin.locationId || "") &&
                (entry.scanTransactions || []).some((candidate) => candidate.id === tx.id)
              );
              const savedTransaction = matchingEntry?.scanTransactions?.find((candidate) => candidate.id === tx.id);
              if (isSubmitting || !savedTransaction || matchingEntry?.submittedTransactionIds?.includes(tx.id) ||
                  savedTransaction.action === "SUBMITTED" || savedTransaction.action === "CORRECTION_SUBMITTED") {
                setEditScanPopupNotice("This transaction is already submitted or no longer available for editing.");
                return;
              }
              const editedTag = editingScanTransaction.inventoryTag.trim();
              const originalTag = String(savedTransaction.inventoryTag || "").trim();
              if (!editedTag && originalTag) {
                setEditScanPopupNotice("Inv Tag cannot be blank. Keep the original tag or enter its correction.");
                return;
              }
              // Enforce one Item Code per Inv Tag within the exact Storage Location.
              const tagConflict = findInventoryTagItemConflict(all, reconciliationCode, editedTag, selectedItemDetails.itemCode, selectedItemDetails.bin.locationId || "");
              if (tagConflict) {
                setEditScanPopupNotice(`Inv Tag ${editedTag} belongs to item ${tagConflict.itemCode}, not ${selectedItemDetails.itemCode}.`);
                return;
              }
              const updated = all.map((entry) => {
                if (entry.mode !== "pcount" || entry.reconciliationCode !== reconciliationCode ||
                    entry.itemCode !== selectedItemDetails.itemCode ||
                    String(entry.bin.locationId || "") !== String(selectedItemDetails.bin.locationId || "")) return entry;
                let running = 0;
                const transactions = (entry.scanTransactions || []).map((candidate) => {
                  let next = candidate;
                  if (candidate.id === tx.id) {
                    const signed = candidate.action === "DEDUCT" ? -Math.abs(preview) : Math.abs(preview);
                    next = {
                      ...candidate,
                      quantityChange: signed,
                      packageStatus: editBreakdown!.loosePackQuantity > 0 ? "OPENED" : "COMPLETE",
                      qrQuantity,
                      ...(editingScanTransaction.legacyUnsplit && !editingScanTransaction.quantityTouched
                        ? {} // Do not invent historical pack counts on an Inv Tag-only correction.
                        : {
                            bigPackCount: editBreakdown!.bigPackCount,
                            loosePackQuantity: editBreakdown!.loosePackQuantity,
                          }),
                      ...(editedTag !== originalTag
                        ? {
                            inventoryTag: editedTag,
                            inventoryTagEditHistory: [
                              ...(candidate.inventoryTagEditHistory || []),
                              { from: originalTag, to: editedTag, at: new Date().toISOString(), employeeId: employee.id },
                            ],
                          }
                        : {}),
                      actualQuantity: preview,
                      remainingQuantity: editBreakdown!.loosePackQuantity > 0 ? preview : undefined,
                      ...({ editedOriginalQuantity: Math.abs(candidate.quantityChange) } as Record<string, unknown>),
                    } as LocalScanTransaction;
                  }
                  if (next.action === "ADD") running += Math.abs(next.quantityChange);
                  else if (next.action === "DEDUCT") running -= Math.abs(next.quantityChange);
                  return { ...next, runningQuantity: running };
                });
                return { ...entry, quantity: running, multiplier: transactions.filter((candidate) => candidate.action === "ADD").length, scanTransactions: transactions };
              });
              try {
                saveLocalScanEntries(employee.id, updated);
              } catch (error) {
                setEditScanPopupNotice(error instanceof Error ? error.message : "Unable to save scan corrections locally.");
                return;
              }
              // The last active tag may have been corrected. Never silently
              // auto-reuse the old tag on the next item scan.
              if (editedTag !== originalTag) {
                delete activeInventoryTagsRef.current[activeInventoryTagKey(
                  reconciliationCode, selectedItemDetails.bin.locationId || "", selectedItemDetails.itemCode, selectedItemDetails.lotNo
                )];
              }
              const visible = updated.filter((entry) => entry.mode === "pcount" && entry.reconciliationCode === reconciliationCode);
              setEntries(visible);
              const refreshed = visible.find((entry) =>
                entry.itemCode === selectedItemDetails.itemCode &&
                String(entry.bin.locationId || "") === String(selectedItemDetails.bin.locationId || "")
              );
              if (refreshed) setSelectedItemDetails(refreshed);
              clearPendingPcountSubmission(employee.id, reconciliationCode);
              submitAttemptRef.current = null;
              setHasQueuedSubmission(false);
              setStockChangeReview(null);
              setEditingScanTransaction(null);
              showToast("success", "Scanned quantity and Inv Tag changes saved.");
            }} onClick={(event) => event.stopPropagation()}>
              <div className="scan-edit-heading">
                <div className="scan-confirm-title" id="scan-edit-dialog-title">Edit Quantity &amp; Inv Tag</div>
                <div className="scan-edit-item-name">{selectedItemDetails.itemCode} — {selectedItemDetails.itemName || itemNameCacheRef.current.get(selectedItemDetails.itemCode.trim().toLocaleUpperCase()) || "Item description unavailable"}</div>
                <div className="scan-confirm-text">{selectedItemDetails.itemCode} · Current Inv Tag {tx.inventoryTag?.trim() || "—"}</div>
              </div>
              <div className="scan-qty-package-toggle scan-edit-package-toggle">
                <button type="button" className={`scan-qty-package-button ${editPackageStatus === "COMPLETE" ? "is-active" : ""}`} onClick={() => { setEditPackageStatus("COMPLETE"); setEditQuantityFresh(true); }}>Big Pack</button>
                <button type="button" className={`scan-qty-package-button ${editPackageStatus === "OPENED" ? "is-active" : ""}`} onClick={() => { setEditPackageStatus("OPENED"); setEditQuantityFresh(true); }}>Loose Pack</button>
              </div>
              <div className="scan-edit-fields">
                <label className="scan-edit-field" htmlFor="scan-edit-invtag">
                  <span>Inventory Tag</span>
                  <input
                    id="scan-edit-invtag"
                    ref={editTagInputRef}
                    className="scan-edit-qty-input"
                    value={editingScanTransaction.inventoryTag}
                    onChange={(event) => { setEditScanPopupNotice(""); setEditingScanTransaction((current) => current ? { ...current, inventoryTag: event.target.value } : current); }}
                    onFocus={() => setEditTagHasFocus(true)}
                    onBlur={() => setEditTagHasFocus(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === "Escape") {
                        event.preventDefault();
                        editTagInputRef.current?.blur();
                      }
                    }}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    enterKeyHint="done"
                    spellCheck={false}
                    aria-label="Edit Inventory Tag"
                  />
                </label>
                <label className="scan-edit-field" htmlFor="scan-edit-quantity">
                  <span>{editPackageStatus === "COMPLETE" ? "Big Pack Count" : "Loose Pack Qty"}</span>
                  <div className="qcmc-calculator-entry">
                    <CalculatorReadout value={editPackageStatus === "COMPLETE" ? editingScanTransaction.bigPackCount : editingScanTransaction.loosePackQuantity}/>
                  <input
                    id="scan-edit-quantity"
                    ref={editQuantityInputRef}
                    onFocus={() => moveCalculatorCaretToEnd(editQuantityInputRef.current)}
                    onClick={() => moveCalculatorCaretToEnd(editQuantityInputRef.current)}
                    className="scan-edit-qty-input"
                    inputMode="none"
                    readOnly
                    value={editPackageStatus === "COMPLETE" ? editingScanTransaction.bigPackCount : editingScanTransaction.loosePackQuantity}
                    aria-label="Edit Quantity"
                  />
                  </div>
                </label>
              </div>
              {editTagHasFocus ? (
                <div className="scan-edit-tag-typing-hint">
                  Editing Inventory Tag · Press your keyboard's Done key when finished.
                </div>
              ) : (
                <div className="scan-edit-calculator" aria-label="Edit quantity calculator">
                  <div className="scan-qty-keypad">
                    {["7","8","9","÷","4","5","6","×","1","2","3","-",".","0","backspace","+"].map((key) => (
                      <button key={key} type="button" className="scan-qty-key"
                        aria-label={key === "backspace" ? "Delete last quantity character" : key === "÷" ? "Divide" : key === "×" ? "Multiply" : key}
                        onClick={() => enterEditQuantityKey(key)}>
                        {key === "backspace" ? "⌫" : key}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="scan-qty-clear" onClick={() => enterEditQuantityKey("clear")}>Clear</button>
                </div>
              )}
              <div className="scan-edit-pack-calculation" aria-live="polite">
                <span>Big Pack: {editBreakdown ? editBreakdown.bigPackCount.toLocaleString() : "—"} × {qrQuantity.toLocaleString()} = {editBreakdown ? editBreakdown.bigPackUnits.toLocaleString() : "—"} {selectedItemDetails.uom}</span>
                <span>+ Loose Pack: {editBreakdown ? editBreakdown.loosePackQuantity.toLocaleString() : "—"} {selectedItemDetails.uom}</span>
              </div>
              {editingScanTransaction.legacyUnsplit && <div className="scan-edit-legacy-note">
                Older scan saved only total quantity. Check the Big/Loose split before saving.
              </div>}
              <div className="scan-qty-total scan-edit-preview" aria-live="polite">
                <span>New physical quantity</span>
                <strong>{Number.isFinite(preview) ? formatScanQuantity(preview) : "—"} {selectedItemDetails.uom}</strong>
              </div>
              {editScanPopupNotice && <div className="scan-edit-notice" role="alert" aria-live="assertive">{editScanPopupNotice}</div>}
              <div className="scan-confirm-actions scan-edit-actions">
                <button type="button" className="scan-confirm-button" onClick={() => setEditingScanTransaction(null)}>Cancel</button>
                <button type="submit" className="scan-confirm-button scan-qty-button-primary" disabled={isSubmitting || !Number.isFinite(preview) || preview < 0}>Save Changes</button>
              </div>
            </form>
          </div>
        );
      })()}

      {removeScanCandidate && (
        <div className="scan-confirm-backdrop" onClick={() => setRemoveScanCandidate(null)}>
          <div className="scan-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-scan-title" onClick={(event) => event.stopPropagation()}>
            <div id="remove-scan-title" className="scan-confirm-title">
              {removeSelectionMode && removeSelectedKeys.size > 1 ? `Remove ${removeSelectedKeys.size} pending items?` : "Remove pending item?"}
            </div>
            <div className="scan-confirm-text">
              {removeSelectionMode && removeSelectedKeys.size > 1
                ? `Remove the ${removeSelectedKeys.size} selected pending items? This does not remove ERP-submitted history.`
                : `Remove ${removeScanCandidate.itemCode} from this pending Physical Count?`}
            </div>
            <div className="scan-confirm-actions">
              <button type="button" className="scan-confirm-button" onClick={() => setRemoveScanCandidate(null)}>Cancel</button>
              <button type="button" className="scan-confirm-button scan-confirm-button-primary" onClick={() => {
                if (removeSelectionMode && removeSelectedKeys.size > 1) removeSelectedPendingEntries();
                else removePendingScanEntry(removeScanCandidate);
              }}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {manualItemOpen && (
        <div className="scan-confirm-backdrop scan-manual-item-backdrop" onClick={closeManualItemSearch}>
          <form className="scan-confirm-dialog scan-manual-item-dialog" role="dialog" aria-modal="true"
            aria-labelledby="manual-item-title" onClick={(event) => event.stopPropagation()} onSubmit={(event) => event.preventDefault()}>
            <div className="scan-manual-item-header">
              <div className="scan-confirm-title" id="manual-item-title">Manual FG Item Search</div>
              <button type="button" className="scan-manual-item-close" onClick={closeManualItemSearch} aria-label="Close Manual Item Search">✕ Close</button>
            </div>
            <div className="scan-confirm-text">
              Search Finished Goods by Item Code or Description from the cached ERPNext catalog. Select an item to continue to Inventory Tag and Quantity.
            </div>
            <div className="scan-manual-item-autocomplete">
            <label className="scan-manual-item-field">
              <span>Item Code or Description</span>
              <input className="scan-input" type="search" value={manualItemQuery}
                onChange={(event) => { setManualItemQuery(event.target.value); setManualCatalogError(""); }}
                placeholder="Search items..." autoCapitalize="off" autoCorrect="off" autoFocus
                role="combobox" aria-autocomplete="list"
                aria-controls="manual-item-suggestions" aria-expanded={Boolean(manualItemQuery.trim())} />
            </label>
            {Boolean(manualItemQuery.trim()) && (
              <div id="manual-item-suggestions" className="scan-manual-item-results" role="listbox" aria-label="Matching ERPNext Items">
                {manualMatches.map((item) => (
                  <button key={item.itemCode} type="button" role="option" aria-selected={false}
                    onClick={() => chooseManualItem(item)}>
                    <strong>{item.itemCode}</strong>
                    <span>{item.itemName}</span>
                    {item.description && item.description !== item.itemName && <small>{item.description.slice(0, 160)}</small>}
                    <small>Stock UOM: {item.stockUom || "Unavailable"}</small>
                  </button>
                ))}
                {manualMatches.length === 0 && (
                  <div className="scan-manual-item-empty">No cached items match this search.</div>
                )}
              </div>
            )}
            </div>
            <div className="scan-manual-item-status" role="status">
              {manualCatalog.length.toLocaleString()} items cached
              {manualCatalogLoading ? ` · Syncing ${manualCatalogProgress.toLocaleString()} received...` : ""}
            </div>
            <button type="button" className="scan-manual-item-sync" onClick={() => void syncManualItems()} disabled={manualCatalogLoading}>
              {manualCatalogLoading ? "Syncing catalog…" : "Sync Items from ERPNext"}
            </button>



            {manualCatalogError && <div className="scan-manual-item-error" role="alert">{manualCatalogError}</div>}

          </form>
        </div>
      )}

      {manualPackItem && (
        <div className="scan-confirm-backdrop scan-manual-pack-backdrop" onClick={returnToManualItemSearch}>
          <form className="scan-confirm-dialog scan-manual-pack-dialog" role="dialog" aria-modal="true"
            aria-labelledby="manual-pack-title" onClick={(event) => event.stopPropagation()}
            onSubmit={confirmManualPackSize}>
            <div className="scan-confirm-title" id="manual-pack-title">Big Pack Quantity</div>
            <div className="scan-manual-pack-item">
              <strong>{manualPackItem.itemCode}</strong>
              <span>{manualPackItem.itemName}</span>
              <small>Stock UOM: {manualPackItem.stockUom}</small>
            </div>
            <label className="scan-manual-item-field" htmlFor="manual-pack-quantity">
              <span>Stock units per Big Pack</span>
            </label>
            <input id="manual-pack-quantity" type="number" min="0.000001" step="any"
              inputMode="decimal" autoFocus className="scan-input"
              value={manualPackSize}
              onChange={(event) => { setManualPackSize(event.target.value); setManualCatalogError(""); }}
              aria-label="Stock units per Big Pack" />
            <div className="scan-confirm-text">Use 1 for an individual stock unit. Enter the correct pack size before continuing.</div>
            {manualCatalogError && <div className="scan-manual-item-error" role="alert">{manualCatalogError}</div>}
            <div className="scan-confirm-actions scan-manual-pack-actions">
              <button type="button" className="scan-confirm-button" onClick={returnToManualItemSearch}>Back to Search</button>
              <button type="submit" className="scan-confirm-button scan-qty-button-primary">Continue</button>
            </div>
          </form>
        </div>
      )}

      {step === "invtag" && pendingItem && (
        <div className="scan-confirm-backdrop">
          <form className="scan-confirm-dialog scan-invtag-dialog" onSubmit={confirmInventoryTag}>
            <div className="scan-confirm-title">Enter Inv Tag</div>
            <div className="scan-confirm-text">{pendingItem.itemCode} · {formatScanQuantity(pendingItem.qrQuantity)} {pendingItem.uom}</div>
            {recountInventoryTags.length > 0 && Boolean(pcountSession?.activeGroupId?.startsWith("recount-")) && (
              <div role="radiogroup" aria-label="Inventory count action" style={{ display: "flex", gap: 16, marginBottom: 12 }}>
                <label><input type="radio" name="recount-tag-operation" checked={recountTagOperation === "existing"} onChange={() => { setRecountTagOperation("existing"); setInventoryTag(recountInventoryTags[0] || ""); setInventoryTagPopupNotice(""); }} /> Recount Existing</label>
                <label><input type="radio" name="recount-tag-operation" checked={recountTagOperation === "new"} onChange={() => { setRecountTagOperation("new"); setInventoryTag(""); setInventoryTagPopupNotice(""); }} /> Add New Count</label>
              </div>
            )}
            {recountTagOperation === "existing" && recountInventoryTags.length > 1 ? (
              <details className="scan-invtag-dropdown">
                <summary className="scan-input" aria-label="Choose existing Inventory Tag">{inventoryTag || "(historical blank)"} <span aria-hidden="true">⌄</span></summary>
                <div className="scan-invtag-dropdown-options" role="group" aria-label="Existing Inventory Tags">
                  {recountInventoryTags.map((tag) => <button type="button" key={tag || "__blank"} className={inventoryTag === tag ? "is-selected" : ""} onClick={(event) => { setInventoryTag(tag); setInventoryTagPopupNotice(""); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{tag || "(historical blank)"}</button>)}
                </div>
              </details>
            ) : (
              <>
              <div className="scan-invtag-last-used" aria-live="polite">
                Last used Inv Tag: <strong>{latestUsedInvTag || "None recorded"}</strong>
              </div>
              <input
                ref={inventoryTagInputRef}
                className="scan-input"
                value={inventoryTag}
                onChange={(event) => { setInventoryTag(event.target.value); setInventoryTagPopupNotice(""); }}
                readOnly={recountTagOperation === "existing" && recountInventoryTags.length === 1}
                autoCapitalize="characters"
                autoCorrect="off"
              />
              </>
            )}
            {inventoryTagPopupNotice && <div className="scan-invtag-notice" role="alert" aria-live="assertive">{inventoryTagPopupNotice}</div>}
            <div className="scan-confirm-actions">
              <button type="button" className="scan-confirm-button" onClick={cancelInventoryTag}>Cancel</button>
              <button type="submit" className="scan-confirm-button scan-qty-button-primary">Continue</button>
            </div>
          </form>
        </div>
      )}

      {step === "qty" && pendingItem && quantityPromptEnabled && (
        <div className="scan-confirm-backdrop scan-quantity-backdrop">
          <form className="scan-confirm-dialog scan-qty-dialog scan-qty-dialog-compact scan-qty-main" onSubmit={confirmQuantity}>
            <div className="scan-confirm-title">Enter Quantity</div>
            <div className="scan-confirm-text">Enter how many Big Packs you counted.</div>
            <div className="scan-qty-item">
              <div className="scan-qty-item-code">{pendingItem.itemCode}</div>
              <div className="scan-qty-item-name">{pendingItem.itemName || itemNameCacheRef.current.get(pendingItem.itemCode.trim().toLocaleUpperCase()) || "Item description unavailable"}</div>
              <div className="scan-qty-item-detail">QR quantity: {formatScanQuantity(pendingItem.qrQuantity)} {pendingItem.uom}</div>
            </div>
            <div className="scan-qty-package-toggle">
              <button type="button" className={`scan-qty-package-button ${packageStatus === "COMPLETE" ? "is-active" : ""}`} onClick={() => selectQuantityPackageStatus("COMPLETE")}>Big Pack</button>
              <button type="button" className={`scan-qty-package-button ${packageStatus === "OPENED" ? "is-active" : ""}`} onClick={() => selectQuantityPackageStatus("OPENED")}>Loose Pack</button>
            </div>
            <div className="scan-qty-label">{packageStatus === "COMPLETE" ? "Big Pack Count" : "Loose Pack Quantity"}</div>
            <div className="qcmc-calculator-entry">
              <CalculatorReadout value={scanValue}/>
              <input ref={inputRef} className="scan-qty-input" value={scanValue} onChange={handleInputChange} onKeyDown={handleKeyDown} onFocus={() => { handleInputFocus(); moveCalculatorCaretToEnd(inputRef.current); }} onClick={() => moveCalculatorCaretToEnd(inputRef.current)} inputMode="none" readOnly aria-label="Quantity: use the on-screen number keypad" />
            </div>
            <div className="scan-qty-keypad">
              {["7","8","9","÷","4","5","6","×","1","2","3","-",".","0","backspace","+"].map((key) => (
                <button key={key} type="button" className="scan-qty-key" onClick={() => enterQuantityKey(key)}>
                  {key === "backspace" ? "⌫" : key}
                </button>
              ))}
            </div>
            <button type="button" className="scan-qty-clear" onClick={() => enterQuantityKey("clear")}>Clear</button>
            {recountLoadedTotal !== null && (
              <div className="scan-qty-total" aria-live="polite">
                <span>Existing count (before recount)</span>
                <strong>{formatScanQuantity(recountLoadedTotal)} {pendingItem.uom}</strong>
              </div>
            )}
            <div className="scan-qty-total">
              <span>Calculate Big Packs</span>
              <strong>{(packageStatus === "OPENED" ? retainedBigPackCount : (() => { try { return evaluateQuantityExpression(scanValue || "0", true); } catch { return 0; } })()).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} packs</strong>
            </div>
            <div className="scan-qty-total">
              <span>Number of Location</span>
              <strong>{effectiveLocationMode === "multi" ? Math.max(1, activeGroupLocations.length) : 1}</strong>
            </div>
            <div className="scan-qty-total">
              <span>Total Quantity</span>
              <strong>{((recountLoadedTotal !== null && !recountCalculatorEdited ? recountLoadedTotal : combinedQuantityPreview) * (effectiveLocationMode === "multi" ? Math.max(1, activeGroupLocations.length) : 1)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {pendingItem.uom}</strong>
            </div>
            {packageQuantityError && <div className="scan-confirm-text">{packageQuantityError}</div>}
            <div className="scan-confirm-actions">
              <button type="button" className="scan-confirm-button" onClick={cancelQuantity}>Cancel</button>
              <button type="submit" className="scan-confirm-button scan-qty-button-primary" disabled={Boolean(packageQuantityError)}>OK</button>
            </div>
          </form>
        </div>
      )}

      {showLocationProgressModal && (
        <div className="scan-confirm-backdrop" onClick={() => setShowLocationProgressModal(false)}>
          <div className="scan-confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="scan-confirm-title">Location Progress</div>
            <div className="scan-confirm-text">{completedLocationCount} completed · {activeLocationCount} active</div>
            <div className="scan-review-list">
              {countedLocations.map((location) => (
                <div className="scan-review-location" key={location.bin.locationId}>
                  <CheckCircle2 size={17} />
                  <div><strong>{location.bin.locationCode || location.bin.locationId}</strong><span>{location.skuCount} SKU{location.skuCount === 1 ? "" : "s"} · {formatScanQuantity(location.totalUnits)} units</span></div>
                </div>
              ))}
            </div>
            <div className="scan-confirm-actions"><button type="button" className="scan-confirm-button" onClick={() => setShowLocationProgressModal(false)}>Close</button></div>
          </div>
        </div>
      )}

    </>
  );
};

export default ScanPage;
