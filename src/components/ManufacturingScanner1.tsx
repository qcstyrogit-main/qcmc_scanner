import React from "react";
import { CalculatorReadout } from "@/components/CalculatorReadout";
import { App as CapacitorApp } from "@capacitor/app";
import { CheckCircle2, ClipboardCheck, Factory, MapPinCheck, PackagePlus, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import AppToast, { type ToastKind, type ToastNotice } from "@/components/AppToast";
import "@/components/ManufacturingScanner.css";
import type { Employee } from "@/types";
import { loadScannerDeviceName } from "@/lib/scanStorage";
import { PackingLabelQrError, parsePackingLabelQr, validateManufacturePackingReferences, type PackingLabelQr } from "@/lib/packingLabelQr";
import { createManufactureReceiveDraft, ManufacturingApiError, type ManufactureReceiveContext } from "@/lib/manufacturingService";
import { clearStorageLocationCache, requireStorageLocationQr } from "@/lib/storageLocationService";
import { areCompatibleUoms } from "@/lib/uom";
import {
  addStockEntryToHandover, adjustAllocationQuantity, allocationIsReadyToComplete, changeAllocationLocation,
  clearDeviceHandover, completeWarehouseAllocation, confirmChecker, createWarehouseAllocation, generateHandoverQr,
  getCheckerReview, getPickerContext, loadDeviceHandover, mergeHandoverDraft, parseHandoverQr,
  saveDeviceHandover, updateCheckedQuantities, validateCheckerCorrections, verifyAllocationLocation, HandoverApiError,
  type DeviceHandover, type HandoverItem, type HandoverQrPayload, type WarehouseAllocation, type WarehouseAllocationRow,
} from "@/lib/warehouseHandover";

type Stage = "receive" | "received" | "batch" | "checker-handover-scan" | "checker" | "checker-scan" | "handover-qr" | "picker-scan" | "picker-form" | "allocation";
type PendingDraft = { label: PackingLabelQr };
type LocationAction = { kind: "verify" | "change" | "quantity"; row: WarehouseAllocationRow; locationId?: string };
const same = (a: string, b: string) => a.trim().toLocaleUpperCase() === b.trim().toLocaleUpperCase();
const today = () => new Date().toISOString().slice(0, 10);

const QuantityKeypad: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const press = (key: string) => {
    if (key === "back") { onChange(value.slice(0, -1)); return; }
    if (key === "." && value.includes(".")) return;
    const next = value === "0" && key !== "." ? key : `${value}${key}`;
    onChange(next);
  };
  return <div className="mfg-qty-keypad">
    {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"].map((key) =>
      <button type="button" className="mfg-qty-key" key={key} onClick={() => press(key)}>{key === "back" ? "⌫" : key}</button>
    )}
  </div>;
};

interface Props { employee: Employee; onBack: () => void }

const contextItems = (context: ManufactureReceiveContext): HandoverItem[] => {
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
  }));
};

