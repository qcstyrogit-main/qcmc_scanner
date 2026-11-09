import { erpRequest, extractErrorMessage } from "@/lib/erpApi";
import { getErpMobileToken } from "@/lib/erpSession";
import { parsePackingLabelQr } from "@/lib/packingLabelQr";

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const number = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const list = (value: unknown) => Array.isArray(value) ? value : [];

export class JobCardTimeApiError extends Error {
  code: string;
  constructor(message: string, code = "") {
    super(message);
    this.name = "JobCardTimeApiError";
    this.code = code;
  }
}

const call = async (endpoint: string, body: UnknownRecord) => {
  const mobileToken = getErpMobileToken();
  const response = await erpRequest(endpoint, {
    method: "POST",
    body: { ...body, ...(mobileToken ? { mobile_token: mobileToken } : {}) },
  });
  const outer = record(response.data);
  const result = record(outer.message ?? outer);
  if (!response.ok || result.success !== true) {
    throw new JobCardTimeApiError(
      extractErrorMessage(result, `ERPNext request failed (HTTP ${response.status})`),
      text(result.error_code ?? result.code)
    );
  }
  return result;
};

export type JobCardTimeLog = {
  timeLogId: string;
  employee: string;
  employeeName: string;
  fromTime: string;
  toTime: string;
  timeInMins: number;
  completedQty: number;
};

const parseTimeLog = (value: unknown): JobCardTimeLog => {
  const row = record(value);
  return {
    timeLogId: text(row.time_log_id ?? row.name),
    employee: text(row.employee),
    employeeName: text(row.employee_name),
    fromTime: text(row.from_time),
    toTime: text(row.to_time),
    timeInMins: number(row.time_in_mins),
    completedQty: number(row.completed_qty),
  };
};

export type JobCardTimeContext = {
  jobCardId: string;
  workOrderId: string;
  operation: string;
  itemCode: string;
  itemName: string;
  quantityToManufacture: number;
  totalCompletedQty: number;
  totalTimeInMins: number;
  status: string;
  startedWithoutTimeLog: boolean;
  actualStartDate: string;
  timeLogs: JobCardTimeLog[];
};

export const getJobCardTimeContext = async (jobCardId: string): Promise<JobCardTimeContext> => {
  const result = await call(
    "/api/method/qcmc_logic.api.job_card_time_log.get_job_card_time_context",
    { job_card_id: jobCardId }
  );
  return {
    jobCardId: text(result.job_card_id ?? result.name) || jobCardId,
    workOrderId: text(result.work_order_id ?? result.work_order),
    operation: text(result.operation),
    itemCode: text(result.item_code ?? result.production_item),
    itemName: text(result.item_name),
    quantityToManufacture: number(result.quantity_to_manufacture ?? result.for_quantity ?? result.qty),
    totalCompletedQty: number(result.total_completed_qty ?? result.completed_qty),
    totalTimeInMins: number(result.total_time_in_minutes ?? result.total_time_in_mins ?? result.total_time),
    status: text(result.status),
    startedWithoutTimeLog: result.started_without_time_log === true,
    actualStartDate: text(result.actual_start_date),
    timeLogs: list(result.time_logs).map(parseTimeLog).filter((row) => row.timeLogId),
  };
};

export type JobCardTimeResult = {
  duplicateRequest: boolean;
  timeLog: JobCardTimeLog;
};

export const startJobCardTime = async (jobCardId: string, employee: string): Promise<JobCardTimeResult> => {
  const result = await call(
    "/api/method/qcmc_logic.api.job_card_time_log.start_job_card_time",
    { job_card_id: jobCardId, employee }
  );
  return {
    duplicateRequest: result.duplicate_request === true,
    timeLog: parseTimeLog(result.time_log),
  };
};

export const completeJobCardTime = async (
  jobCardId: string,
  employee: string,
  timeLogId: string | undefined,
  completedQty: number
): Promise<JobCardTimeResult> => {
  const result = await call(
    "/api/method/qcmc_logic.api.job_card_time_log.complete_job_card_time",
    {
      job_card_id: jobCardId,
      employee,
      ...(timeLogId ? { time_log_id: timeLogId } : {}),
      completed_qty: completedQty,
    }
  );
  return {
    duplicateRequest: result.duplicate_request === true,
    timeLog: parseTimeLog(result.time_log),
  };
};

