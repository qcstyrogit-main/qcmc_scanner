import React from "react";
import { CalculatorReadout } from "@/components/CalculatorReadout";
import { App as CapacitorApp } from "@capacitor/app";
import { ArrowLeft, ArrowLeftRight, Barcode, CheckCircle2, ChevronRight, MapPin, Package, ShieldCheck } from "lucide-react";
import AppToast, { type ToastNotice } from "@/components/AppToast";
import { loadScannerDeviceName } from "@/lib/scanStorage";
import {
  createLocationTransfer, loadSourceLocationStock, LOCATION_TRANSFER_ONLINE_MESSAGE, LocationTransferError,
  newLocationTransferRequestId, parseTransferItemQr, parseTransferQuantity, validateTransferDestination,
  validateTransferLocation, validateTransferQuantity, verifyLocationTransferConnection,
  type LocationTransferResult, type TransferItemStock,
} from "@/lib/locationTransfer";
import type { ResolvedStorageLocation } from "@/lib/storageLocationService";
import { createLocationTransferTransaction, saveSuccessfulTransaction } from "@/lib/transactionHistory";
import type { Employee } from "@/types";
import "@/components/LocationTransferScanner.css";

type Stage = "source" | "item" | "quantity" | "target" | "review" | "success";
interface Props { employee: Employee; onBack: () => void }

interface QuantityKeypadModalProps {
  value: string;
  uom: string;
  availableQuantity: number;
  itemCode: string;
  itemName: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

const QuantityKeypadModal: React.FC<QuantityKeypadModalProps> = ({
  value,
  uom,
  availableQuantity,
  itemCode,
  itemName,
  onCancel,
  onConfirm,
}) => {
  const [draft, setDraft] = React.useState(value || "");

  React.useEffect(() => {
    setDraft(value || "");
  }, [value]);

  const press = (key: string) => {
    if (key === "back") {
      setDraft((current) => current.slice(0, -1));
      return;
    }
    if (key === "clear") {
      setDraft("");
      return;
    }
    if (key === "." && draft.includes(".")) return;
    setDraft((current) => current === "0" && key !== "." ? key : `${current}${key}`);
  };

  return (
    <div className="lt-qty-modal" role="dialog" aria-modal="true" aria-label="Transfer Quantity">
      <div className="lt-qty-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="lt-qty-modal-head">
          <div>
            <span>Transfer Quantity</span>
            <div className="lt-qty-item-identity"><b>{itemCode}</b><small>{itemName || "Item description unavailable"}</small></div>
            <CalculatorReadout value={draft} unit={uom}/>
          </div>
          <p>Available: {availableQuantity.toLocaleString()} {uom}</p>
        </div>

        <div className="lt-keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"].map((key) => (
            <button type="button" key={key} onClick={() => press(key)}>
              {key === "back" ? "⌫" : key}
            </button>
          ))}
        </div>

        <div className="lt-qty-modal-actions">
          <button type="button" className="lt-qty-clear" onClick={() => press("clear")}>Clear</button>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="lt-qty-ok" onClick={() => onConfirm(draft)}>OK</button>
        </div>
      </div>
    </div>
  );
};

