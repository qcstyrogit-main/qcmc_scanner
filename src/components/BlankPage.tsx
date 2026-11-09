import React from "react";
import "@/styles/authenticated-ui.css";
import { App as CapacitorApp } from "@capacitor/app";
import Navigation from "@/components/Navigation";
import ScanPage, { type ScanMode } from "@/components/ScanPage";
import ManufacturingScanner from "@/components/ManufacturingScanner";
import JobCardTimeScanner from "@/components/JobCardTimeScanner";
import LocationTransferScanner from "@/components/LocationTransferScanner";
import StatusPage from "@/components/StatusPage";
import AppToast, { type ToastKind, type ToastNotice } from "@/components/AppToast";
import type { Employee, ViewType } from "@/types";
import { erpRequest, getActiveErpBaseUrl } from "@/lib/erpApi";
import { createPcountSubmissionId, getPcountItemBaseline, getReconciliationContext, PcountNotOpenError, PCOUNT_NOT_OPEN_MESSAGE, PcountStockChangedError, submitPcountEntries, type PcountEntry } from "@/lib/erpService";
import { getAuthoritativeStockUom } from "@/lib/uom";
import { normalizeWarehouseName } from "@/lib/storageLocationService";
import { loadActiveWarehouseAllocation, loadCompletedAllocationHistory, loadDeviceHandover } from "@/lib/warehouseHandover";
import {
  createPhysicalCountTransaction,
  createWarehouseAllocationTransaction,
  loadFailedTransactionHistory,
  loadSuccessfulTransactionHistory,
  isTransactionForDevice,
  saveSuccessfulTransaction,
  type FailedTransaction,
  type SuccessfulTransaction,
} from "@/lib/transactionHistory";
import { removeReconciliationContextOffline, saveReconciliationContextOffline } from "@/lib/offlinePcountCache";
import {
  loadPendingLocalScanEntries,
  loadLocalScanEntries,
  loadLastScanSetup,
  clearPcountLastScanSetup,
  loadPendingPcountSubmission,
  loadPcountSession,
  isPendingLocalScanEntry,
  loadScannerDeviceName,
  clearLocalScanEntries,
  markPcountSubmissionTransactionsSubmitted,
  markPcountBaselineRefreshRequired,
  savePendingPcountSubmission,
  clearPendingPcountSubmission,
  clearPcountSession,
  isPcountReconciliationUnavailable,
  removePcountFromLastActivity,
  restorePcountToLastActivity,
  saveScannerDeviceName,
  updateValidatedLocalScanEntry,
  type LocalScanEntry,
} from "@/lib/scanStorage";
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
import { loadScannerPackageMode, loadScannerQuantityMode, resolveScannerModes, saveScannerPackageMode, saveScannerQuantityMode, type ScannerPackageMode, type ScannerQuantityMode } from "@/lib/scannerPreferences";
import type { ManufacturingRole } from "@/lib/manufacturingEntry";
import { shouldShowBottomNavigation } from "@/lib/navigationPolicy";
import { AlertTriangle, ArrowLeftRight, Bell, Box, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, Database, Globe2, Keyboard, LayoutGrid, Loader2, LogOut, MapPinCheck, Moon, PackageCheck, PackagePlus, ReceiptText, ScanLine, Send, Settings, ShieldCheck, SlidersHorizontal, Smartphone, Trash2, Truck, User, Volume2, Wifi, Zap } from "lucide-react";

interface BlankPageProps {
  employee: Employee;
  onLogout: () => void;
}

