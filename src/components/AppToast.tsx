import React from "react";
import { AlertTriangle, CheckCircle2, X, XCircle } from "lucide-react";

export type ToastKind = "success" | "warning" | "error";

export type ToastNotice = {
  id: number;
  kind: ToastKind;
  message: string;
};

interface AppToastProps {
  toast: ToastNotice | null;
  onClose: () => void;
}

/** Inline status label; never floats over the scanner, calculator or controls. */
const AppToast: React.FC<AppToastProps> = ({ toast, onClose }) => {
  React.useEffect(() => {
    if (!toast || toast.kind === "error") return;
    const timeout = window.setTimeout(onClose, toast.kind === "warning" ? 8000 : 5000);
    return () => window.clearTimeout(timeout);
  }, [onClose, toast]);

  if (!toast) return null;
  const Icon = toast.kind === "success" ? CheckCircle2 : toast.kind === "warning" ? AlertTriangle : XCircle;

  return (
    <>
      <style>{`
        .app-status-label {
          position: static;
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin: 7px 0;
          padding: 9px 10px;
          border-left: 4px solid;
          border-radius: 7px;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        }
        .app-status-label-success { border-color:#17834c; background:#eaf8ef; color:#176137; }
        .app-status-label-warning { border-color:#d49a22; background:#fff7e6; color:#815407; }
        .app-status-label-error { border-color:#c2363c; background:#fff0f0; color:#a21f27; }
        .app-status-label svg { flex-shrink:0; margin-top:1px; }
        .app-status-label-message {
          flex:1;
          min-width:0;
          font-size:12px;
          font-weight:700;
          line-height:1.4;
          overflow-wrap:anywhere;
        }
        .app-status-label-close {
          flex-shrink:0;
          min-width:28px;
          min-height:28px;
          border:0;
          border-radius:6px;
          background:transparent;
          color:inherit;
          display:flex;
          align-items:center;
          justify-content:center;
        }
      `}</style>
      <div className={`app-status-label app-status-label-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
        <Icon size={17} aria-hidden="true" />
        <span className="app-status-label-message">{toast.message}</span>
        <button type="button" className="app-status-label-close" onClick={onClose} aria-label="Dismiss status"><X size={15} /></button>
      </div>
    </>
  );
};

export default AppToast;