const ManufacturingScanner: React.FC<Props> = ({ employee, onBack }) => {
  const [stage, setStage] = React.useState<Stage>("receive");
  const [message, setMessage] = React.useState("Scan a Job Card QR.");
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState<ToastNotice | null>(null);
  const [pendingDraft, setPendingDraft] = React.useState<PendingDraft | null>(null);
  const [pullOutSlip, setPullOutSlip] = React.useState("");
  const [lastDraft, setLastDraft] = React.useState("");
  const [lastDraftExisting, setLastDraftExisting] = React.useState(false);
  const [handover, setHandover] = React.useState<DeviceHandover | null>(() => loadDeviceHandover());
  const [handoverQr, setHandoverQr] = React.useState("");
  const [checkerQr, setCheckerQr] = React.useState<HandoverQrPayload | null>(null);
  const [pickerQr, setPickerQr] = React.useState<HandoverQrPayload | null>(null);
  const [pickerTypes, setPickerTypes] = React.useState<string[]>([]);
  const [pickerWarehouseMan, setPickerWarehouseMan] = React.useState("");
  const [pickerChecker, setPickerChecker] = React.useState("");
  const [pickerItems, setPickerItems] = React.useState<HandoverItem[]>([]);
  const [warehouses, setWarehouses] = React.useState<string[]>([]);
  const [transactionType, setTransactionType] = React.useState("");
  const [warehouse, setWarehouse] = React.useState("");
  const [postingDate, setPostingDate] = React.useState(today());
  const [postingTime, setPostingTime] = React.useState(() => new Date().toTimeString().slice(0, 8));
  const [allocation, setAllocation] = React.useState<WarehouseAllocation | null>(null);
  const [locationAction, setLocationAction] = React.useState<LocationAction | null>(null);
  const [checkerEdit, setCheckerEdit] = React.useState<number | null>(null);
  const [checkerQuantity, setCheckerQuantity] = React.useState("");
  const [actionQuantity, setActionQuantity] = React.useState("");
  const [actionReason, setActionReason] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const scannerBufferRef = React.useRef("");
  const draftCreatingRef = React.useRef(false);
  const deviceName = loadScannerDeviceName() || "Scanner";

  const notify = React.useCallback((kind: ToastKind, text: string) => setToast({ id: Date.now(), kind, message: text }), []);
  const focusScanner = React.useCallback(() => window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })), []);
  const persist = React.useCallback((value: DeviceHandover | null) => {
    setHandover(value);
    if (value) saveDeviceHandover(value); else clearDeviceHandover();
  }, []);

  const resetReceive = React.useCallback(() => {
    setStage("receive"); setPendingDraft(null); setPullOutSlip(""); setLastDraft(""); setLastDraftExisting(false);
    setMessage("Scan a Job Card QR."); scannerBufferRef.current = ""; focusScanner();
  }, [focusScanner]);

  const goBack = React.useCallback(() => {
    if (pendingDraft) { setPendingDraft(null); setPullOutSlip(""); focusScanner(); return; }
    if (stage !== "receive") { setStage("receive"); setMessage("Scan a Job Card QR."); focusScanner(); return; }
    onBack();
  }, [focusScanner, onBack, pendingDraft, stage]);

  React.useEffect(() => {
    let listener: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;
    void CapacitorApp.addListener("backButton", goBack).then((handle) => { listener = handle; });
    return () => { void listener?.remove(); };
  }, [goBack]);

  React.useEffect(() => {
    const restore = () => {
      const waitingForLocation = locationAction && locationAction.kind !== "quantity" && !locationAction.locationId;
      if (!pendingDraft && checkerEdit === null && (!locationAction || waitingForLocation)) focusScanner();
    };
    const visibility = () => { if (document.visibilityState === "visible") restore(); };
    restore(); window.addEventListener("focus", restore); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("focus", restore); document.removeEventListener("visibilitychange", visibility); };
  }, [checkerEdit, focusScanner, locationAction, pendingDraft, stage]);

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

  const processScan = React.useCallback(async (raw: string) => {
    if (busy || !raw.trim()) return;
    try {
      if (stage === "receive" && !pendingDraft) {
        const label = parsePackingLabelQr(raw);
        if (!label.jobCardId) throw new Error("This packing label does not contain a Job Card Document Name.");
        setPendingDraft({ label }); setPullOutSlip(""); setMessage(`Job Card ${label.jobCardId} scanned.`); return;
      }
      if (stage === "checker-handover-scan") {
        const qr = parseHandoverQr(raw); setBusy(true);
        const review = await getCheckerReview(qr);
        const next: DeviceHandover = { batchId: review.batchId, token: qr.token, expiresAt: qr.expires_at,
          status: (review.status || "PENDING_CHECK") as DeviceHandover["status"], drafts: review.items,
          warehouseMan: review.warehouseMan, checker: "", picker: "", updatedAt: new Date().toISOString() };
        setCheckerQr(qr); persist(next); setStage("checker"); return;
      }
      if (stage === "checker-scan" && handover) {
        setBusy(true);
        const result = await confirmChecker(handover.batchId, raw, deviceName);
        persist({ ...handover, checker: result.checker, status: "CHECKED", updatedAt: new Date().toISOString() });
        setStage("checker"); notify("success", `Checked by ${result.checker}.`); return;
      }
      if (stage === "picker-scan") {
        const qr = parseHandoverQr(raw); setBusy(true);
        const context = await getPickerContext(qr);
        if (context.status.toLocaleUpperCase() !== "CHECKED") throw new HandoverApiError("Checker verification is required before picker handover.", "HANDOVER_NOT_CHECKED");
        setPickerQr(qr); setPickerTypes(context.transactionTypes); setTransactionType(context.transactionTypes[0] || "");
        setPickerWarehouseMan(context.warehouseMan); setPickerChecker(context.checker); setPickerItems(context.items);
        setWarehouses(context.warehouses); setWarehouse(context.warehouses[0] || ""); setStage("picker-form"); return;
      }
      if (stage === "allocation" && locationAction && locationAction.kind !== "quantity") {
        const location = requireStorageLocationQr(raw);
        if (location.isGroup) throw new HandoverApiError("Group Storage Locations cannot be verified as a physical placement.", "LOCATION_IS_GROUP");
        setLocationAction({ ...locationAction, locationId: location.locationId });
        setActionQuantity(String(locationAction.row.allocatedQuantity)); return;
      }
    } catch (error) {
      notify("error", error instanceof PackingLabelQrError || error instanceof Error ? error.message : "The scanned QR is invalid.");
    } finally { setBusy(false); focusScanner(); }
  }, [busy, deviceName, focusScanner, handover, locationAction, notify, pendingDraft, persist, stage]);

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
    draftCreatingRef.current = true; setBusy(true);
    try {
      clearStorageLocationCache();
      const context = await createManufactureReceiveDraft(pendingDraft.label.jobCardId!, reference, {
        quantity: pendingDraft.label.quantity, deviceId: deviceName,
      });
      const mismatch = validateManufacturePackingReferences(pendingDraft.label, { jobOrderId: context.workOrderId, jobCardId: context.jobCardId });
      if (mismatch) throw new ManufacturingApiError(mismatch, "ERP_VALIDATION_FAILED");
      const sourceRows = context.finishedItems.length ? context.finishedItems : context.putawayAllocations;
      const matching = sourceRows.filter((row) => same(row.itemCode, pendingDraft.label.itemCode));
      if (!matching.length) throw new ManufacturingApiError(`Packing label item ${pendingDraft.label.itemCode} is not in ${context.stockEntryId}.`, "ERP_VALIDATION_FAILED");
      if (!matching.some((row) => areCompatibleUoms(row.uom, pendingDraft.label.uom))) throw new ManufacturingApiError(`Barcode UOM ${pendingDraft.label.uom} is not compatible with ERPNext Stock UOM.`, "ERP_VALIDATION_FAILED");

      const reusable = handover && ["OPEN", "PENDING_CHECK"].includes(handover.status) ? handover : null;
      let next = contextItems(context).reduce((value, row) => mergeHandoverDraft(value, row), reusable);
      persist(next); // Never lose a created Draft name if handover registration is temporarily unavailable.
      try {
        const registration = await addStockEntryToHandover(next.batchId, context.stockEntryId, deviceName);
        next = (registration.items.length ? registration.items : contextItems(context)).reduce((value, row) => mergeHandoverDraft(value, row, registration.batchId), next);
        next = { ...next, status: registration.status, updatedAt: new Date().toISOString() };
        persist(next);
      } catch (registrationError) {
        notify("warning", `Draft created and saved on this device. Handover registration must be retried online: ${registrationError instanceof Error ? registrationError.message : "Connection failed."}`);
      }
      setLastDraft(context.stockEntryId); setLastDraftExisting(context.existingDraft); setPendingDraft(null); setStage("received");
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
      if (result.items.length) persist({ ...handover, drafts: result.items, updatedAt: new Date().toISOString() });
      setStage("checker-scan"); setMessage("Scan the assigned Checker QR Code.");
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

  const showHandoverQr = async () => {
    if (!handover?.drafts.length) { notify("warning", "Add at least one Draft Stock Entry first."); return; }
    setBusy(true);
    try { const active = await syncHandoverBatch(); const qr = await generateHandoverQr(active.batchId); setHandoverQr(qr.raw); persist({ ...active, token: qr.parsed.token, expiresAt: qr.parsed.expires_at }); setStage("handover-qr"); }
    catch (error) { notify("error", error instanceof Error ? error.message : "Could not generate handover QR."); }
    finally { setBusy(false); }
  };

  const createAllocation = async (event: React.FormEvent) => {
    event.preventDefault(); if (!pickerQr || !transactionType || !warehouse || !postingDate) { notify("warning", "Transaction Type, Warehouse, and Date are required."); return; }
    setBusy(true);
    try {
      const value = await createWarehouseAllocation({ batchId: pickerQr.batch_id, token: pickerQr.token, transactionType,
        warehouse, postingDate, postingTime, deviceId: deviceName, additionalDetails: {} });
      setAllocation(value); // Preserve the exact authoritative ERPNext row order.
      setStage("allocation");
    }
    catch (error) { notify("error", error instanceof Error ? error.message : "Could not create Warehouse Allocation."); }
    finally { setBusy(false); }
  };

  const runLocationAction = async () => {
    if (!allocation || !locationAction) return;
    const quantity = Number(actionQuantity.replace(/,/g, ""));
    if (!Number.isFinite(quantity) || quantity < 0) { notify("warning", "Enter a valid actual quantity."); return; }
    if ((locationAction.kind === "change" || locationAction.kind === "quantity") && !actionReason.trim()) { notify("warning", "A reason is required for this change."); return; }
    if (locationAction.kind !== "quantity" && !locationAction.locationId) { notify("warning", "Scan the Storage Location QR first."); return; }
    setBusy(true);
    try {
      let update;
      if (locationAction.kind === "verify") update = await verifyAllocationLocation(allocation.name, locationAction.row, locationAction.locationId!, quantity, deviceName);
      else if (locationAction.kind === "change") update = await changeAllocationLocation(allocation.name, locationAction.row, locationAction.locationId!, quantity, actionReason.trim(), deviceName);
      else update = await adjustAllocationQuantity(allocation.name, locationAction.row, quantity, actionReason.trim(), deviceName);
      const updated = { ...update.row, suggestedLocation: update.row.suggestedLocation || locationAction.row.suggestedLocation };
      setAllocation(update.allocation || { ...allocation, rows: allocation.rows.map((row) => row.allocationId === updated.allocationId ? updated : row) });
      setLocationAction(null); setActionQuantity(""); setActionReason("");
      notify(updated.status.toUpperCase() === "VERIFIED" ? "success" : "warning", `ERPNext status: ${updated.status.replaceAll("_", " ")}.`);
    } catch (error) { notify("error", error instanceof Error ? error.message : "Could not update this allocation."); }
    finally { setBusy(false); focusScanner(); }
  };

  const finishAllocation = async () => {
    if (!allocation || !allocationIsReadyToComplete(allocation)) { notify("warning", "Verify every allocated Storage Location before completion."); return; }
    setBusy(true);
    try {
      const result = await completeWarehouseAllocation(allocation.name, deviceName);
      const authoritative = result.allocation.name ? result.allocation : { ...allocation, status: "Completed", stockEntriesRemainDraft: true };
      setAllocation(authoritative); if (handover) persist({ ...handover, status: "COMPLETED" });
      notify("success", `${authoritative.name || allocation.name} completed. Linked Stock Entries remain Draft.`);
    }
    catch (error) {
      if (error instanceof HandoverApiError && error.code === "ALLOCATION_INCOMPLETE") {
        const pending = Array.isArray(error.payload.pending_rows) ? error.payload.pending_rows.map(String).join(", ") : "";
        notify("warning", `${error.message}${pending ? ` Pending rows: ${pending}` : ""}`);
      } else notify("error", error instanceof Error ? error.message : "Could not complete Warehouse Allocation.");
    }
    finally { setBusy(false); }
  };

  const scanning = (stage === "receive" && !pendingDraft) || stage === "checker-handover-scan" || stage === "checker-scan" || stage === "picker-scan" || (stage === "allocation" && locationAction && locationAction.kind !== "quantity" && !locationAction.locationId);
  const heading = stage === "checker-handover-scan" || stage === "checker" || stage === "checker-scan" ? "Checker Verification" : stage === "picker-scan" || stage === "picker-form" ? "Picker Handover" : stage === "allocation" ? "Warehouse Allocation" : "Receive Finished Goods";

  return <div className="mfg-page">
    <header className="mfg-head"><div><h1>{heading}</h1><p>{employee.full_name} / {deviceName}</p></div></header>
    <main className="mfg-body" onClick={() => scanning && focusScanner()}>
      <AppToast toast={toast} onClose={() => setToast(null)}/>
      <div className="mfg-scroll">
        {stage === "receive" && <>
          <div className="mfg-kicker">Warehouse handover</div><div className="mfg-title">Scan Job Card QR</div>
          <div className="mfg-copy">Create a Draft Manufacture Stock Entry. Putaway and location allocation happen later, after checker verification.</div>
          {handover?.drafts.length ? <div className="mfg-batch-summary"><strong>{new Set(handover.drafts.map((x) => x.stockEntryId)).size} Draft Stock Entries</strong><span>{handover.status.replaceAll("_", " ")}</span></div> : null}
        </>}
        {stage === "received" && <div className="mfg-success"><div className="mfg-success-icon"><CheckCircle2 size={38}/></div><h2>{lastDraftExisting ? "Existing Draft Reused" : "Draft Saved"}</h2><div className="mfg-success-code">{lastDraft}</div><p>No Putaway Rule or location allocation was performed.</p></div>}
        {stage === "batch" && handover && <><div className="mfg-kicker">Handover batch</div><div className="mfg-title">{handover.batchId}</div><div className="mfg-copy">{handover.warehouseMan ? `Warehouse Man: ${handover.warehouseMan}` : "Draft Stock Entries saved on this device."}</div>{Array.from(new Set(handover.drafts.map((row) => row.stockEntryId))).map((id) => <div className="mfg-job" key={id}><span>{id}</span><small>Draft</small></div>)}</>}
        {stage === "checker-handover-scan" && <div className="mfg-scan-prompt"><QrCode size={48}/><h2>Scan Handover QR</h2><p>Load the authoritative batch before checking its quantities.</p></div>}
        {stage === "checker" && handover && <>
          <div className="mfg-kicker">{handover.status.replaceAll("_", " ")}</div><div className="mfg-title">{handover.batchId}</div>
          <div className="mfg-copy">Warehouse Man: {handover.warehouseMan || "Not supplied"}</div>
          <div className="mfg-copy">Correct each quantity if needed. ERP Stock Entry Drafts remain the source documents.</div>
          {handover.drafts.map((row, index) => <div className="mfg-review-row" key={`${row.stockEntryId}-${row.stockEntryRow}-${index}`}>
            <strong>{row.itemCode}</strong><small>{row.itemName}</small><span>{row.stockEntryId} · Job Card {row.jobCardId || "—"} · Work Order {row.workOrderId || "—"}</span><span>Pull Out Slip: {row.pullOutSlip || "—"}</span>
            <label>Recorded <b>{row.recordedQuantity} {row.uom}</b></label>
            <label>Verified quantity<button type="button" className="mfg-review-quantity" disabled={handover.status === "CHECKED"} onClick={() => { setCheckerEdit(index); setCheckerQuantity(String(row.verifiedQuantity)); }}>{row.verifiedQuantity} {row.uom}</button></label>
            {row.verifiedQuantity !== row.recordedQuantity && <label>Correction reason<input value={row.correctionReason} disabled={handover.status === "CHECKED"} onChange={(event) => persist({ ...handover, drafts: handover.drafts.map((item, itemIndex) => itemIndex === index ? { ...item, correctionReason: event.target.value } : item) })} placeholder="Required"/></label>}
          </div>)}
          {handover.checker && <div className="mfg-location">Checked by {handover.checker}</div>}
        </>}
        {stage === "checker-scan" && <div className="mfg-scan-prompt"><ClipboardCheck size={48}/><h2>Scan Checker QR Code</h2><p>The assigned checker must scan their personal QR to approve this handover.</p></div>}
        {stage === "handover-qr" && handoverQr && <div className="mfg-qr-card"><h2>Handover QR</h2><p>The Checker and Picker scan this backend-issued QR. Picker allocation remains locked until status is CHECKED.</p><QRCodeSVG value={handoverQr} size={230} level="M" marginSize={2}/><strong>{handover?.batchId}</strong><small>Expires: {handover?.expiresAt ? new Date(handover.expiresAt).toLocaleString() : "Backend did not provide expiration"}</small></div>}
        {stage === "picker-scan" && <div className="mfg-scan-prompt"><QrCode size={48}/><h2>Scan Handover QR</h2><p>Scan the QR generated by the checked receiving device.</p></div>}
        {stage === "picker-form" && <form className="mfg-picker-form" onSubmit={createAllocation}>
          <div className="mfg-kicker">Create draft allocation</div><div className="mfg-title">Transaction Details</div>
          <div className="mfg-copy">Warehouse Man: {pickerWarehouseMan || "—"} · Checker: {pickerChecker || "—"}</div>
          {pickerItems.map((row) => <div className="mfg-job" key={`${row.stockEntryId}-${row.stockEntryRow}`}><span>{row.itemCode}<small>{row.stockEntryId}</small></span><strong>{row.verifiedQuantity} {row.uom}</strong></div>)}
          <label>Transaction Type<select value={transactionType} onChange={(e) => setTransactionType(e.target.value)}>{pickerTypes.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Warehouse<select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} disabled={!warehouses.length}><option value="">{warehouses.length ? "Select warehouse" : "No permitted warehouse returned"}</option>{warehouses.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Date<input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)}/></label>
          <label>Time<input type="time" step="1" value={postingTime} onChange={(e) => setPostingTime(e.target.value)}/></label>
          <button className="mfg-primary" disabled={busy || !transactionType || !warehouse}>{busy ? "Creating..." : "Create Warehouse Allocation"}</button>
        </form>}
        {stage === "allocation" && allocation && <>
          <div className="mfg-kicker">{allocation.status}</div><div className="mfg-title">{allocation.name}</div>
          <div className="mfg-copy">Rows are shown in the exact order returned by ERPNext. Verify the physical Storage Location and actual quantity.</div>
          {allocation.rows.map((row, index) => <article className={`mfg-row mfg-allocation ${row.status.toUpperCase() === "VERIFIED" ? "is-complete" : ""}`} key={row.allocationId}>
            <div className="mfg-row-top"><strong>Allocation {index + 1}</strong><span>{row.originalQuantity} → {row.allocatedQuantity} {row.uom}</span></div>
            <div className="mfg-row-name">{row.itemCode} / {row.itemName}</div><div className="mfg-allocation-location">Suggested: {row.suggestedLocation || "—"}</div><div className="mfg-row-location">Actual: {row.actualLocation || "Not verified"}</div>
            <div className="mfg-allocation-status">{row.status.replaceAll("_", " ")}</div>
            <div className="mfg-row-actions"><button onClick={() => { setLocationAction({ kind: "verify", row }); setActionQuantity(String(row.allocatedQuantity)); }}>Verify Location</button><button onClick={() => { setLocationAction({ kind: "change", row }); setActionQuantity(String(row.allocatedQuantity)); }}>Change Location</button><button onClick={() => { setLocationAction({ kind: "quantity", row }); setActionQuantity(String(row.allocatedQuantity)); }}>Adjust Qty</button></div>
          </article>)}
          {allocation.status.toUpperCase() === "COMPLETED" && <div className="mfg-location">Allocation completed. Linked Stock Entries remain Draft; no stock or accounting document was submitted.</div>}
        </>}
      </div>

      {scanning && <input ref={inputRef} className="mfg-input mfg-scanner-capture" readOnly inputMode="none" onKeyDown={handleKey} onBlur={focusScanner} aria-label="Scanner input"/>}
      <div className="mfg-dock">
        {stage === "receive" && <><div className="mfg-dock-grid"><button className="mfg-secondary" disabled={!handover?.drafts.length} onClick={() => setStage("batch")}><ClipboardCheck size={16}/> Review Batch</button><button className="mfg-secondary" onClick={() => setStage("checker-handover-scan")}><QrCode size={16}/> Checker</button></div><button className="mfg-secondary" onClick={() => setStage("picker-scan")}><QrCode size={16}/> Picker</button></>}
        {stage === "received" && <><div className="mfg-dock-grid"><button className="mfg-secondary" onClick={resetReceive}><PackagePlus size={16}/> Add Another</button><button className="mfg-secondary" onClick={() => setStage("batch")}><ClipboardCheck size={16}/> Review Batch</button></div><button className="mfg-primary" disabled={busy} onClick={() => void showHandoverQr()}><QrCode size={16}/> Generate Handover QR</button></>}
        {stage === "batch" && <button className="mfg-primary" disabled={busy} onClick={() => void showHandoverQr()}><QrCode size={16}/> Generate Handover QR</button>}
        {stage === "checker" && handover?.status !== "CHECKED" && <button className="mfg-primary" disabled={busy} onClick={() => void saveCheckerRows()}><ClipboardCheck size={16}/> Save & Scan Checker QR</button>}
        {stage === "handover-qr" && <><div className="mfg-dock-grid"><button className="mfg-secondary" onClick={() => setStage("checker-handover-scan")}><ClipboardCheck size={16}/> Checker</button><button className="mfg-secondary" onClick={() => setStage("picker-scan")}><QrCode size={16}/> Picker</button></div><button className="mfg-secondary" onClick={resetReceive}><Factory size={16}/> Return to Receiving</button></>}
        {stage === "allocation" && <button className="mfg-primary" disabled={busy || !allocationIsReadyToComplete(allocation)} onClick={() => void finishAllocation()}><MapPinCheck size={16}/> Complete Allocation</button>}
      </div>
    </main>

    {pendingDraft && <div className="mfg-confirm-bg"><form className="mfg-confirm" onSubmit={createDraft}><h2>Enter Pull Out Slip</h2><p>Job Card: <strong>{pendingDraft.label.jobCardId}</strong></p><label className="mfg-pull-label">Pull Out Slip</label><input className="mfg-pull-input" value={pullOutSlip} onChange={(e) => setPullOutSlip(e.target.value)} disabled={busy} autoFocus required/><div className="mfg-confirm-actions"><button type="button" onClick={() => { setPendingDraft(null); setPullOutSlip(""); focusScanner(); }}>Cancel</button><button disabled={busy || !pullOutSlip.trim()}>{busy ? "Creating..." : "Create Draft"}</button></div></form></div>}
    {checkerEdit !== null && handover && <div className="mfg-confirm-bg"><div className="mfg-confirm"><h2>Correct Physical Quantity</h2><p>{handover.drafts[checkerEdit]?.itemCode} · {handover.drafts[checkerEdit]?.itemName || "Item description unavailable"} · {handover.drafts[checkerEdit]?.stockEntryId}</p><label className="mfg-pull-label">Verified Quantity</label><div className="mfg-qty-input mfg-calculator-field"><CalculatorReadout value={checkerQuantity}/></div><QuantityKeypad value={checkerQuantity} onChange={setCheckerQuantity}/><div className="mfg-confirm-actions"><button onClick={() => setCheckerEdit(null)}>Cancel</button><button onClick={() => { const quantity = Number(checkerQuantity || 0); if (!Number.isFinite(quantity) || quantity < 0) { notify("warning", "Enter a valid quantity."); return; } persist({ ...handover, drafts: handover.drafts.map((item, index) => index === checkerEdit ? { ...item, verifiedQuantity: quantity } : item) }); setCheckerEdit(null); }}>Confirm</button></div></div></div>}
    {locationAction && <div className="mfg-confirm-bg"><div className="mfg-confirm"><h2>{locationAction.kind === "verify" ? "Verify Placement" : locationAction.kind === "change" ? "Change Location" : "Adjust Quantity"}</h2><p>{locationAction.row.itemCode} · {locationAction.row.itemName || "Item description unavailable"} · Suggested: {locationAction.row.suggestedLocation}</p>{locationAction.kind !== "quantity" && <div className="mfg-location">{locationAction.locationId ? `Scanned: ${locationAction.locationId}` : "Scan the Storage Location QR now."}</div>}<label className="mfg-pull-label">Actual Quantity</label><div className="mfg-qty-input mfg-calculator-field"><CalculatorReadout value={actionQuantity}/></div><QuantityKeypad value={actionQuantity} onChange={setActionQuantity}/>{locationAction.kind !== "verify" && <><label className="mfg-pull-label">Reason</label><input className="mfg-pull-input" value={actionReason} onChange={(e) => setActionReason(e.target.value)}/></>}<div className="mfg-confirm-actions"><button onClick={() => setLocationAction(null)}>Cancel</button><button disabled={busy || (locationAction.kind !== "quantity" && !locationAction.locationId)} onClick={() => void runLocationAction()}>{busy ? "Saving..." : "Confirm"}</button></div></div></div>}
  </div>;
};

export default ManufacturingScanner;