const SHOW_DEFERRED_HOME_WORKFLOWS = true;
const normalizeReference = (value: string) => value.trim().toLocaleUpperCase();
const formatLastActivity = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `Last activity: ${date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
};
const isNetworkFailure = (error: unknown) =>
  /cannot reach|network|timed out|timeout|failed to fetch|fetch failed|connection/i.test(
    error instanceof Error ? error.message : String(error)
  );

type HistoryStockChangeReview = {
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

const TRANSACTION_PERIOD_OPTIONS = [
  { value: "all", label: "All dates" },
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
] as const;
const TRANSACTION_TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "physical_count", label: "Physical Count" },
  { value: "warehouse_allocation", label: "Warehouse Allocation" },
  { value: "location_transfer", label: "Transfer Location" },
] as const;

const BlankPage: React.FC<BlankPageProps> = ({ employee, onLogout }) => {
  React.useLayoutEffect(() => {
    const applyNativeInset = () => {
      const inset = window.QcmcScanner?.getNavigationInset?.();
      if (typeof inset === "number" && Number.isFinite(inset)) {
        document.documentElement.style.setProperty("--qcmc-navigation-inset", `${Math.max(0, inset)}px`);
      }
    };
    applyNativeInset();
    window.addEventListener("focus", applyNativeInset);
    return () => window.removeEventListener("focus", applyNativeInset);
  }, []);

  const [currentView, setCurrentView] = React.useState<ViewType>("dashboard");
  const [scanMode, setScanMode] = React.useState<ScanMode>("in");
  const [manufacturingRole, setManufacturingRole] = React.useState<ManufacturingRole>();
  const [scanSessionKey, setScanSessionKey] = React.useState(0);
  const [resumePhysicalCount, setResumePhysicalCount] = React.useState(false);
  const [resumeWarehouseAllocation, setResumeWarehouseAllocation] = React.useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = React.useState(false);
  const [showDeviceNameDialog, setShowDeviceNameDialog] = React.useState(false);
  const [showClearSavedConfirm, setShowClearSavedConfirm] = React.useState(false);
  const [deviceNameInput, setDeviceNameInput] = React.useState(() => loadScannerDeviceName());
  const [scannerQuantityMode, setScannerQuantityMode] = React.useState<ScannerQuantityMode>(() => loadScannerQuantityMode());
  const [scannerPackageMode, setScannerPackageMode] = React.useState<ScannerPackageMode>(() => loadScannerPackageMode());
  const [scannerQuickMenuOpen, setScannerQuickMenuOpen] = React.useState(false);
  React.useEffect(() => {
    if (currentView === "profile" || currentView === "settings") {
      setScannerQuantityMode(loadScannerQuantityMode());
      setScannerPackageMode(loadScannerPackageMode());
    }
  }, [currentView]);
  const [connectionTest, setConnectionTest] = React.useState<{ loading: boolean; ok?: boolean; message?: string; checkedAt?: string }>({ loading: false });
  const [deviceNetworkOnline, setDeviceNetworkOnline] = React.useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  React.useEffect(() => {
    const refreshNetwork = () => setDeviceNetworkOnline(navigator.onLine !== false);
    window.addEventListener("online", refreshNetwork);
    window.addEventListener("offline", refreshNetwork);
    return () => {
      window.removeEventListener("online", refreshNetwork);
      window.removeEventListener("offline", refreshNetwork);
    };
  }, []);
  const [selectedReconciliation, setSelectedReconciliation] = React.useState<string | null>(null);
  const [historySubmitState, setHistorySubmitState] = React.useState<{
    isSubmitting: boolean;
    result: { ok: boolean; text: string } | null;
  }>({ isSubmitting: false, result: null });
  const [historyRevision, setHistoryRevision] = React.useState(0);
  const [historyTab, setHistoryTab] = React.useState<"successful" | "failed" | "pending">("successful");
  const [transactionSearch, setTransactionSearch] = React.useState("");
  const [transactionTypeFilter, setTransactionTypeFilter] = React.useState("all");
  const [transactionDateFilter, setTransactionDateFilter] = React.useState("all");
  const [openTransactionFilter, setOpenTransactionFilter] = React.useState<"period" | "type" | null>(null);
  const transactionFiltersRef = React.useRef<HTMLDivElement>(null);
  const periodFilterButtonRef = React.useRef<HTMLButtonElement>(null);
  const typeFilterButtonRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!openTransactionFilter) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!transactionFiltersRef.current?.contains(event.target as Node)) {
        setOpenTransactionFilter(null);
      }
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpenTransactionFilter(null);
        (openTransactionFilter === "period" ? periodFilterButtonRef : typeFilterButtonRef).current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [openTransactionFilter]);
  const [selectedTransactionDetails, setSelectedTransactionDetails] = React.useState<SuccessfulTransaction | FailedTransaction | null>(null);
  const [showStoredSummaryDetails, setShowStoredSummaryDetails] = React.useState(false);
  const [validatedLastActivity, setValidatedLastActivity] = React.useState<Set<string> | null>(null);
  const [toast, setToast] = React.useState<ToastNotice | null>(null);
  const [historyStockChangeReview, setHistoryStockChangeReview] = React.useState<HistoryStockChangeReview | null>(null);
  const [historyReviewConfirmed, setHistoryReviewConfirmed] = React.useState(false);
  const [expandedReviewLocations, setExpandedReviewLocations] = React.useState<Set<string>>(() => new Set());
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const showToast = React.useCallback((kind: ToastKind, message: string) => {
    setToast({ id: Date.now(), kind, message });
  }, []);
  const dismissToast = React.useCallback(() => setToast(null), []);
  const handlePcountNotOpen = React.useCallback((reconciliationCode: string) => {
    removePcountFromLastActivity(employee.id, reconciliationCode);
    removeReconciliationContextOffline(reconciliationCode);
    setSelectedReconciliation((current) =>
      current && normalizeReference(current) === normalizeReference(reconciliationCode) ? null : current
    );
    setHistoryStockChangeReview(null);
    setHistorySubmitState({ isSubmitting: false, result: null });
    setHistoryRevision((revision) => revision + 1);
    showToast("error", PCOUNT_NOT_OPEN_MESSAGE);
  }, [employee.id, showToast]);

  const refreshLastActivity = React.useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setValidatedLastActivity(null);
      return;
    }

    const session = loadPcountSession(employee.id);
    const references = Array.from(new Set([
      ...loadPendingLocalScanEntries(employee.id)
        .filter((entry) => entry.mode === "pcount")
        .map((entry) => entry.reconciliationCode),
      ...(session?.reconciliationCode ? [session.reconciliationCode] : []),
    ].map(normalizeReference).filter(Boolean)));

    setValidatedLastActivity(new Set());
    const available = new Set<string>();
    let networkUnavailable = false;
    await Promise.all(references.map(async (reference) => {
      try {
        const context = await getReconciliationContext(reference);
        restorePcountToLastActivity(employee.id, context.reconciliationId);
        restorePcountToLastActivity(employee.id, reference);
        saveReconciliationContextOffline(context);
        available.add(normalizeReference(reference));
        available.add(normalizeReference(context.reconciliationId));
      } catch (error) {
        if (error instanceof PcountNotOpenError) {
          removePcountFromLastActivity(employee.id, reference);
          removeReconciliationContextOffline(reference);
        } else if (isNetworkFailure(error)) {
          networkUnavailable = true;
        }
      }
    }));
    setValidatedLastActivity(networkUnavailable ? null : new Set(available));
    setSelectedReconciliation((current) =>
      !networkUnavailable && current && !available.has(normalizeReference(current)) ? null : current
    );
    setHistoryRevision((revision) => revision + 1);
  }, [employee.id]);
  const historySubmitAttemptRef = React.useRef<{
    fingerprint: string;
    submissionId: string;
  } | null>(null);
  const showScanPage = currentView === "scan";
  const historyDeviceId = loadScannerDeviceName();
  const savedScanEntries = React.useMemo(
    () => {
      void historyRevision;
      return currentView === "history" ? loadPendingLocalScanEntries(employee.id).filter((entry) =>
        isTransactionForDevice(entry, historyDeviceId) &&
        (entry.scanTransactions || []).filter((tx) => tx.action === "ADD" || tx.action === "DEDUCT")
          .every((tx) => isTransactionForDevice(tx, historyDeviceId)) &&
        !isPcountReconciliationUnavailable(employee.id, entry.reconciliationCode) &&
        (entry.mode !== "pcount" || validatedLastActivity === null || validatedLastActivity.has(normalizeReference(entry.reconciliationCode)))
      ) : [];
    },
    [currentView, employee.id, historyRevision, validatedLastActivity, historyDeviceId]
  );
  const reconciliationGroups = React.useMemo(() => {
    const groups = new Map<string, LocalScanEntry[]>();

    for (const entry of savedScanEntries) {
      const current = groups.get(entry.reconciliationCode) || [];
      current.push(entry);
      groups.set(entry.reconciliationCode, current);
    }

    return Array.from(groups.entries()).map(([reference, entries]) => ({
      reference,
      entries,
      latestTimestamp: entries.reduce((latest, entry) => entry.timestamp && entry.timestamp > latest ? entry.timestamp : latest, ""),
      itemCount: entries.length,
      pcountCount: entries.filter((entry) => entry.mode === "pcount").length,
    }));
  }, [savedScanEntries]);
  const selectedEntries = React.useMemo(
    () =>
      selectedReconciliation
        ? savedScanEntries.filter((entry) => entry.reconciliationCode === selectedReconciliation)
        : [],
    [savedScanEntries, selectedReconciliation]
  );
  const selectedPendingTotal = selectedEntries.reduce(
    (total, entry) => total + Math.max(0, entry.quantity - (entry.submittedQuantity || 0)),
    0
  );
  const selectedReview = React.useMemo(() => {
    const pcountEntries = selectedEntries.filter((entry) => entry.mode === "pcount");
    const byLocation = new Map<string, { label: string; entries: LocalScanEntry[] }>();
    let addTransactions = 0;
    let deductTransactions = 0;

    pcountEntries.forEach((entry) => {
      const locationId = entry.bin.locationId || entry.bin.locationCode || entry.bin.locationName || entry.bin.bin || "Unknown Location";
      const label = entry.bin.locationCode || entry.bin.locationName || entry.bin.locationPath || entry.bin.bin || locationId;
      const current = byLocation.get(locationId) || { label, entries: [] };
      current.entries.push(entry);
      byLocation.set(locationId, current);
      (entry.scanTransactions || []).forEach((transaction) => {
        if (transaction.action === "ADD") addTransactions += 1;
        if (transaction.action === "DEDUCT") deductTransactions += 1;
      });
    });

    const session = selectedReconciliation ? loadPcountSession(employee.id) : null;
    const recountLocations = session?.reconciliationCode === selectedReconciliation
      ? new Set(session.locations.filter((location) => location.groupId?.startsWith("recount-")).map((location) => location.bin.locationId)).size
      : 0;

    return {
      locations: Array.from(byLocation.entries()).map(([id, value]) => ({ id, ...value })),
      locationCount: byLocation.size,
      itemLocationCount: pcountEntries.length,
      addTransactions,
      deductTransactions,
      recountLocations,
    };
  }, [employee.id, selectedEntries, selectedReconciliation]);
  const failedTransactions = React.useMemo<FailedTransaction[]>(() => {
    void historyRevision;
    return loadFailedTransactionHistory().filter((entry) => isTransactionForDevice(entry, historyDeviceId));
  }, [historyRevision, historyDeviceId]);
  const successfulTransactions = React.useMemo(() => {
    void historyRevision;
    const local = loadSuccessfulTransactionHistory().filter((entry) => isTransactionForDevice(entry, historyDeviceId));
    const allocations = loadCompletedAllocationHistory()
      .filter((entry) => isTransactionForDevice(entry, historyDeviceId))
      .map((entry) => createWarehouseAllocationTransaction({
      allocationName: entry.allocationName,
      completedAt: entry.completedAt,
      rowCount: entry.allocation.rows.length,
      stockEntryCount: entry.stockEntryIds.length,
    }));
    const combined = new Map<string, SuccessfulTransaction>();
    [...local, ...allocations].forEach((entry) => combined.set(entry.id, entry));
    return Array.from(combined.values()).sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  }, [historyRevision, historyDeviceId]);

  // Local device history is a compact receipt log, not an item-level ERP report.
  // Filter only fields that were actually stored with the transaction.
  const transactionWithinDate = React.useCallback((timestamp: string) => {
    if (transactionDateFilter === "all") return true;
    const value = new Date(timestamp).getTime();
    if (!Number.isFinite(value)) return false;
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const cutoff = transactionDateFilter === "today"
      ? startToday.getTime() : Date.now() - 7 * 86400000;
    return value >= cutoff;
  }, [transactionDateFilter]);
  const filteredSuccessfulTransactions = successfulTransactions.filter((entry) =>
    (transactionTypeFilter === "all" || entry.type === transactionTypeFilter) &&
    transactionWithinDate(entry.completedAt) &&
    [entry.title, entry.reference, entry.detail, entry.route || ""].some((value) =>
      value.toLocaleLowerCase().includes(transactionSearch.trim().toLocaleLowerCase())
    )
  );
  const filteredFailedTransactions = failedTransactions.filter((entry) =>
    (transactionTypeFilter === "all" || transactionTypeFilter === entry.type) &&
    transactionWithinDate(entry.failedAt) &&
    [entry.title, entry.reference, entry.detail, entry.errorMessage].some((value) =>
      value.toLocaleLowerCase().includes(transactionSearch.trim().toLocaleLowerCase())
    )
  );
  const filteredPendingReconciliations = reconciliationGroups.filter((group) =>
    (transactionTypeFilter === "all" || transactionTypeFilter === "physical_count") &&
    [group.reference, "Physical Count"].some((value) =>
      value.toLocaleLowerCase().includes(transactionSearch.trim().toLocaleLowerCase())
    ) && (transactionDateFilter === "all" ||
      transactionWithinDate(group.latestTimestamp))
  );

  React.useEffect(() => {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }, [currentView, selectedReconciliation, scanSessionKey]);

  React.useEffect(() => {
    if (currentView === "history" || (currentView === "scan" && scanMode === "pcount")) {
      void refreshLastActivity();
    }

    const handleOnline = () => void refreshLastActivity();
    const handleVisible = () => {
      if (document.visibilityState === "visible") void refreshLastActivity();
    };
    let nativeListener: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void refreshLastActivity();
    }).then((listener) => {
      nativeListener = listener;
    });
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      void nativeListener?.remove();
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [currentView, refreshLastActivity, scanMode]);

  const startScanner = (mode: ScanMode, resumePcount = false) => {
    setResumeWarehouseAllocation(false);
    setResumePhysicalCount(mode === "pcount" && resumePcount);
    setManufacturingRole(undefined);
    setScanMode(mode);
    setScanSessionKey((key) => key + 1);
    setCurrentView("scan");
  };

  const startManufacturingRole = (role: ManufacturingRole) => {
    setResumeWarehouseAllocation(false);
    setManufacturingRole(role);
    setScanMode("in");
    setScanSessionKey((key) => key + 1);
    setCurrentView("scan");
  };

  const selectScannerQuantityMode = (mode: ScannerQuantityMode) => {
    const resolved = resolveScannerModes(mode, scannerPackageMode);
    setScannerQuantityMode(saveScannerQuantityMode(resolved.quantityMode));
    setScannerQuickMenuOpen(false);
    showToast("success", mode === "automatic" && resolved.quantityMode === "manual"
      ? "Loose Pack requires Manual quantity. Manual mode remains active."
      : `${mode === "automatic" ? "Automatic" : "Manual"} scan mode saved on this device.`);
  };

  const selectScannerPackageMode = (mode: ScannerPackageMode) => {
    const resolved = resolveScannerModes(scannerQuantityMode, mode);
    setScannerPackageMode(saveScannerPackageMode(resolved.packageMode));
    setScannerQuantityMode(saveScannerQuantityMode(resolved.quantityMode));
    showToast("success", mode === "loose"
      ? "Loose Pack selected. Manual quantity mode is required and has been saved."
      : "Big Pack mode saved on this device.");
  };

  const resumeAllocation = () => {
    setResumeWarehouseAllocation(true);
    setManufacturingRole(undefined);
    setScanMode("in");
    setScanSessionKey((key) => key + 1);
    setCurrentView("scan");
  };

  const goBackHome = () => {
    setOpenTransactionFilter(null);
    setShowLogoutConfirm(false);
    setSelectedReconciliation(null);
    setHistorySubmitState({ isSubmitting: false, result: null });
    setCurrentView("dashboard");
  };

  const openHistory = () => {
    setOpenTransactionFilter(null);
    setSelectedReconciliation(null);
    setSelectedTransactionDetails(null);
    setHistorySubmitState({ isSubmitting: false, result: null });
    setHistoryRevision((revision) => revision + 1);
    setCurrentView("history");
  };

  const saveDeviceName = () => {
    saveScannerDeviceName(deviceNameInput);
    setDeviceNameInput(loadScannerDeviceName());
    setShowDeviceNameDialog(false);
    showToast("success", "Scanner name saved.");
  };

  const testErpConnection = async () => {
    if (connectionTest.loading) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const message = "No internet connection. Reconnect, then test ERPNext again.";
      setConnectionTest({ loading: false, ok: false, message, checkedAt: new Date().toISOString() });
      showToast("error", message);
      return;
    }
    setConnectionTest({ loading: true });
    try {
      const response = await erpRequest("/api/method/ping", { method: "GET", retryOn403: false });
      if (!response.ok) throw new Error(`ERPNext returned HTTP ${response.status}.`);
      const message = `Connected to ${getActiveErpBaseUrl()}`;
      setConnectionTest({ loading: false, ok: true, message, checkedAt: new Date().toISOString() });
      showToast("success", "ERPNext connection is working.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to reach ERPNext.";
      setConnectionTest({ loading: false, ok: false, message, checkedAt: new Date().toISOString() });
      showToast("error", `ERPNext connection failed. ${message}`);
    }
  };

  const openReconciliation = (reference: string) => {
    setSelectedReconciliation(reference);
    setHistoryReviewConfirmed(false);
    setExpandedReviewLocations(new Set());
    setHistorySubmitState({ isSubmitting: false, result: null });
  };

  const closeReconciliation = () => {
    setSelectedReconciliation(null);
    setHistoryReviewConfirmed(false);
    setExpandedReviewLocations(new Set());
    setHistorySubmitState({ isSubmitting: false, result: null });
  };

  React.useEffect(() => {
    if (currentView === "scan") return;

    let listener: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;
    let cancelled = false;
    void CapacitorApp.addListener("backButton", () => {
      if (showDeviceNameDialog) {
        setShowDeviceNameDialog(false);
      } else if (showClearSavedConfirm) {
        setShowClearSavedConfirm(false);
      } else if (showLogoutConfirm) {
        setShowLogoutConfirm(false);
      } else if (currentView === "history" && openTransactionFilter) {
        setOpenTransactionFilter(null);
      } else if (currentView === "history" && selectedTransactionDetails) {
        setSelectedTransactionDetails(null);
      } else if (currentView === "history" && selectedReconciliation) {
        closeReconciliation();
      } else if (currentView !== "dashboard") {
        goBackHome();
      } else {
        // Authenticated Inventory dashboard is the navigation root.
        // Android Back must not terminate the scanner or abandon saved work.
        showToast("warning", "Use Log out from Profile to return to the Login screen.");
      }
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
  }, [currentView, selectedReconciliation, selectedTransactionDetails, openTransactionFilter, showClearSavedConfirm, showDeviceNameDialog, showLogoutConfirm]);

  // Let keyboard users dismiss the open dialog with Escape, and keep Tab focus trapped inside it,
  // matching the hardware back-button behavior and standard modal dialog semantics.
  React.useEffect(() => {
    const dialogOpen = showDeviceNameDialog || showClearSavedConfirm || showLogoutConfirm || Boolean(historyStockChangeReview);
    if (!dialogOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (showDeviceNameDialog) {
          setShowDeviceNameDialog(false);
        } else if (showClearSavedConfirm) {
          setShowClearSavedConfirm(false);
        } else if (showLogoutConfirm) {
          setShowLogoutConfirm(false);
        } else if (historyStockChangeReview) {
          setHistoryStockChangeReview(null);
          showToast("warning", `${historyStockChangeReview.inventoryLocation} requires review.`);
        }
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showDeviceNameDialog, showClearSavedConfirm, showLogoutConfirm, historyStockChangeReview, showToast]);

  const clearSavedScans = () => {
    const pcountReferences = new Set(
      loadLocalScanEntries(employee.id)
        .filter((entry) => entry.mode === "pcount" && entry.reconciliationCode)
        .map((entry) => entry.reconciliationCode)
    );
    const activePcountSession = loadPcountSession(employee.id);
    if (activePcountSession?.reconciliationCode) pcountReferences.add(activePcountSession.reconciliationCode);
    const pcountLastSetup = loadLastScanSetup(employee.id, "pcount");
    if (pcountLastSetup?.reconciliationCode) pcountReferences.add(pcountLastSetup.reconciliationCode);
    pcountReferences.forEach((reconciliationCode) => {
      removePcountFromLastActivity(employee.id, reconciliationCode);
    });
    clearPcountSession(employee.id);
    clearLocalScanEntries(employee.id);
    setSelectedReconciliation(null);
    setHistorySubmitState({ isSubmitting: false, result: null });
    setHistoryRevision((revision) => revision + 1);
    setShowClearSavedConfirm(false);
    showToast("success", "Saved scans cleared from this device.");
  };

  const submitSelectedReconciliation = async () => {
    if (!selectedReconciliation || historySubmitState.isSubmitting) return;
    if (!historyReviewConfirmed) {
      showToast("warning", "Review the Physical Count summary and confirm it before submitting to ERP.");
      return;
    }

    const session = loadPcountSession(employee.id);
    const incompleteLocations = session?.reconciliationCode === selectedReconciliation
      ? session.locations.filter((location) => location.status !== "completed")
      : [];
    if (incompleteLocations.length > 0 || (session?.reconciliationCode === selectedReconciliation && session.activeLocationId)) {
      const names = incompleteLocations.map((location) => location.bin.locationCode || location.bin.locationId).join(", ");
      showToast("warning", `Complete these locations before submitting: ${names || session?.activeLocationId}.`);
      return;
    }

    const conflict = selectedEntries.find((entry) => entry.syncConflict && isPendingLocalScanEntry(entry));
    if (conflict && !conflict.syncConflict?.startsWith("Baseline refresh required")) {
      showToast("warning", `${conflict.itemCode}: ${conflict.syncConflict}`);
      return;
    }

    const pendingEntries = selectedEntries.filter((entry) => entry.mode === "pcount");

    if (pendingEntries.length === 0) {
      setHistorySubmitState({
        isSubmitting: false,
        result: { ok: false, text: "No P. Count entries to submit for this reference." },
      });
      showToast("warning", "No Physical Count entries are ready to submit.");
      return;
    }

    const negativeCountIssue = getPcountNegativeCountIssue(pendingEntries);
    if (negativeCountIssue) {
      const message = getPcountNegativeCountMessage(negativeCountIssue);
      setHistorySubmitState({ isSubmitting: false, result: { ok: false, text: message } });
      showToast("error", message);
      return;
    }

    setHistorySubmitState({ isSubmitting: true, result: null });
    let attemptedEntries: PcountEntry[] = [];
    let attemptedSourceFingerprint = "";
    try {
      const context = await getReconciliationContext(selectedReconciliation);
      restorePcountToLastActivity(employee.id, context.reconciliationId);
      saveReconciliationContextOffline(context);
      const sourceFingerprint = createPcountSourceFingerprint(selectedReconciliation, pendingEntries);
      attemptedSourceFingerprint = sourceFingerprint;
      const persistedRetry = loadPendingPcountSubmission(employee.id, selectedReconciliation);
      const shouldReuseSubmissionId = persistedRetry?.sourceFingerprint === sourceFingerprint;
      const pcountEntries = await Promise.all(pendingEntries.map(async (entry) => {
        const locationId = entry.bin.locationId || "";
        if (normalizeWarehouseName(entry.bin.warehouse) !== normalizeWarehouseName(context.warehouse)) {
          throw new Error(`${locationId}: location warehouse ${entry.bin.warehouse} does not match ${context.warehouse}.`);
        }
        const baseline = await getPcountItemBaseline(
          selectedReconciliation,
          entry.itemCode,
          context.warehouse,
          locationId,
          entry.lotNo || ""
        );
        if (normalizeWarehouseName(baseline.warehouse) !== normalizeWarehouseName(context.warehouse)) {
          throw new Error(`${entry.itemCode}: ERP returned warehouse ${baseline.warehouse}; expected ${context.warehouse}.`);
        }
        if (baseline.inventoryLocation.trim() !== locationId) {
          throw new Error(`${entry.itemCode}: ERP returned location ${baseline.inventoryLocation}; expected ${locationId}.`);
        }
        const authoritativeUom = getAuthoritativeStockUom(baseline.stockUom, baseline.uom);
        // QR UOM is informational only for Physical Count. Quantities are
        // recorded in ERP Stock UOM; keep historical conversion metadata.
        const conversionFactor = entry.uomConversionFactor ?? 1;
        if (!authoritativeUom || !conversionFactor) {
          throw new Error(`${entry.itemCode}: ERPNext Item Stock UOM is required before submitting Physical Count.`);
        }
        updateValidatedLocalScanEntry(employee.id, entry, {
          authoritativeUom,
          itemName: baseline.itemName,
          erpBaselineQuantity: baseline.currentErpQuantity,
          lotNo: baseline.batchNo,
          ...(conversionFactor ? { uomConversionFactor: conversionFactor } : {}),
        });
        const expectedPreviousCount = baseline.currentErpQuantity;
        return buildPcountEntry({
          entry,
          warehouse: context.warehouse,
          expectedPreviousCount: getPcountStartingPhysicalCount(entry),
          expectedErpQuantity: expectedPreviousCount,
          authoritativeUom,
        });
      }));
      attemptedEntries = pcountEntries;
      const fingerprint = JSON.stringify({
        reconciliationId: selectedReconciliation,
        entries: pcountEntries,
      });
      historySubmitAttemptRef.current = {
        fingerprint,
        submissionId: shouldReuseSubmissionId && persistedRetry
          ? persistedRetry.submissionId
          : createPcountSubmissionId(),
      };
      savePendingPcountSubmission(employee.id, selectedReconciliation, {
        fingerprint,
        sourceFingerprint,
        submissionId: historySubmitAttemptRef.current.submissionId,
        payload: {
          reconciliation_id: selectedReconciliation,
          operation: "adjustment",
          submission_id: historySubmitAttemptRef.current.submissionId,
          entries: pcountEntries,
        },
        queuedAt: persistedRetry?.queuedAt || new Date().toISOString(),
      });
      const result = await submitPcountEntries(selectedReconciliation, pcountEntries, {
        operation: "adjustment",
        submissionId: historySubmitAttemptRef.current.submissionId,
      });
      saveSuccessfulTransaction(createPhysicalCountTransaction({
        reconciliationId: selectedReconciliation,
        submissionId: result.submissionId,
        itemCount: result.itemCount,
        entries: pcountEntries,
      }));
      markPcountSubmissionTransactionsSubmitted(employee.id, selectedReconciliation, pcountEntries);
      clearPcountLastScanSetup(employee.id, selectedReconciliation);
      clearPendingPcountSubmission(employee.id, selectedReconciliation);
      const activeSession = loadPcountSession(employee.id);
      if (activeSession?.reconciliationCode === selectedReconciliation) {
        clearPcountSession(employee.id);
      }
      historySubmitAttemptRef.current = null;
      setHistoryRevision((revision) => revision + 1);
      setHistorySubmitState({
        isSubmitting: false,
        result: { ok: true, text: `${result.itemCount} item(s) saved to ${selectedReconciliation}.` },
      });
      showToast("success", `${result.itemCount} item(s) saved to ${selectedReconciliation}.`);
    } catch (err) {
      if (err instanceof PcountNotOpenError) {
        handlePcountNotOpen(selectedReconciliation);
        return;
      }
      if (err instanceof PcountStockChangedError && attemptedEntries.length > 0) {
        const fallback = attemptedEntries.find((entry) =>
          (!err.itemCode || entry.itemCode === err.itemCode) &&
          (!err.inventoryLocation || entry.inventoryLocation === err.inventoryLocation)
        ) || attemptedEntries[0];
        const target = {
          itemCode: err.itemCode || fallback.itemCode,
          warehouse: err.warehouse || fallback.warehouse,
          inventoryLocation: err.inventoryLocation || fallback.inventoryLocation,
        };
        try {
          const latest = await getPcountItemBaseline(selectedReconciliation, target.itemCode, target.warehouse, target.inventoryLocation, fallback.lotNo || "");
          const refreshedEntries = refreshPcountExpectedErpQuantity(attemptedEntries, target, latest.currentErpQuantity);
          const refreshedTarget = refreshedEntries.find((entry) =>
            entry.itemCode === target.itemCode && entry.warehouse === target.warehouse && entry.inventoryLocation === target.inventoryLocation
          ) || fallback;
          markPcountBaselineRefreshRequired(employee.id, selectedReconciliation, target, "Baseline refresh required. Review before resubmitting.");
          setHistoryStockChangeReview({
            previousErpQuantity: Number.isFinite(err.expectedErpQuantity)
              ? err.expectedErpQuantity
              : fallback.expectedERPQuantity || 0,
            currentErpQuantity: latest.currentErpQuantity,
            ...target,
            uom: refreshedTarget.uom,
            physicalCount: refreshedTarget.physicalCount,
            entries: refreshedEntries,
            sourceFingerprint: attemptedSourceFingerprint,
          });
          setHistoryRevision((revision) => revision + 1);
          setHistorySubmitState({ isSubmitting: false, result: { ok: false, text: PCOUNT_BLIND_CONFLICT_NOTICE } });
          return;
        } catch (refreshError) {
          markPcountBaselineRefreshRequired(employee.id, selectedReconciliation, target);
          const message = /network|connect|timeout|fetch/i.test(refreshError instanceof Error ? refreshError.message : String(refreshError))
            ? "Baseline refresh required. Connect to ERP before resubmitting."
            : refreshError instanceof Error ? refreshError.message : "Unable to refresh the ERP baseline.";
          setHistorySubmitState({ isSubmitting: false, result: { ok: false, text: message } });
          showToast("warning", message);
          return;
        }
      }
      const errorMessage = err instanceof Error ? err.message : "Submit failed.";
      console.error("Saved Physical Count payload validation/submission failed", {
        reconciliationId: selectedReconciliation,
        error: errorMessage,
        entries: pendingEntries.map((entry) => ({
          itemCode: entry.itemCode,
          warehouse: entry.bin.warehouse,
          locationId: entry.bin.locationId,
          uom: entry.authoritativeUom || entry.uom,
          submittedQuantity: entry.submittedQuantity,
          erpBaselineQuantity: entry.erpBaselineQuantity,
          transactions: entry.scanTransactions,
        })),
      });
      setHistorySubmitState({
        isSubmitting: false,
        result: { ok: false, text: errorMessage },
      });
      showToast("error", errorMessage);
    }
  };

  const resubmitHistoryAfterBaselineRefresh = async () => {
    if (!historyStockChangeReview || !selectedReconciliation || historySubmitState.isSubmitting) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      showToast("warning", "Baseline refresh required. Connect to ERP before resubmitting.");
      return;
    }
    setHistorySubmitState({ isSubmitting: true, result: null });
    const submissionId = createPcountSubmissionId();
    const fingerprint = JSON.stringify({ reconciliationId: selectedReconciliation, entries: historyStockChangeReview.entries });
    try {
    savePendingPcountSubmission(employee.id, selectedReconciliation, {
      fingerprint,
      sourceFingerprint: historyStockChangeReview.sourceFingerprint,
      submissionId,
      payload: {
        reconciliation_id: selectedReconciliation,
        operation: "adjustment",
        submission_id: submissionId,
        entries: historyStockChangeReview.entries,
      },
    });
    } catch (error) {
      setHistorySubmitState({ isSubmitting: false, result: null });
      showToast("error", error instanceof Error ? error.message : "Unable to save count locally. Upload cancelled.");
      return;
    }
    try {
      const result = await submitPcountEntries(selectedReconciliation, historyStockChangeReview.entries, {
        operation: "adjustment",
        submissionId,
      });
      saveSuccessfulTransaction(createPhysicalCountTransaction({
        reconciliationId: selectedReconciliation,
        submissionId: result.submissionId,
        itemCount: result.itemCount,
        entries: historyStockChangeReview.entries,
      }));
      markPcountSubmissionTransactionsSubmitted(employee.id, selectedReconciliation, historyStockChangeReview.entries);
      clearPcountLastScanSetup(employee.id, selectedReconciliation);
      clearPendingPcountSubmission(employee.id, selectedReconciliation);
      const activeSession = loadPcountSession(employee.id);
      if (activeSession?.reconciliationCode === selectedReconciliation) clearPcountSession(employee.id);
      setHistoryStockChangeReview(null);
      setHistoryRevision((revision) => revision + 1);
      setHistorySubmitState({ isSubmitting: false, result: { ok: true, text: `${result.itemCount} item(s) saved to ${selectedReconciliation}.` } });
      showToast("success", `${result.itemCount} item(s) saved to ${selectedReconciliation}.`);
    } catch (error) {
      if (error instanceof PcountNotOpenError) {
        handlePcountNotOpen(selectedReconciliation);
        return;
      }
      if (error instanceof PcountStockChangedError) {
        const fallback = historyStockChangeReview.entries.find((entry) =>
          (!error.itemCode || entry.itemCode === error.itemCode) &&
          (!error.inventoryLocation || entry.inventoryLocation === error.inventoryLocation)
        ) || historyStockChangeReview.entries[0];
        const target = {
          itemCode: error.itemCode || fallback.itemCode,
          warehouse: error.warehouse || fallback.warehouse,
          inventoryLocation: error.inventoryLocation || fallback.inventoryLocation,
        };
        try {
          const latest = await getPcountItemBaseline(selectedReconciliation, target.itemCode, target.warehouse, target.inventoryLocation, fallback.lotNo || "");
          const refreshedEntries = refreshPcountExpectedErpQuantity(historyStockChangeReview.entries, target, latest.currentErpQuantity);
          const refreshedTarget = refreshedEntries.find((entry) =>
            entry.itemCode === target.itemCode && entry.warehouse === target.warehouse && entry.inventoryLocation === target.inventoryLocation
          ) || fallback;
          markPcountBaselineRefreshRequired(employee.id, selectedReconciliation, target, "Baseline refresh required. Review before resubmitting.");
          setHistoryStockChangeReview({
            previousErpQuantity: Number.isFinite(error.expectedErpQuantity) ? error.expectedErpQuantity : fallback.expectedERPQuantity || 0,
            currentErpQuantity: latest.currentErpQuantity,
            ...target,
            uom: refreshedTarget.uom,
            physicalCount: refreshedTarget.physicalCount,
            entries: refreshedEntries,
            sourceFingerprint: historyStockChangeReview.sourceFingerprint,
          });
          setHistorySubmitState({ isSubmitting: false, result: { ok: false, text: PCOUNT_BLIND_CONFLICT_NOTICE } });
          showToast("warning", PCOUNT_BLIND_CONFLICT_NOTICE);
          return;
        } catch (refreshError) {
          const refreshMessage = /network|connect|timeout|fetch/i.test(refreshError instanceof Error ? refreshError.message : String(refreshError))
            ? "Baseline refresh required. Connect to ERP before resubmitting."
            : refreshError instanceof Error ? refreshError.message : "Unable to refresh the ERP baseline.";
          setHistorySubmitState({ isSubmitting: false, result: { ok: false, text: refreshMessage } });
          showToast("warning", refreshMessage);
          return;
        }
      }
      const message = /transaction.*already.*submitted|already.*transaction/i.test(error instanceof Error ? error.message : String(error))
          ? "A scan transaction may already be submitted. Automatic retry stopped; review the audit history."
          : error instanceof Error ? error.message : "Resubmission failed.";
      setHistorySubmitState({ isSubmitting: false, result: { ok: false, text: message } });
      showToast("error", message);
    }
  };

  const dashboardPcountSession = currentView === "dashboard" ? loadPcountSession(employee.id) : null;
  const dashboardHandover = currentView === "dashboard" ? loadDeviceHandover() : null;
  const dashboardActiveAllocation = currentView === "dashboard" ? loadActiveWarehouseAllocation() : null;
  const dashboardAllocation = dashboardActiveAllocation?.allocation || null;
  const dashboardAllocationVerified = dashboardAllocation?.rows.filter((row) => row.status.trim().toLocaleUpperCase() === "VERIFIED").length || 0;
  const dashboardAllocationTotal = dashboardAllocation?.rows.length || 0;
  const dashboardAllocationRemaining = Math.max(0, dashboardAllocationTotal - dashboardAllocationVerified);
  const hasDashboardAllocationWork = Boolean(dashboardAllocation?.name && dashboardAllocationRemaining > 0);
  const dashboardPcountRemaining = dashboardPcountSession?.locations.filter((location) => location.status !== "completed").length || 0;
  const dashboardPcountTotal = dashboardPcountSession?.locations.length || 0;
  // Resume Work is local/offline-first. If a Physical Count session still exists
  // on this device, keep it resumable even when ERP/network is unavailable.
  // A reconciliation confirmed closed by ERP already clears the saved session
  // through removePcountFromLastActivity(), so network status must not hide it.
  const hasDashboardPcountWork = Boolean(dashboardPcountSession?.reconciliationCode);
  const dashboardPcountStatus = dashboardPcountSession?.activeLocationId
    ? "Storage Location count in progress"
    : dashboardPcountRemaining > 0
      ? `${dashboardPcountRemaining} of ${dashboardPcountTotal} location${dashboardPcountRemaining === 1 ? "" : "s"} remaining`
      : dashboardPcountTotal > 0
        ? "All recorded locations counted · Review or continue"
        : "Ready to scan a Storage Location";
  const hasDashboardHandoverWork = Boolean(dashboardHandover && !hasDashboardAllocationWork);
  const handoverStatusLabel = (() => {
    switch (dashboardHandover?.status) {
      case "OPEN": return "Pullout in progress";
      case "PENDING_CHECK": return "Waiting for Checker";
      case "CHECKED": return "Checker verified · Ready for Picker";
      case "ALLOCATION_CREATED": return "Warehouse Allocation in progress";
      default: return dashboardHandover?.status?.replaceAll("_", " ") || "In progress";
    }
  })();

  // Local settings summaries are resolved only while Profile/Settings is open.
  // This avoids fake illustrated counts and keeps locally saved scans intact.
  const isProfileView = currentView === "profile" || currentView === "settings";
  const profilePcountSession = isProfileView ? loadPcountSession(employee.id) : null;
  const profileScanEntryCount = isProfileView ? loadLocalScanEntries(employee.id).length : 0;
  const profilePendingPcountCount = isProfileView ? loadPendingLocalScanEntries(employee.id).filter((entry) => entry.mode === "pcount").length : 0;
  const profileAllocation = isProfileView ? loadActiveWarehouseAllocation()?.allocation : null;
  const profileHandover = isProfileView ? loadDeviceHandover() : null;
  const profilePendingWorkflowCount =
    Number(Boolean(profilePcountSession?.reconciliationCode || profilePendingPcountCount > 0)) +
    Number(Boolean(profileAllocation?.name && profileAllocation.rows.some((row) => row.status.trim().toUpperCase() !== "VERIFIED"))) +
    Number(Boolean(profileHandover?.batchId && !profileAllocation?.name));

  return (
    <>
      <style>{`
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      @media (prefers-reduced-motion: reduce) {
        .bp-blank,
        .home-scan-selector,
        .simple-view,
        .logout-dialog,
        .home-scan-option,
        .home-work-card {
          animation: none !important;
          transition: none !important;
        }
      }

      .bp-root {
        min-height: 100vh;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        font-family: 'Sora', sans-serif;
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .bp-blob {
        position: fixed;
        border-radius: 50%;
        pointer-events: none;
        z-index: 0;
        filter: blur(80px);
      }
      .bp-blob-1 {
        width: 520px; height: 520px;
        top: -180px; left: -140px;
        background: radial-gradient(circle, hsl(var(--primary) / 0.18) 0%, transparent 70%);
      }
      .bp-blob-2 {
        width: 400px; height: 400px;
        bottom: -120px; right: -100px;
        background: radial-gradient(circle, hsl(var(--primary) / 0.12) 0%, transparent 70%);
      }
      .bp-blob-3 {
        width: 300px; height: 300px;
        top: 40%; left: 40%;
        background: radial-gradient(circle, hsl(var(--primary) / 0.06) 0%, transparent 70%);
      }

      .bp-main {
        position: relative;
        z-index: 1;
        flex: 1;
        min-width: 0;
        padding: 20px 16px 28px;
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }
      .bp-main > .app-status-label {
        flex: 0 0 auto;
        width: 100%;
        max-width: 100%;
        align-self: stretch;
      }
      .bp-main > .bp-blank,
      .bp-main > .bp-surface {
        flex: 1 1 auto;
        min-width: 0;
        width: 100%;
      }
      @media (min-width: 768px) {
        .bp-main { padding: 28px 32px 40px; }
      }

      .bp-blank {
        width: 100%;
        min-height: calc(100vh - 120px);
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: flex-start;
        justify-content: center;
      }
      .bp-blank::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
          height: 1px;
        background: linear-gradient(90deg, transparent, hsl(var(--primary) / 0.5), transparent);
      }

      .bp-surface {
        width: 100%;
        min-height: calc(100vh - 120px);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      @media (max-width: 767px) {
        .bp-main { padding-bottom: 92px; }
        .bp-blank { min-height: calc(100vh - 124px); }
        .bp-surface { min-height: calc(100vh - 124px); }
      }

      .bp-blank { animation: bpFade 0.5s cubic-bezier(0.16,1,0.3,1) 0.08s both; }
      @keyframes bpFade { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

      .home-scan-selector {
        width: min(100%, 420px);
        margin-top: 6px;
        background: hsl(var(--card));
        border: 1px solid hsl(var(--primary) / 0.18);
        border-radius: 18px;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
        overflow: hidden;
        animation: bpFade 0.22s ease both;
      }
      .home-scan-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 16px 10px;
      }
      .home-scan-title {
        font-size: 18px;
        font-weight: 800;
        color: hsl(var(--foreground));
      }
      .home-scan-sub {
        margin-top: 4px;
        font-size: 12px;
        color: hsl(var(--muted-foreground));
      }
      .home-head-actions {
        min-width: 0;
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .home-scanner-name {
        max-width: 112px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .home-settings-button {
        width: 42px;
        height: 42px;
        padding: 0;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 12px;
        background: rgba(255,255,255,.1);
        color: #fff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .home-settings-button:hover,
      .home-settings-button:focus-visible { background: rgba(255,255,255,.18); }
      .home-settings-button:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
      .home-scan-options {
        display: grid;
        gap: 10px;
        padding: 12px 16px 16px;
        overflow-y: auto;
      }
      .home-current-work {
        display: grid;
        gap: 9px;
        padding: 2px 0 4px;
      }
      .home-current-work-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 0 2px;
      }
      .home-current-work-title {
        font-size: 12px;
        font-weight: 900;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: #14213d;
      }
      .home-current-work-count {
        min-width: 24px;
        height: 24px;
        padding: 0 7px;
        border-radius: 999px;
        background: #ffe8da;
        color: #c24c05;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 900;
      }
      .home-work-card {
        width: 100%;
        border: 1px solid #e4e0d4;
        border-left: 4px solid #fb6107;
        border-radius: 12px;
        background: #fffaf7;
        color: #14213d;
        padding: 12px;
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr) auto;
        gap: 11px;
        align-items: center;
        text-align: left;
        font-family: inherit;
      }
      .home-work-card:hover {
        border-color: #fb6107;
        background: #fff6f0;
      }
      .home-work-card:focus-visible {
        border-color: #fb6107;
        background: #fff6f0;
        outline: 3px solid #14213d;
        outline-offset: 2px;
      }
      .home-work-icon {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: #ffe8da;
        color: #c24c05;
      }
      .home-work-card.is-pcount { border-left-color: #5a4fb8; background: #faf9ff; }
      .home-work-card.is-pcount .home-work-icon { background: #ebe9fa; color: #5a4fb8; }
      .home-work-card.is-allocation { border-left-color: #16834a; background: #f8fcf9; }
      .home-work-card.is-allocation .home-work-icon { background: #e1f4e8; color: #16834a; }
      .home-work-progress {
        width: 100%;
        height: 5px;
        margin-top: 7px;
        border-radius: 999px;
        background: #e8e5dc;
        overflow: hidden;
        display: block;
      }
      .home-work-progress > span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: #16834a;
        transition: width .2s ease;
      }
      .home-work-copy { min-width: 0; }
      .home-work-type { display: block; font-size: 11px; font-weight: 800; color: #6b7280; }
      .home-work-reference {
        display: block;
        margin-top: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 800 14px Consolas, monospace;
      }
      .home-work-status { display: block; margin-top: 4px; font-size: 11px; line-height: 1.35; color: #6b7280; }
      .home-work-time { display: block; margin-top: 3px; color: #81899b; font-size: 10px; line-height: 1.3; }
      .home-work-continue {
        min-height: 34px;
        padding: 0 10px;
        border-radius: 9px;
        background: #14213d;
        color: #fff;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 800;
        white-space: nowrap;
      }
      .home-work-divider { height: 1px; background: #ece9e2; margin: 2px 0 1px; }
      .home-scan-option {
        min-height: 62px;
        border: 1px solid hsl(var(--border));
        border-radius: 14px;
        background: hsl(var(--foreground) / 0.03);
        color: hsl(var(--foreground));
        font-family: 'Sora', sans-serif;
        display: grid;
        grid-template-columns: 42px 1fr;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        text-align: left;
      }
      .home-scan-option:hover {
        border-color: hsl(var(--primary) / 0.35);
        background: hsl(var(--primary) / 0.05);
      }
      .home-scan-option-icon {
        width: 42px;
        height: 42px;
        border-radius: 12px;
        background: hsl(var(--primary) / 0.1);
        color: hsl(var(--primary));
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .home-scan-option-title {
        display: block;
        font-size: 15px;
        font-weight: 800;
        line-height: 1.2;
      }
      .home-scan-option-sub {
        display: block;
        margin-top: 3px;
        font-size: 11px;
        color: hsl(var(--muted-foreground));
        line-height: 1.35;
      }
      .bp-back-row {
        width: min(100%, 860px);
        margin: 0 auto;
      }
      .bp-back-button {
        min-height: 40px;
        border: 1px solid hsl(var(--border));
        border-radius: 11px;
        background: hsl(var(--card));
        color: hsl(var(--foreground));
        font-family: 'Sora', sans-serif;
        font-size: 12px;
        font-weight: 800;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 12px;
        box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
      }
      .bp-back-button:hover {
        border-color: hsl(var(--primary) / 0.35);
        background: hsl(var(--primary) / 0.05);
      }
      .home-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        padding: 0 16px 16px;
      }
      .home-action {
        min-height: 44px;
        border: 1px solid hsl(var(--border));
        border-radius: 12px;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        font-family: 'Sora', sans-serif;
        font-size: 12px;
        font-weight: 800;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .home-action:hover {
        border-color: hsl(var(--primary) / 0.35);
        background: hsl(var(--primary) / 0.05);
      }
      .home-action-danger {
        color: hsl(0 72% 48%);
      }
      .home-device-name {
        padding: 0 16px 16px;
      }
      .home-device-name .home-action {
        width: 100%;
      }
      .device-dialog-input {
        width: 100%;
        min-height: 44px;
        margin-top: 12px;
        border: 1px solid hsl(var(--border));
        border-radius: 11px;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        font-family: 'Sora', sans-serif;
        font-size: 14px;
        padding: 0 12px;
      }
      .device-dialog-input:focus-visible {
        outline: 3px solid #14213d;
        outline-offset: 1px;
      }
      .device-dialog-input:focus {
        border-color: hsl(var(--primary) / 0.55);
        background: hsl(var(--primary) / 0.05);
      }
      .logout-dialog-backdrop {
        position: fixed;
        inset: 0;
        z-index: 80;
        background: rgba(15, 23, 42, 0.38);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
      }
      .logout-dialog {
        width: min(100%, 340px);
        background: hsl(var(--card));
        border: 1px solid hsl(var(--border));
        border-radius: 16px;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
        padding: 18px;
        animation: bpFade 0.18s ease both;
      }
      .logout-dialog-title {
        font-size: 17px;
        font-weight: 800;
        color: hsl(var(--foreground));
      }
      .logout-dialog-text {
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.5;
        color: hsl(var(--muted-foreground));
      }
      .logout-dialog-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-top: 18px;
      }
      .logout-dialog-button {
        min-height: 42px;
        border-radius: 11px;
        border: 1px solid hsl(var(--border));
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        font-family: 'Sora', sans-serif;
        font-size: 13px;
        font-weight: 800;
      }
      .logout-dialog-button-primary {
        border-color: transparent;
        background: hsl(0 72% 48%);
        color: white;
      }
      .simple-view {
        width: min(100%, 420px);
        margin-top: 6px;
        background: hsl(var(--card));
        border: 1px solid hsl(var(--primary) / 0.18);
        border-radius: 18px;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
        padding: 18px;
      }
      .simple-view-title {
        font-size: 18px;
        font-weight: 800;
        color: hsl(var(--foreground));
      }
      .simple-view-text {
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.5;
        color: hsl(var(--muted-foreground));
      }
      .simple-view-actions {
        display: flex;
        gap: 10px;
        margin-top: 16px;
      }
      .simple-view-actions .home-action {
        min-width: 112px;
        padding: 0 14px;
      }
      .settings-list {
        min-height: 0;
        flex: 1;
        display: grid;
        align-content: start;
        gap: 10px;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-bottom: max(4px, env(safe-area-inset-bottom));
      }
      .settings-action {
        width: 100%;
        min-height: 72px;
        padding: 12px 14px;
        border: 1px solid #e4e0d4;
        border-radius: 12px;
        background: #fff;
        color: #14213d;
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr) 20px;
        align-items: center;
        gap: 12px;
        text-align: left;
        font-family: inherit;
      }
      .settings-action:hover,
      .settings-action:focus-visible { border-color: #fb6107; background: #fffbf8; }
      .settings-action:disabled { opacity: .68; }
      .settings-action:focus-visible { outline: 3px solid #14213d; outline-offset: 2px; }
      .settings-action-icon {
        width: 42px;
        height: 42px;
        border-radius: 10px;
        background: #f4f2ec;
        color: #3b4a6b;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .settings-action-copy { min-width: 0; }
      .settings-action-title { display: block; font-size: 16px; font-weight: 800; line-height: 1.25; }
      .settings-action-detail { display: block; margin-top: 3px; color: #6b7280; font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
      .settings-action-chevron { color: #9ca3af; }
      .settings-action-danger .settings-action-icon,
      .settings-action-danger .settings-action-title { color: #c1272d; }
      .settings-control {
        padding: 14px;
        border: 1px solid #e4e0d4;
        border-radius: 12px;
        background: #fff;
      }
      .settings-control-head { display: flex; align-items: center; gap: 12px; }
      .settings-control-head .settings-action-copy { flex: 1; }
      .settings-segmented {
        margin-top: 12px;
        padding: 4px;
        border-radius: 12px;
        background: #f4f2ec;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
      }
      .settings-segmented button {
        min-height: 46px;
        border: 0;
        border-radius: 9px;
        background: transparent;
        color: #4d5871;
        font-family: inherit;
        font-size: 15px;
        font-weight: 800;
      }
      .settings-segmented button.is-selected { background: #14213d; color: #fff; box-shadow: 0 3px 8px rgba(20,33,61,.18); }
      .settings-result {
        margin-top: 9px;
        padding: 10px 12px;
        border-radius: 10px;
        background: #f4f2ec;
        color: #4d5871;
        font-size: 13px;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }
      .settings-result.is-success { background: #e1f4e8; color: #12683b; }
      .settings-result.is-error { background: #ffe8e8; color: #a51f28; }
      .settings-action-icon .spin { animation: settings-spin .8s linear infinite; }
      @keyframes settings-spin { to { transform: rotate(360deg); } }
      .settings-back-button {
        width: 42px;
        height: 42px;
        padding: 0;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 12px;
        background: rgba(255,255,255,.1);
        color: #fff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .history-list {
        display: grid;
        gap: 9px;
        margin-top: 14px;
        max-height: 460px;
        overflow: auto;
        padding-right: 2px;
      }
      .history-item {
        border: 1px solid hsl(var(--border));
        border-radius: 12px;
        background: hsl(var(--foreground) / 0.025);
        padding: 11px 12px;
        color: hsl(var(--foreground));
        font-family: 'Sora', sans-serif;
        text-align: left;
      }
      button.history-item {
        width: 100%;
      }
      button.history-item:hover {
        border-color: hsl(var(--primary) / 0.35);
        background: hsl(var(--primary) / 0.05);
      }
      .history-item-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .history-item-code {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 800;
        color: hsl(var(--foreground));
      }
      .history-item-mode {
        flex-shrink: 0;
        border-radius: 999px;
        background: hsl(var(--primary) / 0.1);
        color: hsl(var(--primary));
        padding: 4px 8px;
        font-size: 10px;
        font-weight: 800;
      }
      .history-item-detail {
        margin-top: 5px;
        font-size: 11px;
        line-height: 1.45;
        color: hsl(var(--muted-foreground));
      }
      .history-review-summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin-top: 12px;
      }
      .history-review-stat {
        padding: 10px;
        border: 1px solid #e4e0d4;
        border-radius: 10px;
        background: #fff;
      }
      .history-review-stat strong { display: block; color: #14213d; font-size: 18px; }
      .history-review-stat span { display: block; margin-top: 2px; color: #6b7280; font-size: 10px; font-weight: 800; text-transform: uppercase; }
      .history-location-review { border: 1px solid #e4e0d4; border-radius: 12px; background: #fff; overflow: hidden; }
      .history-location-review-button { width: 100%; border: 0; background: transparent; padding: 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; text-align: left; font-family: inherit; color: #14213d; }
      .history-location-review-button:hover { background: #fffbf8; }
      .history-location-review-title { min-width: 0; font: 800 13px Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .history-location-review-count { flex-shrink: 0; color: #6b7280; font-size: 10px; font-weight: 800; }
      .history-location-review-items { display: grid; gap: 8px; padding: 0 10px 10px; }
      .history-review-confirm { margin-top: 12px; padding: 12px; border: 1px solid #e4e0d4; border-radius: 11px; background: #fffaf7; display: flex; align-items: flex-start; gap: 10px; color: #14213d; font-size: 12px; font-weight: 700; line-height: 1.4; }
      .history-review-confirm input { width: 18px; height: 18px; margin-top: 1px; flex: 0 0 auto; accent-color: #fb6107; }
      .history-submit {
        width: 100%;
        margin-top: 14px;
        border-color: transparent;
        background: hsl(var(--primary));
        color: white;
      }
      .history-submit:disabled {
        opacity: 0.62;
      }
      .history-submit-result {
        margin-top: 10px;
        font-size: 12px;
        line-height: 1.45;
        font-weight: 700;
      }
      .history-back-top {
        margin-bottom: 14px;
      }
      .history-back-top .home-action {
        min-height: 38px;
        padding: 0 12px;
      }
      .history-total {
        margin-top: 5px;
        font-size: 18px;
        font-weight: 800;
        color: hsl(var(--foreground));
      }
      .history-meta-line {
        margin-top: 5px;
        font-size: 11px;
        line-height: 1.5;
        color: hsl(var(--muted-foreground));
      }
      .history-location {
        display: inline-flex;
        max-width: 100%;
        margin-top: 9px;
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
      .history-quantity-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0;
        margin-top: 9px;
        overflow: hidden;
        border-radius: 9px;
        background: #f4f2ec;
      }
      .history-quantity-box {
        padding: 8px;
        border-radius: 0;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .history-quantity-box + .history-quantity-box { border-top: 1px solid #e4e0d4; }
      .history-quantity-label {
        font-size: 9px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: hsl(var(--muted-foreground));
      }
      .history-quantity-value {
        margin-top: 3px;
        font-size: 13px;
        font-weight: 800;
        color: hsl(var(--foreground));
      }
      .history-empty {
        margin-top: 14px;
        padding: 18px;
        border: 1px dashed hsl(var(--border));
        border-radius: 12px;
        text-align: center;
        font-size: 12px;
        line-height: 1.5;
        color: hsl(var(--muted-foreground));
      }

      /* Industrial scanner redesign */
      .bp-root {
        background: #f4f2ec;
        color: #14213d;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        overflow-x: hidden;
      }
      .bp-blob { display: none; }
      .bp-main { padding: 22px 16px 40px; }
      .bp-blank::before { display: none; }
      .home-scan-selector,
      .simple-view {
        width: min(100%, 430px);
        margin-top: 0;
        border: 1px solid #e4e0d4;
        border-radius: 18px;
        background: #fff;
        box-shadow: 0 18px 44px rgba(20,33,61,.13);
        overflow: hidden;
      }
      .home-scan-head,
      .screen-appbar {
        min-height: 88px;
        padding: 18px;
        background: #14213d;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
      }
      .home-scan-head { display: block; }
      .home-title-line {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .home-scan-title,
      .screen-appbar-title {
        color: #fff;
        font-family: Impact, "Arial Narrow", sans-serif;
        font-size: 24px;
        font-weight: 700;
        letter-spacing: .045em;
        line-height: 1;
        text-transform: uppercase;
      }
      .home-scan-sub,
      .screen-appbar-sub { margin-top: 6px; color: #b9c2dc; font-size: 12px; }
      .home-scanner-status {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        border-radius: 999px;
        background: rgba(255,255,255,.1);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
      }
      .home-scanner-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #3ed598;
        box-shadow: 0 0 0 3px rgba(62,213,152,.2);
      }
      .home-scan-options { gap: 10px; padding: 16px; }
      .home-scan-option {
        min-height: 72px;
        grid-template-columns: 44px minmax(0,1fr) 20px;
        gap: 12px;
        padding: 12px;
        border: 1px solid #e4e0d4;
        border-left-width: 4px;
        border-radius: 12px;
        background: #fff;
        color: #14213d;
        font-family: inherit;
        transition: border-color .15s, background .15s, transform .15s;
      }
      .home-scan-option:hover,
      .home-scan-option:focus-visible {
        border-color: #fb6107;
        background: #fffbf8;
        transform: translateY(-1px);
      }
      .home-scan-option:focus-visible {
        outline: 3px solid #14213d;
        outline-offset: 2px;
      }
      .home-scan-option-icon { border-radius: 10px; }
      .home-scan-option-in .home-scan-option-icon { background: #e4eefa; color: #1d5fa8; }
      .home-scan-option-out .home-scan-option-icon { background: #ffe8da; color: #c24c05; }
      .home-scan-option-count .home-scan-option-icon { background: #ebe9fa; color: #5a4fb8; }
      .home-scan-option-time .home-scan-option-icon { background: #e1f4e8; color: #16834a; }
      .home-scan-option-title { font-size: 16px; font-weight: 700; }
      .home-scan-option-sub { color: #6b7280; font-size: 12px; }
      .home-scan-option-tag {
        margin-right: 5px;
        color: #6b7280;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: .08em;
      }
      .home-scan-chevron { color: #9ca3af; }
      .home-actions { padding: 0 16px 10px; }
      .home-action,
      .bp-back-button,
      .logout-dialog-button {
        min-height: 46px;
        border-color: #e4e0d4;
        border-radius: 12px;
        background: #fff;
        color: #14213d;
        font-family: inherit;
        font-weight: 700;
      }
      .home-action-danger { color: #c1272d; }
      .home-device-name { padding: 0 16px 16px; }
      .home-device-name .home-action { justify-content: flex-start; padding: 0 14px; }
      .simple-view { padding: 0; }
      .simple-view-body { padding: 16px; }
      .simple-view-title {
        color: #14213d;
        font-family: Impact, "Arial Narrow", sans-serif;
        font-size: 25px;
        letter-spacing: .025em;
        text-transform: uppercase;
      }
      .simple-view-text { color: #6b7280; font-size: 13px; }
      .history-back-top { margin-bottom: 14px; }
      .history-list { max-height: none; gap: 10px; }
      .history-item {
        border-color: #e4e0d4;
        border-radius: 12px;
        background: #fff;
        color: #14213d;
        font-family: inherit;
        padding: 14px;
      }
      button.history-item:hover { border-color: #fb6107; background: #fffbf8; }
      .history-item-code { color: #14213d; font-family: Consolas, monospace; font-size: 14px; }
      .history-item-mode { background: #ffe8da; color: #c24c05; }
      .history-total { color: #fb6107; font-size: 20px; }
      .history-location { background: #f4f2ec; color: #3b4a6b; }
      .history-quantity-box { background: #f4f2ec; }
      .history-submit {
        min-height: 52px;
        background: #fb6107;
        color: #fff;
        box-shadow: 0 8px 20px rgba(251,97,7,.22);
      }
      .history-review-hero {
        margin: 0 0 14px;
        padding: 15px;
        border: 1px solid #e4e0d4;
        border-radius: 12px;
        background: #fff;
        color: #14213d;
      }
      .history-review-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .history-review-code { font-family: Consolas, monospace; font-size: 14px; font-weight: 700; }
      .history-review-status { padding: 5px 9px; border-radius: 999px; background: #fdf0dc; color: #8a5a08; font-size: 10px; font-weight: 800; text-transform: uppercase; }
      .history-review-total { margin-top: 9px; color: #6b7280; font-size: 12px; }
      .history-review-total strong { color: #14213d; font-size: 17px; }
      .history-keep { width: 100%; margin-top: 8px; }
      .logout-dialog { border-color: #e4e0d4; border-radius: 18px; font-family: inherit; }
      .logout-dialog-button-primary { background: #c1272d; }
      .device-dialog-input { border-color: #e4e0d4; background: #f4f2ec; font-family: inherit; }

      /* Fixed viewport application shell */
      .bp-root {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }
      .bp-main {
        width: 100%;
        min-height: 0;
        flex: 1;
        padding: 0;
        overflow: hidden;
      }
      .bp-blank,
      .bp-surface {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }
      .home-scan-selector,
      .simple-view {
        width: 100%;
        max-width: none;
        height: 100%;
        min-height: 0;
        margin: 0;
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }
      .home-scan-selector {
        display: flex;
        flex-direction: column;
      }
      .home-scan-options { flex: 0 1 auto; }
      .simple-view {
        display: flex;
        flex-direction: column;
      }
      .screen-appbar { flex: 0 0 auto; }
      .simple-view-body {
        min-height: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .history-list {
        min-height: 0;
        flex: 1;
        align-content: start;
        grid-auto-rows: max-content;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: thin;
      }
      .history-submit,
      .history-keep,
      .simple-view-actions,
      .history-back-top,
      .simple-view-title,
      .simple-view-text,
      .history-review-hero,
      .history-empty { flex: 0 0 auto; }

      /* Dashboard Current Work - original card sizing, scroll-safe container */
      .home-scan-selector {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .home-scan-head {
        position: relative;
        z-index: 2;
        flex: 0 0 auto;
      }
      .home-scan-options {
        flex: 1 1 auto;
        min-height: 0;
        align-content: start;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 14px 12px calc(18px + env(safe-area-inset-bottom));
      }
      .home-current-work {
        display: grid;
        gap: 9px;
        margin: 0;
        padding: 2px 0 4px;
      }
      .home-current-work-head {
        padding: 0 2px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .home-current-work-title {
        font-size: 12px;
        font-weight: 900;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: #14213d;
      }
      .home-current-work-count {
        min-width: 24px;
        height: 24px;
        padding: 0 7px;
        border-radius: 999px;
        background: #ffe8da;
        color: #c24c05;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 900;
      }
      .home-work-card {
        width: 100%;
        min-height: 0;
        padding: 12px;
        border: 1px solid #e4e0d4;
        border-left: 4px solid #fb6107;
        border-radius: 12px;
        background: #fffaf7;
        color: #14213d;
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr) auto;
        gap: 11px;
        align-items: center;
        text-align: left;
        font-family: inherit;
        box-shadow: none;
        overflow: visible;
      }
      .home-work-card:hover,
      .home-work-card:focus-visible {
        border-color: #fb6107;
        background: #fff6f0;
        box-shadow: none;
      }
      .home-work-card:focus-visible {
        outline: 3px solid #14213d;
        outline-offset: 2px;
      }
      .home-work-card.is-pcount {
        border-left-color: #5a4fb8;
        background: #faf9ff;
      }
      .home-work-card.is-allocation {
        border-left-color: #16834a;
        background: #f8fcf9;
      }
      .home-work-icon {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: #ffe8da;
        color: #c24c05;
      }
      .home-work-card.is-pcount .home-work-icon { background: #ebe9fa; color: #5a4fb8; }
      .home-work-card.is-allocation .home-work-icon { background: #e1f4e8; color: #16834a; }
      .home-work-copy {
        min-width: 0;
      }
      .home-work-type {
        display: block;
        color: #6b7280;
        font-size: 11px;
        line-height: 1.2;
        font-weight: 800;
      }
      .home-work-reference {
        display: block;
        max-width: 100%;
        margin-top: 2px;
        color: #14213d;
        font-family: Consolas, monospace;
        font-size: 14px;
        line-height: 1.28;
        font-weight: 800;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .home-work-status {
        display: block;
        margin-top: 4px;
        color: #6b7280;
        font-size: 11px;
        line-height: 1.35;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .home-work-time {
        display: block;
        margin-top: 3px;
        color: #81899b;
        font-size: 10px;
        line-height: 1.3;
      }
      .home-work-continue {
        width: auto;
        height: auto;
        min-height: 34px;
        padding: 0 10px;
        border-radius: 9px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        background: #14213d;
        color: #fff;
        font-size: 11px;
        font-weight: 800;
        white-space: nowrap;
      }
      .home-work-divider { height: 1px; background: #ece9e2; margin: 2px 0 1px; }
      .home-scan-option { min-height: 62px; }
      @media (max-width: 380px) {
        .home-scan-options { padding-left: 10px; padding-right: 10px; gap: 8px; }
        .home-work-card { grid-template-columns: 38px minmax(0,1fr) auto; gap: 9px; padding: 12px; }
      }

      /* Readability baseline for warehouse operators. */
      .screen-appbar-sub, .home-scan-sub, .home-scan-option-sub,
      .simple-view-text, .history-item-detail, .history-review-total,
      .history-meta-line, .home-device-name { font-size: 14px; line-height: 1.5; }
      .home-scanner-status, .history-item-mode, .history-review-status,
      .history-quantity-label { font-size: 12px; }
      .home-action, .history-submit, .history-keep,
      .logout-dialog button { min-height: 52px; font-size: 15px; }
      .history-item-code, .history-review-code { font-size: 16px; }

      /* Scanner UX polish: keep controls readable and prevent label collisions. */
      .home-scan-head,
      .screen-appbar {
        gap: 12px;
      }
      .home-scan-head > div,
      .screen-appbar > div,
      .settings-action-copy,
      .home-scan-option-copy,
      .history-item-top > div:first-child {
        min-width: 0;
      }
      .home-scan-title,
      .screen-appbar-title {
        line-height: 1.18;
        overflow-wrap: anywhere;
      }
      .home-scanner-name,
      .home-scanner-status {
        max-width: 42vw;
      }
      .home-scan-option,
      .settings-action {
        grid-template-columns: 48px minmax(0, 1fr) 28px;
        align-items: center;
      }
      .home-scan-option-title,
      .settings-action-title {
        display: block;
        overflow-wrap: anywhere;
      }
      .home-scan-option-sub,
      .settings-action-detail {
        display: block;
        margin-top: 3px;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }
      .history-item-top,
      .history-review-top {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: start;
      }
      .history-item-mode,
      .history-review-status {
        white-space: nowrap;
      }
      .history-quantity-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .history-quantity-value,
      .history-total,
      .history-location {
        overflow-wrap: anywhere;
      }
      .logout-dialog {
        max-height: calc(100dvh - 36px);
        overflow-y: auto;
      }
      .logout-dialog-actions {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .inventory-header {
        position: relative;
        z-index: 2;
        flex: 0 0 auto;
        padding: 16px 16px 12px;
        background: #fff;
        border-bottom: 1px solid #eceff4;
      }
      .inventory-header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .inventory-eyebrow { color: #657086; font-size: 12px; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
      .inventory-title { margin: 2px 0 0; color: #111827; font-size: 25px; font-weight: 900; line-height: 1.12; }
      .inventory-subtitle { margin-top: 8px; color: #667085; font-size: 13px; line-height: 1.4; }
      .inventory-alert-button {
        width: 46px; height: 46px; flex: 0 0 46px; border: 1px solid #e5e9f0; border-radius: 13px;
        background: #fff; color: #17223b; display: inline-flex; align-items: center; justify-content: center;
      }
      .inventory-task-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .inventory-task {
        min-width: 0; min-height: 132px; padding: 14px; border: 1px solid #edf0f4; border-radius: 14px;
        background: #fbfcfe; color: #111827; text-align: left; font-family: inherit;
        display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start;
      }
      .inventory-task:focus-visible { outline: 3px solid #1677ff; outline-offset: 2px; }
      .inventory-task-icon {
        width: 42px; height: 42px; flex: 0 0 42px; border-radius: 11px; background: #dbeafe; color: #075fbd;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .inventory-task.is-orange .inventory-task-icon { background: #ffeadf; color: #d7530a; }
      .inventory-task.is-purple .inventory-task-icon { background: #eee9ff; color: #6550c8; }
      .inventory-task-title { display: block; margin-top: 10px; font-size: 16px; font-weight: 850; line-height: 1.2; overflow-wrap: anywhere; }
      .inventory-task-sub { display: block; margin-top: 5px; color: #606b80; font-size: 12px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
      .inventory-mobile-nav { display: none; }
      .bp-surface .mfg-page { height: 100%; max-height: 100%; }

      @media (max-width: 767px) {
        .home-scan-selector { border: 0; border-radius: 0; box-shadow: none; background: #fff; }
        .home-scan-options { gap: 12px; padding: 12px 12px calc(86px + env(safe-area-inset-bottom)); background: #fff; }
        .inventory-mobile-nav {
          position: relative; z-index: 45; flex: 0 0 auto; width: 100%;
          min-height: 68px; padding: 6px 8px max(6px, env(safe-area-inset-bottom));
          border-top: 1px solid #e5e9f0; background: rgba(255,255,255,.97);
          display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
        }
        .inventory-mobile-nav button {
          min-width: 0; border: 0; background: transparent; color: #596579; font-family: inherit;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
          font-size: clamp(9px, 2.6vw, 11px); font-weight: 750; line-height: 1.1; text-align: center;
        }
        .inventory-mobile-nav button > span:last-child { max-width: 100%; overflow-wrap: anywhere; }
        .inventory-mobile-nav button.is-active { color: #086bf2; }
        .inventory-scan-control { position: relative; min-width: 0; display: flex; align-items: center; justify-content: center; }
        .inventory-mobile-nav .inventory-nav-scan { width: 100%; height: 100%; position: relative; padding-top: 0; color: #17223b; }
        .inventory-nav-scan-icon {
          width: 46px; height: 46px; margin-top: -15px; border-radius: 999px; background: #05070b; color: #fff;
          display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 6px 14px rgba(5,7,11,.22);
        }
        .inventory-mobile-nav .inventory-nav-scan.is-active { color: #086bf2; }
        .inventory-scan-menu-backdrop { position: fixed; inset: 0; z-index: 44; border: 0; background: transparent; }
        .inventory-scan-actions {
          position: absolute; z-index: 46; left: 50%; bottom: calc(100% + 12px); width: max-content;
          display: grid; grid-template-columns: repeat(2, 76px); gap: 14px; opacity: 0; pointer-events: none;
          transform: translate(-50%, 18px) scale(.86); transform-origin: center bottom;
          transition: opacity .2s ease, transform .26s cubic-bezier(.2,.85,.25,1.2);
        }
        .inventory-scan-control.is-open .inventory-scan-actions { opacity: 1; pointer-events: auto; transform: translate(-50%, 0) scale(1); }
        .inventory-mobile-nav .inventory-scan-choice {
          width: 76px; height: 76px; padding: 8px; border-radius: 999px; border: 2px solid #fff;
          background: #fff; color: #17223b; box-shadow: 0 8px 24px rgba(9,16,31,.2);
          font-size: 10px; font-weight: 850; line-height: 1.05;
        }
        .inventory-mobile-nav .inventory-scan-choice.is-selected { background: #086bf2; color: #fff; }
        .inventory-mobile-nav .inventory-scan-choice svg { flex: 0 0 auto; }
      }
      @media (max-width: 380px) {
        .home-scanner-name,
        .home-scanner-status { max-width: 36vw; }
        .home-scan-option,
        .settings-action { grid-template-columns: 44px minmax(0, 1fr) 24px; }
        .history-quantity-grid { grid-template-columns: 1fr; }
        .inventory-task { min-height: 124px; padding: 12px; }
        .inventory-task-title { font-size: 15px; }
      }

      @media (min-width: 768px) {
        .bp-main { padding: 0; }
      }
    `}</style>

    <div className="bp-root">
      <div className="bp-blob bp-blob-1" aria-hidden="true" />
      <div className="bp-blob bp-blob-2" aria-hidden="true" />
      <div className="bp-blob bp-blob-3" aria-hidden="true" />

      <Navigation
        employee={employee}
        currentView={currentView}
        onNavigate={setCurrentView}
      />

      <main className="bp-main">
        <AppToast toast={toast} onClose={dismissToast} />
        {currentView === "job_card_time" ? (
          <div className="bp-surface"><JobCardTimeScanner employee={employee} onBack={goBackHome}/></div>
        ) : currentView === "location_transfer" ? (
          <div className="bp-surface"><LocationTransferScanner employee={employee} onBack={goBackHome}/></div>
        ) : showScanPage ? (
          <div className="bp-surface">
            {scanMode === "in"
              ? <ManufacturingScanner employee={employee} onBack={goBackHome} resumeAllocation={resumeWarehouseAllocation} initialRole={manufacturingRole} />
              : <ScanPage employee={employee} initialMode={scanMode} sessionKey={scanSessionKey} quantityMode={scannerQuantityMode} packageMode={scannerPackageMode} locationMode="multi" resumePhysicalCount={resumePhysicalCount} onBack={goBackHome} />}
          </div>
        ) : (
          <div className="bp-blank">
            {currentView === "dashboard" && (
              <section className="home-scan-selector inventory-home-v2" aria-labelledby="home-scan-title">
                <header className="inventory-home-header">
                  <div className="inventory-home-heading">
                    <span className="inventory-home-eyebrow">{loadScannerDeviceName() || "QCMC Scanner"}</span>
                    <h1 id="home-scan-title">Inventory</h1>
                  </div>
                  <span className="inventory-home-mode-indicator" aria-label={`Scanner quantity mode: ${scannerQuantityMode}`}>
                    <ScanLine size={15} aria-hidden="true" />
                    {scannerQuantityMode === "automatic" ? "Automatic Mode" : "Manual Mode"}
                  </span>
                </header>

                <div className="home-scan-options inventory-home-content">
                  {(hasDashboardPcountWork || hasDashboardHandoverWork || hasDashboardAllocationWork) && (
                    <section className="home-current-work inventory-home-resume" aria-labelledby="inventory-resume-title">
                      <div className="inventory-home-section-heading">
                        <h2 id="inventory-resume-title">Resume Work</h2>
                        <span>{Number(hasDashboardPcountWork) + Number(hasDashboardHandoverWork) + Number(hasDashboardAllocationWork)} saved {Number(hasDashboardPcountWork) + Number(hasDashboardHandoverWork) + Number(hasDashboardAllocationWork) === 1 ? "task" : "tasks"}</span>
                      </div>
                      {hasDashboardPcountWork && dashboardPcountSession && (
                        <button type="button" className="home-work-card inventory-home-resume-card is-pcount" onClick={() => startScanner("pcount", true)}>
                          <span className="inventory-home-resume-icon"><PackageCheck size={22} aria-hidden="true" /></span>
                          <span className="inventory-home-resume-copy">
                            <span className="inventory-home-resume-label">Physical Count</span>
                            <strong className="inventory-home-resume-ref">{dashboardPcountSession.reconciliationCode}</strong>
                            <span className="inventory-home-resume-detail">
                              {dashboardPcountSession.activeLocationId
                                ? `Current location: ${dashboardPcountSession.locations.find((location) => location.bin.locationId === dashboardPcountSession.activeLocationId)?.bin.locationCode || dashboardPcountSession.activeLocationId}`
                                : dashboardPcountStatus}
                            </span>
                            {formatLastActivity(dashboardPcountSession.updatedAt) && <span className="inventory-home-resume-time">{formatLastActivity(dashboardPcountSession.updatedAt)}</span>}
                          </span>
                          <span className="inventory-home-resume-side"><span className="inventory-home-saved-status">Saved on device</span><span className="inventory-home-continue">Continue <ChevronRight size={16} aria-hidden="true" /></span></span>
                        </button>
                      )}
                      {hasDashboardAllocationWork && dashboardAllocation && (
                        <button type="button" className="home-work-card inventory-home-resume-card is-allocation" onClick={resumeAllocation}>
                          <span className="inventory-home-resume-icon"><MapPinCheck size={22} aria-hidden="true" /></span>
                          <span className="inventory-home-resume-copy">
                            <span className="inventory-home-resume-label">Warehouse Allocation</span>
                            <strong className="inventory-home-resume-ref">{dashboardAllocation.name}</strong>
                            <span className="inventory-home-resume-detail">{dashboardAllocationVerified} / {dashboardAllocationTotal} locations verified · {dashboardAllocationRemaining} remaining</span>
                            {formatLastActivity(dashboardActiveAllocation?.updatedAt) && <span className="inventory-home-resume-time">{formatLastActivity(dashboardActiveAllocation?.updatedAt)}</span>}
                          </span>
                          <span className="inventory-home-resume-side"><span className="inventory-home-saved-status">Saved on device</span><span className="inventory-home-continue">Continue <ChevronRight size={16} aria-hidden="true" /></span></span>
                        </button>
                      )}
                      {hasDashboardHandoverWork && dashboardHandover && (
                        <button type="button" className="home-work-card inventory-home-resume-card" onClick={() => startScanner("in")}>
                          <span className="inventory-home-resume-icon"><PackagePlus size={22} aria-hidden="true" /></span>
                          <span className="inventory-home-resume-copy">
                            <span className="inventory-home-resume-label">Pullout / Receive FG</span>
                            <strong className="inventory-home-resume-ref">{dashboardHandover.batchId}</strong>
                            <span className="inventory-home-resume-detail">{handoverStatusLabel}</span>
                            {formatLastActivity(dashboardHandover.updatedAt) && <span className="inventory-home-resume-time">{formatLastActivity(dashboardHandover.updatedAt)}</span>}
                          </span>
                          <span className="inventory-home-resume-side"><span className="inventory-home-saved-status">Saved on device</span><span className="inventory-home-continue">Continue <ChevronRight size={16} aria-hidden="true" /></span></span>
                        </button>
                      )}
                    </section>
                  )}

                  <section className="inventory-home-section" aria-labelledby="inventory-home-operations">
                    <div className="inventory-home-section-heading"><h2 id="inventory-home-operations">Warehouse Operations</h2></div>
                    <div className="inventory-task-grid inventory-home-operation-grid" aria-label="Inventory operations">
                      <button type="button" className="inventory-task" onClick={() => startScanner("pcount")}>
                        <span className="inventory-task-icon"><ScanLine size={23} aria-hidden="true" /></span>
                        <span className="inventory-task-title">Physical Count</span>
                        <span className="inventory-task-sub">Scan and count inventory</span>
                        <ChevronRight className="inventory-home-task-chevron" size={17} aria-hidden="true" />
                      </button>
                      <button type="button" className="inventory-task" onClick={() => startManufacturingRole("pullout")}>
                        <span className="inventory-task-icon"><PackagePlus size={23} aria-hidden="true" /></span>
                        <span className="inventory-task-title">Pullout / Receive FG</span>
                        <span className="inventory-task-sub">Scan Job Card and save draft</span>
                        <ChevronRight className="inventory-home-task-chevron" size={17} aria-hidden="true" />
                      </button>
                      <button type="button" className="inventory-task" onClick={() => startManufacturingRole("checker")}>
                        <span className="inventory-task-icon"><ClipboardCheck size={23} aria-hidden="true" /></span>
                        <span className="inventory-task-title">Checker</span>
                        <span className="inventory-task-sub">Verify quantities and handover</span>
                        <ChevronRight className="inventory-home-task-chevron" size={17} aria-hidden="true" />
                      </button>
                      <button type="button" className="inventory-task" onClick={() => startManufacturingRole("picker")}>
                        <span className="inventory-task-icon"><MapPinCheck size={23} aria-hidden="true" /></span>
                        <span className="inventory-task-title">Picker / Warehouse Allocation</span>
                        <span className="inventory-task-sub">Verify storage locations</span>
                        <ChevronRight className="inventory-home-task-chevron" size={17} aria-hidden="true" />
                      </button>
                      <button type="button" className="inventory-task" onClick={() => setCurrentView("location_transfer")}>
                        <span className="inventory-task-icon"><ArrowLeftRight size={23} aria-hidden="true" /></span>
                        <span className="inventory-task-title">Transfer Location</span>
                        <span className="inventory-task-sub">Move stock between locations</span>
                        <ChevronRight className="inventory-home-task-chevron" size={17} aria-hidden="true" />
                      </button>
                      {SHOW_DEFERRED_HOME_WORKFLOWS && (
                        <button type="button" className="inventory-task is-upcoming" onClick={() => setCurrentView("issue_stock_coming_soon")}>
                          <span className="inventory-task-icon"><LogOut size={23} aria-hidden="true" /></span>
                          <span className="inventory-task-title">Issue Stock</span>
                          <span className="inventory-task-sub">Stock issue workflow</span>
                          <span className="inventory-home-coming-soon">Coming soon</span>
                          <ChevronRight className="inventory-home-task-chevron" size={17} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </section>

                  <section className="inventory-home-section" aria-labelledby="inventory-home-tools">
                    <div className="inventory-home-section-heading"><h2 id="inventory-home-tools">Activity &amp; Tools</h2></div>
                    <div className="inventory-home-tools-grid">
                      <button type="button" className="inventory-home-tool" onClick={openHistory}>
                        <span className="inventory-home-tool-icon"><ReceiptText size={23} aria-hidden="true" /></span>
                        <strong>Transactions</strong><span>Scan and submission history</span>
                        <ChevronRight className="inventory-home-tool-chevron" size={16} aria-hidden="true"/>
                      </button>
                      <button type="button" className="inventory-home-tool" onClick={() => setCurrentView("profile")}>
                        <span className="inventory-home-tool-icon"><User size={23} aria-hidden="true" /></span>
                        <strong>Profile</strong><span>Account and scanner settings</span>
                        <ChevronRight className="inventory-home-tool-chevron" size={16} aria-hidden="true"/>
                      </button>
                      <button type="button" className="inventory-home-tool" onClick={() => void testErpConnection()} disabled={connectionTest.loading}>
                        <span className="inventory-home-tool-icon"><Wifi size={23} aria-hidden="true" /></span>
                        <strong>ERP Connection</strong>
                        <span className={`inventory-home-erp-status ${connectionTest.ok === true ? "is-connected" : connectionTest.ok === false ? "is-error" : ""}`}>
                          {connectionTest.loading ? "Testing connection…" : connectionTest.ok === true ? "Last test passed" : connectionTest.ok === false ? "Connection test failed" : "Tap to test ERP"}
                        </span>
                        <ChevronRight className="inventory-home-tool-chevron" size={16} aria-hidden="true"/>
                      </button>
                    </div>
                  </section>

                  <div className="inventory-home-tip">
                    <ScanLine size={19} aria-hidden="true" />
                    <span><strong>Choose an operation to start scanning</strong><small>{hasDashboardPcountWork || hasDashboardHandoverWork || hasDashboardAllocationWork ? "Continue saved work above or choose another task." : "Physical Count can save locally; other ERP operations require a connection."}</small></span>
                  </div>
                </div>
              </section>
            )}
            {currentView === "issue_stock_coming_soon" && (
              <StatusPage
                variant="coming-soon"
                title="Issue Stock"
                description="Issue Stock is being prepared for this scanner. Please use the available inventory workflows for now."
                onBack={goBackHome}
              />
            )}
            {currentView === "delivery_coming_soon" && (
              <StatusPage
                variant="coming-soon"
                title="Delivery"
                description="Delivery workflows are being prepared for this scanner and will be available in a future update."
                onBack={goBackHome}
              />
            )}
            {(currentView === "settings" || currentView === "profile") && (
              <section className="simple-view settings-profile-v2" aria-labelledby="settings-title">
                <header className="settings-profile-header">
                  <button type="button" className="settings-profile-back" aria-label="Back to Inventory" onClick={goBackHome}>
                    <ChevronLeft size={24} aria-hidden="true"/>
                  </button>
                  <h1 id="settings-title">Profile &amp; Settings</h1>
                  <span className="settings-profile-app-pill"><ScanLine size={15} aria-hidden="true"/> Scanner</span>
                </header>
                <div className="simple-view-body settings-profile-scroll">
                  <article className="profile-user-card settings-profile-identity">
                    <div className="profile-user-avatar" aria-hidden="true">
                      {employee.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U"}
                    </div>
                    <div className="profile-user-summary">
                      <h2>{employee.full_name}</h2>
                      <p>Employee ID: {employee.employee_id || employee.id}</p>
                      <p>{employee.designation || (employee.role === "admin" ? "Administrator" : "Employee")}</p>
                      <p>Device: <strong>{loadScannerDeviceName() || "Not named"}</strong></p>
                    </div>
                    <span className="settings-profile-signed-in"><CheckCircle2 size={14} aria-hidden="true"/> Signed in</span>
                    <dl className="profile-user-details">
                      <div><dt>Department</dt><dd>{employee.department || "Not assigned"}</dd></div>
                      <div><dt>Email</dt><dd>{employee.email || "Not available"}</dd></div>
                      {(employee.company || employee.custom_location) && (
                        <div><dt>{employee.custom_location ? "Location" : "Company"}</dt><dd>{employee.custom_location || employee.company}</dd></div>
                      )}
                    </dl>
                  </article>
                  <section className="settings-profile-section" aria-labelledby="settings-scanner-title">
                    <h2 id="settings-scanner-title"><Settings size={20} aria-hidden="true"/> Scanner Settings</h2>
                    <button type="button" className="settings-profile-row" onClick={() => {
                      setDeviceNameInput(loadScannerDeviceName());
                      setShowDeviceNameDialog(true);
                    }}>
                      <span className="settings-profile-row-icon"><Smartphone size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>Device Name</strong><small>Name this scanner device</small></span>
                      <span className="settings-profile-row-value">{loadScannerDeviceName() || "Not set"}</span>
                      <ChevronRight className="settings-profile-chevron" size={17} aria-hidden="true"/>
                    </button>
                    <div className="settings-profile-control">
                      <span className="settings-profile-row-icon"><Keyboard size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>Quantity Mode</strong><small>Choose how Physical Count quantities are entered</small></span>
                      <div className="settings-profile-choice" role="group" aria-label="Scanner quantity mode">
                        <button type="button" className={scannerQuantityMode === "manual" ? "is-selected" : ""} aria-pressed={scannerQuantityMode === "manual"}
                          onClick={() => selectScannerQuantityMode("manual")}>Manual</button>
                        <button type="button" className={scannerQuantityMode === "automatic" ? "is-selected" : ""} aria-pressed={scannerQuantityMode === "automatic"}
                          onClick={() => selectScannerQuantityMode("automatic")} disabled={scannerPackageMode === "loose"}>Auto</button>
                      </div>
                    </div>
                    <div className="settings-profile-control">
                      <span className="settings-profile-row-icon"><Box size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>Package Mode</strong><small>Loose Pack requires Manual quantity mode</small></span>
                      <div className="settings-profile-choice" role="group" aria-label="Package mode">
                        <button type="button" className={scannerPackageMode === "big" ? "is-selected" : ""} aria-pressed={scannerPackageMode === "big"}
                          onClick={() => selectScannerPackageMode("big")}>Big</button>
                        <button type="button" className={scannerPackageMode === "loose" ? "is-selected" : ""} aria-pressed={scannerPackageMode === "loose"}
                          onClick={() => selectScannerPackageMode("loose")}>Loose</button>
                      </div>
                    </div>
                    <div className="settings-profile-row is-info">
                      <span className="settings-profile-row-icon"><ScanLine size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>Scanner Focus Status</strong><small>Barcode focus is managed inside active scanning screens</small></span>
                      <span className="settings-profile-row-value">Check while scanning</span>
                    </div>
                  </section>
                  <section className="settings-profile-section" aria-labelledby="settings-erp-title">
                    <h2 id="settings-erp-title"><Globe2 size={20} aria-hidden="true"/> ERP / Connection</h2>
                    <div className="settings-profile-row is-info">
                      <span className="settings-profile-row-icon"><Globe2 size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>ERPNext Base URL</strong><small>Current authenticated ERP server · Change at sign-in</small>
                        <span className="settings-profile-url">{getActiveErpBaseUrl()}</span>
                      </span>
                    </div>
                    <button type="button" className="settings-profile-row" disabled={connectionTest.loading} onClick={() => void testErpConnection()}>
                      <span className="settings-profile-row-icon">{connectionTest.loading ? <Loader2 className="spin" size={21} aria-hidden="true"/> : <Wifi size={21} aria-hidden="true"/>}</span>
                      <span className="settings-profile-row-main"><strong>Test Connection</strong><small>Ping the configured ERPNext server</small></span>
                      <span className="settings-profile-test">{connectionTest.loading ? "Testing…" : "Test"}</span>
                      <ChevronRight className="settings-profile-chevron" size={17} aria-hidden="true"/>
                    </button>
                    {connectionTest.message && <div className={`settings-profile-result ${connectionTest.ok ? "is-success" : "is-error"}`} role="status">
                      {connectionTest.ok ? "Last ERP test passed: " : "Last ERP test failed: "}{connectionTest.message}
                    </div>}
                    <div className="settings-profile-row is-info">
                      <span className="settings-profile-row-icon"><Wifi size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>Device Network</strong><small>Device-reported interface status; test ERP separately</small></span>
                      <span className={`settings-profile-connection-state ${deviceNetworkOnline ? "is-online" : "is-offline"}`}>
                        <span aria-hidden="true"/> {deviceNetworkOnline ? "Interface online" : "Offline"}
                      </span>
                    </div>
                    <div className="settings-profile-row is-info">
                      <span className="settings-profile-row-icon"><Clock3 size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>Last ERP Connection Test</strong><small>This is not a Stock Entry sync timestamp</small></span>
                      <span className="settings-profile-row-value">{connectionTest.checkedAt
                        ? new Date(connectionTest.checkedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                        : "Not tested yet"}</span>
                    </div>
                  </section>
                  <section className="settings-profile-section" aria-labelledby="settings-data-title">
                    <h2 id="settings-data-title"><Database size={20} aria-hidden="true"/> Data &amp; History</h2>
                    <button type="button" className="settings-profile-row" onClick={() => {
                      if (!profilePcountSession && !profileAllocation?.name && !profileHandover?.batchId && profilePendingPcountCount > 0) {
                        openHistory();
                        setHistoryTab("pending");
                      } else {
                        goBackHome();
                      }
                    }}>
                      <span className="settings-profile-row-icon"><Clock3 size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>Resume Pending Work</strong><small>Continue from Inventory Home, or review pending saved scans in Transactions</small></span>
                      <span className="settings-profile-row-value">{profilePendingWorkflowCount} saved {profilePendingWorkflowCount === 1 ? "task" : "tasks"}</span>
                      <ChevronRight className="settings-profile-chevron" size={17} aria-hidden="true"/>
                    </button>
                    <button type="button" className="settings-profile-row" onClick={openHistory}>
                      <span className="settings-profile-row-icon"><ReceiptText size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>Saved Transactions</strong><small>View local receipts and pending Physical Counts</small></span>
                      <span className="settings-profile-row-value">{successfulTransactions.length + failedTransactions.length} receipts</span>
                      <ChevronRight className="settings-profile-chevron" size={17} aria-hidden="true"/>
                    </button>
                    <button type="button" className="settings-profile-row is-danger" disabled={profileScanEntryCount === 0 && !profilePcountSession}
                      onClick={() => setShowClearSavedConfirm(true)}>
                      <span className="settings-profile-row-icon"><Trash2 size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>Clear Saved Scans</strong><small>Remove saved scan entries and Physical Count session; cannot undo</small></span>
                      <span className="settings-profile-row-value">{profileScanEntryCount} local</span>
                      <ChevronRight className="settings-profile-chevron" size={17} aria-hidden="true"/>
                    </button>
                  </section>
                  <section className="settings-profile-section" aria-labelledby="settings-preferences-title">
                    <h2 id="settings-preferences-title"><SlidersHorizontal size={20} aria-hidden="true"/> App Preferences</h2>
                    <div className="settings-profile-row is-info">
                      <span className="settings-profile-row-icon"><Bell size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>Notifications</strong><small>Custom in-app notification preference</small></span>
                      <span className="settings-profile-row-value is-unavailable">Not available</span>
                    </div>
                    <div className="settings-profile-row is-info">
                      <span className="settings-profile-row-icon"><Volume2 size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>Sound / Vibration</strong><small>Use your scanner's system sound and vibration controls</small></span>
                      <span className="settings-profile-row-value is-unavailable">Device controlled</span>
                    </div>
                    <div className="settings-profile-row is-info">
                      <span className="settings-profile-row-icon"><Moon size={21} aria-hidden="true"/></span>
                      <span className="settings-profile-row-main"><strong>Dark Mode</strong><small>Alternative scanner theme</small></span>
                      <span className="settings-profile-row-value is-unavailable">Coming soon</span>
                    </div>
                  </section>
                  <p className="settings-profile-autosave"><ShieldCheck size={18} aria-hidden="true"/> Scanner mode, package mode and device name are saved when changed. No extra Save button needed.</p>
                  <button type="button" className="settings-profile-logout" onClick={() => setShowLogoutConfirm(true)}>
                    <LogOut size={19} aria-hidden="true"/> Logout
                  </button>
                </div>
              </section>
            )}
            {currentView === "history" && (
              <section className={`simple-view${selectedReconciliation ? " history-review-page" : ""}`} aria-labelledby="history-title">
                <div className="screen-appbar">
                  <div>
                    <h1 id="history-title" className="screen-appbar-title">{selectedReconciliation ? "Saved scan" : "Transactions"}</h1>
                    <div className="screen-appbar-sub">{selectedReconciliation ? "Review before submitting" : "Device submission history"}</div>
                  </div>
                  <div className="home-scanner-status"><Smartphone size={15} aria-hidden="true" /><span className="sr-only">Scanner: </span>{loadScannerDeviceName() || "Scanner"}</div>
                </div>
                <div className="simple-view-body">
                {!historyDeviceId && (
                  <div className="scan-feedback" role="status">
                    Set a unique Device Name in Settings to view transactions recorded by this scanner.
                    Older receipts without a recorded device name are excluded from the device-only history.
                  </div>
                )}
                {!selectedReconciliation && selectedTransactionDetails && (
                  <div className="tx-v2-detail" aria-label="Transaction details">
                    <button type="button" className="tx-v2-return" onClick={() => { setShowStoredSummaryDetails(false); setSelectedTransactionDetails(null); }}>
                      <ChevronLeft size={17} aria-hidden="true"/> Back to Transactions
                    </button>
                    <div className="tx-v2-detail-hero">
                      <span className="tx-v2-hero-icon">{selectedTransactionDetails.type === "location_transfer" ? <ArrowLeftRight size={25}/> : selectedTransactionDetails.type === "warehouse_allocation" ? <PackageCheck size={25}/> : <ClipboardCheck size={25}/>}</span>
                      <span><strong>{selectedTransactionDetails.title}</strong><small>{selectedTransactionDetails.reference}</small></span>
                      <span className={`tx-v2-status ${"completedAt" in selectedTransactionDetails ? "is-success" : "is-failed"}`}>{"completedAt" in selectedTransactionDetails ? "Successful" : "Failed"}</span>
                    </div>
                    <section className="tx-v2-info-card">
                      <h2>Transaction Information</h2>
                      <dl>
                        <div><dt>Type</dt><dd>{selectedTransactionDetails.title}</dd></div>
                        <div><dt>Reference</dt><dd>{selectedTransactionDetails.reference}</dd></div>
                        <div><dt>Time</dt><dd>{new Date("completedAt" in selectedTransactionDetails ? selectedTransactionDetails.completedAt : selectedTransactionDetails.failedAt).toLocaleString()}</dd></div>
                        <div><dt>Status</dt><dd>{"completedAt" in selectedTransactionDetails ? "Successful" : "Failed"}</dd></div>
                        {selectedTransactionDetails.type === "location_transfer" && "route" in selectedTransactionDetails && selectedTransactionDetails.route &&
                          <div><dt>Route</dt><dd>{selectedTransactionDetails.route}</dd></div>}
                      </dl>
                    </section>
                    <section className="tx-v2-info-card tx-v2-summary-disclosure">
                      <button type="button" className="tx-v2-summary-trigger" aria-expanded={showStoredSummaryDetails} aria-controls="tx-v2-summary-expanded" onClick={() => setShowStoredSummaryDetails((open) => !open)}>
                        <span><strong>Stored Summary</strong><small>{selectedTransactionDetails.detail}</small></span>
                        <ChevronDown size={19} className={showStoredSummaryDetails ? "is-open" : ""} aria-hidden="true"/>
                      </button>
                      {showStoredSummaryDetails && <div id="tx-v2-summary-expanded" className="tx-v2-summary-expanded">
                          <h3>Saved receipt details</h3>
                          {"items" in selectedTransactionDetails && selectedTransactionDetails.items && selectedTransactionDetails.items.length > 0 ? (
                            <div className="tx-v2-item-breakdown" aria-label="Submitted Physical Count items">
                              <strong>Item breakdown ({selectedTransactionDetails.items.length})</strong>
                              {selectedTransactionDetails.items.map((item, index) => (
                                <article className="tx-v2-item-detail" key={`${item.itemCode}-${item.location}-${index}`}>
                                  <div><strong>{item.itemCode}</strong><small>{item.location}</small></div>
                                  <dl>
                                    <div><dt>Previous count</dt><dd>{item.previousCount.toLocaleString()} {item.uom}</dd></div>
                                    <div><dt>Adjustment</dt><dd>{item.adjustment > 0 ? "+" : ""}{item.adjustment.toLocaleString()} {item.uom}</dd></div>
                                    <div><dt>Physical count</dt><dd>{item.physicalCount.toLocaleString()} {item.uom}</dd></div>
                                    <div><dt>Inventory Tag(s)</dt><dd>{item.inventoryTags.join(", ") || "Not stored"}</dd></div>
                                  </dl>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="tx-v2-summary-note">Item-level details were not retained in this device receipt. Older transactions cannot be reconstructed from the summary alone. Check ERPNext for the original items and quantities.</p>
                          )}
                          <dl>
                            <div><dt>Transaction ID</dt><dd>{selectedTransactionDetails.id}</dd></div>
                            <div><dt>Document reference</dt><dd>{selectedTransactionDetails.reference}</dd></div>
                            <div><dt>Transaction type</dt><dd>{selectedTransactionDetails.title}</dd></div>
                            <div><dt>Recorded on</dt><dd>{new Date("completedAt" in selectedTransactionDetails ? selectedTransactionDetails.completedAt : selectedTransactionDetails.failedAt).toLocaleString()}</dd></div>
                            <div><dt>Result</dt><dd>{"completedAt" in selectedTransactionDetails ? "Successfully recorded" : "Failed"}</dd></div>
                            {"submissionId" in selectedTransactionDetails && <div><dt>Submission ID</dt><dd>{selectedTransactionDetails.submissionId}</dd></div>}
                            {selectedTransactionDetails.type === "physical_count" && "completedAt" in selectedTransactionDetails &&
                              <div><dt>Submission ID</dt><dd>{selectedTransactionDetails.id.split(":").slice(2).join(":") || "Not stored"}</dd></div>}
                            {"route" in selectedTransactionDetails && selectedTransactionDetails.route &&
                              <div><dt>From → To</dt><dd>{selectedTransactionDetails.route}</dd></div>}
                            <div><dt>Recorded summary</dt><dd>{selectedTransactionDetails.detail}</dd></div>
                            {"errorCode" in selectedTransactionDetails && selectedTransactionDetails.errorCode &&
                              <div><dt>Error code</dt><dd>{selectedTransactionDetails.errorCode}</dd></div>}
                            {"errorMessage" in selectedTransactionDetails &&
                              <div><dt>Failure reason</dt><dd className="tx-v2-error">{selectedTransactionDetails.errorMessage}</dd></div>}
                          </dl>
                          <p className="tx-v2-summary-note">New Physical Count receipts include item-level snapshots when available. ERPNext remains the source of truth for Stock Entry documents.</p>
                        </div>}
                    </section>
                    <p className="tx-v2-footnote">Older receipts may contain summaries only. Full Stock Entry documents must be reviewed in ERPNext.</p>
                  </div>
                )}
                {!selectedReconciliation && !selectedTransactionDetails && <>
                  <div className="tx-v2-intro">
                    <span className="tx-v2-intro-icon"><ReceiptText size={26} aria-hidden="true"/></span>
                    <span><strong>Inventory Transactions</strong><small>Review stored receipts, pending Physical Counts and failures on this device.</small></span>
                  </div>
                  <div className="tx-v2-filters">
                    <label className="tx-v2-search"><span className="sr-only">Search transactions</span><input type="search" value={transactionSearch}
                      onChange={(event) => setTransactionSearch(event.target.value)} placeholder="Search reference or details"/></label>
                    <div className="tx-v2-filter-grid" ref={transactionFiltersRef}>
                      <div className={`tx-v2-filter-field ${openTransactionFilter === "period" ? "is-open" : ""}`}>
                        <span className="tx-v2-filter-label" id="tx-period-label">Period</span>
                        <button type="button" className="tx-v2-dropdown-trigger"
                          ref={periodFilterButtonRef}
                          aria-labelledby="tx-period-label tx-period-trigger"
                          aria-expanded={openTransactionFilter === "period"}
                          aria-controls="tx-period-options"
                          id="tx-period-trigger"
                          onClick={() => setOpenTransactionFilter((current) => current === "period" ? null : "period")}>
                          <span>{TRANSACTION_PERIOD_OPTIONS.find((option) => option.value === transactionDateFilter)?.label || "All dates"}</span>
                          <ChevronDown className="tx-v2-dropdown-chevron" size={18} aria-hidden="true"/>
                        </button>
                        {openTransactionFilter === "period" && (
                          <div className="tx-v2-dropdown-menu" id="tx-period-options" role="group" aria-label="Select period">
                            {TRANSACTION_PERIOD_OPTIONS.map((option) => (
                              <button type="button" key={option.value} className="tx-v2-dropdown-option"
                                aria-pressed={transactionDateFilter === option.value}
                                onClick={() => {
                                  setTransactionDateFilter(option.value);
                                  setOpenTransactionFilter(null);
                                  periodFilterButtonRef.current?.focus();
                                }}>
                                <span>{option.label}</span>
                                {transactionDateFilter === option.value && <CheckCircle2 size={17} aria-hidden="true"/>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className={`tx-v2-filter-field ${openTransactionFilter === "type" ? "is-open" : ""}`}>
                        <span className="tx-v2-filter-label" id="tx-type-label">Type</span>
                        <button type="button" className="tx-v2-dropdown-trigger"
                          ref={typeFilterButtonRef}
                          aria-labelledby="tx-type-label tx-type-trigger"
                          aria-expanded={openTransactionFilter === "type"}
                          aria-controls="tx-type-options"
                          id="tx-type-trigger"
                          onClick={() => setOpenTransactionFilter((current) => current === "type" ? null : "type")}>
                          <span>{TRANSACTION_TYPE_OPTIONS.find((option) => option.value === transactionTypeFilter)?.label || "All types"}</span>
                          <ChevronDown className="tx-v2-dropdown-chevron" size={18} aria-hidden="true"/>
                        </button>
                        {openTransactionFilter === "type" && (
                          <div className="tx-v2-dropdown-menu" id="tx-type-options" role="group" aria-label="Select transaction type">
                            {TRANSACTION_TYPE_OPTIONS.map((option) => (
                              <button type="button" key={option.value} className="tx-v2-dropdown-option"
                                aria-pressed={transactionTypeFilter === option.value}
                                onClick={() => {
                                  setTransactionTypeFilter(option.value);
                                  setOpenTransactionFilter(null);
                                  typeFilterButtonRef.current?.focus();
                                }}>
                                <span>{option.label}</span>
                                {transactionTypeFilter === option.value && <CheckCircle2 size={17} aria-hidden="true"/>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="transaction-tabs tx-v2-tabs" role="tablist" aria-label="Transaction status">
                    <button type="button" role="tab" aria-selected={historyTab === "successful"} className={historyTab === "successful" ? "is-active" : ""}
                      onClick={() => setHistoryTab("successful")}>Successful <span>{successfulTransactions.length}</span></button>
                    <button type="button" role="tab" aria-selected={historyTab === "pending"} className={historyTab === "pending" ? "is-active" : ""}
                      onClick={() => setHistoryTab("pending")}>Pending <span>{reconciliationGroups.length}</span></button>
                    <button type="button" role="tab" aria-selected={historyTab === "failed"} className={historyTab === "failed" ? "is-active" : ""}
                      onClick={() => setHistoryTab("failed")}>Failed <span>{failedTransactions.length}</span></button>
                  </div>
                </>}
                {!selectedReconciliation && !selectedTransactionDetails && historyTab === "successful" && (
                  filteredSuccessfulTransactions.length > 0 ? (
                    <div className="transaction-success-list tx-v2-list">
                      {filteredSuccessfulTransactions.map((entry) => (
                        <button type="button" className={`transaction-success-card tx-v2-card is-${entry.type}`} key={entry.id}
                          onClick={() => { setShowStoredSummaryDetails(false); setSelectedTransactionDetails(entry); }}>
                          <span className="transaction-success-icon" aria-hidden="true">
                            {entry.type === "warehouse_allocation" ? <PackageCheck size={22}/> : entry.type === "physical_count" ? <ClipboardCheck size={22}/> : <ArrowLeftRight size={22}/>}
                          </span>
                          <span className="transaction-success-copy">
                            <span className="transaction-success-heading"><strong>{entry.title}</strong><span>Successful</span></span>
                            <span className="transaction-success-reference">{entry.reference}</span>
                            <span className="transaction-success-detail">{entry.detail}</span>
                            {entry.route && <span className="transaction-success-route">{entry.route}</span>}
                            <time dateTime={entry.completedAt}>{new Date(entry.completedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
                          </span>
                          <ChevronRight className="tx-v2-chevron" size={17} aria-hidden="true"/>
                        </button>
                      ))}
                    </div>
                  ) : <div className="history-empty">No matching successful transaction receipts on this device.</div>
                )}
                {!selectedReconciliation && !selectedTransactionDetails && historyTab === "pending" && (
                  filteredPendingReconciliations.length > 0 ? (
                    <div className="transaction-success-list tx-v2-list">
                      {filteredPendingReconciliations.map((group) => (
                        <button type="button" className="transaction-success-card tx-v2-card is-pending" key={group.reference}
                          onClick={() => openReconciliation(group.reference)}>
                          <span className="transaction-success-icon" aria-hidden="true"><ClipboardCheck size={22}/></span>
                          <span className="transaction-success-copy">
                            <span className="transaction-success-heading"><strong>Physical Count</strong><span>Saved locally</span></span>
                            <span className="transaction-success-reference">{group.reference}</span>
                            <span className="transaction-success-detail">{group.itemCount} pending item/location count${group.itemCount === 1 ? "" : "s"} · Review before submission</span>
                            {group.latestTimestamp && <time dateTime={group.latestTimestamp}>{new Date(group.latestTimestamp).toLocaleString()}</time>}
                          </span>
                          <ChevronRight className="tx-v2-chevron" size={17} aria-hidden="true"/>
                        </button>
                      ))}
                    </div>
                  ) : <div className="history-empty">No matching locally saved Physical Count scans. Only records on this device appear here.</div>
                )}
                {!selectedReconciliation && !selectedTransactionDetails && historyTab === "failed" && (
                  filteredFailedTransactions.length > 0 ? (
                    <div className="transaction-success-list tx-v2-list">
                      {filteredFailedTransactions.map((entry) => (
                        <button type="button" className="transaction-success-card tx-v2-card is-failed" key={entry.id}
                          onClick={() => { setShowStoredSummaryDetails(false); setSelectedTransactionDetails(entry); }}>
                          <span className="transaction-success-icon" aria-hidden="true"><AlertTriangle size={22}/></span>
                          <span className="transaction-success-copy">
                            <span className="transaction-success-heading"><strong>{entry.title}</strong><span>Failed</span></span>
                            <span className="transaction-success-reference">{entry.reference}</span>
                            <span className="transaction-success-detail">{entry.detail}</span>
                            <span className="transaction-failed-error">{entry.errorCode ? `${entry.errorCode}: ` : ""}{entry.errorMessage}</span>
                            <time dateTime={entry.failedAt}>{new Date(entry.failedAt).toLocaleString()}</time>
                          </span>
                          <ChevronRight className="tx-v2-chevron" size={17} aria-hidden="true"/>
                        </button>
                      ))}
                    </div>
                  ) : <div className="history-empty">No matching failed Physical Count submissions on this device.</div>
                )}
                {selectedReconciliation && <>
                {!selectedReconciliation && <div className="simple-view-text">
                  {selectedReconciliation
                    ? `${selectedEntries.length} item${selectedEntries.length === 1 ? "" : "s"} under this reconciliation reference.`
                    : reconciliationGroups.length > 0
                      ? `${reconciliationGroups.length} reconciliation reference${reconciliationGroups.length === 1 ? "" : "s"} saved on this device.`
                      : "No saved history is available yet."}
                </div>}
                {selectedReconciliation && selectedEntries.length > 0 && (
                  <div className="history-review-hero">
                    <div className="history-review-top">
                      <div className="history-review-code">{selectedReconciliation}</div>
                                          </div>
                    <div className="history-review-total">
                      <strong>{selectedPendingTotal.toFixed(2)}</strong> total units ready for ERP
                    </div>
                    <div className="history-review-summary" aria-label="Physical Count review summary">
                      <div className="history-review-stat"><strong>{selectedReview.locationCount}</strong><span>Locations</span></div>
                      <div className="history-review-stat"><strong>{selectedReview.itemLocationCount}</strong><span>Item / Location Counts</span></div>
                      <div className="history-review-stat"><strong>{selectedReview.addTransactions}</strong><span>ADD Scans</span></div>
                      <div className="history-review-stat"><strong>{selectedReview.deductTransactions}</strong><span>DEDUCT Scans</span></div>
                      {selectedReview.recountLocations > 0 && (
                        <div className="history-review-stat"><strong>{selectedReview.recountLocations}</strong><span>Recounted Locations</span></div>
                      )}
                    </div>
                  </div>
                )}
                {!selectedReconciliation && reconciliationGroups.length > 0 && (
                  <div className="history-list">
                    {reconciliationGroups.map((group) => (
                      <button
                        type="button"
                        className="history-item"
                        key={group.reference}
                        onClick={() => openReconciliation(group.reference)}
                      >
                        <div className="history-item-top">
                          <div className="history-item-code">{group.reference}</div>
                          <div className="history-item-mode">{group.itemCount} item{group.itemCount === 1 ? "" : "s"}</div>
                        </div>
                        <div className="history-item-detail">
                          {group.pcountCount} P. Count / Latest: {group.latestTimestamp || "-"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {selectedReconciliation && selectedEntries.length > 0 && (
                  <>
                    <div className="history-list">
                      {selectedReview.locations.map((location) => {
                        const expanded = expandedReviewLocations.has(location.id);
                        return (
                          <section className="history-location-review" key={location.id}>
                            <button
                              type="button"
                              className="history-location-review-button"
                              aria-expanded={expanded}
                              onClick={() => setExpandedReviewLocations((current) => {
                                const next = new Set(current);
                                if (next.has(location.id)) next.delete(location.id);
                                else next.add(location.id);
                                return next;
                              })}
                            >
                              <span className="history-location-review-title">{location.label}</span>
                              <span className="history-location-review-count">{location.entries.length} item{location.entries.length === 1 ? "" : "s"} {expanded ? "▲" : "▼"}</span>
                            </button>
                            {expanded && (
                              <div className="history-location-review-items">
                                {location.entries.map((entry, index) => {
                                  const countChange = entry.quantity - (entry.submittedQuantity || 0);
                                  const submittedQuantity = entry.submittedQuantity || 0;
                                  return (
                                    <div className="history-item" key={`${entry.timestamp}-${entry.raw}-${index}`}>
                                      <div className="history-item-top">
                                        <div className="history-item-code">{entry.itemCode}</div>
                                        <div className="history-item-mode">{entry.uom}</div>
                                      </div>
                                      {entry.itemName && <div className="history-item-detail">{entry.itemName}</div>}
                                      <div className="history-quantity-grid">
                                        <div className="history-quantity-box"><div className="history-quantity-label">Previous Count</div><div className="history-quantity-value">{submittedQuantity.toFixed(2)} {entry.uom}</div></div>
                                        <div className="history-quantity-box"><div className="history-quantity-label">Count Adjustment</div><div className="history-quantity-value">{countChange >= 0 ? "+" : ""}{countChange.toFixed(2)} {entry.uom}</div></div>
                                        <div className="history-quantity-box"><div className="history-quantity-label">Final Count</div><div className="history-quantity-value">{entry.quantity.toFixed(2)} {entry.uom}</div></div>
                                      </div>
                                      <div className="history-meta-line">{entry.lotNo ? `Lot ${entry.lotNo} · ` : ""}{(entry.scanTransactions || []).length} scan transaction{(entry.scanTransactions || []).length === 1 ? "" : "s"} · Updated {entry.timestamp}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                    <label className="history-review-confirm">
                      <input type="checkbox" checked={historyReviewConfirmed} onChange={(event) => setHistoryReviewConfirmed(event.target.checked)} />
                      <span>I reviewed the locations and final item quantities for this Physical Count.</span>
                    </label>
                    <button
                      type="button"
                      className="home-action history-submit"
                      onClick={submitSelectedReconciliation}
                      disabled={historySubmitState.isSubmitting || !historyReviewConfirmed}
                    >
                      <Send size={16}  aria-hidden="true" />
                      {historySubmitState.isSubmitting ? "Submitting..." : historyReviewConfirmed ? "Submit to ERP" : "Review Required"}
                    </button>
                    <button type="button" className="home-action history-keep" onClick={closeReconciliation}>
                      Keep saved for later
                    </button>
                  </>
                )}
                {selectedReconciliation && selectedEntries.length === 0 && (
                  <div className="history-empty">No items to submit. Everything in this reference has been submitted.</div>
                )}
                {!selectedReconciliation && <div className="simple-view-actions">
                  {reconciliationGroups.length > 0 && (
                    <button
                      type="button"
                      className="home-action home-action-danger simple-back-button"
                      onClick={() => setShowClearSavedConfirm(true)}
                    >
                      <Trash2 size={16}  aria-hidden="true" />
                      Clear saved scans
                    </button>
                  )}
                </div>}
                </>}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {shouldShowBottomNavigation(currentView) && <>
        {scannerQuickMenuOpen && <button type="button" className="inventory-scan-menu-backdrop" aria-label="Close scanner mode menu" onClick={() => setScannerQuickMenuOpen(false)} />}
        <nav className="inventory-mobile-nav" aria-label="Primary navigation">
          <button type="button" className={["dashboard", "location_transfer", "job_card_time", "issue_stock_coming_soon"].includes(currentView) ? "is-active" : ""} onClick={goBackHome}>
            <LayoutGrid size={20} aria-hidden="true" /><span>Inventory</span>
          </button>
          <button type="button" className={currentView === "delivery_coming_soon" ? "is-active" : ""} onClick={() => setCurrentView("delivery_coming_soon")}>
            <Truck size={20} aria-hidden="true" /><span>Delivery</span>
          </button>
          <div className={`inventory-scan-control${scannerQuickMenuOpen ? " is-open" : ""}`}>
            <div className="inventory-scan-actions" role="menu" aria-label="Scanner quantity mode">
              <button type="button" role="menuitem" className={`inventory-scan-choice${scannerQuantityMode === "automatic" ? " is-selected" : ""}`} onClick={() => selectScannerQuantityMode("automatic")}>
                <Zap size={22} aria-hidden="true" /><span>Automatic</span>
              </button>
              <button type="button" role="menuitem" className={`inventory-scan-choice${scannerQuantityMode === "manual" ? " is-selected" : ""}`} onClick={() => selectScannerQuantityMode("manual")}>
                <Keyboard size={22} aria-hidden="true" /><span>Manual</span>
              </button>
            </div>
            <button type="button" className={`inventory-nav-scan${scannerQuickMenuOpen ? " is-active" : ""}`} aria-expanded={scannerQuickMenuOpen} aria-label="Choose scanner quantity mode" onClick={() => {
              setScannerQuantityMode(loadScannerQuantityMode());
              setScannerPackageMode(loadScannerPackageMode());
              setScannerQuickMenuOpen((open) => !open);
            }}>
              <span className="inventory-nav-scan-icon"><ScanLine size={22} aria-hidden="true" /></span><span>Scan Mode</span>
            </button>
          </div>
          <button type="button" className={currentView === "history" ? "is-active" : ""} onClick={openHistory}>
            <ReceiptText size={20} aria-hidden="true" /><span>Transactions</span>
          </button>
          <button type="button" className={currentView === "profile" ? "is-active" : ""} onClick={() => setCurrentView("profile")}>
            <User size={20} aria-hidden="true" /><span>Profile</span>
          </button>
        </nav>
      </>}

      {historyStockChangeReview && (
        <div className="logout-dialog-backdrop">
          <div ref={dialogRef} className="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="history-stock-changed-title" aria-describedby="history-stock-changed-desc">
            <h2 id="history-stock-changed-title" className="logout-dialog-title">{PCOUNT_BLIND_CONFLICT_TITLE}</h2>
            <div id="history-stock-changed-desc" className="logout-dialog-text">
              {PCOUNT_BLIND_CONFLICT_MESSAGE}
            </div>
            <div className="logout-dialog-actions">
              <button type="button" className="logout-dialog-button" autoFocus disabled={historySubmitState.isSubmitting} onClick={() => {
                setHistoryStockChangeReview(null);
                showToast("warning", `${historyStockChangeReview.inventoryLocation} requires review.`);
              }}>
                Cancel and Review
              </button>
              <button type="button" className="logout-dialog-button logout-dialog-button-primary" disabled={historySubmitState.isSubmitting} onClick={() => void resubmitHistoryAfterBaselineRefresh()}>
                {historySubmitState.isSubmitting ? "Resubmitting..." : "Refresh and Resubmit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="logout-dialog-backdrop" onClick={() => setShowLogoutConfirm(false)}>
          <div ref={dialogRef} className="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-dialog-title" aria-describedby="logout-dialog-desc" onClick={(event) => event.stopPropagation()}>
            <h2 id="logout-dialog-title" className="logout-dialog-title">Logout?</h2>
            <div id="logout-dialog-desc" className="logout-dialog-text">You will be signed out of this device. Your saved scanner records will remain on this device.</div>
            <div className="logout-dialog-actions">
              <button type="button" className="logout-dialog-button" autoFocus onClick={() => setShowLogoutConfirm(false)}>
                Stay logged in
              </button>
              <button type="button" className="logout-dialog-button logout-dialog-button-primary is-danger" onClick={onLogout}>
                Log out
              </button>
            </div>
          </div>
        </div>
      )}
      {showClearSavedConfirm && (
        <div className="logout-dialog-backdrop" onClick={() => setShowClearSavedConfirm(false)}>
          <div
            ref={dialogRef}
            className="logout-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-saved-dialog-title"
            aria-describedby="clear-saved-dialog-desc"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="clear-saved-dialog-title" className="logout-dialog-title">Clear saved scans?</h2>
            <div id="clear-saved-dialog-desc" className="logout-dialog-text">
              This permanently removes locally saved scanner counts and the active Physical Count session from this device. It cannot be undone. Previously submitted ERPNext transactions are not deleted.
            </div>
            <div className="logout-dialog-actions">
              <button type="button" className="logout-dialog-button" autoFocus onClick={() => setShowClearSavedConfirm(false)}>
                Keep saved scans
              </button>
              <button type="button" className="logout-dialog-button logout-dialog-button-primary is-danger" onClick={clearSavedScans}>
                Clear scans
              </button>
            </div>
          </div>
        </div>
      )}
      {showDeviceNameDialog && (
        <div className="logout-dialog-backdrop" onClick={() => setShowDeviceNameDialog(false)}>
          <div ref={dialogRef} className="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="device-name-title" aria-describedby="device-name-desc" onClick={(event) => event.stopPropagation()}>
            <h2 id="device-name-title" className="logout-dialog-title">Device Name</h2>
            <div id="device-name-desc" className="logout-dialog-text">This name will be saved with new scans and submitted to ERP.</div>
            <label htmlFor="device-name-input" className="sr-only">Device name</label>
            <input
              id="device-name-input"
              className="device-dialog-input"
              value={deviceNameInput}
              onChange={(event) => setDeviceNameInput(event.target.value)}
              placeholder="Example: Scanner A"
              autoFocus
            />
            <div className="logout-dialog-actions">
              <button type="button" className="logout-dialog-button" onClick={() => setShowDeviceNameDialog(false)}>
                Cancel
              </button>
              <button type="button" className="logout-dialog-button logout-dialog-button-primary" onClick={saveDeviceName}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {historySubmitState.isSubmitting && (
        <div className="mfg-loading-overlay" role="status" aria-live="assertive" aria-label="Submitting Physical Count">
          <div className="mfg-loading-card">
            <span className="mfg-loading-spinner" aria-hidden="true" />
            <div className="mfg-loading-copy">
              <strong>{historyStockChangeReview ? "Resubmitting Physical Count" : "Submitting Physical Count"}</strong>
              <span>Please wait for ERPNext to finish processing.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  </>
  );
};

export default BlankPage;