export type ActiveJobCardTimeSession = {
  jobCardId: string;
  employee: string;
  employeeName: string;
  timeLogId: string;
  fromTime: string;
  completeWithoutTimeLogId?: boolean;
};

const ACTIVE_SESSION_KEY = "qcmc.jobCardTime.active.v1";

export const loadActiveJobCardTimeSession = (): ActiveJobCardTimeSession | null => {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as ActiveJobCardTimeSession;
    return value.jobCardId && value.employee && value.fromTime &&
      (value.timeLogId || value.completeWithoutTimeLogId === true) ? value : null;
  } catch { return null; }
};

export const saveActiveJobCardTimeSession = (session: ActiveJobCardTimeSession) => {
  try { localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session)); }
  catch { /* The live screen still retains the authoritative ERP session. */ }
};

export const clearActiveJobCardTimeSession = () => {
  try { localStorage.removeItem(ACTIVE_SESSION_KEY); }
  catch { /* Ignore storage cleanup failures after ERP success. */ }
};

const cleanScanText = (raw: string) => Array.from(raw)
  .filter((character) => {
    const code = character.charCodeAt(0);
    return code > 31 && code !== 127;
  })
  .join("")
  .trim();

const looksLikeJobCardId = (value: string) =>
  /^(?:[A-Z0-9]+-)*JOB(?:[-A-Z0-9]*\d[-A-Z0-9]*|\d+)$/i.test(value.trim());

/** Supports packing labels plus legacy bare-ID, JSON, and ERP URL labels. */
export const parseJobCardPackingQr = (raw: string) => {
  const value = cleanScanText(raw);
  if (!value) return null;

  try {
    const label = parsePackingLabelQr(value);
    if (label.jobCardId) return {
      itemCode: label.itemCode,
      quantity: label.quantity,
      uom: label.uom,
      workOrderId: label.jobOrderId || "",
      jobCardId: label.jobCardId,
    };
  } catch { /* Continue with bare Job Card, JSON, and URL recognition. */ }

  if (value.startsWith("{")) {
    try {
      const payload = JSON.parse(value) as UnknownRecord;
      const jobCardId = text(
        payload.job_card_id ?? payload.jobCardId ?? payload.job_card ??
        (text(payload.doctype).toLowerCase() === "job card" ? payload.name : "")
      );
      if (jobCardId) {
        return {
          itemCode: text(payload.item_code ?? payload.itemCode),
          quantity: number(payload.quantity ?? payload.qty),
          uom: text(payload.uom),
          workOrderId: text(payload.work_order_id ?? payload.workOrderId ?? payload.work_order),
          jobCardId,
        };
      }
    } catch { /* Continue with plain-text and URL recognition. */ }
  }

  try {
    const url = new URL(value);
    const queryId = text(
      url.searchParams.get("job_card_id") ??
      url.searchParams.get("job_card") ??
      url.searchParams.get("name")
    );
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const routeIndex = segments.findIndex((segment) => segment.toLowerCase().replace(/_/g, "-") === "job-card");
    const routeId = routeIndex >= 0 ? text(segments[routeIndex + 1]) : "";
    const jobCardId = queryId || routeId;
    if (jobCardId) return { itemCode: "", quantity: 0, uom: "", workOrderId: "", jobCardId };
  } catch { /* A scanner value normally is not a URL. */ }

  if (looksLikeJobCardId(value)) {
    return { itemCode: "", quantity: 0, uom: "", workOrderId: "", jobCardId: value };
  }
  return null;
};

export const parseEmployeeScan = (raw: string) => {
  const value = cleanScanText(raw);
  if (!value) return "";
  if (value.startsWith("{")) {
    try {
      const payload = JSON.parse(value) as UnknownRecord;
      return text(payload.employee ?? payload.employee_id ?? payload.document_id);
    } catch { return ""; }
  }
  return /^(HR-)?EMP[-A-Z0-9]+$/i.test(value) ? value : "";
};
