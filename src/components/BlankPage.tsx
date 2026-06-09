import React from "react";
import Navigation from "@/components/Navigation";
import ScanPage, { type ScanMode } from "@/components/ScanPage";
import type { Employee, ViewType } from "@/types";
import { submitPcountEntries } from "@/lib/erpService";
import {
  loadLocalScanEntries,
  loadScannerDeviceName,
  saveScannerDeviceName,
  type LocalScanEntry,
} from "@/lib/scanStorage";
import { ArrowLeft, Clock, LogIn, LogOut, PackageCheck, Power, Send, Smartphone } from "lucide-react";

interface BlankPageProps {
  employee: Employee;
  onLogout: () => void;
}

const BlankPage: React.FC<BlankPageProps> = ({ employee, onLogout }) => {
  const [currentView, setCurrentView] = React.useState<ViewType>("dashboard");
  const [scanMode, setScanMode] = React.useState<ScanMode>("in");
  const [scanSessionKey, setScanSessionKey] = React.useState(0);
  const [showLogoutConfirm, setShowLogoutConfirm] = React.useState(false);
  const [showDeviceNameDialog, setShowDeviceNameDialog] = React.useState(false);
  const [deviceNameInput, setDeviceNameInput] = React.useState(() => loadScannerDeviceName());
  const [selectedReconciliation, setSelectedReconciliation] = React.useState<string | null>(null);
  const [historySubmitState, setHistorySubmitState] = React.useState<{
    isSubmitting: boolean;
    result: { ok: boolean; text: string } | null;
  }>({ isSubmitting: false, result: null });
  const showScanPage = currentView === "scan";
  const savedScanEntries = React.useMemo(
    () => (currentView === "history" ? loadLocalScanEntries(employee.id) : []),
    [currentView, employee.id]
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
      latestTimestamp: entries[0]?.timestamp || "",
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

  const startScanner = (mode: ScanMode) => {
    setScanMode(mode);
    setScanSessionKey((key) => key + 1);
    setCurrentView("scan");
  };

  const goBackHome = () => {
    setShowLogoutConfirm(false);
    setSelectedReconciliation(null);
    setHistorySubmitState({ isSubmitting: false, result: null });
    setCurrentView("dashboard");
  };

  const openHistory = () => {
    setSelectedReconciliation(null);
    setHistorySubmitState({ isSubmitting: false, result: null });
    setCurrentView("history");
  };

  const saveDeviceName = () => {
    saveScannerDeviceName(deviceNameInput);
    setDeviceNameInput(loadScannerDeviceName());
    setShowDeviceNameDialog(false);
  };

  const openReconciliation = (reference: string) => {
    setSelectedReconciliation(reference);
    setHistorySubmitState({ isSubmitting: false, result: null });
  };

  const closeReconciliation = () => {
    setSelectedReconciliation(null);
    setHistorySubmitState({ isSubmitting: false, result: null });
  };

  const submitSelectedReconciliation = async () => {
    if (!selectedReconciliation || historySubmitState.isSubmitting) return;

    const pcountEntries = selectedEntries
      .filter((entry) => entry.mode === "pcount")
      .map((entry) => ({
        itemCode: entry.itemCode,
        quantity: entry.quantity,
        uom: entry.uom,
        lotNo: entry.lotNo,
        deviceId: entry.deviceId,
        bin: entry.bin,
      }));

    if (pcountEntries.length === 0) {
      setHistorySubmitState({
        isSubmitting: false,
        result: { ok: false, text: "No P. Count entries to submit for this reference." },
      });
      return;
    }

    setHistorySubmitState({ isSubmitting: true, result: null });
    try {
      const result = await submitPcountEntries(selectedReconciliation, pcountEntries);
      setHistorySubmitState({
        isSubmitting: false,
        result: { ok: true, text: `${result.itemCount} item(s) saved to ${selectedReconciliation}.` },
      });
    } catch (err) {
      setHistorySubmitState({
        isSubmitting: false,
        result: { ok: false, text: err instanceof Error ? err.message : "Submit failed." },
      });
    }
  };

  return (
    <>
      <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

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
        padding: 20px 16px 28px;
        display: flex;
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
      .home-scan-options {
        display: grid;
        gap: 10px;
        padding: 12px 16px 16px;
      }
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
        outline: none;
        padding: 0 12px;
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
    `}</style>

    <div className="bp-root">
      <div className="bp-blob bp-blob-1" />
      <div className="bp-blob bp-blob-2" />
      <div className="bp-blob bp-blob-3" />

      <Navigation
        employee={employee}
        currentView={currentView}
        onNavigate={setCurrentView}
      />

      <main className="bp-main">
        {showScanPage ? (
          <div className="bp-surface">
            <div className="bp-back-row">
              <button type="button" className="bp-back-button" onClick={goBackHome}>
                <ArrowLeft size={16} />
                Back
              </button>
            </div>
            <ScanPage employee={employee} initialMode={scanMode} sessionKey={scanSessionKey} />
          </div>
        ) : (
          <div className="bp-blank">
            {currentView === "dashboard" && (
              <section className="home-scan-selector" aria-labelledby="home-scan-title">
                <div className="home-scan-head">
                  <div>
                    <div id="home-scan-title" className="home-scan-title">Select Scan Type</div>
                    <div className="home-scan-sub">Choose the transaction before scanning the bin.</div>
                  </div>
                </div>
                <div className="home-scan-options">
                  <button type="button" className="home-scan-option" onClick={() => startScanner("in")}>
                    <span className="home-scan-option-icon"><LogIn size={20} /></span>
                    <span>
                      <span className="home-scan-option-title">IN</span>
                      <span className="home-scan-option-sub">Receive items into a bin.</span>
                    </span>
                  </button>
                  <button type="button" className="home-scan-option" onClick={() => startScanner("out")}>
                    <span className="home-scan-option-icon"><LogOut size={20} /></span>
                    <span>
                      <span className="home-scan-option-title">OUT</span>
                      <span className="home-scan-option-sub">Issue items out from a bin.</span>
                    </span>
                  </button>
                  <button type="button" className="home-scan-option" onClick={() => startScanner("pcount")}>
                    <span className="home-scan-option-icon"><PackageCheck size={20} /></span>
                    <span>
                      <span className="home-scan-option-title">P. Count</span>
                      <span className="home-scan-option-sub">Count actual stock in a bin.</span>
                    </span>
                  </button>
                </div>
                <div className="home-actions">
                  <button type="button" className="home-action" onClick={openHistory}>
                    <Clock size={16} />
                    History
                  </button>
                  <button type="button" className="home-action home-action-danger" onClick={() => setShowLogoutConfirm(true)}>
                    <Power size={16} />
                    Logout
                  </button>
                </div>
                <div className="home-device-name">
                  <button type="button" className="home-action" onClick={() => {
                    setDeviceNameInput(loadScannerDeviceName());
                    setShowDeviceNameDialog(true);
                  }}>
                    <Smartphone size={16} />
                    {loadScannerDeviceName() || "Set Device Name"}
                  </button>
                </div>
              </section>
            )}
            {currentView === "history" && (
              <section className="simple-view" aria-labelledby="history-title">
                <div id="history-title" className="simple-view-title">
                  {selectedReconciliation ? selectedReconciliation : "History"}
                </div>
                <div className="simple-view-text">
                  {selectedReconciliation
                    ? `${selectedEntries.length} item${selectedEntries.length === 1 ? "" : "s"} under this reconciliation reference.`
                    : reconciliationGroups.length > 0
                      ? `${reconciliationGroups.length} reconciliation reference${reconciliationGroups.length === 1 ? "" : "s"} saved on this device.`
                      : "No saved history is available yet."}
                </div>
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
                {selectedReconciliation && (
                  <>
                    <div className="history-list">
                      {selectedEntries.map((entry, index) => (
                        <div className="history-item" key={`${entry.timestamp}-${entry.raw}-${index}`}>
                          <div className="history-item-top">
                            <div className="history-item-code">
                              {entry.itemCode} - {entry.quantity.toFixed(2)} {entry.uom}
                            </div>
                            <div className="history-item-mode">
                              {entry.mode === "pcount" ? "P. Count" : entry.mode.toUpperCase()}
                            </div>
                          </div>
                          <div className="history-item-detail">
                            {entry.qrQuantity.toFixed(2)} x {entry.multiplier} / Lot {entry.lotNo} / {entry.bin.bin}
                          </div>
                          <div className="history-item-detail">{entry.timestamp}</div>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="home-action history-submit"
                      onClick={submitSelectedReconciliation}
                      disabled={historySubmitState.isSubmitting}
                    >
                      <Send size={16} />
                      {historySubmitState.isSubmitting ? "Submitting..." : "Submit to ERP"}
                    </button>
                    {historySubmitState.result && (
                      <div
                        className="history-submit-result"
                        style={{ color: historySubmitState.result.ok ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)" }}
                      >
                        {historySubmitState.result.text}
                      </div>
                    )}
                  </>
                )}
                <div className="simple-view-actions">
                  <button
                    type="button"
                    className="home-action simple-back-button"
                    onClick={selectedReconciliation ? closeReconciliation : goBackHome}
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {showLogoutConfirm && (
        <div className="logout-dialog-backdrop" onClick={() => setShowLogoutConfirm(false)}>
          <div className="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-dialog-title" onClick={(event) => event.stopPropagation()}>
            <div id="logout-dialog-title" className="logout-dialog-title">Logout?</div>
            <div className="logout-dialog-text">Are you sure you want to logout?</div>
            <div className="logout-dialog-actions">
              <button type="button" className="logout-dialog-button" onClick={() => setShowLogoutConfirm(false)}>
                No
              </button>
              <button type="button" className="logout-dialog-button logout-dialog-button-primary" onClick={onLogout}>
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
      {showDeviceNameDialog && (
        <div className="logout-dialog-backdrop" onClick={() => setShowDeviceNameDialog(false)}>
          <div className="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="device-name-title" onClick={(event) => event.stopPropagation()}>
            <div id="device-name-title" className="logout-dialog-title">Device Name</div>
            <div className="logout-dialog-text">This name will be saved with new scans and submitted to ERP.</div>
            <input
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
    </div>
  </>
  );
};

export default BlankPage;
