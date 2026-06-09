import React from "react";
import {
  Barcode,
  CheckCircle2,
  Layers3,
  MapPin,
  RotateCcw,
  Send,
} from "lucide-react";
import { Device } from "@capacitor/device";
import type { Employee } from "@/types";
import { submitPcountEntries } from "@/lib/erpService";
import {
  loadLocalScanEntries,
  saveLocalScanEntries,
  type LocalBinLocation,
  type LocalScanEntry,
} from "@/lib/scanStorage";

export type ScanMode = "in" | "out" | "pcount";
type ScanStep = "reconciliation" | "bin" | "item" | "qty";

interface ScanPageProps {
  employee: Employee;
  initialMode: ScanMode;
  sessionKey: number;
}

type BinLocation = LocalBinLocation;
type ItemScan = LocalScanEntry;

type PendingItem = {
  raw: string;
  itemCode: string;
  qrQuantity: number;
  uom: string;
  lotNo: string;
};

declare global {
  interface Window {
    QcmcScanner?: {
      startScan?: () => void;
      stopScan?: () => void;
    };
  }
}

const modeLabels: Record<ScanMode, string> = {
  in: "IN",
  out: "OUT",
  pcount: "P. Count",
};

const parseBin = (code: string): BinLocation | null => {
  const parts = code.split(";").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 5 || !parts[0].toLowerCase().startsWith("stockroom")) {
    return null;
  }

  return {
    raw: code,
    stockroom: parts[0],
    building: parts[1],
    aisle: parts[2],
    rack: parts[3],
    bin: parts.slice(4).join("; "),
  };
};

const parseItem = (code: string) => {
  const parts = code.split(";").map((part) => part.trim());
  if (parts.length !== 4) {
    return null;
  }

  const quantity = Number(parts[1]);
  if (!parts[0] || !Number.isFinite(quantity) || quantity <= 0 || !parts[2] || !parts[3]) {
    return null;
  }

  return {
    itemCode: parts[0],
    qrQuantity: quantity,
    uom: parts[2],
    lotNo: parts[3],
  };
};

