import React from "react";
import { CalculatorReadout } from "@/components/CalculatorReadout";
import { App as CapacitorApp } from "@capacitor/app";
import { ArrowLeft, Barcode, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Factory, FileText, MapPinCheck, Package, PackagePlus, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import AppToast, { type ToastKind, type ToastNotice } from "@/components/AppToast";
import "@/components/ManufacturingScanner.css";
import type { Employee } from "@/types";
import { loadScannerDeviceName } from "@/lib/scanStorage";
import { PackingLabelQrError, parsePackingLabelQr, validateManufacturePackingReferences, type PackingLabelQr } from "@/lib/packingLabelQr";
import { createManufactureReceiveDraft, createManufacturingSubmissionId, ManufacturingApiError, validateManufactureJobCard, type ManufactureReceiveContext } from "@/lib/manufacturingService";
import { getPcountItemDetails } from "@/lib/erpService";
import { RECEIVE_FINISHED_GOODS_ONLINE_MESSAGE, verifyReceiveFinishedGoodsConnection } from "@/lib/receiveFinishedGoodsOnline";
import { clearStorageLocationCache, requireStorageLocationQr, resolveStorageLocationQr } from "@/lib/storageLocationService";
import { areCompatibleUoms } from "@/lib/uom";
import {
  calculatePulloutPackage,
  createPulloutRequestSignature,
  getPackageModeDefaultInput,
  PackageQuantityError,
  type PulloutPackageMode,
} from "@/lib/packageQuantity";
import {
  addStockEntryToHandover, adjustAllocationQuantity, allocationDefaultQuantity, allocationIsReadyToComplete, allocationItemBalances, changeAllocationLocation,
  canGenerateHandoverQr, clearActiveWarehouseAllocation, clearCompletedHandoverCache, clearDeviceHandover, completeWarehouseAllocation, confirmChecker, createWarehouseAllocation, generateHandoverQr,
  createDeviceHandoverQrPayload,
  getCheckerReview, getDeviceCompletedAllocationHistory, getPickerContext, getWarehouseAllocation, isAllocationCompleted, isTerminalHandoverStatus, loadActiveWarehouseAllocation, loadCompletedAllocationHistory, loadDeviceHandover, mergeHandoverDraft, parseHandoverQr, pendingCheckerItems, reconcileHandoverServerStatus,
  applyHandoverQuantityMultiplier, getHandoverUnitQuantity, preserveHandoverScanMetadata, saveActiveWarehouseAllocation, saveDeviceHandover, updateCheckedQuantities, updateManufactureReceiveDraft, validateCheckerCorrections, verifyAllocationLocation, HandoverApiError,
  findMatchingAllocationRow, getPickerTargetWarehouse, isActiveAllocationForBatch, isPickerReadyStatus, parseAllocationQuantityInput, saveCompletedAllocationHistory, validateAllocationQuantity, type CompletedAllocationHistory, type DeviceHandover, type HandoverItem, type HandoverQrPayload, type WarehouseAllocation, type WarehouseAllocationRow,
} from "@/lib/warehouseHandover";
import { resolveManufacturingEntryStage, type ManufacturingRole } from "@/lib/manufacturingEntry";
import { getManufacturingStepState } from "@/lib/manufacturingWorkflow";
import { loadScannerPackageMode } from "@/lib/scannerPreferences";
import { createWarehouseAllocationTransaction, saveSuccessfulTransaction } from "@/lib/transactionHistory";

type Stage = "menu" | "receive" | "received" | "batch" | "checker-handover-scan" | "checker" | "checker-scan" | "handover-qr" | "picker-scan" | "picker-form" | "allocation";
type PendingDraft = { label: PackingLabelQr };
type QuantityMetadata = { itemCode: string; qrQuantity: number; quantityMultiplier: number };
type LocationAction = {
  kind: "verify" | "change" | "quantity";
  row: WarehouseAllocationRow;
  locationId?: string;
  locationCode?: string;
  storageCapacity?: number;
};
const same = (a: string, b: string) => a.trim().toLocaleUpperCase() === b.trim().toLocaleUpperCase();
const loadPreferredPulloutMode = (): PulloutPackageMode => loadScannerPackageMode() === "loose" ? "PARTIAL" : "FULL";
const today = () => new Date().toISOString().slice(0, 10);
const checkerErrorMessage = (error: HandoverApiError) => ({
  INVALID_CHECKER_QR: "Invalid Checker QR. Scan a newly generated Assign Checker QR from ERPNext.",
  CHECKER_NOT_AUTHORIZED: "This checker is inactive or not authorized for this verification.",
  CHECKER_VERIFICATION_CONFLICT: "This handover was already verified by a different checker.",
  HANDOVER_NOT_FOUND: "The handover was not found. Return to Pullout and refresh the batch.",
  SOURCE_DOCUMENT_NOT_FOUND: "A linked Draft Stock Entry is missing. Refresh the batch before retrying.",
  SOURCE_DOCUMENT_NOT_DRAFT: "Checker Verification is blocked because every linked Stock Entry must remain Draft.",
  SOURCE_DOCUMENT_CHANGED: "A linked Stock Entry changed in ERPNext. Refresh and review the complete batch before retrying.",
  CHECKER_VERIFICATION_REQUIRED: "Checker Verification is required before generating the Handover QR.",
  WAREHOUSE_PERMISSION_DENIED: "You do not have permission to verify this warehouse handover.",
  STOCK_ENTRY_SUBMISSION_FAILED: "Checker Verification succeeded, but ERPNext could not submit the linked Pullout Stock Entries. No handover was generated.",
  STOCK_ENTRY_SUBMISSION_REQUIRED: "ERPNext verified the checker but did not confirm Pullout Stock Entry submission. Update the backend before generating the handover.",
  PARTIAL_SUBMISSION_NOT_ALLOWED: "ERPNext could not submit the complete Pullout batch. The operation was rolled back.",
}[error.code] || error.message);
const isTerminalHandoverError = (error: unknown) => {
  if (!(error instanceof HandoverApiError)) return false;
  const status = String(error.payload.handover_status ?? error.payload.status ?? "").trim().toLocaleUpperCase();
  return ["HANDOVER_COMPLETED", "HANDOVER_CANCELLED"].includes(error.code.toLocaleUpperCase()) ||
    ["COMPLETED", "CANCELLED"].includes(status) || /\b(?:is|status(?:\s+is)?)\s+(?:COMPLETED|CANCELLED)\b/i.test(error.message);
};

const QuantityKeypad: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const press = (key: string) => {
    if (key === "back") { onChange(value.slice(0, -1)); return; }
    if (key === "." && value.includes(".")) return;
    const next = value === "0" && key !== "." ? key : `${value}${key}`;
    onChange(next);
  };
  return <div className="mfg-qty-keypad">
    {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"].map((key) =>
      <button type="button" className={`mfg-qty-key ${key === "back" ? "mfg-qty-key-muted" : ""}`} key={key} aria-label={key === "back" ? "Delete last digit" : `Enter ${key}`} onClick={() => press(key)}>{key === "back" ? "⌫" : key}</button>
    )}
  </div>;
};

const WHEEL_ITEM_HEIGHT = 44;
const WheelColumn: React.FC<{ values: string[]; value: string; label: string; onChange: (value: string) => void }> = ({ values, value, label, onChange }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const settleTimer = React.useRef<number | null>(null);
  const selectedIndex = Math.max(0, values.indexOf(value));
  React.useLayoutEffect(() => {
    ref.current?.scrollTo({ top: selectedIndex * WHEEL_ITEM_HEIGHT, behavior: "auto" });
  }, [selectedIndex]);
  React.useEffect(() => () => { if (settleTimer.current !== null) window.clearTimeout(settleTimer.current); }, []);
  return <div className="mfg-wheel-column-wrap">
    <div ref={ref} className="mfg-wheel-column" role="listbox" aria-label={label} onScroll={(event) => {
      const index = Math.max(0, Math.min(values.length - 1, Math.round(event.currentTarget.scrollTop / WHEEL_ITEM_HEIGHT)));
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => { if (values[index] !== value) onChange(values[index]); }, 90);
    }}>
      {values.map((option, index) => <button type="button" role="option" aria-selected={option === value} className={option === value ? "is-selected" : ""} key={`${label}-${option}`} onClick={() => {
        onChange(option); ref.current?.scrollTo({ top: index * WHEEL_ITEM_HEIGHT, behavior: "smooth" });
      }}>{option}</button>)}
    </div>
    <span className="mfg-wheel-selection" aria-hidden="true"/>
  </div>;
};

const pad2 = (value: number | string) => String(value).padStart(2, "0");
const dateParts = (value: string) => {
  const [year, month, day] = value.split("-").map(Number); const now = new Date();
  return { year: Number.isFinite(year) ? year : now.getFullYear(), month: Number.isFinite(month) ? month : now.getMonth() + 1,
    day: Number.isFinite(day) ? day : now.getDate() };
};
const timeParts = (value: string) => {
  const [rawHour, rawMinute] = value.split(":").map(Number); const hour24 = Number.isFinite(rawHour) ? rawHour : 0;
  return { hour: hour24 % 12 || 12, minute: Number.isFinite(rawMinute) ? rawMinute : 0, period: hour24 >= 12 ? "PM" : "AM" };
};

interface Props { employee: Employee; onBack: () => void; resumeAllocation?: boolean; initialRole?: ManufacturingRole }

const contextItems = (context: ManufactureReceiveContext, quantityMetadata?: QuantityMetadata): HandoverItem[] => {
  const allocationRows = Array.from(context.putawayAllocations.reduce((items, row) => {
    const key = `${row.rowId}\u0000${row.itemCode}\u0000${row.uom}`;
    const existing = items.get(key);
    items.set(key, existing ? { ...existing, expectedQuantity: existing.expectedQuantity + row.quantity } : {
      rowId: row.rowId, itemCode: row.itemCode, itemName: row.itemName, expectedQuantity: row.quantity,
      uom: row.uom, targetWarehouse: row.targetWarehouse, inventoryLocation: row.inventoryLocation,
      inventoryLocationCode: "", requiresBatch: row.requiresBatch, requiresSerial: row.requiresSerial,
    });
    return items;
  }, new Map<string, ManufactureReceiveContext["finishedItems"][number]>()).values());
  const rows = context.finishedItems.length ? context.finishedItems : allocationRows.length ? allocationRows : [{
    rowId: "", itemCode: context.finishedItemCode, itemName: context.finishedItemName,
    expectedQuantity: context.expectedManufactureQuantity, uom: "", targetWarehouse: "", inventoryLocation: "",
    inventoryLocationCode: "", requiresBatch: false, requiresSerial: false,
  }];
  return rows.filter((row) => row.itemCode).map((row) => ({
    stockEntryId: context.stockEntryId, stockEntryRow: row.rowId, jobCardId: context.jobCardId,
    workOrderId: context.workOrderId, itemCode: row.itemCode, itemName: row.itemName,
    recordedQuantity: row.expectedQuantity, verifiedQuantity: row.expectedQuantity, uom: row.uom,
    pullOutSlip: context.customReferenceDocument, correctionReason: "", modified: "",
    actualWeightPerItem: context.actualWeightPerItem,
    targetWarehouse: row.targetWarehouse,
    ...(quantityMetadata && same(row.itemCode, quantityMetadata.itemCode) ? {
      qrQuantity: quantityMetadata.qrQuantity,
      quantityMultiplier: quantityMetadata.quantityMultiplier,
    } : {}),
  }));
};

