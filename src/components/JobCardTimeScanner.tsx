import React from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { CheckCircle2, Clock3, Square } from "lucide-react";
import AppToast, { type ToastKind, type ToastNotice } from "@/components/AppToast";
import type { Employee } from "@/types";
import {
  clearActiveJobCardTimeSession,
  completeJobCardTime,
  getJobCardTimeContext,
  JobCardTimeApiError,
  loadActiveJobCardTimeSession,
  parseEmployeeScan,
  parseJobCardPackingQr,
  saveActiveJobCardTimeSession,
  startJobCardTime,
  type ActiveJobCardTimeSession,
  type JobCardTimeContext,
  type JobCardTimeLog,
} from "@/lib/jobCardTimeService";
import "@/components/JobCardTimeScanner.css";

interface Props { employee: Employee; onBack: () => void }
type SessionState = "NOT STARTED" | "RUNNING" | "COMPLETED";

const apiErrorText = (error: unknown, fallback: string) => {
  if (error instanceof JobCardTimeApiError) return `${error.message}${error.code ? ` [${error.code}]` : ""}`;
  return error instanceof Error ? error.message : fallback;
};

const parseErpTime = (value: string) => {
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : Date.now();
};

const elapsedLabel = (fromTime: string, now: number) => {
  const seconds = Math.max(0, Math.floor((now - parseErpTime(fromTime)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
};

const JobCardTimeScanner: React.FC<Props> = ({ employee, onBack }) => {
  const initialSession = React.useMemo(loadActiveJobCardTimeSession, []);
  const [employeeId, setEmployeeId] = React.useState(initialSession?.employee || "");
  const [context, setContext] = React.useState<JobCardTimeContext | null>(null);
  const [activeSession, setActiveSession] = React.useState<ActiveJobCardTimeSession | null>(initialSession);
  const [completedLog, setCompletedLog] = React.useState<JobCardTimeLog | null>(null);
  const [completedQty, setCompletedQty] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState(initialSession ? "Restoring active ERP timer..." : "Select or scan an employee first.");
  const [toast, setToast] = React.useState<ToastNotice | null>(null);
  const [now, setNow] = React.useState(Date.now());
  const scannerInputRef = React.useRef<HTMLInputElement>(null);
  const scannerBufferRef = React.useRef("");
  const restoredRef = React.useRef(false);

  const state: SessionState = completedLog ? "COMPLETED" : activeSession ? "RUNNING" : "NOT STARTED";
  const notify = React.useCallback((kind: ToastKind, text: string) => setToast({ id: Date.now(), kind, message: text }), []);
  const focusScanner = React.useCallback(() => window.requestAnimationFrame(() => {
    scannerInputRef.current?.focus({ preventScroll: true });
  }), []);

  React.useEffect(() => {
    const restoreFocus = () => {
      if (!busy && document.activeElement?.id !== "jct-employee" && document.activeElement?.id !== "jct-qty") focusScanner();
    };
    const handleVisibility = () => { if (document.visibilityState === "visible") restoreFocus(); };
    window.addEventListener("focus", restoreFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", restoreFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [busy, focusScanner]);

  const loadContext = React.useCallback(async (jobCardId: string) => {
    const selectedEmployee = employeeId.trim();
    if (!selectedEmployee) {
      notify("warning", "Select or scan an employee before scanning the Job Card.");
      setMessage("Employee is required before the Job Card.");
      focusScanner();
      return;
    }
    setBusy(true);
    setMessage(`Loading ${jobCardId} from ERPNext...`);
    try {
      const loaded = await getJobCardTimeContext(jobCardId);
      const expectedEmployee = initialSession?.jobCardId === loaded.jobCardId
        ? initialSession.employee
        : selectedEmployee;
      const canCompleteAtomically = loaded.status.toLowerCase() === "work in progress" &&
        loaded.startedWithoutTimeLog && Boolean(loaded.actualStartDate);
      let session: ActiveJobCardTimeSession;
      let resumed = false;

      if (canCompleteAtomically) {
        session = {
          jobCardId: loaded.jobCardId,
          employee: expectedEmployee,
          employeeName: "",
          timeLogId: "",
          fromTime: loaded.actualStartDate,
          completeWithoutTimeLogId: true,
        };
      } else {
        const startResult = await startJobCardTime(loaded.jobCardId, expectedEmployee);
        const openLog = startResult.timeLog;
        if (!openLog.timeLogId || !openLog.fromTime) {
          throw new JobCardTimeApiError(
            "ERPNext did not return a valid open Time Log ID and From Time.",
            "NO_OPEN_TIME_LOG"
          );
        }
        resumed = startResult.duplicateRequest;
        session = {
          jobCardId: loaded.jobCardId,
          employee: openLog.employee,
          employeeName: openLog.employeeName,
          timeLogId: openLog.timeLogId,
          fromTime: openLog.fromTime,
        };
      }
      saveActiveJobCardTimeSession(session);
      setContext(loaded);
      setActiveSession(session);
      setEmployeeId(session.employee);
      setCompletedLog(null);
      setMessage(canCompleteAtomically
        ? "Job Card is Work In Progress. Enter the completed quantity."
        : resumed
          ? "Existing employee timer resumed. Enter the completed quantity."
          : "Employee timer started. Enter the completed quantity.");
    } catch (error) {
      notify("error", apiErrorText(error, "Unable to load the Job Card."));
      setMessage("Job Card was not loaded. Scan it again.");
    } finally {
      setBusy(false);
      focusScanner();
    }
  }, [employeeId, focusScanner, initialSession, notify]);

  React.useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (initialSession?.jobCardId) void loadContext(initialSession.jobCardId);
  }, [initialSession, loadContext]);

  React.useEffect(() => {
    if (!activeSession) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeSession]);

  const processScan = React.useCallback(async (raw: string) => {
    if (busy) return;
    const scannedEmployee = parseEmployeeScan(raw);
    if (scannedEmployee) {
      if (activeSession && activeSession.employee.toLowerCase() !== scannedEmployee.toLowerCase()) {
        notify("warning", `Complete the active Job Card for ${activeSession.employee} first.`);
        return;
      }
      setEmployeeId(scannedEmployee);
      setMessage(`Employee ${scannedEmployee} selected. Scan the already-started Job Card.`);
      notify("success", `Employee ${scannedEmployee} selected.`);
      return;
    }
    const qr = parseJobCardPackingQr(raw);
    if (qr) {
      if (activeSession && activeSession.jobCardId !== qr.jobCardId) {
        notify("warning", `Complete active Job Card ${activeSession.jobCardId} before opening ${qr.jobCardId}.`);
        return;
      }
      await loadContext(qr.jobCardId);
      return;
    }
    notify("warning", "Unsupported QR. Scan a Job Card QR.");
  }, [activeSession, busy, loadContext, notify]);

  React.useEffect(() => {
    const handler = (event: Event) => void processScan((event as CustomEvent<{ code?: string }>).detail?.code || "");
    window.addEventListener("qcmc-scanner-data", handler);
    return () => window.removeEventListener("qcmc-scanner-data", handler);
  }, [processScan]);

  const handleScannerKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const raw = scannerBufferRef.current;
      scannerBufferRef.current = "";
      if (raw) void processScan(raw);
    } else if (event.key === "Escape" || event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault(); scannerBufferRef.current = "";
    } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault(); scannerBufferRef.current += event.key;
    }
  };

  React.useEffect(() => {
    let listener: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;
    void CapacitorApp.addListener("backButton", onBack).then((handle) => { listener = handle; });
    return () => { void listener?.remove(); };
  }, [onBack]);

  const complete = async () => {
    if (!context || !activeSession || busy) return;
    const quantity = Number(completedQty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      notify("warning", "Completed Qty must be greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const result = await completeJobCardTime(
        context.jobCardId,
        activeSession.employee,
        activeSession.completeWithoutTimeLogId ? undefined : activeSession.timeLogId,
        quantity
      );
      clearActiveJobCardTimeSession();
      setActiveSession(null);
      setCompletedLog(result.timeLog);
      setCompletedQty("");
      setMessage(result.duplicateRequest ? "Original completed ERP time log loaded." : "Work completed in ERPNext.");
      notify("success", result.duplicateRequest ? "Completion already recorded in ERPNext." : "Work completed successfully.");
      try {
        const refreshed = await getJobCardTimeContext(context.jobCardId);
        setContext(refreshed);
      } catch {
        setMessage("Work completed in ERPNext. Use Refresh to reload the latest Job Card totals.");
      }
    } catch (error) { notify("error", apiErrorText(error, "Unable to complete work.")); }
    finally { setBusy(false); focusScanner(); }
  };

  return <div className="jct-page">
    <header className="jct-head">
      <div><h1>Complete Job Card</h1><p>Scan an already-started Job Card</p></div>
      <span className={`jct-state is-${state.toLowerCase().replace(" ", "-")}`}>{state}</span>
    </header>
    <main className="jct-body" onClick={focusScanner}>
      <AppToast toast={toast} onClose={() => setToast(null)}/>
      <div className="jct-scroll">
        <section className="jct-card">
          <label className="jct-label" htmlFor="jct-employee">Employee</label>
          <input id="jct-employee" className="jct-employee" value={employeeId}
            disabled={Boolean(activeSession) || busy}
            onChange={(event) => {
              setEmployeeId(event.target.value);
              setMessage(event.target.value.trim() ? "Scan the already-started Job Card." : "Select or scan an employee first.");
            }}
            onClick={(event) => event.stopPropagation()}
            placeholder="Scan or enter Employee ID"/>
          <small>{activeSession?.employeeName || `Signed in as ${employee.full_name}`}</small>
        </section>

        {!context && <section className="jct-empty"><Clock3 size={34}/><h2>Scan Job Card QR</h2><p>Select an employee, then scan the active ERPNext Job Card.</p></section>}

        {context && <>
          <section className="jct-card jct-context">
            <div className="jct-card-top"><div><span>Job Card</span><strong>{context.jobCardId}</strong></div></div>
            <div className="jct-grid">
              <div><span>Operation</span><strong>{context.operation || "-"}</strong></div>
              <div><span>Item</span><strong>{context.itemCode}</strong><small>{context.itemName}</small></div>
            </div>
          </section>

          {activeSession && <section className="jct-running">
            <div className="jct-running-icon"><Clock3 size={24}/></div><div><span>Phone-side elapsed estimate</span><strong>{elapsedLabel(activeSession.fromTime, now)}</strong></div>
            <div className="jct-official"><span>Official ERP From Time</span><strong>{activeSession.fromTime}</strong></div>
          </section>}

          {completedLog && <section className="jct-complete">
            <CheckCircle2 size={30}/><h2>Completed</h2>
            <div className="jct-grid">
              <div><span>Employee</span><strong>{completedLog.employeeName || completedLog.employee}</strong></div>
              <div><span>Completed Qty</span><strong>{completedLog.completedQty.toLocaleString()}</strong></div>
              <div><span>From</span><strong>{completedLog.fromTime}</strong></div>
              <div><span>To</span><strong>{completedLog.toTime}</strong></div>
              <div><span>ERP Time</span><strong>{completedLog.timeInMins.toLocaleString()} min</strong></div>
            </div>
          </section>}

        </>}
      </div>

      <input ref={scannerInputRef} className="jct-scanner" readOnly inputMode="none" onKeyDown={handleScannerKey}
        onBlur={() => { window.setTimeout(() => { if (!busy && document.activeElement?.id !== "jct-employee" && document.activeElement?.id !== "jct-qty") focusScanner(); }, 0); }} placeholder={busy ? "Waiting for ERPNext..." : "Waiting for scanner..."}/>
      <div className="jct-message">{message}</div>
      <div className="jct-dock">
        {context && activeSession && <><label className="jct-label" htmlFor="jct-qty">Completed Qty for this session</label><input id="jct-qty" className="jct-qty" type="number" min="0" step="any" value={completedQty} onChange={(event) => setCompletedQty(event.target.value)} onClick={(event) => event.stopPropagation()} placeholder="Enter completed quantity"/><button className="jct-danger" disabled={busy} onClick={(event) => { event.stopPropagation(); void complete(); }}><Square size={16}/> Complete Work</button></>}
        {context && state === "COMPLETED" && <button className="jct-primary" onClick={(event) => { event.stopPropagation(); setCompletedLog(null); setContext(null); setMessage("Scan the next Job Card QR."); focusScanner(); }}>Scan Another Job Card</button>}
      </div>
    </main>
  </div>;
};

export default JobCardTimeScanner;