const getTime = () =>
  new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const ScanPage: React.FC<ScanPageProps> = ({ employee, initialMode, sessionKey }) => {
  const [mode, setMode] = React.useState<ScanMode>(initialMode);
  const [step, setStep] = React.useState<ScanStep>("reconciliation");
  const [scanValue, setScanValue] = React.useState("");
  const [reconciliationCode, setReconciliationCode] = React.useState("");
  const [currentBin, setCurrentBin] = React.useState<BinLocation | null>(null);
  const [pendingItem, setPendingItem] = React.useState<PendingItem | null>(null);
  const [entries, setEntries] = React.useState<ItemScan[]>(() => loadLocalScanEntries(employee.id));
  const [message, setMessage] = React.useState("Select a mode, then scan the reconciliation QR first.");
  const [qtyDefaultActive, setQtyDefaultActive] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitResult, setSubmitResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [deviceId, setDeviceId] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const scannerBufferRef = React.useRef("");

  React.useEffect(() => {
    Device.getId()
      .then((info) => setDeviceId(info.identifier))
      .catch(() => setDeviceId(""));
  }, []);

  React.useEffect(() => {
    saveLocalScanEntries(employee.id, entries);
  }, [employee.id, entries]);

  const handleSubmitToErp = React.useCallback(async () => {
    if (!reconciliationCode || isSubmitting) return;

    const pcountEntries = entries
      .filter((e) => e.mode === "pcount" && e.reconciliationCode === reconciliationCode)
      .map((e) => ({
        itemCode: e.itemCode,
        quantity: e.quantity,
        uom: e.uom,
        lotNo: e.lotNo,
        deviceId: e.deviceId,
        bin: e.bin,
      }));

    if (pcountEntries.length === 0) {
      setSubmitResult({ ok: false, text: "No P. Count entries to submit." });
      return;
    }

    setIsSubmitting(true);
    setSubmitResult(null);
    try {
      const result = await submitPcountEntries(reconciliationCode, pcountEntries);
      setSubmitResult({ ok: true, text: `${result.itemCount} item(s) saved to ${reconciliationCode}.` });
    } catch (err) {
      setSubmitResult({ ok: false, text: err instanceof Error ? err.message : "Submit failed." });
    } finally {
      setIsSubmitting(false);
    }
  }, [entries, isSubmitting, reconciliationCode]);

  const focusScanner = React.useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const triggerScanner = React.useCallback(() => {
    focusScanner();
    window.QcmcScanner?.startScan?.();
  }, [focusScanner]);

  const stopScanner = React.useCallback(() => {
    window.QcmcScanner?.stopScan?.();
  }, []);

  React.useEffect(() => {
    setMode(initialMode);
    setStep("reconciliation");
    setReconciliationCode("");
    setCurrentBin(null);
    setPendingItem(null);
    setScanValue("");
    setQtyDefaultActive(false);
    scannerBufferRef.current = "";
    setMessage(`${modeLabels[initialMode]} selected. Scan the reconciliation QR first.`);
  }, [initialMode, sessionKey]);

  React.useEffect(() => {
    focusScanner();
  }, [focusScanner, mode, step]);

  const scanAnotherBin = () => {
    setStep("bin");
    setCurrentBin(null);
    setPendingItem(null);
    setScanValue("");
    setQtyDefaultActive(false);
    scannerBufferRef.current = "";
    setMessage("Scan the next bin QR.");
  };

  const scanAnotherReconciliation = () => {
    setStep("reconciliation");
    setReconciliationCode("");
    setCurrentBin(null);
    setPendingItem(null);
    setScanValue("");
    setQtyDefaultActive(false);
    scannerBufferRef.current = "";
    setMessage("Scan the reconciliation QR.");
  };

  const processScan = React.useCallback(
    (rawCode: string) => {
      stopScanner();
      const code = rawCode.trim();
      if (!code) return;

      if (step === "reconciliation") {
        if (parseBin(code) || parseItem(code)) {
          setMessage("Scan the reconciliation QR first. Bin and item QR codes are not accepted yet.");
          setScanValue("");
          setQtyDefaultActive(false);
          return;
        }

        setReconciliationCode(code);
        setCurrentBin(null);
        setPendingItem(null);
        setStep("bin");
        setScanValue("");
        setQtyDefaultActive(false);
        scannerBufferRef.current = "";
        setMessage("Reconciliation QR selected. Tap Scan to scan the bin QR.");
        return;
      }

      if (step === "bin") {
        const bin = parseBin(code);
        if (!bin) {
          setMessage("Invalid bin QR. Expected: Stockroom;Building;Aisle;Rack;Bin.");
          setScanValue("");
          return;
        }

        setCurrentBin(bin);
        setPendingItem(null);
        setStep("item");
        setScanValue("");
        setQtyDefaultActive(false);
        scannerBufferRef.current = "";
        setMessage(`${bin.bin} selected. Tap Scan to scan item barcode.`);
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
        return;
      }

      if (!currentBin) {
        setStep("bin");
        setPendingItem(null);
        setMessage("Scan the bin QR first.");
        setScanValue("");
        setQtyDefaultActive(false);
        scannerBufferRef.current = "";
        return;
      }

      if (step === "qty") {
        if (!pendingItem) {
          setStep("item");
          setMessage("Scan item barcode first.");
          setScanValue("");
          setQtyDefaultActive(false);
          scannerBufferRef.current = "";
          return;
        }

        const multiplier = Number(code);
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
          setMessage("Invalid qty. Enter a number greater than 0.");
          setScanValue("");
          setQtyDefaultActive(false);
          return;
        }

        const quantity = pendingItem.qrQuantity * multiplier;
        setEntries((current) => [
          {
            raw: pendingItem.raw,
            mode,
            reconciliationCode,
            bin: currentBin,
            itemCode: pendingItem.itemCode,
            qrQuantity: pendingItem.qrQuantity,
            multiplier,
            quantity,
            uom: pendingItem.uom,
            lotNo: pendingItem.lotNo,
            timestamp: getTime(),
            deviceId,
          },
          ...current,
        ]);
        setPendingItem(null);
        setStep("item");
        setScanValue("");
        setQtyDefaultActive(false);
        scannerBufferRef.current = "";
        setMessage(
          `${pendingItem.itemCode} recorded: ${pendingItem.qrQuantity.toFixed(2)} x ${multiplier} = ${quantity.toFixed(2)} ${pendingItem.uom}.`
        );
        return;
      }

      const item = parseItem(code);
      if (!item) {
        setMessage("Invalid item barcode. Expected: Item;Qty;UOM;Lot.");
        setScanValue("");
        return;
      }

      setPendingItem({ raw: code, ...item });
      setStep("qty");
      setScanValue("1");
      setQtyDefaultActive(true);
      scannerBufferRef.current = "";
      setMessage(
        `${item.itemCode} scanned. QR qty is ${item.qrQuantity.toFixed(2)} ${item.uom}. Enter qty to multiply.`
      );
    },
    [currentBin, deviceId, mode, pendingItem, reconciliationCode, step, stopScanner]
  );

  React.useEffect(() => {
    const handleNativeScan = (event: Event) => {
      const scanEvent = event as CustomEvent<{ code?: string }>;
      processScan(scanEvent.detail?.code || "");
    };

    window.addEventListener("qcmc-scanner-data", handleNativeScan);
    return () => window.removeEventListener("qcmc-scanner-data", handleNativeScan);
  }, [processScan]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
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

  const handleInputFocus = () => {
    if (step === "qty" && qtyDefaultActive) {
      inputRef.current?.select();
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (step !== "qty") {
      return;
    }

    if (step === "qty" && qtyDefaultActive) {
      const value = event.target.value;
      setQtyDefaultActive(false);
      setScanValue(value === "1" ? "" : value.replace(/^1/, ""));
      return;
    }

    setScanValue(event.target.value);
  };

  const latest = entries[0];

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
        }
        .scan-history-row {
          display: grid;
          grid-template-columns: 76px minmax(0, 1fr) 82px;
          gap: 10px;
          align-items: center;
          padding: 12px 14px;
          border-bottom: 1px solid hsl(var(--border));
        }
        .scan-history-row:last-child {
          border-bottom: 0;
        }
        .scan-history-mode {
          font-size: 12px;
          font-weight: 800;
          color: hsl(var(--primary));
        }
        .scan-history-main {
          min-width: 0;
        }
        .scan-history-code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          font-weight: 700;
          color: hsl(var(--foreground));
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

        @media (min-width: 768px) {
          .scan-page {
            max-width: 860px;
            margin: 0 auto;
          }
          .scan-context {
            grid-template-columns: repeat(3, minmax(0, 1fr));
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
          .scan-history-row {
            grid-template-columns: 62px minmax(0, 1fr);
          }
          .scan-history-time {
            display: none;
          }
        }
      `}</style>

      <section className="scan-page" onClick={focusScanner}>
        <div className="scan-panel">
          <div className="scan-hero">
            <div>
              <h1 className="scan-title">Inventory Scanner</h1>
              <p className="scan-sub">{employee.full_name}</p>
            </div>
            <div className="scan-icon">
              <Barcode size={24} />
            </div>
          </div>

          <div className="scan-context">
            <div className="scan-context-card">
              <div className="scan-context-title">
                <Layers3 size={15} />
                Current Mode
              </div>
              <div className="scan-context-main">{modeLabels[mode]}</div>
              <div className="scan-context-detail">
                {mode === "pcount" ? "Physical count for actual stock on hand." : "Inventory item movement."}
              </div>
            </div>

            <div className="scan-context-card">
              <div className="scan-context-title">
                <CheckCircle2 size={15} />
                Reconciliation
              </div>
              <div className="scan-context-main">
                {reconciliationCode ? "Selected" : "Not scanned"}
              </div>
              <div className="scan-context-detail">
                {reconciliationCode || "First scan must be the reconciliation QR."}
              </div>
            </div>

            <div className="scan-context-card">
              <div className="scan-context-title">
                <MapPin size={15} />
                Current Bin
              </div>
              <div className="scan-context-main">{currentBin ? currentBin.bin : "No bin selected"}</div>
              <div className="scan-context-detail">
                {currentBin
                  ? `${currentBin.stockroom} / ${currentBin.building} / ${currentBin.aisle} / ${currentBin.rack}`
                  : "Scan bin after reconciliation QR."}
              </div>
            </div>
          </div>

          <div className="scan-capture">
            <label className="scan-input-label" htmlFor="scanner-input">
              Scanner Input
              <span className="scan-step-pill">
                {step === "reconciliation"
                  ? "Scan Reconciliation"
                  : step === "bin"
                    ? "Scan Bin"
                    : step === "item"
                      ? "Scan Item"
                      : "Enter Qty"}
              </span>
            </label>
            <input
              id="scanner-input"
              ref={inputRef}
              className="scan-input"
              value={scanValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={handleInputFocus}
              placeholder={
                step === "reconciliation"
                  ? "Scan reconciliation QR"
                  : step === "bin"
                    ? "Stockroom;Bldg;Aisle;Rack;Bin"
                    : step === "item"
                      ? "Item;Qty;UOM;Lot"
                      : "Enter qty"
              }
              autoCapitalize="off"
              autoCorrect="off"
              inputMode={step === "qty" ? "decimal" : "none"}
            />
            <div className="scan-actions">
              <button type="button" className="scan-action" onClick={triggerScanner}>
                <Barcode size={15} />
                Scan
              </button>
              <button type="button" className="scan-action" onClick={scanAnotherReconciliation}>
                <CheckCircle2 size={15} />
                Change Reconciliation
              </button>
              <button type="button" className="scan-action" onClick={scanAnotherBin}>
                <RotateCcw size={15} />
                Change Bin
              </button>
              {mode === "pcount" && entries.length > 0 && (
                <button
                  type="button"
                  className="scan-action"
                  style={{ background: "hsl(var(--primary))", color: "white", borderColor: "transparent", opacity: isSubmitting ? 0.6 : 1 }}
                  onClick={handleSubmitToErp}
                  disabled={isSubmitting}
                >
                  <Send size={15} />
                  {isSubmitting ? "Submitting…" : "Submit to ERP"}
                </button>
              )}
            </div>
            <div className="scan-message">{message}</div>
            {submitResult && (
              <div
                className="scan-message"
                style={{ color: submitResult.ok ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)", fontWeight: 700 }}
              >
                {submitResult.text}
              </div>
            )}
          </div>

          <div className="scan-status">
            <div className="scan-status-icon">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <div className="scan-status-code">{latest ? latest.itemCode : "Ready to scan"}</div>
              <div className="scan-status-meta">
                {latest
                  ? `${latest.qrQuantity.toFixed(2)} x ${latest.multiplier} = ${latest.quantity.toFixed(2)} ${latest.uom} / ${latest.bin.bin}`
                  : pendingItem
                    ? `${pendingItem.itemCode}: ${pendingItem.qrQuantity.toFixed(2)} ${pendingItem.uom} per qty`
                    : `Current step: ${
                        step === "reconciliation"
                          ? "scan reconciliation first"
                          : step === "bin"
                            ? "scan bin"
                            : step === "item"
                              ? "scan item"
                              : "enter qty"
                      }`}
              </div>
            </div>
          </div>
        </div>

        <div className="scan-panel scan-history">
          {entries.length > 0 ? (
            entries.slice(0, 30).map((entry, index) => (
              <div className="scan-history-row" key={`${entry.timestamp}-${entry.raw}-${index}`}>
                <div className="scan-history-mode">{modeLabels[entry.mode]}</div>
                <div className="scan-history-main">
                  <div className="scan-history-code">
                    {entry.itemCode} - {entry.quantity.toFixed(2)} {entry.uom}
                  </div>
                  <div className="scan-history-detail">
                    {entry.qrQuantity.toFixed(2)} x {entry.multiplier} / Lot {entry.lotNo} / {entry.bin.bin} / {entry.reconciliationCode}
                  </div>
                </div>
                <div className="scan-history-time">{entry.timestamp}</div>
              </div>
            ))
          ) : (
            <div className="scan-empty">Scan reconciliation QR, then bin, item, and qty.</div>
          )}
        </div>
      </section>
    </>
  );
};

export default ScanPage;