const ManufacturingScanner: React.FC<Props> = ({ employee, onBack, resumeAllocation = false, initialRole }) => {
  const initialStageRef = React.useRef<Stage>(resolveManufacturingEntryStage(initialRole, Boolean(loadDeviceHandover()?.drafts.length)));
  const [stage, setStage] = React.useState<Stage>(initialStageRef.current);
  const [message, setMessage] = React.useState(
    initialRole === "checker"
      ? initialStageRef.current === "batch" ? "Review the live ERPNext Pullout quantities." : "Scan the Handover QR to review the batch."
      : initialRole === "picker" ? "Scan the generated Handover QR." : "Scan a packing-label QR containing a Job Card reference."
  );
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState<ToastNotice | null>(null);
  const [pendingDraft, setPendingDraft] = React.useState<PendingDraft | null>(null);
  const [pendingDraftItemName, setPendingDraftItemName] = React.useState("");
  React.useEffect(() => {
    const itemCode = pendingDraft?.label.itemCode;
    if (!itemCode) { setPendingDraftItemName(""); return; }
    let active = true;
    setPendingDraftItemName("");
    void getPcountItemDetails(itemCode).then((details) => {
      if (active && details.itemCode.trim().toUpperCase() === itemCode.trim().toUpperCase()) {
        setPendingDraftItemName(details.itemName || "");
      }
    }).catch(() => { /* Keep scanning available when item name lookup is offline. */ });
    return () => { active = false; };
  }, [pendingDraft?.label.itemCode]);
  const [quantityConfirmed, setQuantityConfirmed] = React.useState(false);
  const [receiveQuantity, setReceiveQuantity] = React.useState(() => getPackageModeDefaultInput(loadPreferredPulloutMode()));
  const [pulloutMode, setPulloutMode] = React.useState<PulloutPackageMode>(() => loadPreferredPulloutMode());
  const [pullOutSlip, setPullOutSlip] = React.useState("");
  const [actualWeight, setActualWeight] = React.useState("");
  const [lastDraft, setLastDraft] = React.useState("");
  const [lastDraftExisting, setLastDraftExisting] = React.useState(false);
  const [showPulloutDrafts, setShowPulloutDrafts] = React.useState(false);
  const [handover, setHandover] = React.useState<DeviceHandover | null>(() => loadDeviceHandover());
  const [handoverQr, setHandoverQr] = React.useState(() => loadDeviceHandover()?.handoverQr || "");
  const [checkerQr, setCheckerQr] = React.useState<HandoverQrPayload | null>(null);
  const [checkerScanOrigin, setCheckerScanOrigin] = React.useState<"batch" | "checker">("checker");
  const [pendingCheckerQr, setPendingCheckerQr] = React.useState("");
  const [pickerQr, setPickerQr] = React.useState<HandoverQrPayload | null>(null);
  const [pickerTypes, setPickerTypes] = React.useState<string[]>([]);
  const [pickerWarehouseMan, setPickerWarehouseMan] = React.useState("");
  const [pickerChecker, setPickerChecker] = React.useState("");
  const [pickerItems, setPickerItems] = React.useState<HandoverItem[]>([]);
  const [transactionType, setTransactionType] = React.useState("");
  const [warehouse, setWarehouse] = React.useState("");
  const [pickerDropdown, setPickerDropdown] = React.useState<"transaction" | null>(null);
  const [postingDate, setPostingDate] = React.useState(today());
  const [postingTime, setPostingTime] = React.useState(() => new Date().toTimeString().slice(0, 8));
  const [dateTimePicker, setDateTimePicker] = React.useState<"date" | "time" | null>(null);
  const [pickerDate, setPickerDate] = React.useState(() => dateParts(today()));
  const [pickerTime, setPickerTime] = React.useState(() => timeParts(new Date().toTimeString().slice(0, 8)));
  const [allocation, setAllocation] = React.useState<WarehouseAllocation | null>(null);
  const [allocationHistory, setAllocationHistory] = React.useState<CompletedAllocationHistory[]>(() => loadCompletedAllocationHistory());
  const [locationAction, setLocationAction] = React.useState<LocationAction | null>(null);
  const [checkerEdit, setCheckerEdit] = React.useState<number | null>(null);
  const [checkerEditKind, setCheckerEditKind] = React.useState<"quantity" | "weight">("quantity");
  const [checkerQuantity, setCheckerQuantity] = React.useState("");
  const [showAllCheckerItems, setShowAllCheckerItems] = React.useState(false);
  const [actionQuantity, setActionQuantity] = React.useState("");
  const [actionReason, setActionReason] = React.useState("");
  const [showAllAllocationRows, setShowAllAllocationRows] = React.useState(false);
  const [showAllocationBalances, setShowAllocationBalances] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const scannerBufferRef = React.useRef("");
  const draftCreatingRef = React.useRef(false);
  const draftRequestIdRef = React.useRef("");
  const draftRequestSignatureRef = React.useRef("");
  const deviceName = loadScannerDeviceName() || "Scanner";

  const notify = React.useCallback((kind: ToastKind, text: string) => setToast({ id: Date.now(), kind, message: text }), []);
  const focusScanner = React.useCallback(() => window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })), []);
  const resetPulloutMode = React.useCallback(() => {
    const preferredMode = loadPreferredPulloutMode();
    setPulloutMode(preferredMode);
    setReceiveQuantity(getPackageModeDefaultInput(preferredMode));
  }, []);
  const persist = React.useCallback((value: DeviceHandover | null) => {
    setHandover(value);
    if (value) saveDeviceHandover(value); else clearDeviceHandover();
  }, []);

  const allocationResumeAttemptedRef = React.useRef(false);
  React.useEffect(() => {
    if (!resumeAllocation || allocationResumeAttemptedRef.current) return;
    allocationResumeAttemptedRef.current = true;
    const saved = loadActiveWarehouseAllocation();
    if (!saved?.allocation?.name) {
      notify("warning", "No unfinished Warehouse Allocation is saved on this scanner.");
      return;
    }

    setBusy(true);
    void (async () => {
      try {
        await verifyReceiveFinishedGoodsConnection();
        const latest = await getWarehouseAllocation(saved.allocation.name);
        if (isAllocationCompleted(latest)) {
          clearActiveWarehouseAllocation(latest.name);
          notify("success", `${latest.name} is already completed.`);
          setStage("menu");
          return;
        }
        setAllocation(latest);
        saveActiveWarehouseAllocation(saved.batchId, latest);
        setStage("allocation");
        setMessage("Continue verifying the remaining Storage Locations.");
      } catch (error) {
        // Keep the locally saved allocation visible if ERPNext is temporarily
        // unreachable. Mutations will still require a successful live request.
        setAllocation(saved.allocation);
        setStage("allocation");
        notify("warning", error instanceof Error ? error.message : RECEIVE_FINISHED_GOODS_ONLINE_MESSAGE);
      } finally {
        setBusy(false);
      }
    })();
  }, [notify, resumeAllocation]);

  const resetReceive = React.useCallback(() => {
    setStage("receive"); setPendingDraft(null); setQuantityConfirmed(false); resetPulloutMode(); setPullOutSlip(""); setActualWeight(""); setLastDraft(""); setLastDraftExisting(false);
    setMessage("Scan a packing-label QR containing a Job Card reference."); scannerBufferRef.current = ""; draftRequestIdRef.current = ""; draftRequestSignatureRef.current = ""; focusScanner();
  }, [focusScanner, resetPulloutMode]);

  const openOnlineStage = React.useCallback(async (nextStage: Stage, nextMessage: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await verifyReceiveFinishedGoodsConnection();
      setStage(nextStage); setMessage(nextMessage); focusScanner();
    } catch {
      notify("error", RECEIVE_FINISHED_GOODS_ONLINE_MESSAGE);
    } finally {
      setBusy(false);
    }
  }, [busy, focusScanner, notify]);

  const goBack = React.useCallback(() => {
    if (pendingCheckerQr) { setPendingCheckerQr(""); focusScanner(); return; }
    if (pendingDraft) {
      if (quantityConfirmed) setQuantityConfirmed(false);
      else { setPendingDraft(null); draftRequestIdRef.current = ""; draftRequestSignatureRef.current = ""; }
      resetPulloutMode(); setPullOutSlip(""); setActualWeight(""); focusScanner(); return;
    }
    if (stage !== "menu") {
      if (initialRole) { onBack(); return; }
      setStage("menu"); setMessage("Select Pullout, Checker, or Picker."); return;
    }
    onBack();
  }, [focusScanner, initialRole, onBack, pendingCheckerQr, pendingDraft, quantityConfirmed, resetPulloutMode, stage]);

  React.useEffect(() => {
    let listener: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;
    void CapacitorApp.addListener("backButton", goBack).then((handle) => { listener = handle; });
    return () => { void listener?.remove(); };
  }, [goBack]);

  React.useEffect(() => {
    const restore = () => {
      const waitingForLocation = locationAction && locationAction.kind !== "quantity" && !locationAction.locationId;
      if (!pendingDraft && !pendingCheckerQr && checkerEdit === null && (!locationAction || waitingForLocation)) focusScanner();
    };
    const visibility = () => { if (document.visibilityState === "visible") restore(); };
    restore(); window.addEventListener("focus", restore); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("focus", restore); document.removeEventListener("visibilitychange", visibility); };
  }, [checkerEdit, focusScanner, locationAction, pendingCheckerQr, pendingDraft, stage]);

  const syncHandoverBatch = React.useCallback(async () => {
    if (!handover?.drafts.length) throw new Error("Receive at least one Draft Stock Entry first.");
    let active = handover;
    const registerAll = active.batchId.startsWith("LOCAL-");
    if (!registerAll) return active;
    const stockEntries = Array.from(new Set(active.drafts.map((row) => row.stockEntryId)));
    for (const stockEntryId of stockEntries) {
      const registration = await addStockEntryToHandover(active.batchId, stockEntryId, deviceName);
      active = { ...active, batchId: registration.batchId || active.batchId, status: registration.status,
        warehouseMan: registration.warehouseMan || active.warehouseMan };
      if (registration.items.length) active = registration.items.reduce((value, row) => mergeHandoverDraft(value, row, registration.batchId), active);
    }
    persist(active);
    return active;
  }, [deviceName, handover, persist]);

  const clearTerminalHandover = React.useCallback((current: DeviceHandover) => {
    const stockEntryIds = Array.from(new Set(current.drafts.map((row) => row.stockEntryId).filter(Boolean)));
    clearCompletedHandoverCache(current.batchId, allocation?.name || "", stockEntryIds);
    setHandover((visible) => visible?.batchId === current.batchId ? null : visible);
    setHandoverQr(""); setCheckerQr(null); setPendingCheckerQr(""); setPickerQr(null); setPickerItems([]); setPickerTypes([]);
    setPickerWarehouseMan(""); setPickerChecker(""); setWarehouse(""); setTransactionType(""); setLocationAction(null); setAllocation(null);
    setStage("menu"); setMessage("Select Pullout, Checker, or Picker.");
  }, [allocation?.name]);

  const openPickerContext = React.useCallback(async (qr: HandoverQrPayload, context: Awaited<ReturnType<typeof getPickerContext>>) => {
    if (!isPickerReadyStatus(context.status)) {
      throw new HandoverApiError("Checker verification is required before picker handover.", "HANDOVER_NOT_CHECKED");
    }
    setPickerQr(qr); setPickerTypes(context.transactionTypes); setTransactionType(context.transactionTypes[0] || "");
    setPickerWarehouseMan(context.warehouseMan); setPickerChecker(context.checker); setPickerItems(context.items);
    const savedAllocation = loadActiveWarehouseAllocation();
    if (isActiveAllocationForBatch(savedAllocation, qr.batch_id)) {
      const latest = await getWarehouseAllocation(savedAllocation!.allocation.name);
      if (isAllocationCompleted(latest)) {
        clearActiveWarehouseAllocation(latest.name);
        setAllocation(null);
        setStage("menu");
        notify("success", `${latest.name} is already completed.`);
        return;
      }
      setAllocation(latest);
      saveActiveWarehouseAllocation(qr.batch_id, latest);
      setStage("allocation");
      setMessage(`${latest.name} restored. Continue verifying the remaining Storage Locations.`);
      notify("success", `${latest.name} reopened.`);
      return;
    }
    const targetWarehouse = getPickerTargetWarehouse(context.items, context.warehouses);
    setWarehouse(targetWarehouse);
    setStage("picker-form");
  }, [notify]);

  const refreshActiveHandover = React.useCallback(async () => {
    const current = loadDeviceHandover();
    if (!current?.token) return;
    try {
      const context = await getPickerContext({ type: "QCMC_WAREHOUSE_HANDOVER", version: 1, batch_id: current.batchId,
        stock_entry_ids: current.drafts.map((row) => row.stockEntryId), issued_at: "", expires_at: current.expiresAt, token: current.token });
      const reconciled = reconcileHandoverServerStatus(current, context.status);
      if (!reconciled) clearTerminalHandover(current);
      else if (reconciled.status !== current.status) persist(reconciled);
    } catch (error) {
      if (isTerminalHandoverError(error)) clearTerminalHandover(current);
    }
  }, [clearTerminalHandover, persist]);

  const refreshActiveAllocation = React.useCallback(async () => {
    if (stage !== "allocation" || !allocation?.name || isAllocationCompleted(allocation)) return;
    try {
      const latest = await getWarehouseAllocation(allocation.name);
      setAllocation(latest);
      saveActiveWarehouseAllocation(loadActiveWarehouseAllocation()?.batchId || handover?.batchId || "", latest);
    } catch {
      // Keep the current screen visible. Every mutation remains blocked until a
      // live ERPNext request succeeds.
    }
  }, [allocation, handover?.batchId, stage]);

  const refreshDeviceHistory = React.useCallback(async () => {
    try {
      const serverHistory = await getDeviceCompletedAllocationHistory(deviceName);
      let merged = loadCompletedAllocationHistory();
      for (const entry of [...serverHistory].reverse()) merged = saveCompletedAllocationHistory(entry);
      setAllocationHistory(merged);
    } catch {
      // The local per-device history remains available if ERPNext is temporarily
      // unreachable or the history endpoint has not yet been installed.
    }
  }, [deviceName]);

  React.useEffect(() => {
    const handleOnline = () => { void refreshActiveHandover(); void refreshActiveAllocation(); void refreshDeviceHistory(); };
    window.addEventListener("online", handleOnline);
    if (navigator.onLine) void refreshActiveHandover();
    return () => window.removeEventListener("online", handleOnline);
  }, [refreshActiveAllocation, refreshActiveHandover, refreshDeviceHistory]);

  React.useEffect(() => {
    let listener: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) { void refreshActiveHandover(); void refreshActiveAllocation(); void refreshDeviceHistory(); }
    }).then((handle) => { listener = handle; });
    return () => { void listener?.remove(); };
  }, [refreshActiveAllocation, refreshActiveHandover, refreshDeviceHistory]);

  React.useEffect(() => {
    if (stage === "menu" && navigator.onLine) void refreshDeviceHistory();
  }, [refreshDeviceHistory, stage]);

  React.useEffect(() => {
    if (!handover?.token || isTerminalHandoverStatus(handover.status)) return;
    // Picker commonly works on another device. Poll ERPNext so this Checker
    // device learns that the allocation was completed without requiring an app
    // restart, network transition, or another button press.
    const interval = window.setInterval(() => void refreshActiveHandover(), 10000);
    return () => window.clearInterval(interval);
  }, [handover?.batchId, handover?.status, handover?.token, refreshActiveHandover]);

  const submitCheckerVerification = React.useCallback(async () => {
    if (!pendingCheckerQr || !handover || busy) return;
    const raw = pendingCheckerQr;
    setPendingCheckerQr("");
    setBusy(true);
    try {
      const result = await confirmChecker(handover.batchId, raw, deviceName);
      if ((result.batchId && result.batchId !== handover.batchId) || result.status !== "CHECKED" || !result.checker || !result.checkerId)
        throw new HandoverApiError("ERPNext did not confirm this Checker Verification QR.", "INVALID_CHECKER_QR");
      if (!result.stockEntriesSubmitted)
        throw new HandoverApiError("ERPNext did not confirm Pullout Stock Entry submission.", "STOCK_ENTRY_SUBMISSION_REQUIRED");
      persist({ ...handover, checker: result.checker, checkerId: result.checkerId, verifiedAt: result.verifiedAt,
        checkerVerificationStatus: "VERIFIED", stockEntriesSubmitted: true, submittedStockEntryIds: result.submittedStockEntryIds,
        status: result.status, updatedAt: new Date().toISOString() });
      setStage(checkerScanOrigin);
      notify("success", `Verified by ${result.checker}. Pullout Stock Entries submitted.`);
    } catch (error) {
      setStage(checkerScanOrigin);
      notify("error", error instanceof HandoverApiError ? checkerErrorMessage(error) : RECEIVE_FINISHED_GOODS_ONLINE_MESSAGE);
    } finally {
      setBusy(false);
      focusScanner();
    }
  }, [busy, checkerScanOrigin, deviceName, focusScanner, handover, notify, pendingCheckerQr, persist]);

  const processScan = React.useCallback(async (raw: string) => {
    if (busy || !raw.trim()) return;
    try {
      if (stage === "receive" && !pendingDraft) {
        const label = parsePackingLabelQr(raw);
        if (!label.jobCardId) throw new Error("This packing label does not contain a Job Card Document Name.");
        setBusy(true);
        const liveJobCard = await validateManufactureJobCard(label.jobCardId);
        draftRequestIdRef.current = ""; draftRequestSignatureRef.current = "";
        setPendingDraft({ label }); setQuantityConfirmed(false); resetPulloutMode(); setPullOutSlip(""); setActualWeight("");
        setMessage(`Job Card ${liveJobCard.jobCardId} validated in ERPNext. Enter the receiving quantity.`); return;
      }
      if (stage === "checker-handover-scan") {
        const qr = parseHandoverQr(raw); setBusy(true);
        const review = await getCheckerReview(qr);
        const next: DeviceHandover = { batchId: review.batchId, token: qr.token, expiresAt: qr.expires_at,
          status: (review.status || "PENDING_CHECK") as DeviceHandover["status"], drafts: review.items,
          warehouseMan: review.warehouseMan, checker: "", checkerId: "", verifiedAt: "", checkerVerificationStatus: "NONE", picker: "", updatedAt: new Date().toISOString() };
        setCheckerQr(qr); persist(next); setStage("checker"); return;
      }
      if (stage === "checker-scan" && handover) {
        setPendingCheckerQr(raw);
        return;
      }
      if (stage === "picker-scan") {
        const qr = parseHandoverQr(raw); setBusy(true);
        const context = await getPickerContext(qr);
        await openPickerContext(qr, context); return;
      }
      if (stage === "allocation" && locationAction && locationAction.kind !== "quantity") {
        const locationQr = requireStorageLocationQr(raw);
        setBusy(true);
        const location = await resolveStorageLocationQr(locationQr, { forceRefresh: true });
        if (location.isGroup) throw new HandoverApiError("Group Storage Locations cannot be verified as a physical placement.", "LOCATION_IS_GROUP");
        setLocationAction({
          ...locationAction,
          locationId: location.inventoryLocationId,
          locationCode: location.locationCode || location.inventoryLocationId,
          storageCapacity: location.storageCapacity,
        });
        setActionQuantity(String(allocationDefaultQuantity(locationAction.row))); return;
      }
    } catch (error) {
      notify("error", error instanceof HandoverApiError ? checkerErrorMessage(error) : error instanceof PackingLabelQrError || error instanceof Error ? error.message : "The scanned QR is invalid.");
    } finally { setBusy(false); if (!(stage === "receive" && !pendingDraft)) focusScanner(); }
  }, [busy, focusScanner, handover, locationAction, notify, openPickerContext, pendingDraft, persist, resetPulloutMode, stage]);

  React.useEffect(() => {
    const handler = (event: Event) => void processScan((event as CustomEvent<{ code?: string }>).detail?.code || "");
    window.addEventListener("qcmc-scanner-data", handler);
    return () => window.removeEventListener("qcmc-scanner-data", handler);
  }, [processScan]);

  const handleKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); const code = scannerBufferRef.current; scannerBufferRef.current = ""; if (code) void processScan(code); return; }
    if (event.key === "Backspace" || event.key === "Delete" || event.key === "Escape") { event.preventDefault(); scannerBufferRef.current = ""; return; }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) { event.preventDefault(); scannerBufferRef.current += event.key; }
  };

  const createDraft = async (event: React.FormEvent) => {
    event.preventDefault(); if (!pendingDraft || busy || draftCreatingRef.current) return;
    const reference = pullOutSlip.trim(); if (!reference) { notify("warning", "Pull Out Slip is required."); return; }
    const weight = Number(actualWeight.replace(/,/g, "").trim());
    if (!Number.isFinite(weight) || weight <= 0) { notify("warning", "Actual Weight per Item must be numeric and greater than zero."); return; }
    let packageQuantity: ReturnType<typeof calculatePulloutPackage>;
    try {
      packageQuantity = calculatePulloutPackage({ qrQuantity: pendingDraft.label.quantity, mode: pulloutMode, input: receiveQuantity });
    } catch (error) {
      notify("warning", error instanceof Error ? error.message : "Enter a valid Pullout quantity.");
      return;
    }
    const quantity = packageQuantity.quantity;
    const requestSignature = createPulloutRequestSignature({
      itemCode: pendingDraft.label.itemCode,
      jobCardId: pendingDraft.label.jobCardId!,
      mode: pulloutMode,
      qrQuantity: packageQuantity.qrQuantity,
      quantity,
      remainingQuantity: packageQuantity.remainingQuantity,
    });
    if (draftRequestSignatureRef.current !== requestSignature) {
      draftRequestSignatureRef.current = requestSignature;
      draftRequestIdRef.current = createManufacturingSubmissionId();
    }
    draftCreatingRef.current = true; setBusy(true);
    try {
      clearStorageLocationCache();
      const context = await createManufactureReceiveDraft(pendingDraft.label.jobCardId!, reference, {
        quantity,
        actualWeightPerItem: weight,
        deviceId: deviceName,
        requestId: draftRequestIdRef.current,
        qrQuantity: packageQuantity.qrQuantity,
        packageStatus: packageQuantity.packageStatus,
        pulloutQuantity: packageQuantity.pulloutQuantity,
        remainingQuantity: packageQuantity.remainingQuantity,
        ...("packageCount" in packageQuantity ? { packageCount: packageQuantity.packageCount } : {}),
      });
      const mismatch = validateManufacturePackingReferences(pendingDraft.label, { jobOrderId: context.workOrderId, jobCardId: context.jobCardId });
      if (mismatch) throw new ManufacturingApiError(mismatch, "ERP_VALIDATION_FAILED");
      const sourceRows = context.finishedItems.length ? context.finishedItems : context.putawayAllocations;
      const matching = sourceRows.filter((row) => same(row.itemCode, pendingDraft.label.itemCode));
      if (!matching.length) throw new ManufacturingApiError(`Packing label item ${pendingDraft.label.itemCode} is not in ${context.stockEntryId}.`, "ERP_VALIDATION_FAILED");
      if (!matching.some((row) => areCompatibleUoms(row.uom, pendingDraft.label.uom))) throw new ManufacturingApiError(`Barcode UOM ${pendingDraft.label.uom} is not compatible with ERPNext Stock UOM.`, "ERP_VALIDATION_FAILED");

      const reusable = handover && ["OPEN", "PENDING_CHECK"].includes(handover.status) ? handover : null;
      const quantityMetadata: QuantityMetadata = {
        itemCode: pendingDraft.label.itemCode,
        qrQuantity: pendingDraft.label.quantity,
        quantityMultiplier: "packageCount" in packageQuantity ? packageQuantity.packageCount : quantity / pendingDraft.label.quantity,
      };
      let next = contextItems(context, quantityMetadata).reduce((value, row) => mergeHandoverDraft(value, row), reusable);
      persist(next);
      const registration = await addStockEntryToHandover(next.batchId, context.stockEntryId, deviceName);
      const registeredItems = registration.items.length ? preserveHandoverScanMetadata(registration.items, next.drafts) : contextItems(context, quantityMetadata);
      next = registeredItems.reduce((value, row) => mergeHandoverDraft(value, row, registration.batchId), next);
      next = { ...next, status: registration.status, updatedAt: new Date().toISOString() };
      persist(next);
      draftRequestIdRef.current = "";
      draftRequestSignatureRef.current = "";
      setLastDraft(context.stockEntryId); setLastDraftExisting(context.existingDraft); setPendingDraft(null); setQuantityConfirmed(false); resetPulloutMode(); setPullOutSlip(""); setActualWeight(""); setStage("received");
      notify("success", `${context.stockEntryId} is ready in Draft status.`);
    } catch (error) {
      const detail = error instanceof ManufacturingApiError && error.code ? `${error.message} [${error.code}]` : error instanceof Error ? error.message : "Unable to create Draft Stock Entry.";
      notify("error", detail);
    } finally { draftCreatingRef.current = false; setBusy(false); }
  };

  const saveCheckerRows = async () => {
    if (!handover || handover.batchId.startsWith("LOCAL-")) { notify("error", "Connect and register the Draft Stock Entries before checker verification."); return; }
    const validation = validateCheckerCorrections(handover.drafts);
    if (validation.length) { notify("warning", validation[0]); return; }
    setBusy(true);
    try {
      const result = await updateCheckedQuantities(handover.batchId, handover.drafts, deviceName);
      if (result.items.length) persist({ ...handover, drafts: preserveHandoverScanMetadata(result.items, handover.drafts), updatedAt: new Date().toISOString() });
      setCheckerScanOrigin("checker"); setStage("checker-scan"); setMessage("Scan the assigned Checker Verification QR.");
    } catch (error) {
      if (error instanceof HandoverApiError && error.code === "SOURCE_DOCUMENT_CHANGED" && checkerQr) {
        try {
          const review = await getCheckerReview(checkerQr);
          persist({ ...handover, drafts: review.items, status: (review.status || "PENDING_CHECK") as DeviceHandover["status"], updatedAt: new Date().toISOString() });
          notify("warning", "ERPNext changed. The checker review was refreshed; review every quantity again.");
        } catch (refreshError) { notify("error", refreshError instanceof Error ? refreshError.message : error.message); }
      } else notify("error", error instanceof Error ? error.message : "Could not save checked quantities.");
    }
    finally { setBusy(false); }
  };

  const saveBatchQuantity = async () => {
    if (!handover || checkerEdit === null) return;
    const row = handover.drafts[checkerEdit];
    const multiplier = Number(checkerQuantity || 0);
    if (!row || !Number.isFinite(multiplier) || multiplier < 0) { notify("warning", "Enter a valid quantity."); return; }
    const updatedRow = applyHandoverQuantityMultiplier(row, multiplier);
    const quantity = updatedRow.verifiedQuantity;
    const drafts = handover.drafts.map((item, index) => index === checkerEdit
      ? {
          ...updatedRow,
          correctionReason: quantity !== item.recordedQuantity && !item.correctionReason
            ? "Batch quantity edited"
            : item.correctionReason,
        }
      : item);
    const validation = validateCheckerCorrections(drafts);
    if (validation.length) { notify("warning", validation[0]); return; }
    setBusy(true);
    try {
      const saved = await updateManufactureReceiveDraft(handover.batchId, drafts, deviceName);
      const savedItems = saved.items.length ? preserveHandoverScanMetadata(saved.items, drafts) : drafts;
      persist({ ...handover, drafts: savedItems, updatedAt: new Date().toISOString() });
      setCheckerEdit(null);
      notify("success", "Quantity saved to the ERPNext Draft.");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Could not save the quantity to the ERPNext Draft.");
    } finally {
      setBusy(false);
    }
  };

  const saveBatchActualWeight = async () => {
    if (!handover || checkerEdit === null) return;
    const row = handover.drafts[checkerEdit];
    const weight = Number(String(checkerQuantity).replace(/,/g, "").trim());
    if (!row || !Number.isFinite(weight) || weight <= 0) { notify("warning", "Actual Weight per Item must be numeric and greater than zero."); return; }
    const drafts = handover.drafts.map((item, index) => index === checkerEdit
      ? { ...item, actualWeightPerItem: weight }
      : item);
    setBusy(true);
    try {
      const saved = await updateManufactureReceiveDraft(handover.batchId, drafts, deviceName);
      const savedItems = saved.items.length ? preserveHandoverScanMetadata(saved.items, drafts) : drafts;
      persist({ ...handover, drafts: savedItems, updatedAt: new Date().toISOString() });
      setCheckerEdit(null);
      notify("success", "Actual Weight saved to the ERPNext Draft.");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Could not save Actual Weight to the ERPNext Draft.");
    } finally {
      setBusy(false);
    }
  };

  const startBatchCheckerVerification = async () => {
    if (!handover?.drafts.length) { notify("warning", "Add at least one Draft Stock Entry first."); return; }
    setBusy(true);
    try {
      await syncHandoverBatch();
      setCheckerScanOrigin("batch");
      setMessage("Scan the assigned Checker Verification QR.");
      setStage("checker-scan");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Could not prepare Checker Verification.");
    } finally {
      setBusy(false);
    }
  };

  const ensureHandoverQr = async (active: DeviceHandover) => {
    if (active.handoverQr) {
      return { raw: active.handoverQr, parsed: parseHandoverQr(active.handoverQr) };
    }
    if (active.token) {
      const parsed = parseHandoverQr(JSON.stringify(createDeviceHandoverQrPayload(active)));
      const raw = JSON.stringify(parsed);
      setHandoverQr(raw);
      persist({ ...active, handoverQr: raw });
      return { raw, parsed };
    }
    const qr = await generateHandoverQr(active.batchId);
    setHandoverQr(qr.raw);
    persist({ ...active, token: qr.parsed.token, expiresAt: qr.parsed.expires_at, handoverQr: qr.raw });
    return qr;
  };

  const showHandoverQr = async () => {
    if (!handover?.drafts.length) { notify("warning", "Add at least one Draft Stock Entry first."); return; }
    if (!canGenerateHandoverQr(handover)) { notify("warning", "Successful online Checker Verification is required before generating the Handover QR."); return; }
    setBusy(true);
    try {
      const active = await syncHandoverBatch();
      if (!canGenerateHandoverQr(active)) throw new HandoverApiError("Checker Verification is required before generating the Handover QR.", "CHECKER_VERIFICATION_REQUIRED");
      const qr = await ensureHandoverQr(active);
      const context = await getPickerContext(qr.parsed);
      if (["COMPLETED", "CANCELLED"].includes(context.status.toLocaleUpperCase())) {
        clearTerminalHandover(active);
        notify("success", "Completed handover removed from active activity.");
        return;
      }
      setHandoverQr(qr.raw);
      setStage("handover-qr");
    }
    catch (error) {
      if (handover && isTerminalHandoverError(error)) {
        clearTerminalHandover(handover);
        notify("success", "Completed handover removed from active activity.");
      } else notify("error", error instanceof HandoverApiError ? checkerErrorMessage(error) : error instanceof Error ? error.message : "Could not generate handover QR.");
    }
    finally { setBusy(false); }
  };

  const proceedToWarehouseAllocation = async () => {
    if (!handover?.drafts.length) { notify("warning", "Add at least one Draft Stock Entry first."); return; }
    if (!canGenerateHandoverQr(handover)) { notify("warning", "Successful online Checker Verification is required before Warehouse Allocation."); return; }
    setBusy(true);
    try {
      const active = await syncHandoverBatch();
      if (!canGenerateHandoverQr(active)) throw new HandoverApiError("Checker Verification is required before Warehouse Allocation.", "CHECKER_VERIFICATION_REQUIRED");
      const qr = await ensureHandoverQr(active);
      const context = await getPickerContext(qr.parsed);
      await openPickerContext(qr.parsed, context);
    } catch (error) {
      if (handover && isTerminalHandoverError(error)) {
        clearTerminalHandover(handover);
        notify("success", "Completed handover removed from active activity.");
      } else notify("error", error instanceof HandoverApiError ? checkerErrorMessage(error) : error instanceof Error ? error.message : "Could not open Warehouse Allocation.");
    } finally {
      setBusy(false);
    }
  };

  const createAllocation = async (event: React.FormEvent) => {
    event.preventDefault(); if (!pickerQr || !transactionType || !warehouse || !postingDate) { notify("warning", "Transaction Type, Warehouse, and Date are required."); return; }
    setBusy(true);
    try {
      const value = await createWarehouseAllocation({ batchId: pickerQr.batch_id, token: pickerQr.token, transactionType,
        warehouse, postingDate, postingTime, deviceId: deviceName, additionalDetails: {} });
      setAllocation(value); // Preserve the exact authoritative ERPNext row order.
      saveActiveWarehouseAllocation(pickerQr.batch_id, value);
      if (handover && handover.batchId === pickerQr.batch_id) {
        persist({ ...handover, status: "ALLOCATION_CREATED", picker: employee.full_name, updatedAt: new Date().toISOString() });
      }
      setStage("allocation");
    }
    catch (error) { notify("error", error instanceof Error ? error.message : "Could not create Warehouse Allocation."); }
    finally { setBusy(false); }
  };

  const openLocationAction = async (kind: LocationAction["kind"], selectedRow: WarehouseAllocationRow) => {
    if (!allocation || busy) return;
    setBusy(true);
    try {
      const latest = await getWarehouseAllocation(allocation.name);
      if (isAllocationCompleted(latest)) {
        setAllocation(latest);
        notify("warning", "This Warehouse Allocation is already completed and cannot be edited.");
        return;
      }
      const row = findMatchingAllocationRow(latest.rows, selectedRow);
      if (!row) {
        setAllocation(latest);
        notify("warning", "This allocation row changed in ERPNext. Review the refreshed allocation.");
        return;
      }
      setAllocation(latest);
      setLocationAction({ kind, row });
      setActionQuantity(String(allocationDefaultQuantity(row)));
      setActionReason("");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : RECEIVE_FINISHED_GOODS_ONLINE_MESSAGE);
    } finally {
      setBusy(false);
      focusScanner();
    }
  };

  const openDatePicker = () => { setPickerDropdown(null); setPickerDate(dateParts(postingDate)); setDateTimePicker("date"); };
  const openTimePicker = () => { setPickerDropdown(null); setPickerTime(timeParts(postingTime)); setDateTimePicker("time"); };
  const updatePickerDate = (next: Partial<typeof pickerDate>) => setPickerDate((current) => {
    const merged = { ...current, ...next };
    const maximumDay = new Date(merged.year, merged.month, 0).getDate();
    return { ...merged, day: Math.min(merged.day, maximumDay) };
  });

  const runLocationAction = async () => {
    if (!allocation || !locationAction) return;
    if (isAllocationCompleted(allocation)) { setLocationAction(null); notify("warning", "Completed Warehouse Allocations cannot be edited."); return; }
    const quantity = parseAllocationQuantityInput(actionQuantity);
    const quantityError = validateAllocationQuantity(allocation, locationAction.row, quantity,
      locationAction.locationId ? {
        locationCode: locationAction.locationCode || locationAction.locationId,
        storageCapacity: locationAction.storageCapacity || 0,
      } : undefined);
    if (quantityError) { notify("warning", quantityError); return; }
    if ((locationAction.kind === "change" || locationAction.kind === "quantity") && !actionReason.trim()) { notify("warning", "A reason is required for this change."); return; }
    if (locationAction.kind !== "quantity" && !locationAction.locationId) { notify("warning", "Scan the Storage Location QR first."); return; }
    setBusy(true);
    try {
      const result = locationAction.kind === "verify"
        ? await verifyAllocationLocation(allocation.name, locationAction.row, locationAction.locationId!, quantity, deviceName)
        : locationAction.kind === "change"
          ? await changeAllocationLocation(allocation.name, locationAction.row, locationAction.locationId!, quantity, actionReason.trim(), deviceName)
          : await adjustAllocationQuantity(allocation.name, locationAction.row, quantity, actionReason.trim(), deviceName);
      const updated = { ...result.row, suggestedLocation: result.row.suggestedLocation || locationAction.row.suggestedLocation };
      let authoritative = result.allocation;
      if (!authoritative?.rows.length) {
        try { authoritative = await getWarehouseAllocation(allocation.name); }
        catch { /* The successful mutation row is still authoritative for the immediate local update. */ }
      }
      if (authoritative?.rows.length) {
        const rows = authoritative.rows.map((returned) => {
          const existing = allocation.rows.find((row) => row.allocationId === returned.allocationId);
          return { ...returned, suggestedLocation: returned.suggestedLocation || existing?.suggestedLocation || "" };
        });
        const nextAllocation = { ...allocation, ...authoritative, name: authoritative.name || allocation.name,
          status: authoritative.status || allocation.status, rows };
        setAllocation(nextAllocation);
        saveActiveWarehouseAllocation(pickerQr?.batch_id || handover?.batchId || "", nextAllocation);
      } else {
        const nextAllocation = { ...allocation, rows: allocation.rows.map((row) => row.allocationId === updated.allocationId ? updated : row) };
        setAllocation(nextAllocation);
        saveActiveWarehouseAllocation(pickerQr?.batch_id || handover?.batchId || "", nextAllocation);
      }
      setLocationAction(null); setActionQuantity(""); setActionReason("");
      notify(updated.status.toUpperCase() === "VERIFIED" ? "success" : "warning", `ERPNext status: ${updated.status.replaceAll("_", " ")}.`);
    } catch (error) { notify("error", error instanceof Error ? error.message : "Could not update this allocation."); }
    finally { setBusy(false); focusScanner(); }
  };

  const finishAllocation = async () => {
    if (!allocation || !allocationIsReadyToComplete(allocation)) { notify("warning", "Verify every allocated Storage Location and allocate the full required quantity before completion."); return; }
    setBusy(true);
    try {
      const result = await completeWarehouseAllocation(allocation.name, deviceName);
      const completed = { ...allocation, ...result.allocation, name: result.allocation.name || allocation.name,
        status: "COMPLETED", rows: result.allocation.rows.length ? result.allocation.rows : allocation.rows,
        stockEntriesRemainDraft: false };
      let authoritative = completed;
      try {
        const refreshed = await getWarehouseAllocation(completed.name);
        if (isAllocationCompleted(refreshed)) authoritative = { ...completed, ...refreshed, status: "COMPLETED", rows: refreshed.rows.length ? refreshed.rows : completed.rows };
      } catch { /* Completion succeeded; retain the authoritative completion response if refresh is temporarily unavailable. */ }
      setAllocation(authoritative);
      const completedBatchId = pickerQr?.batch_id || "";
      const stockEntryIds = Array.from(new Set([...pickerItems.map((row) => row.stockEntryId), ...(handover?.submittedStockEntryIds || [])].filter(Boolean)));
      const historyEntry: CompletedAllocationHistory = {
        allocationName: authoritative.name, batchId: completedBatchId, completedAt: new Date().toISOString(),
        checker: pickerChecker || handover?.checker || "", picker: employee.full_name, stockEntryIds, allocation: authoritative,
      };
      setAllocationHistory(saveCompletedAllocationHistory(historyEntry));
      saveSuccessfulTransaction(createWarehouseAllocationTransaction({
        allocationName: historyEntry.allocationName,
        completedAt: historyEntry.completedAt,
        rowCount: historyEntry.allocation.rows.length,
        stockEntryCount: historyEntry.stockEntryIds.length,
      }));
      clearActiveWarehouseAllocation(authoritative.name);
      clearCompletedHandoverCache(completedBatchId, authoritative.name, stockEntryIds);
      if (handover && completedBatchId && handover.batchId === completedBatchId) setHandover(null);
      setHandoverQr(""); setPickerQr(null); setPickerItems([]); setPickerTypes([]); setPickerWarehouseMan(""); setPickerChecker("");
      setWarehouse(""); setTransactionType(""); setLocationAction(null); setAllocation(null); setStage("checker-handover-scan");
      setMessage("Warehouse Allocation completed. Scan the next Handover QR for Checker review.");
      notify("success", "Allocation completed. The Warehouse Allocation and linked Stock Entries are submitted.");
    }
    catch (error) {
      if (error instanceof HandoverApiError && error.code === "ALLOCATION_INCOMPLETE") {
        const pending = Array.isArray(error.payload.pending_rows) ? error.payload.pending_rows.map(String).join(", ") : "";
        notify("warning", `${error.message}${pending ? ` Pending rows: ${pending}` : ""}`);
      } else if (error instanceof HandoverApiError) notify("error", `${error.message}${error.code ? ` [${error.code}]` : ""}`);
      else notify("error", error instanceof Error ? error.message : "Could not complete Warehouse Allocation.");
    }
    finally { setBusy(false); }
  };

  const scanning = !pendingCheckerQr && ((stage === "receive" && !pendingDraft) || stage === "checker-handover-scan" || stage === "checker-scan" || stage === "picker-scan" || (stage === "allocation" && locationAction && locationAction.kind !== "quantity" && !locationAction.locationId));
  const workflowDisplay = getManufacturingStepState(stage);
  const heading = workflowDisplay.title;
  const loadingLabel = stage === "receive"
    ? pendingDraft ? "Creating Stock Entry" : "Validating Job Card"
    : stage === "checker-handover-scan" || stage === "checker" || stage === "checker-scan" || stage === "batch"
      ? "Loading Checker Data"
      : stage === "picker-scan" || stage === "handover-qr"
        ? "Loading Handover"
        : stage === "picker-form"
          ? "Creating Warehouse Allocation"
          : stage === "allocation"
            ? locationAction ? "Saving Location" : "Loading Allocation"
            : "Connecting to ERPNext";
  const checkerActivityAvailable = Boolean(handover && (canGenerateHandoverQr(handover) || pendingCheckerItems(handover.drafts, handover.status).length));
  const activePulloutDraftCount = handover?.stockEntriesSubmitted ? 0 : new Set(
    (handover?.drafts || []).filter((row) => row.docstatus === undefined || row.docstatus === 0).map((row) => row.stockEntryId)
  ).size;
  const workflowStep = workflowDisplay.current;
  const isPulloutStage = stage === "receive" || stage === "received";
  // Checker Home opens in batch (existing local drafts) or checker-handover-scan
  // (another device's Handover QR). Both entry stages must use the approved UI.
  const isCheckerStage = stage === "batch" || stage === "checker-handover-scan" ||
    stage === "checker" || stage === "checker-scan";
  const isHandoverQrStage = stage === "handover-qr";
  const isRoleMenuStage = stage === "menu";
  const isPickerStage = stage === "picker-scan" || stage === "picker-form" || stage === "allocation";
  const checkerRows = handover
    ? handover.status === "CHECKED" ? handover.drafts : pendingCheckerItems(handover.drafts, handover.status)
    : [];
  const checkerStockEntryCount = new Set(checkerRows.map((row) => row.stockEntryId).filter(Boolean)).size;
  const checkerSkuCount = new Set(checkerRows.map((row) => row.itemCode.trim().toUpperCase()).filter(Boolean)).size;
  const checkerUoms = new Set(checkerRows.map((row) => row.uom.trim().toUpperCase()).filter(Boolean));
  const checkerUniformUom = checkerRows.length > 0 && checkerUoms.size === 1 && checkerRows.every((row) => Boolean(row.uom.trim()));
  const checkerRecordedUnits = checkerUniformUom
    ? checkerRows.reduce((sum, row) => sum + row.recordedQuantity, 0)
    : null;
  const checkerMismatchCount = checkerRows.filter((row) => row.verifiedQuantity !== row.recordedQuantity).length;
  const checkerCorrectionPending = checkerRows.filter((row) =>
    (row.verifiedQuantity !== row.recordedQuantity && !row.correctionReason.trim()) ||
    !Number.isFinite(row.actualWeightPerItem) || (row.actualWeightPerItem ?? 0) <= 0
  ).length;
  // All figures on this screen come from locally retained ERPNext Draft Stock
  // Entry details. This is NOT an offline submit queue or an item-scan ledger.
  const activePulloutDraftRows = handover?.stockEntriesSubmitted ? [] : (handover?.drafts || []).filter(
    (row) => row.docstatus === undefined || row.docstatus === 0
  );
  const pulloutDraftIds = Array.from(new Set(activePulloutDraftRows.map((row) => row.stockEntryId).filter(Boolean)));
  const pulloutLastSavedRow = activePulloutDraftRows.find((row) => row.stockEntryId === lastDraft) || activePulloutDraftRows[activePulloutDraftRows.length - 1];
  const pulloutCurrentJobCard = pendingDraft?.label.jobCardId || pulloutLastSavedRow?.jobCardId || "";
  const pulloutCurrentWarehouse = pulloutLastSavedRow?.targetWarehouse || "";
  const pulloutItemCount = new Set(activePulloutDraftRows.map((row) => row.itemCode.trim().toLocaleUpperCase()).filter(Boolean)).size;
  const pulloutUoms = Array.from(new Set(activePulloutDraftRows.map((row) => row.uom.trim().toLocaleUpperCase()).filter(Boolean)));
  const pulloutTotalQuantity = activePulloutDraftRows.reduce((sum, row) => sum + (Number(row.recordedQuantity) || 0), 0);
  const pulloutStepIndex = stage === "received" ? 4 : quantityConfirmed ? 3 : pendingDraft ? 2 : 1;
  const allocationVerifiedCount = allocation?.rows.filter((row) => row.status.trim().toLocaleUpperCase() === "VERIFIED").length || 0;
  const allocationRowCount = allocation?.rows.length || 0;
  const allocationReady = allocationIsReadyToComplete(allocation);
  const allocationBalances = allocationItemBalances(allocation);
  const allocationNextRow = allocation?.rows.find((row) => row.status.trim().toUpperCase() !== "VERIFIED");
  const allocationSkuCount = new Set((allocation?.rows || []).map((row) => row.itemCode.trim().toUpperCase()).filter(Boolean)).size;
  const allocationRemainingUoms = new Set(allocationBalances.map((row) => row.uom.trim().toUpperCase()).filter(Boolean));
  const allocationPendingHasUniformUom = allocationBalances.length > 0 &&
    allocationRemainingUoms.size === 1 && allocationBalances.every((row) => Boolean(row.uom.trim()));
  const allocationPendingQty = allocationBalances.reduce((sum, row) => sum + row.remaining, 0);
  const pickerProgressStage = stage === "picker-scan" ? 1 : stage === "picker-form" ? 2 :
    allocation && isAllocationCompleted(allocation) ? 4 : 3;
  let pulloutPreview: ReturnType<typeof calculatePulloutPackage> | null = null;
  let pulloutQuantityError = "";
  if (pendingDraft && receiveQuantity.trim()) {
    try {
      pulloutPreview = calculatePulloutPackage({ qrQuantity: pendingDraft.label.quantity, mode: pulloutMode, input: receiveQuantity });
    } catch (error) {
      pulloutQuantityError = error instanceof PackageQuantityError ? error.message : "Enter a valid Pullout quantity.";
    }
  }

  return <div className={`mfg-page ${isPulloutStage ? "is-pullout-redesign" : ""} ${isCheckerStage || isHandoverQrStage ? "is-checker-redesign" : ""} ${isPickerStage ? "is-picker-redesign" : ""} ${isRoleMenuStage ? "is-role-menu-redesign" : ""} ${isHandoverQrStage ? "is-handover-qr-redesign" : ""}`}>
    {isRoleMenuStage ? (
      <header className="mfg-entry-head">
        <button type="button" className="mfg-entry-back" aria-label="Back to Inventory" onClick={goBack}><ArrowLeft size={22} aria-hidden="true"/></button>
        <span className="mfg-entry-heading"><strong>Receive Finished Goods</strong><small>{employee.full_name} / {deviceName}</small></span>
        <span className="mfg-entry-head-icon"><PackagePlus size={20} aria-hidden="true"/></span>
      </header>
    ) : isPickerStage ? (
      <header className="mfg-picker-head">
        <button type="button" className="mfg-picker-back" onClick={goBack} aria-label="Back to Inventory"><ArrowLeft size={22} aria-hidden="true"/></button>
        <h1>Picker / Warehouse Allocation</h1>
        <span className="mfg-picker-role-pill">Picker</span>
      </header>
    ) : isCheckerStage || isHandoverQrStage ? (
      <header className="mfg-checker-head">
        <button type="button" className="mfg-checker-back" onClick={goBack} aria-label="Back to previous screen"><ArrowLeft size={23} aria-hidden="true"/></button>
        <h1>Checker</h1>
        <span className="mfg-checker-role-pill"><Package size={15} aria-hidden="true"/> Receive FG</span>
      </header>
    ) : isPulloutStage ? (
      <header className="mfg-pullout-head">
        <button type="button" className="mfg-pullout-back" onClick={goBack} aria-label="Back to Inventory"><ArrowLeft size={23} aria-hidden="true"/></button>
        <h1>Pullout / Receive FG</h1>
        <span className="mfg-pullout-mode">{pulloutMode === "FULL" ? "Big Pack" : "Loose Pack"}</span>
      </header>
    ) : <header className="mfg-head"><div><h1>{heading}</h1><p>{employee.full_name} / {deviceName}</p></div></header>}
    <main className="mfg-body" onClick={() => scanning && focusScanner()}>
      <AppToast toast={toast} onClose={() => setToast(null)}/>
      <div className="mfg-scroll">
        {workflowStep > 0 && !isPulloutStage && !isCheckerStage && !isHandoverQrStage && !isPickerStage && <div className="mfg-workflow" aria-label={`Receive Finished Goods step ${workflowStep} of 3`}>
          {["Pullout", "Checker", "Picker"].map((label, index) => <div className={`mfg-workflow-step ${index + 1 < workflowStep ? "is-done" : index + 1 === workflowStep ? "is-active" : ""}`} key={label}>
            <span>{index + 1 < workflowStep ? "✓" : index + 1}</span><strong>{label}</strong>
          </div>)}
        </div>}
        {stage !== "menu" && !isPulloutStage && !isCheckerStage && !isHandoverQrStage && !isPickerStage && message && <div className="mfg-message" role="status" aria-live="polite"><strong>Next:</strong> {message}</div>}
        {stage === "menu" && <section className="mfg-role-home" aria-label="Receive Finished Goods role selection">
          <div className="mfg-role-intro">
            <span className="mfg-role-intro-icon"><PackagePlus size={24} aria-hidden="true"/></span>
            <span><strong>Select your warehouse role</strong>
              <small>Use the role assigned to you for this Finished Goods transaction.</small></span>
          </div>
          <div className="mfg-role-list" aria-label="Receiving roles">
            <button type="button" className="mfg-role-card" disabled={busy} onClick={() => void openOnlineStage("receive", "Scan a packing-label QR containing a Job Card reference.")}>
              <span className="mfg-role-icon"><PackagePlus size={24} aria-hidden="true"/></span>
              <span><strong>Pullout</strong><small>Scan packing-label QR, confirm quantity and create ERPNext Draft Stock Entries.</small></span>
              <ChevronRight className="mfg-role-chevron" size={18} aria-hidden="true"/>
            </button>
            <button type="button" className="mfg-role-card" disabled={busy || !checkerActivityAvailable} onClick={() => void openOnlineStage("batch", "Review the live ERPNext Pullout quantities.")}>
              <span className="mfg-role-icon"><ClipboardCheck size={24} aria-hidden="true"/></span>
              <span><strong>Checker</strong><small>{checkerActivityAvailable
                ? "Review quantities and actual weight, then verify with the assigned Checker QR."
                : "No active Draft Stock Entries require Checker Verification on this device."}</small></span>
              <ChevronRight className="mfg-role-chevron" size={18} aria-hidden="true"/>
            </button>
            <button type="button" className="mfg-role-card" disabled={busy} onClick={() => void openOnlineStage("picker-scan", "Scan the generated Handover QR.")}>
              <span className="mfg-role-icon"><MapPinCheck size={24} aria-hidden="true"/></span>
              <span><strong>Picker</strong><small>Scan an authorized Handover QR and verify allocations to Storage Locations.</small></span>
              <ChevronRight className="mfg-role-chevron" size={18} aria-hidden="true"/>
            </button>
          </div>
          {allocationHistory.length > 0 && (
            <section className="mfg-role-history" aria-label="Completed warehouse allocation history">
              <div className="mfg-role-history-heading"><h2>Completed History</h2><span>{allocationHistory.length} saved</span></div>
              {allocationHistory.map((entry) =>
                <button type="button" className="mfg-history-row" key={entry.allocationName}
                  onClick={() => { setAllocation(entry.allocation); setStage("allocation"); }}>
                  <span className="mfg-role-history-icon"><CheckCircle2 size={19} aria-hidden="true"/></span>
                  <span><strong>{entry.allocationName}</strong><small>{entry.stockEntryIds.length} Stock {entry.stockEntryIds.length === 1 ? "Entry" : "Entries"} · {new Date(entry.completedAt).toLocaleString()}</small></span>
                  <b>Completed</b>
                </button>
              )}
            </section>
          )}
        </section>}
        {isPulloutStage && (
          <section className="mfg-pullout-overview" aria-label="Pullout and finished goods receiving">
            <div className="mfg-pullout-reference-card">
              <span className="mfg-pullout-reference-icon"><Barcode size={22} aria-hidden="true" /></span>
              <strong>{pulloutCurrentJobCard || "Scan Packing Label"}</strong>
              <span className="mfg-pullout-erp-status">{stage === "received" ? "ERP Draft saved" : activePulloutDraftCount > 0 ? `${activePulloutDraftCount} ERP Draft${activePulloutDraftCount === 1 ? "" : "s"}` : "ERP required"}</span>
            </div>
            <div className="mfg-pullout-job-card">
              <span className="mfg-pullout-card-icon"><FileText size={23} aria-hidden="true" /></span>
              <div className="mfg-pullout-job-copy">
                <span className="mfg-pullout-caption">{pulloutCurrentJobCard ? "Current Job Card" : "Next step"}</span>
                <strong>{pulloutCurrentJobCard || "Scan Packing Label QR"}</strong>
                <small>{stage === "received" ? "Draft Stock Entry created in ERPNext" : pendingDraft ? "Validate Pullout quantity and details" : "Scan a packing label containing a Job Card reference"}</small>
              </div>
              <div className="mfg-pullout-job-details">
                <span><MapPinCheck size={15} aria-hidden="true" /> Target Warehouse: <b>{pulloutCurrentWarehouse || "Assigned by ERPNext"}</b></span>
                <span><FileText size={15} aria-hidden="true" /> {stage === "received" && lastDraft ? `Draft: ${lastDraft}` : activePulloutDraftCount > 0 ? "Existing draft entries awaiting Checker" : "Draft Stock Entry created only after confirmation"}</span>
              </div>
            </div>
            <div className="mfg-pullout-progress" aria-label={`Pullout progress step ${pulloutStepIndex} of 4`}>
              <div className="mfg-pullout-section-title"><strong>Receive Progress</strong><span>{pulloutStepIndex}/4</span></div>
              <div className="mfg-pullout-steps">
                {["Packing Label", "Quantity", "Confirm", "Draft"].map((label, index) => (
                  <span className={`mfg-pullout-step ${index + 1 === pulloutStepIndex ? "is-active" : index + 1 < pulloutStepIndex ? "is-done" : ""}`} key={label}>
                    <b>{index + 1 < pulloutStepIndex ? "✓" : index + 1}</b>{label}
                  </span>
                ))}
              </div>
            </div>
            {stage === "receive" && !pendingDraft && (
              <div className="mfg-pullout-scan-ready" aria-live="polite">
                <Barcode size={36} aria-hidden="true" />
                <strong>Ready to Scan Packing Label</strong>
                <span>Scan the finished goods packing-label QR using your scanner</span>
              </div>
            )}
            <div className="mfg-pullout-package-card">
              <span className="mfg-pullout-package-icon"><Package size={20} aria-hidden="true"/></span>
              <span><strong>Package Mode: {pulloutMode === "FULL" ? "BIG PACK" : "LOOSE PACK"}</strong><small>{pulloutMode === "FULL" ? "Use the Big Pack quantity in the confirmation keypad" : "Enter the Loose Pack quantity in the confirmation keypad"}</small></span>
            </div>
            {stage === "received" && (
              <div className="mfg-pullout-draft-success" role="status">
                <CheckCircle2 size={25} aria-hidden="true" />
                <span><strong>{lastDraftExisting ? "Existing ERP draft reused" : "Draft Stock Entry saved in ERPNext"}</strong><small>{lastDraft || "Draft confirmed"} · Checker verification required before submission</small></span>
              </div>
            )}
            {stage === "receive" && !pendingDraft && pulloutLastSavedRow && (
              <div className="mfg-pullout-last-draft">
                <CheckCircle2 size={23} aria-hidden="true" />
                <span><strong>Last Draft Item</strong><b>{pulloutLastSavedRow.itemCode}</b><small>{pulloutLastSavedRow.stockEntryId} · Not submitted</small></span>
                <strong>{pulloutLastSavedRow.recordedQuantity.toLocaleString()} {pulloutLastSavedRow.uom}</strong>
              </div>
            )}
            <div className="mfg-pullout-totals" aria-label="Locally retained ERP draft summary">
              <div><small>Drafts</small><strong>{pulloutDraftIds.length}</strong></div>
              <div><small>SKUs</small><strong>{pulloutItemCount}</strong></div>
              <div><small>Draft Quantity</small><strong>{activePulloutDraftRows.length === 0 ? "—" : pulloutUoms.length === 1 && activePulloutDraftRows.every((row) => Boolean(row.uom.trim())) ? pulloutTotalQuantity.toLocaleString() : "Mixed UOM"}</strong>
                {pulloutUoms.length === 1 && activePulloutDraftRows.every((row) => Boolean(row.uom.trim())) && <small>{pulloutUoms[0]}</small>}
              </div>
            </div>
            <div className="mfg-pullout-draft-list">
              <div className="mfg-pullout-draft-header">
                <strong>Draft Items</strong>
                {activePulloutDraftRows.length > 1 && <button type="button" onClick={() => setShowPulloutDrafts((shown) => !shown)} aria-expanded={showPulloutDrafts}>{showPulloutDrafts ? "Show less" : `View all · ${activePulloutDraftRows.length}`} <ChevronRight size={15} aria-hidden="true"/></button>}
              </div>
              {activePulloutDraftRows.length > 0 ? activePulloutDraftRows.slice(0, showPulloutDrafts ? undefined : 1).map((row, index) => (
                <div className="mfg-pullout-draft-row" key={`${row.stockEntryId}-${row.stockEntryRow}-${index}`}>
                  <span className="mfg-pullout-draft-icon"><Package size={19} aria-hidden="true"/></span>
                  <span className="mfg-pullout-draft-info"><strong>{row.itemCode}</strong><small>{row.stockEntryId} · Draft · Review in Checker</small></span>
                  <strong>{row.recordedQuantity.toLocaleString()} {row.uom}</strong>
                </div>
              )) : <p className="mfg-pullout-empty-draft">No Draft Stock Entries yet. Scan a packing label to begin.</p>}
            </div>
            {stage === "receive" && !pendingDraft && <p className="mfg-pullout-helper" role="status">{message}</p>}
          </section>
        )}
        {/* Batch review now uses the same Checker cards as the QR-loaded review,
            while its quantity editor and QR verification handlers remain distinct. */}
        {stage === "checker-handover-scan" && <div className="mfg-scan-prompt"><QrCode size={48}/><h2>Scan Handover QR</h2><p>Load the authoritative batch before checking its quantities.</p></div>}
        {isCheckerStage && stage !== "checker-handover-scan" && handover && <section className="mfg-checker-overview" aria-label="Checker batch review">
          <div className="mfg-checker-reference-card">
            <span className="mfg-checker-ref-icon"><Barcode size={21} aria-hidden="true"/></span>
            <strong>{handover.batchId}</strong>
            <span className={`mfg-checker-status ${handover.status === "CHECKED" ? "is-checked" : ""}`}>
              {handover.status === "CHECKED" ? "Checked" : "Pending Check"}
            </span>
          </div>
          <div className="mfg-checker-intro-card">
            <span className="mfg-checker-intro-icon"><ClipboardCheck size={29} aria-hidden="true"/></span>
            <div><h2>{stage === "checker" || stage === "batch" ? "Review Pullout Batch" : "Scan Checker Verification"}</h2>
              <p>{stage === "checker" || stage === "batch"
                ? "Verify quantities, actual weight and corrections before scanning the Checker QR."
                : "Scan the assigned Checker QR from ERPNext to authorize this batch."}</p>
              <small>Warehouse Man: {handover.warehouseMan || "Not supplied"}</small>
            </div>
          </div>
          <div className="mfg-checker-stats" aria-label="Checker draft batch summary">
            <div><Barcode size={18} aria-hidden="true"/><span>Drafts</span><strong>{checkerStockEntryCount}</strong></div>
            <div><Package size={18} aria-hidden="true"/><span>SKUs</span><strong>{checkerSkuCount}</strong></div>
            <div><ClipboardCheck size={18} aria-hidden="true"/><span>Total Units</span>
              <strong>{checkerRows.length === 0 ? "—" : checkerRecordedUnits === null ? "Mixed UOM" : checkerRecordedUnits.toLocaleString()}</strong>
              {checkerUniformUom && <small>{checkerRows[0].uom}</small>}
            </div>
          </div>
          <div className="mfg-checker-progress">
            <strong>Checker Progress</strong>
            <div className="mfg-checker-steps" aria-label={`Checker step ${stage === "checker" || stage === "batch" ? 1 : 2} of 3`}>
              {["Review Items", "Scan Checker QR", "Handover QR"].map((label, index) => (
                <span className={`mfg-checker-step ${index === (stage === "checker" || stage === "batch" ? 0 : 1) ? "is-active" : index < (stage === "checker" || stage === "batch" ? 0 : 1) ? "is-done" : ""}`} key={label}>
                  <b>{index < (stage === "checker" || stage === "batch" ? 0 : 1) ? "✓" : index + 1}</b>{label}
                </span>
              ))}
            </div>
          </div>
          {(stage === "checker" || stage === "batch") && <>
            <div className="mfg-checker-items-heading">
              <div><h3>Items for verification</h3><small>{checkerRows.length} draft item${checkerRows.length === 1 ? "" : "s"} · {checkerMismatchCount} quantity adjustment${checkerMismatchCount === 1 ? "" : "s"}</small></div>
              {checkerRows.length > 3 && <button type="button" aria-expanded={showAllCheckerItems} onClick={() => setShowAllCheckerItems((current) => !current)}>
                {showAllCheckerItems ? "Show fewer" : `View all (${checkerRows.length})`} <ChevronRight size={15} aria-hidden="true"/>
              </button>}
            </div>
            {checkerRows.length > 3 && !showAllCheckerItems && <div className="mfg-checker-list-hint">Showing first 3 items. Select View all to review the entire batch.</div>}
            {checkerRows.slice(0, showAllCheckerItems ? undefined : 3).map((row, index) => {
              const hasDifference = row.verifiedQuantity !== row.recordedQuantity;
              const missingReason = hasDifference && !row.correctionReason.trim();
              const missingWeight = !Number.isFinite(row.actualWeightPerItem) || (row.actualWeightPerItem ?? 0) <= 0;
              const statusText = handover.status === "CHECKED" ? "Verified" : missingReason ? "Needs reason" : missingWeight ? "Needs weight" : hasDifference ? "Adjusted" : "No changes";
              return <article className="mfg-checker-item" key={`${row.stockEntryId}-${row.stockEntryRow}-${index}`}>
                <div className="mfg-checker-item-head"><strong>{row.itemCode}</strong>
                  <span className={`mfg-checker-row-status ${handover.status === "CHECKED" ? "is-verified" : missingReason || missingWeight ? "is-warning" : "is-neutral"}`}>
                    {missingReason || missingWeight ? "!" : handover.status === "CHECKED" ? "✓" : "•"} {statusText}
                  </span>
                </div>
                <div className="mfg-checker-item-name">{row.itemName || "Finished Goods item"}</div>
                <div className="mfg-checker-item-meta">
                  <span>Stock Entry: <b>{row.stockEntryId}</b></span>
                  <span>Job Card: <b>{row.jobCardId || "—"}</b></span>
                  <span>Work Order: <b>{row.workOrderId || "—"}</b></span>
                  <span>Pull Out Slip: <b>{row.pullOutSlip || "—"}</b></span>
                </div>
                <div className="mfg-checker-item-values">
                  <div className="mfg-checker-value"><span>Recorded Qty</span><strong>{row.recordedQuantity.toLocaleString()} <small>{row.uom}</small></strong></div>
                  <div className="mfg-checker-value"><span>Verified Qty</span>
                    <button type="button" className="mfg-checker-edit-value" disabled={busy || handover.status === "CHECKED"}
                      aria-label={`Edit verified quantity for ${row.itemCode}`}
                      onClick={() => { const draftIndex = handover.drafts.indexOf(row); setCheckerEditKind("quantity"); setCheckerEdit(draftIndex); setCheckerQuantity(String(stage === "batch" ? row.quantityMultiplier ?? 1 : row.verifiedQuantity)); }}>
                      {row.verifiedQuantity.toLocaleString()} <small>{row.uom}</small>
                    </button>
                  </div>
                  <div className="mfg-checker-value"><span>Actual Weight</span>
                    <button type="button" className="mfg-checker-edit-value" disabled={busy || handover.status === "CHECKED"}
                      aria-label={`Edit actual weight for ${row.itemCode}`}
                      onClick={() => { const draftIndex = handover.drafts.indexOf(row); setCheckerEditKind("weight"); setCheckerEdit(draftIndex); setCheckerQuantity(String(row.actualWeightPerItem || "")); }}>
                      {row.actualWeightPerItem ? row.actualWeightPerItem.toLocaleString() : "Set weight"} <small>per item</small>
                    </button>
                  </div>
                </div>
                {hasDifference && <label className="mfg-checker-reason">Correction reason
                  <input value={row.correctionReason} disabled={busy || stage === "batch" || handover.status === "CHECKED"}
                    aria-label={`Correction reason for ${row.itemCode}`}
                    onChange={(event) => persist({ ...handover, drafts: handover.drafts.map((item) => item === row ? { ...item, correctionReason: event.target.value } : item) })}
                    placeholder="Required when quantity differs"/>
                </label>}
              </article>;
            })}
            <div className="mfg-checker-source-note">
              <ClipboardCheck size={20} aria-hidden="true"/>
              <div><strong>ERPNext Draft Stock Entries remain the source documents.</strong>
                <span>{checkerCorrectionPending > 0
                  ? `${checkerCorrectionPending} item${checkerCorrectionPending === 1 ? " needs" : "s need"} correction details before verification.`
                  : stage === "batch"
                    ? "Quantity and weight edits are saved to ERPNext individually. Choose Verify Checker to scan the assigned QR."
                    : "Save your review before scanning the assigned Checker QR."}</span>
              </div>
            </div>
            {handover.checker && <div className="mfg-location">Checked by {handover.checker}</div>}
          </>}
        </section>}
        {stage === "checker-scan" && <div className="mfg-scan-prompt"><ClipboardCheck size={48}/><h2>Scan Checker Verification</h2><p>The assigned Checker must scan the QR from their Assign Checker record.</p></div>}
        {stage === "handover-qr" && handoverQr && <section className="mfg-checker-handover" aria-label="Authorized Picker handover QR">
          <div className="mfg-checker-handover-progress" aria-label="Finished Goods handover progress">
            {["Pullout", "Checker", "Picker"].map((label, index) =>
              <div className={`mfg-checker-handover-step ${index < 2 ? "is-done" : "is-upcoming"}`} key={label}>
                <span>{index < 2 ? <Check size={18} aria-hidden="true"/> : index + 1}</span>
                <strong>{label}</strong>
              </div>
            )}
          </div>
          <div className="mfg-checker-handover-next" role="status">
            <CheckCircle2 size={19} aria-hidden="true"/>
            <span>Checker verified. Share this QR with the assigned Picker.</span>
          </div>
          <div className="mfg-qr-card mfg-checker-handover-card">
            <div className="mfg-checker-handover-card-title"><span className="mfg-checker-handover-card-icon"><QrCode size={21} aria-hidden="true"/></span>
              <span><h2>Handover QR</h2><small>Backend-issued QR · Ready for Picker</small></span>
              <span className="mfg-checker-handover-verified"><CheckCircle2 size={15} aria-hidden="true"/> Verified</span>
            </div>
            <p>The Picker scans this backend-issued QR to continue with Warehouse Allocation. It is available only after authorized Checker Verification.</p>
            <div className="mfg-checker-handover-code" aria-label="QR code for Picker to scan">
              <QRCodeSVG value={handoverQr} size={230} level="M" marginSize={2}/>
            </div>
            <dl className="mfg-checker-handover-details">
              <div><dt>Handover Batch</dt><dd>{handover?.batchId || "—"}</dd></div>
              <div><dt>Verified by</dt><dd>{handover?.checker || "Authorized Checker"}</dd></div>
              <div><dt>Expires</dt><dd>{handover?.expiresAt ? new Date(handover.expiresAt).toLocaleString() : "Backend did not provide expiration"}</dd></div>
            </dl>
          </div>
        </section>}
        {isPickerStage && <section className="mfg-picker-overview" aria-label="Picker workflow overview">
          <div className="mfg-picker-reference-card">
            <span className="mfg-picker-reference-icon"><Barcode size={22} aria-hidden="true"/></span>
            <strong>{allocation?.name || pickerQr?.batch_id || "Scan Handover QR"}</strong>
            <span className={`mfg-picker-state ${allocation && isAllocationCompleted(allocation) ? "is-completed" : ""}`}>
              {allocation && isAllocationCompleted(allocation) ? "Completed"
                : stage === "allocation" ? "Allocation in progress"
                : stage === "picker-form" ? "Ready to create" : "Awaiting handover"}
            </span>
          </div>
          {stage === "allocation" && allocation && <div className="mfg-picker-next-location">
            <span className="mfg-picker-location-icon"><MapPinCheck size={24} aria-hidden="true"/></span>
            <span><small>{allocationNextRow ? "Next suggested location" : "Location verification"}</small>
              <strong>{allocationNextRow?.suggestedLocation || (allocationNextRow ? "Check the location on this row" : "All rows verified")}</strong>
              <small>{allocationNextRow
                ? locationAction && locationAction.kind !== "quantity"
                  ? "Scan the actual Storage Location QR to verify placement"
                  : "Tap Verify Next Location, then scan the actual Storage Location QR"
                : "Review all quantities before submitting"}</small>
            </span>
          </div>}
          {stage === "picker-form" && <div className="mfg-picker-next-location">
            <span className="mfg-picker-location-icon"><FileText size={23} aria-hidden="true"/></span>
            <span><small>Verified handover received</small>
              <strong>Review transaction details</strong>
              <small>Choose transaction type and confirm target warehouse before creating the allocation.</small>
            </span>
          </div>}
          <div className="mfg-picker-steps-panel">
            <div className="mfg-picker-section-heading"><strong>Allocation Progress</strong><span>Step {pickerProgressStage} of 4</span></div>
            <div className="mfg-picker-steps" aria-label={`Picker progress step ${pickerProgressStage} of 4`}>
              {["Scan Handover QR", "Review Details", "Verify Locations", "Submit"].map((label, index) => (
                <span className={`mfg-picker-step ${index + 1 < pickerProgressStage ? "is-done" : index + 1 === pickerProgressStage ? "is-active" : ""}`} key={label}>
                  <b>{index + 1 < pickerProgressStage ? "✓" : index + 1}</b>{label}
                </span>
              ))}
            </div>
          </div>
          {(stage === "picker-scan" || stage === "allocation" && locationAction && locationAction.kind !== "quantity" && !locationAction.locationId) && (
            <div className="mfg-picker-scan-ready" aria-live="polite">
              <QrCode size={34} aria-hidden="true"/>
              <strong>{stage === "picker-scan" ? "Ready to Scan Handover QR" : "Ready to Scan Location"}</strong>
              <span>{stage === "picker-scan"
                ? "Scan the QR generated by the authorized Checker."
                : "Scan the actual Storage Location QR to confirm item placement."}</span>
            </div>
          )}
        </section>}
        {stage === "picker-form" && <form className="mfg-picker-form mfg-picker-form-redesign" onSubmit={createAllocation}>
          <div className="mfg-kicker">Create draft allocation</div><div className="mfg-title">Transaction Details</div>
          <div className="mfg-copy">Warehouse Man: {pickerWarehouseMan || "—"} · Checker: {pickerChecker || "—"}</div>
          {pickerItems.map((row) => <article className="mfg-job" key={`${row.stockEntryId}-${row.stockEntryRow}`}>
            <div className="mfg-job-main"><div><span>Item</span><strong>{row.itemCode}</strong></div><div className="mfg-job-quantity"><span>Quantity</span><strong>{row.verifiedQuantity.toLocaleString()} {row.uom}</strong></div></div>
            {row.itemName && <div className="mfg-job-name">{row.itemName}</div>}
            <div className="mfg-job-reference"><span>Stock Entry</span><strong>{row.stockEntryId}</strong></div>
          </article>)}
          <label>Transaction Type<div className={`mfg-inline-select ${pickerDropdown === "transaction" ? "is-open" : ""}`}>
            <button type="button" className="mfg-inline-select-trigger" aria-haspopup="listbox" aria-expanded={pickerDropdown === "transaction"} onClick={() => setPickerDropdown((open) => open === "transaction" ? null : "transaction")}>
              <span>{transactionType || "Select transaction type"}</span><ChevronDown size={16}/>
            </button>
            {pickerDropdown === "transaction" && <div className="mfg-inline-select-menu" role="listbox" aria-label="Transaction Type">
              {pickerTypes.map((value) => <button type="button" role="option" aria-selected={value === transactionType} className={value === transactionType ? "is-selected" : ""} key={value} onClick={() => { setTransactionType(value); setPickerDropdown(null); }}><span>{value}</span>{value === transactionType && <Check size={15}/>}</button>)}
            </div>}
          </div></label>
          <label>Warehouse<div className="mfg-picker-warehouse-readonly"><MapPinCheck size={18} aria-hidden="true"/><strong>{warehouse}</strong><small>From Job Card target warehouse</small></div></label>
          <label>Date<button type="button" className="mfg-date-time-trigger" onClick={openDatePicker}>{new Date(`${postingDate}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}<ChevronDown size={16}/></button></label>
          <label>Time<button type="button" className="mfg-date-time-trigger" onClick={openTimePicker}>{new Date(`2000-01-01T${postingTime || "00:00:00"}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}<ChevronDown size={16}/></button></label>
          <button className="mfg-primary" disabled={busy || !transactionType || !warehouse}>{busy ? "Creating..." : "Create Warehouse Allocation"}</button>
        </form>}
        {stage === "allocation" && allocation && <section className="mfg-picker-allocation" aria-label="Warehouse allocation rows">
          <div className="mfg-picker-progress-summary">
            <div className="mfg-picker-section-heading">
              <strong>Storage Location Verification</strong><span>{allocationVerifiedCount}/{allocationRowCount} Verified</span>
            </div>
            <div className="mfg-picker-progress-track" role="progressbar" aria-label="Verified allocation rows"
              aria-valuenow={allocationVerifiedCount} aria-valuemin={0} aria-valuemax={allocationRowCount}>
              <span style={{ width: `${allocationRowCount ? Math.round((allocationVerifiedCount / allocationRowCount) * 100) : 0}%` }}/>
            </div>
          </div>
          <div className="mfg-picker-totals" aria-label="Allocation summary">
            <div><Barcode size={19} aria-hidden="true"/><span>Rows</span><strong>{allocationRowCount}</strong></div>
            <div><Package size={19} aria-hidden="true"/><span>SKUs</span><strong>{allocationSkuCount}</strong></div>
            <div><MapPinCheck size={19} aria-hidden="true"/><span>Pending Qty</span>
              <strong>{allocationBalances.length === 0 ? "—" : allocationPendingHasUniformUom ? allocationPendingQty.toLocaleString() : "Mixed UOM"}</strong>
              {allocationPendingHasUniformUom && <small>{allocationBalances[0].uom}</small>}
            </div>
          </div>
          <div className="mfg-picker-balances">
            <button type="button" className="mfg-picker-balances-toggle"
              onClick={() => setShowAllocationBalances((shown) => !shown)} aria-expanded={showAllocationBalances}>
              <span>Item balances &amp; required quantities</span><span>{showAllocationBalances ? "Hide" : `View ${allocationBalances.length}`} <ChevronDown size={15} aria-hidden="true"/></span>
            </button>
            {showAllocationBalances && <div className="mfg-allocation-balances">
              {allocationBalances.map((balance) => <div key={`${balance.sourceDocument}-${balance.sourceRow}-${balance.itemCode}-${balance.uom}`}>
                <strong>{balance.itemCode}</strong>{balance.sourceDocument && <span>{balance.sourceDocument}</span>}
                <span>Required: {balance.required.toLocaleString()} {balance.uom}</span>
                <span>Allocated: {balance.allocated.toLocaleString()} {balance.uom}</span>
                <b className={balance.remaining > 0 || balance.overAllocated > 0 ? "is-warning" : ""}>
                  {balance.overAllocated > 0 ? `Over allocated: ${balance.overAllocated.toLocaleString()}` : `Remaining: ${balance.remaining.toLocaleString()}`} {balance.uom}
                </b>
              </div>)}
            </div>}
          </div>
          <div className="mfg-picker-rows-section">
            <div className="mfg-picker-section-heading">
              <strong>Allocation Rows</strong>
              {allocation.rows.length > 3 && <button type="button" onClick={() => setShowAllAllocationRows((shown) => !shown)}
                aria-expanded={showAllAllocationRows}>
                {showAllAllocationRows ? "Show fewer" : `View all · ${allocationRowCount}`} <ChevronRight size={16} aria-hidden="true"/>
              </button>}
            </div>
            {allocation.rows.length > 3 && !showAllAllocationRows &&
              <p className="mfg-picker-list-hint">Showing the first 3 rows. View all to access the remaining allocation rows.</p>}
            {allocation.rows.slice(0, showAllAllocationRows ? undefined : 3).map((row, index) => {
              const verified = row.status.trim().toUpperCase() === "VERIFIED";
              return <article className={`mfg-picker-allocation-row ${verified ? "is-verified" : ""}`} key={row.allocationId}>
                <div className="mfg-picker-allocation-row-head">
                  <span className="mfg-picker-row-icon"><Package size={20} aria-hidden="true"/></span>
                  <div><strong>{row.itemCode}</strong><small>{row.itemName || `Allocation row ${index + 1}`}</small></div>
                  <span className={`mfg-picker-row-status ${verified ? "is-verified" : ""}`}>
                    {verified ? <CheckCircle2 size={14} aria-hidden="true"/> : <QrCode size={14} aria-hidden="true"/>}
                    {row.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="mfg-picker-row-values">
                  <span>Original Qty: <b>{row.originalQuantity.toLocaleString()} {row.uom}</b></span>
                  <span>Allocated: <b>{row.allocatedQuantity.toLocaleString()} {row.uom}</b></span>
                </div>
                <div className="mfg-picker-row-locations">
                  <span><MapPinCheck size={15} aria-hidden="true"/> Suggested: <b>{row.suggestedLocation || "Not provided"}</b></span>
                  <span>Actual: <b>{row.actualLocation || "Scan Storage Location QR"}</b></span>
                </div>
                {!isAllocationCompleted(allocation) && <button type="button" className="mfg-picker-row-verify"
                  disabled={busy} onClick={() => void openLocationAction("verify", row)}>
                  <MapPinCheck size={16} aria-hidden="true"/>{verified ? "Review / Reverify Location" : "Verify Location"}
                </button>}
              </article>;
            })}
          </div>
          {isAllocationCompleted(allocation) && <div className="mfg-picker-completed-message">
            <CheckCircle2 size={22} aria-hidden="true"/> Allocation completed. Warehouse Allocation and linked Stock Entries submitted.
          </div>}
          {!isAllocationCompleted(allocation) && !allocationReady && !allocationNextRow && <p className="mfg-picker-unfinished-notice">
            Some required quantities remain unallocated or exceed the required amount. Review item balances before completing.
          </p>}
        </section>}      </div>

      {scanning && <input ref={inputRef} className="mfg-input mfg-scanner-capture" readOnly inputMode="none" onKeyDown={handleKey} onBlur={focusScanner} aria-label="Scanner input"/>}
      <div className="mfg-dock">
        {stage === "received" && <div className="mfg-dock-grid"><button className="mfg-secondary" onClick={resetReceive}><PackagePlus size={16}/> Add Another</button><button className="mfg-secondary" onClick={() => setStage("batch")}><ClipboardCheck size={16}/> Go to Checker</button></div>}
        {(stage === "batch" || stage === "checker") && canGenerateHandoverQr(handover) && <>
          <button className="mfg-primary" disabled={busy} onClick={() => void proceedToWarehouseAllocation()}><MapPinCheck size={16}/> Proceed to Warehouse Allocation</button>
          <button className="mfg-secondary" disabled={busy} onClick={() => void showHandoverQr()}><QrCode size={16}/> Generate Handover QR for Another Device</button>
        </>}
        {stage === "batch" && !canGenerateHandoverQr(handover) && pendingCheckerItems(handover?.drafts || [], handover?.status).length > 0 &&
          <div className="mfg-checker-dock-actions">
            <button type="button" className="mfg-secondary" disabled={busy} onClick={goBack}><ArrowLeft size={16}/> Back</button>
            <button type="button" className="mfg-primary" disabled={busy} onClick={() => void startBatchCheckerVerification()}><ClipboardCheck size={16}/> Verify Checker QR</button>
          </div>}
        {stage === "checker" && handover?.status !== "CHECKED" && <div className="mfg-checker-dock-actions">
          <button type="button" className="mfg-secondary" disabled={busy} onClick={() => setStage("batch")}><ClipboardCheck size={16}/> Back to Batch</button>
          <button type="button" className="mfg-primary" disabled={busy} onClick={() => void saveCheckerRows()}><QrCode size={16}/> Save & Scan Checker QR</button>
        </div>}
        {stage === "checker-scan" && handover?.status !== "CHECKED" && <button type="button" className="mfg-secondary mfg-checker-review-return" disabled={busy} onClick={() => setStage("checker")}><ArrowLeft size={16}/> Back to Review</button>}
        {stage === "handover-qr" && <><button className="mfg-secondary" onClick={() => setStage("picker-scan")}><QrCode size={16}/> Go to Picker</button><button className="mfg-secondary" onClick={() => setStage("menu")}><Factory size={16}/> Return to Roles</button></>}
        {stage === "allocation" && allocation && !isAllocationCompleted(allocation) &&
          <div className="mfg-picker-footer-actions">
            <button type="button" className="mfg-secondary"
              onClick={() => setShowAllAllocationRows((shown) => !shown)}>
              <FileText size={16} aria-hidden="true"/>{showAllAllocationRows ? "Show Fewer Rows" : "View Allocation Rows"}
            </button>
            {allocationReady
              ? <button type="button" className="mfg-primary" disabled={busy || !allocationIsReadyToComplete(allocation)}
                  onClick={() => void finishAllocation()}><CheckCircle2 size={17} aria-hidden="true"/> Complete Allocation</button>
              : allocationNextRow
                ? <button type="button" className="mfg-primary" disabled={busy}
                    onClick={() => void openLocationAction("verify", allocationNextRow)}>
                    <MapPinCheck size={17} aria-hidden="true"/> Verify Next Location
                  </button>
                : <button type="button" className="mfg-primary" disabled title="Review the remaining or overallocated item balances before completion.">
                    <CheckCircle2 size={17} aria-hidden="true"/> Complete Allocation
                  </button>}
          </div>}
      </div>
    </main>

    {pendingDraft && !quantityConfirmed && <div className="mfg-qty-bg">
      <form className="mfg-qty-modal" role="dialog" aria-modal="true" aria-labelledby="mfg-quantity-dialog-title" onSubmit={(event) => {
        event.preventDefault();
        if (!pulloutPreview || pulloutQuantityError) { notify("warning", pulloutQuantityError || "Enter a valid Pullout quantity."); return; }
        setQuantityConfirmed(true); setMessage("Quantity entered. Review the Pullout details.");
      }}>
        <h2 id="mfg-quantity-dialog-title">Enter Pullout Quantity</h2>
        <p className="mfg-qty-sub">Enter the quantity using the package mode selected from Mode.</p>
        <div className="mfg-qty-item"><strong>{pendingDraft.label.itemCode}</strong><span className="mfg-qty-item-description">{pendingDraftItemName || handover?.drafts.find((row) => same(row.itemCode, pendingDraft.label.itemCode))?.itemName || "Item description unavailable"}</span><span>QR quantity: {pendingDraft.label.quantity.toFixed(2)} {pendingDraft.label.uom} · Job Card {pendingDraft.label.jobCardId}</span></div>
        <label className="mfg-qty-label" htmlFor="mfg-receive-quantity">{pulloutMode === "FULL" ? "Big Pack Count" : "Loose Pack Quantity"}</label>
        <div id="mfg-receive-quantity" className="mfg-qty-input mfg-calculator-field" role="textbox" aria-label="Entered quantity"><CalculatorReadout value={receiveQuantity}/></div>
        <QuantityKeypad value={receiveQuantity} onChange={setReceiveQuantity}/>
        <button type="button" className="mfg-qty-key mfg-qty-key-muted mfg-qty-clear" onClick={() => setReceiveQuantity("")}>Clear</button>
        {pulloutMode === "PARTIAL" ? <div className="mfg-package-summary">
          <span>QR Quantity<strong>{pendingDraft.label.quantity.toFixed(2)} {pendingDraft.label.uom}</strong></span>
          <span>Pullout Quantity<strong>{(pulloutPreview?.pulloutQuantity || 0).toFixed(2)} {pendingDraft.label.uom}</strong></span>
          <span>Remaining Package Quantity<strong>{(pulloutPreview?.remainingQuantity ?? pendingDraft.label.quantity).toFixed(2)} {pendingDraft.label.uom}</strong></span>
          <span>Status after Pullout<strong>{pulloutPreview?.packageStatus === "OPENED" ? "Loose Pack" : "Big Pack"}</strong></span>
        </div> : <div className="mfg-qty-total"><span>Stock Entry quantity</span><strong>{(pulloutPreview?.quantity || 0).toFixed(2)} {pendingDraft.label.uom}</strong></div>}
        {pulloutQuantityError && <div className="mfg-qty-error">{pulloutQuantityError}</div>}
        <div className="mfg-qty-actions"><button type="button" onClick={() => { setPendingDraft(null); resetPulloutMode(); draftRequestIdRef.current = ""; draftRequestSignatureRef.current = ""; focusScanner(); }}>Cancel</button><button type="submit" disabled={busy || !pulloutPreview || Boolean(pulloutQuantityError)}>Review</button></div>
      </form>
    </div>}
    {pendingDraft && quantityConfirmed && pulloutPreview && <div className="mfg-confirm-bg">
      <form className="mfg-confirm mfg-pullout-confirm" onSubmit={createDraft}>
        <h2>Confirm Pullout</h2>
        <div className="mfg-package-summary is-confirmation">
          <span>Item<strong>{pendingDraft.label.itemCode}</strong></span>
          <span>Job Card<strong>{pendingDraft.label.jobCardId}</strong></span>
          <span>Original QR Quantity<strong>{pendingDraft.label.quantity.toFixed(2)} {pendingDraft.label.uom}</strong></span>
          {"packageCount" in pulloutPreview && <span>Big Pack Count<strong>{pulloutPreview.packageCount}</strong></span>}
          <span>Stock Entry Quantity<strong>{pulloutPreview.quantity.toFixed(2)} {pendingDraft.label.uom}</strong></span>
          {pulloutMode === "PARTIAL" && <>
            <span>Remaining Package Quantity<strong>{pulloutPreview.remainingQuantity.toFixed(2)} {pendingDraft.label.uom}</strong></span>
            <span>Package Status<strong>{pulloutPreview.packageStatus === "OPENED" ? "Loose Pack" : "Big Pack"}</strong></span>
          </>}
        </div>
        <label className="mfg-pull-label">Pull Out Slip</label>
        <input className="mfg-pull-input" value={pullOutSlip} onChange={(e) => setPullOutSlip(e.target.value)} disabled={busy} autoFocus required/>
        <label className="mfg-pull-label">Actual Weight per Item</label>
        <input className="mfg-pull-input" type="text" inputMode="decimal" value={actualWeight} onChange={(e) => setActualWeight(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" disabled={busy} required/>
        <div className="mfg-confirm-actions"><button type="button" disabled={busy} onClick={() => { setQuantityConfirmed(false); setPullOutSlip(""); setActualWeight(""); focusScanner(); }}>Back</button><button disabled={busy || !pullOutSlip.trim() || !actualWeight.trim()}>{busy ? "Creating..." : "Create Draft"}</button></div>
      </form>
    </div>}
    {pendingCheckerQr && <div className="mfg-confirm-bg"><div className="mfg-confirm"><h2>Confirm Checker &amp; Submit Pullout</h2><p>Confirm the Checker Verification and submit every Draft Pullout Stock Entry linked to this Handover Batch. This will post the Stock Entries in ERPNext.</p><div className="mfg-confirm-actions"><button type="button" disabled={busy} onClick={() => { setPendingCheckerQr(""); focusScanner(); }}>Cancel</button><button type="button" disabled={busy} onClick={() => void submitCheckerVerification()}>Confirm</button></div></div></div>}
    {checkerEdit !== null && handover && <div className="mfg-confirm-bg"><div className="mfg-confirm"><h2>{checkerEditKind === "weight" ? "Edit Actual Weight" : stage === "batch" ? "Edit Batch Quantity" : "Correct Physical Quantity"}</h2><p>{handover.drafts[checkerEdit]?.itemCode} · {handover.drafts[checkerEdit]?.itemName || "Item description unavailable"} · {handover.drafts[checkerEdit]?.stockEntryId}</p><label className="mfg-pull-label">{checkerEditKind === "weight" ? "Actual Weight per Item" : stage === "batch" ? "Quantity multiplier" : "Verified Quantity"}</label><div className="mfg-qty-input mfg-calculator-field"><CalculatorReadout value={checkerQuantity}/></div>{checkerEditKind === "quantity" && stage === "batch" && getHandoverUnitQuantity(handover.drafts[checkerEdit]) > 0 && <div className="mfg-qty-item"><span>QR unit quantity: {getHandoverUnitQuantity(handover.drafts[checkerEdit]).toLocaleString()} {handover.drafts[checkerEdit].uom}</span><span>Total Draft quantity: {(getHandoverUnitQuantity(handover.drafts[checkerEdit]) * (Number(checkerQuantity) || 0)).toLocaleString()} {handover.drafts[checkerEdit].uom}</span></div>}<QuantityKeypad value={checkerQuantity} onChange={setCheckerQuantity}/><div className="mfg-confirm-actions"><button onClick={() => setCheckerEdit(null)}>Cancel</button><button disabled={busy} onClick={() => {
      if (checkerEditKind === "weight") { void saveBatchActualWeight(); return; }
      if (stage === "batch") { void saveBatchQuantity(); return; }
      const quantity = Number(checkerQuantity || 0);
      if (!Number.isFinite(quantity) || quantity < 0) { notify("warning", "Enter a valid quantity."); return; }
      persist({ ...handover, drafts: handover.drafts.map((item, index) => index === checkerEdit ? { ...item, verifiedQuantity: quantity } : item) });
      setCheckerEdit(null);
    }}>Confirm</button></div></div></div>}
    {locationAction && <div className="mfg-confirm-bg"><div className="mfg-confirm"><h2>{locationAction.kind === "verify" ? "Verify Placement" : locationAction.kind === "change" ? "Change Location" : "Adjust Quantity"}</h2><p>{locationAction.row.itemCode} · {locationAction.row.itemName || "Item description unavailable"} · Suggested: {locationAction.row.suggestedLocation}</p>{locationAction.kind !== "quantity" && <div className="mfg-location">{locationAction.locationId ? <><strong>Scanned: {locationAction.locationCode || locationAction.locationId}</strong>{Number(locationAction.storageCapacity) > 0 && <small>Location capacity: {Number(locationAction.storageCapacity).toLocaleString()} {locationAction.row.uom}</small>}</> : "Scan the Storage Location QR now."}</div>}<label className="mfg-pull-label">Actual Quantity</label><div className="mfg-qty-input mfg-calculator-field"><CalculatorReadout value={actionQuantity}/></div><QuantityKeypad value={actionQuantity} onChange={setActionQuantity}/>{locationAction.kind !== "verify" && <><label className="mfg-pull-label">Reason</label><input className="mfg-pull-input" value={actionReason} onChange={(e) => setActionReason(e.target.value)}/></>}<div className="mfg-confirm-actions"><button onClick={() => setLocationAction(null)}>Cancel</button><button disabled={busy || (locationAction.kind !== "quantity" && !locationAction.locationId)} onClick={() => void runLocationAction()}>{busy ? "Saving..." : "Confirm"}</button></div></div></div>}
    {dateTimePicker && <div className="mfg-wheel-bg"><div className="mfg-wheel-dialog" role="dialog" aria-modal="true" aria-label={dateTimePicker === "date" ? "Set date" : "Set time"}>
      <h2>{dateTimePicker === "date" ? "Set Date" : "Set Time"}</h2>
      {dateTimePicker === "date" ? <div className="mfg-wheel-grid is-date">
        <WheelColumn label="Month" values={Array.from({ length: 12 }, (_, index) => new Date(2000, index, 1).toLocaleString(undefined, { month: "short" }))} value={new Date(2000, pickerDate.month - 1, 1).toLocaleString(undefined, { month: "short" })} onChange={(month) => updatePickerDate({ month: Array.from({ length: 12 }, (_, index) => new Date(2000, index, 1).toLocaleString(undefined, { month: "short" })).indexOf(month) + 1 })}/>
        <WheelColumn label="Day" values={Array.from({ length: new Date(pickerDate.year, pickerDate.month, 0).getDate() }, (_, index) => String(index + 1))} value={String(pickerDate.day)} onChange={(day) => updatePickerDate({ day: Number(day) })}/>
        <WheelColumn label="Year" values={Array.from({ length: 11 }, (_, index) => String(new Date().getFullYear() - 5 + index))} value={String(pickerDate.year)} onChange={(year) => updatePickerDate({ year: Number(year) })}/>
      </div> : <div className="mfg-wheel-grid is-time">
        <WheelColumn label="Hour" values={Array.from({ length: 12 }, (_, index) => String(index + 1))} value={String(pickerTime.hour)} onChange={(hour) => setPickerTime((current) => ({ ...current, hour: Number(hour) }))}/>
        <WheelColumn label="Minute" values={Array.from({ length: 60 }, (_, index) => pad2(index))} value={pad2(pickerTime.minute)} onChange={(minute) => setPickerTime((current) => ({ ...current, minute: Number(minute) }))}/>
        <WheelColumn label="AM or PM" values={["AM", "PM"]} value={pickerTime.period} onChange={(period) => setPickerTime((current) => ({ ...current, period }))}/>
      </div>}
      <div className="mfg-wheel-actions"><button type="button" onClick={() => setDateTimePicker(null)}>Cancel</button><button type="button" onClick={() => {
        if (dateTimePicker === "date") setPostingDate(`${pickerDate.year}-${pad2(pickerDate.month)}-${pad2(pickerDate.day)}`);
        else { const hour24 = pickerTime.hour % 12 + (pickerTime.period === "PM" ? 12 : 0); setPostingTime(`${pad2(hour24)}:${pad2(pickerTime.minute)}:00`); }
        setDateTimePicker(null);
      }}>Set</button></div>
    </div></div>}
    {busy && <div className="mfg-loading-overlay" role="status" aria-live="assertive" aria-label={loadingLabel}>
      <div className="mfg-loading-card"><span className="mfg-loading-spinner" aria-hidden="true"/><strong>{loadingLabel}</strong><small>Please wait for ERPNext.</small></div>
    </div>}
  </div>;
};

export default ManufacturingScanner;