const LocationTransferScanner: React.FC<Props> = ({ employee, onBack }) => {
  const [stage, setStage] = React.useState<Stage>("source");
  const [source, setSource] = React.useState<ResolvedStorageLocation | null>(null);
  const [target, setTarget] = React.useState<ResolvedStorageLocation | null>(null);
  const [item, setItem] = React.useState<TransferItemStock | null>(null);
  const [quantityInput, setQuantityInput] = React.useState("");
  const [quantityModalOpen, setQuantityModalOpen] = React.useState(false);
  const [result, setResult] = React.useState<LocationTransferResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [toast, setToast] = React.useState<ToastNotice | null>(null);
  const captureRef = React.useRef<HTMLInputElement>(null);
  const bufferRef = React.useRef("");
  const requestIdRef = React.useRef("");
  const deviceId = loadScannerDeviceName() || "Scanner";
  const scannerActive = connected && !busy && ["source", "item", "target"].includes(stage);

  const notify = React.useCallback((kind: ToastNotice["kind"], message: string) => setToast({ id: Date.now(), kind, message }), []);
  const focusScanner = React.useCallback(() => window.requestAnimationFrame(() => captureRef.current?.focus({ preventScroll: true })), []);

  const reset = React.useCallback(() => {
    setStage("source"); setSource(null); setTarget(null); setItem(null); setQuantityInput(""); setQuantityModalOpen(false); setResult(null);
    requestIdRef.current = ""; bufferRef.current = ""; focusScanner();
  }, [focusScanner]);

  const connect = React.useCallback(async () => {
    setBusy(true);
    try { await verifyLocationTransferConnection(); setConnected(true); focusScanner(); }
    catch { setConnected(false); notify("error", LOCATION_TRANSFER_ONLINE_MESSAGE); }
    finally { setBusy(false); }
  }, [focusScanner, notify]);

  React.useEffect(() => { void connect(); }, [connect]);
  React.useEffect(() => { if (scannerActive) focusScanner(); }, [focusScanner, scannerActive, stage]);
  React.useEffect(() => {
    const online = () => void connect(); const offline = () => { setConnected(false); notify("error", LOCATION_TRANSFER_ONLINE_MESSAGE); };
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, [connect, notify]);
  const goBackStep = React.useCallback(() => {
    if (stage === "source") onBack();
    else if (stage === "item") { setSource(null); setStage("source"); }
    else if (stage === "target") setStage("item");
    else if (stage === "quantity") { setTarget(null); setStage("target"); }
    else if (stage === "review") setStage("quantity");
    else reset();
  }, [onBack, reset, stage]);
  React.useEffect(() => {
    let listener: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;
    void CapacitorApp.addListener("backButton", goBackStep).then((value) => { listener = value; });
    return () => { void listener?.remove(); };
  }, [goBackStep]);

  const friendlyError = (error: unknown) => {
    if (!(error instanceof LocationTransferError)) return error instanceof Error ? error.message : "Location Transfer failed.";
    if (error.code === "INTERNET_REQUIRED") return LOCATION_TRANSFER_ONLINE_MESSAGE;
    return error.message || "ERPNext rejected the Location Transfer.";
  };

  const processScan = async (raw: string) => {
    if (!scannerActive) return;
    setBusy(true);
    try {
      if (stage === "source") {
        const location = await validateTransferLocation(raw);
        setSource(location); setStage("item"); notify("success", `Source Location ${location.inventoryLocationId} confirmed.`);
      } else if (stage === "item" && source) {
        const stock = await loadSourceLocationStock(source, parseTransferItemQr(raw));
        setItem(stock); setQuantityInput(String(stock.availableQuantity)); setStage("target");
        notify("success", `${stock.itemCode}: ${stock.availableQuantity.toLocaleString()} ${stock.uom} available in this location.`);
      } else if (stage === "target" && source && item) {
        const location = await validateTransferLocation(raw);
        await validateTransferDestination(source, location);
        setTarget(location); requestIdRef.current = ""; setStage("quantity"); setQuantityModalOpen(true);
        notify("success", `Destination Location ${location.inventoryLocationId} confirmed.`);
      }
    } catch (error) { notify("error", friendlyError(error)); }
    finally { setBusy(false); focusScanner(); }
  };

  const handleKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault(); const raw = bufferRef.current.trim(); bufferRef.current = "";
      if (raw) void processScan(raw);
      return;
    }
    if (event.key.length === 1) bufferRef.current += event.key;
  };

  const continueQuantity = () => {
    if (!item) return;
    const quantity = parseTransferQuantity(quantityInput);
    const error = validateTransferQuantity(quantity, item.availableQuantity, item.precision);
    if (error) { notify("warning", error); return; }
    requestIdRef.current = newLocationTransferRequestId(); setStage("review");
  };

  const confirmTransfer = async () => {
    if (!source || !target || !item || busy) return;
    const quantity = parseTransferQuantity(quantityInput);
    const error = validateTransferQuantity(quantity, item.availableQuantity, item.precision);
    if (error) { notify("warning", error); setStage("quantity"); return; }
    setBusy(true);
    try {
      const completed = await createLocationTransfer({ item, source, target, quantity, deviceId,
        requestId: requestIdRef.current || (requestIdRef.current = newLocationTransferRequestId()) });
      if (!completed.stockEntry) throw new LocationTransferError("ERPNext did not return the completed Stock Entry reference.", "TRANSFER_FAILED");
      saveSuccessfulTransaction(createLocationTransferTransaction(completed));
      setResult(completed); setStage("success"); notify("success", `Location Transfer ${completed.stockEntry} completed.`);
    } catch (error) {
      if (error instanceof LocationTransferError && ["STOCK_CHANGED", "INSUFFICIENT_SOURCE_QUANTITY"].includes(error.code)) {
        const latest = Number(error.payload.latest_available_quantity ?? error.payload.available_quantity);
        if (Number.isFinite(latest) && latest >= 0) {
          setItem({ ...item, availableQuantity: latest }); setQuantityInput(String(Math.min(quantity, latest))); setStage("quantity"); setQuantityModalOpen(true); requestIdRef.current = "";
        }
      }
      notify("error", friendlyError(error));
    } finally { setBusy(false); }
  };

  const quantity = parseTransferQuantity(quantityInput);
  const transferStep = stage === "source" ? 1 : stage === "item" ? 2 :
    stage === "target" ? 3 : stage === "quantity" ? 4 : 5;
  return <main className="lt-page lt-v2" onClick={() => { if (scannerActive) focusScanner(); }}>
    <header className="lt-v2-head">
      <button type="button" className="lt-v2-back" aria-label="Back" onClick={(event) => { event.stopPropagation(); goBackStep(); }}>
        <ArrowLeft size={23} aria-hidden="true"/>
      </button>
      <h1>Transfer Location</h1>
      <span className="lt-v2-mode">Single item</span>
      <span className="sr-only">Operator {employee.full_name} · Device {deviceId}</span>
    </header>
    <div className="lt-body">
      <AppToast toast={toast} onClose={() => setToast(null)}/>
      <div className="lt-scroll">
        <div className="lt-v2-intro">
          <span className="lt-v2-intro-icon"><ArrowLeftRight size={25} aria-hidden="true"/></span>
          <span><strong>Move stock between Storage Locations</strong><small>Same warehouse · Online ERPNext verification</small></span>
        </div>
        <section className="lt-v2-progress" aria-label={`Transfer step ${transferStep} of 5`}>
          <div className="lt-v2-progress-top"><strong>Transfer Progress</strong><span>{stage === "success" ? "Completed" : `Step ${transferStep} of 5`}</span></div>
          <div className="lt-v2-steps">
            {["From", "Item", "To", "Quantity", "Confirm"].map((label, index) => (
              <span className={`lt-v2-step ${stage === "success" || index+1 < transferStep ? "is-done" : index+1 === transferStep ? "is-active" : ""}`} key={label}>
                <b>{stage === "success" || index+1 < transferStep ? "✓" : index+1}</b>{label}
              </span>
            ))}
          </div>
        </section>
        {(source || target) && <section className="lt-v2-route" aria-label="Transfer source and destination">
          <div><small>FROM LOCATION</small><strong>{source?.inventoryLocationId || "Not scanned"}</strong></div>
          <ArrowLeftRight size={20} aria-hidden="true"/>
          <div><small>TO LOCATION</small><strong>{target?.inventoryLocationId || "Not scanned"}</strong></div>
          {source && <p>Warehouse: <strong>{source.warehouse}</strong></p>}
        </section>}
        {item && <section className="lt-v2-item" aria-label="Selected stock item">
          <span className="lt-v2-item-icon"><Package size={23} aria-hidden="true"/></span>
          <span><small>Selected item</small><strong>{item.itemCode}</strong>
            <small>{item.itemName || "Stock item"}</small>
            <small>Available at source: {item.availableQuantity.toLocaleString()} {item.uom}</small>
            {item.batchNo && <small>Batch: {item.batchNo}</small>}
          </span>
        </section>}
        {!connected && <section className="lt-offline"><strong>ERPNext connection required</strong>
          <p>{LOCATION_TRANSFER_ONLINE_MESSAGE} No transfer is queued offline.</p>
          <button type="button" onClick={() => void connect()}>Retry ERP Connection</button>
        </section>}
        {connected && stage === "source" && <section className="lt-prompt lt-v2-scan-prompt">
          <MapPin size={43} aria-hidden="true"/><h2>Scan From Location QR</h2>
          <p>Scan the source Storage Location containing the stock to transfer.</p>
        </section>}
        {connected && stage === "item" && source && <section className="lt-prompt lt-v2-scan-prompt">
          <Barcode size={43} aria-hidden="true"/><h2>Scan Item QR</h2>
          <p>Only stock available in the scanned From Location can be transferred.</p>
        </section>}
        {connected && stage === "target" && source && item && <section className="lt-prompt lt-v2-scan-prompt">
          <MapPin size={43} aria-hidden="true"/><h2>Scan To Location QR</h2>
          <p>Scan a different leaf Storage Location within the same Warehouse.</p>
        </section>}
        {connected && stage === "quantity" && source && target && item && <section className="lt-card lt-v2-quantity">
          <h2>Transfer Quantity</h2><p>Check the stock available at the source before proceeding.</p>
          <div className="lt-v2-available">Available <strong>{item.availableQuantity.toLocaleString()} {item.uom}</strong></div>
          <button className="lt-quantity lt-quantity-button" type="button" onClick={(event) => { event.stopPropagation(); setQuantityModalOpen(true); }}>
            <span>{quantityInput || "0"}</span> <small>{item.uom}</small>
          </button>
          <button className="lt-primary" type="button" onClick={continueQuantity}>Review Transfer <ChevronRight size={18} aria-hidden="true"/></button>
        </section>}
        {connected && stage === "review" && source && target && item && <section className="lt-card lt-v2-review">
          <h2>Review Transfer Details</h2>
          <p>Check locations and quantity before creating the Stock Entry in ERPNext.</p>
          <div className="lt-review">
            <span>Item Code</span><strong>{item.itemCode}</strong>
            <span>Item Name</span><strong>{item.itemName || "—"}</strong>
            <span>From Location</span><strong>{source.inventoryLocationId}</strong>
            <span>To Location</span><strong>{target.inventoryLocationId}</strong>
            <span>Warehouse</span><strong>{source.warehouse}</strong>
            <span>Quantity</span><strong>{quantity.toLocaleString()} {item.uom}</strong>
            <span>Available</span><strong>{item.availableQuantity.toLocaleString()} {item.uom}</strong>
            {item.batchNo && <><span>Batch</span><strong>{item.batchNo}</strong></>}
          </div>
          <div className="lt-v2-confirm-help"><ShieldCheck size={19} aria-hidden="true"/> Submitting transfers stock online; this action is not saved as a draft.</div>
          <div className="lt-actions"><button type="button" onClick={goBackStep}>Back</button>
            <button type="button" disabled={busy} onClick={() => void confirmTransfer()}>Confirm Transfer</button>
          </div>
        </section>}
        {stage === "success" && result && <section className="lt-success lt-v2-success">
          <CheckCircle2 size={55} aria-hidden="true"/><h2>Location Transfer Complete</h2>
          <p>ERPNext confirmed the Stock Entry below.</p>
          <div className="lt-review">
            <span>Stock Entry</span><strong>{result.stockEntry}</strong>
            <span>Item</span><strong>{result.itemCode}</strong>
            <span>Quantity</span><strong>{result.quantity.toLocaleString()} {result.uom}</strong>
            <span>From</span><strong>{result.sourceLocation}</strong>
            <span>To</span><strong>{result.targetLocation}</strong>
            <span>Warehouse</span><strong>{result.warehouse}</strong>
          </div>
          <div className="lt-actions"><button type="button" onClick={onBack}>Back to Inventory</button>
            <button type="button" onClick={reset}>New Transfer</button>
          </div>
        </section>}
      </div>
    </div>
    {quantityModalOpen && stage === "quantity" && item && <QuantityKeypadModal
      value={quantityInput}
      uom={item.uom}
      availableQuantity={item.availableQuantity}
      itemCode={item.itemCode}
      itemName={item.itemName || ""}
      onCancel={() => setQuantityModalOpen(false)}
      onConfirm={(value) => {
        setQuantityInput(value);
        setQuantityModalOpen(false);
      }}
    />}
    {scannerActive && <input ref={captureRef} className="lt-capture" readOnly inputMode="none" aria-label="Scanner input" onKeyDown={handleKey} onBlur={focusScanner}/>} 
    {busy && <div className="lt-loading"><div><span/><strong>Checking ERPNext…</strong><small>Please wait</small></div></div>}
  </main>;
};

export default LocationTransferScanner;
