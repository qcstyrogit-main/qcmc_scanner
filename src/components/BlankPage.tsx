import React from "react";
import Navigation from "@/components/Navigation";
import ScanPage, { type ScanMode } from "@/components/ScanPage";
import type { Employee, ViewType } from "@/types";
import { LogIn, LogOut, PackageCheck, X } from "lucide-react";

interface BlankPageProps {
  employee: Employee;
}

const BlankPage: React.FC<BlankPageProps> = ({ employee }) => {
  const [currentView, setCurrentView] = React.useState<ViewType>("dashboard");
  const [scanMode, setScanMode] = React.useState<ScanMode>("in");
  const [scanSessionKey, setScanSessionKey] = React.useState(0);
  const [showScanModeModal, setShowScanModeModal] = React.useState(false);
  const showScanPage = currentView === "scan";

  const openScanModeModal = () => {
    setShowScanModeModal(true);
  };

  const startScanner = (mode: ScanMode) => {
    setScanMode(mode);
    setScanSessionKey((key) => key + 1);
    setCurrentView("scan");
    setShowScanModeModal(false);
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
        background: hsl(var(--card));
        border: 1px solid hsl(var(--primary) / 0.15);
        border-radius: 20px;
        position: relative;
        overflow: hidden;
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
      }

      @media (max-width: 767px) {
        .bp-main { padding-bottom: 92px; }
        .bp-blank { min-height: calc(100vh - 124px); }
        .bp-surface { min-height: calc(100vh - 124px); }
      }

      .bp-blank { animation: bpFade 0.5s cubic-bezier(0.16,1,0.3,1) 0.08s both; }
      @keyframes bpFade { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

      .scan-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 80;
        background: rgba(15, 23, 42, 0.38);
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding: 18px;
      }
      .scan-modal {
        width: min(100%, 420px);
        background: hsl(var(--card));
        border: 1px solid hsl(var(--primary) / 0.18);
        border-radius: 18px;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
        overflow: hidden;
        animation: bpFade 0.22s ease both;
      }
      .scan-modal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 16px 10px;
      }
      .scan-modal-title {
        font-size: 18px;
        font-weight: 800;
        color: hsl(var(--foreground));
      }
      .scan-modal-sub {
        margin-top: 4px;
        font-size: 12px;
        color: hsl(var(--muted-foreground));
      }
      .scan-modal-close {
        width: 36px;
        height: 36px;
        border: 1px solid hsl(var(--border));
        border-radius: 10px;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .scan-modal-options {
        display: grid;
        gap: 10px;
        padding: 12px 16px 16px;
      }
      .scan-modal-option {
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
      .scan-modal-option-icon {
        width: 42px;
        height: 42px;
        border-radius: 12px;
        background: hsl(var(--primary) / 0.1);
        color: hsl(var(--primary));
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .scan-modal-option-title {
        font-size: 15px;
        font-weight: 800;
      }
      .scan-modal-option-sub {
        margin-top: 2px;
        font-size: 11px;
        color: hsl(var(--muted-foreground));
      }

      @media (min-width: 768px) {
        .scan-modal-backdrop {
          align-items: center;
        }
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
        onScanClick={openScanModeModal}
      />

      <main className="bp-main">
        {showScanPage ? (
          <div className="bp-surface">
            <ScanPage employee={employee} initialMode={scanMode} sessionKey={scanSessionKey} />
          </div>
        ) : (
          <div className="bp-blank" />
        )}
      </main>

      {showScanModeModal && (
        <div className="scan-modal-backdrop" onClick={() => setShowScanModeModal(false)}>
          <div className="scan-modal" onClick={(event) => event.stopPropagation()}>
            <div className="scan-modal-head">
              <div>
                <div className="scan-modal-title">Select Scan Type</div>
                <div className="scan-modal-sub">Choose the transaction before scanning the bin.</div>
              </div>
              <button type="button" className="scan-modal-close" onClick={() => setShowScanModeModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="scan-modal-options">
              <button type="button" className="scan-modal-option" onClick={() => startScanner("in")}>
                <span className="scan-modal-option-icon"><LogIn size={20} /></span>
                <span>
                  <span className="scan-modal-option-title">IN</span>
                  <span className="scan-modal-option-sub">Receive items into a bin.</span>
                </span>
              </button>
              <button type="button" className="scan-modal-option" onClick={() => startScanner("out")}>
                <span className="scan-modal-option-icon"><LogOut size={20} /></span>
                <span>
                  <span className="scan-modal-option-title">OUT</span>
                  <span className="scan-modal-option-sub">Issue items out from a bin.</span>
                </span>
              </button>
              <button type="button" className="scan-modal-option" onClick={() => startScanner("pcount")}>
                <span className="scan-modal-option-icon"><PackageCheck size={20} /></span>
                <span>
                  <span className="scan-modal-option-title">P. Count</span>
                  <span className="scan-modal-option-sub">Count actual stock in a bin.</span>
                </span>
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
