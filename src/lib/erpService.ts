import type { Employee } from "@/types";
import {
  erpRequest,
  extractErrorMessage,
  setErpSid,
  setErpCsrf,
  setErpMobileToken,
} from "@/lib/erpApi";
import { getErpMobileToken } from "@/lib/erpSession";


/* ============================================================
 * TYPES
 * ============================================================
 */

export type PcountEntry = {
  itemCode: string;
  warehouse: string;
  inventoryLocation: string;
  inventoryLocationCode?: string;
  quantity: number;
  quantityDelta: number;
  expectedPreviousCount: number;
  /** ERP stock snapshot used only for concurrent-change validation. */
  expectedERPQuantity?: number;
  physicalCount: number;
  stockUom?: string;
  totalAdded?: number;
  totalDeducted?: number;
  transactions?: Array<{
    id: string;
    action: "ADD" | "DEDUCT";
    quantityChange: number;
    runningQuantity: number;
    timestamp: string;
    employeeId: string;
    employeeName: string;
    deviceId: string;
    locationId: string;
    locationLabel: string;
    /** Inventory Tag entered for this exact physical-count scan. */
    inventoryTag?: string;
    qrQuantity?: number;
    packageStatus?: "COMPLETE" | "OPENED";
    actualQuantity?: number;
    remainingQuantity?: number;
    packageId?: string;
  }>;
  uom: string;
  lotNo: string;
  deviceId: string;

  bin: {
    /**
     * Exact ERPNext Warehouse value.
     */
    warehouse?: string;

    /**
     * Legacy hierarchy fields.
     */
    stockroom: string;
    building: string;
    aisle: string;
    rack: string;
    bin: string;

    /**
     * Exact Storage Location metadata.
     */
    locationId?: string;
    locationCode?: string;
    locationName?: string;
    locationType?: string;
    locationPath?: string;

    /**
     * Put-away metadata.
     */
    isGroup?: number;
    itemCode?: string;
    storageCapacity?: number;
  };
};


export type ReconciliationContext = {
  reconciliationId: string;
  warehouse: string;
  purpose?: string;
};

export type PcountErpRow = {
  itemCode: string;
  itemName: string;
  warehouse: string;
  inventoryLocation: string;
  inventoryLocationCode: string;
  quantity: number;
  uom: string;
};

export type PcountItemDetails = {
  itemCode: string;
  itemName: string;
  uom: string;
  stockUom: string;
};

export type PcountItemBaseline = {
  itemCode: string;
  itemName: string;
  warehouse: string;
  inventoryLocation: string;
  currentErpQuantity: number;
  uom: string;
  stockUom: string;
  uomConversionFactor?: number;
  batchNo: string;
};


/* ============================================================
 * SAFE READERS
 * ============================================================
 */

const asRecord = (
  value: unknown
): Record<string, unknown> => {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as Record<string, unknown>;
};

const isRecord = (
  value: unknown
): value is Record<string, unknown> =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value);

const unwrapFrappePayload = (
  data: Record<string, unknown>
): Record<string, unknown> => {
  if (isRecord(data.message)) {
    return {
      ...data,
      ...data.message,
    };
  }

  return data;
};


const readString = (
  value: unknown
): string | undefined =>
  typeof value === "string"
    ? value
    : undefined;

const cleanBackendMessage = (
  value: string
) =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

const describeBackendPayload = (
  payload: Record<string, unknown>
) => {
  const keys = Object.keys(payload)
    .filter((key) => !/(token|secret|password|cookie|session|sid|csrf|key)/i.test(key))
    .slice(0, 8);
  return keys.length > 0
    ? `Response fields: ${keys.join(", ")}.`
    : "Response body was empty.";
};

export const PCOUNT_NOT_OPEN_MESSAGE =
  "This Physical Count is already For Recon or Close Inventory and is no longer available for scanning.";

export class PcountNotOpenError extends Error {
  readonly code = "PCOUNT_NOT_OPEN";
  readonly removeFromLastActivity: boolean;

  constructor(removeFromLastActivity = true) {
    super(PCOUNT_NOT_OPEN_MESSAGE);
    this.name = "PcountNotOpenError";
    this.removeFromLastActivity = removeFromLastActivity;
  }
}

export const throwIfPcountNotOpen = (payload: Record<string, unknown>) => {
  const errorCode = readString(payload.error_code ?? payload.code)?.trim().toLocaleUpperCase();
  if (errorCode === "PCOUNT_NOT_OPEN") {
    throw new PcountNotOpenError(payload.remove_from_last_activity !== false);
  }
};

const getBackendValidationMessage = (
  payload: Record<string, unknown>,
  fallback: string
) => {
  const serverMessages = payload._server_messages;
  let parsedServerMessage = "";
  if (serverMessages) {
    try {
      const messages = typeof serverMessages === "string"
        ? JSON.parse(serverMessages)
        : serverMessages;
      if (Array.isArray(messages)) {
        for (const message of messages) {
          const row = typeof message === "string"
            ? asRecord(JSON.parse(message))
            : asRecord(message);
          parsedServerMessage = cleanBackendMessage(readString(row?.message) || "");
          if (parsedServerMessage) break;
        }
      }
    } catch {
      parsedServerMessage = "";
    }
  }
  let base = parsedServerMessage ||
    cleanBackendMessage(
      readString(payload.error) ||
      readString(payload._error_message) ||
      readString(asRecord(payload.details)?.reason) ||
      readString(payload.exc) ||
      ""
    ) ||
    extractErrorMessage(payload, fallback);
  if (base === fallback) {
    base = `ERPNext did not return item baseline details. ${describeBackendPayload(payload)}`;
  }
  const errorCode = readString(payload.error_code ?? payload.code)?.trim().toLocaleUpperCase();
  const itemCode = readString(payload.item_code ?? payload.itemCode)?.trim();
  const rowNumber = payload.row_number ?? payload.rowNumber;
  const details: string[] = [];
  if (errorCode === "ITEM_NOT_FOUND" && itemCode && !base.includes(itemCode)) {
    details.push(`Item: ${itemCode}`);
  } else if (errorCode === "ITEM_NOT_FOUND" && itemCode) {
    details.push(`Item: ${itemCode}`);
  }
  if ((typeof rowNumber === "number" || typeof rowNumber === "string") && String(rowNumber).trim()) {
    details.push(`Row: ${String(rowNumber).trim()}`);
  }
  return details.length > 0 ? `${base.replace(/\.+$/, "")}. ${details.join(". ")}.` : base;
};


/* ============================================================
 * RECONCILIATION CONTEXT
 * ============================================================
 */

export const getReconciliationContext = async (
  reconciliationId: string
): Promise<ReconciliationContext> => {
  const mobileToken =
    getErpMobileToken();

  const res = await erpRequest(
    "/api/method/qcmc_logic.api.reconciliation_context.get_reconciliation_context",
    {
      method: "POST",

      body: {
        reconciliation_id:
          reconciliationId,

        ...(mobileToken
          ? {
              mobile_token:
                mobileToken,
            }
          : {}),
      },
    }
  );

  const data =
    asRecord(res.data);

  const payload =
    unwrapFrappePayload(data);

  const hasValidContext = Boolean(readString(payload.warehouse)?.trim());
  if (
    !res.ok ||
    payload.success === false ||
    (!hasValidContext && payload.success !== true)
  ) {
    throwIfPcountNotOpen(payload);
    throw new Error(
      getBackendValidationMessage(
        payload,
        `Unable to validate reconciliation (HTTP ${res.status})`
      )
    );
  }

  const warehouse =
    readString(
      payload.warehouse
    )?.trim();

  if (!warehouse) {
    throw new Error(
      "Default Warehouse is required on the Stock Reconciliation."
    );
  }

  return {
    reconciliationId:
      readString(
        payload.reconciliation_id
      ) ||
      reconciliationId,

    warehouse,

    purpose:
      readString(
        payload.purpose
      ),
  };
};

export const getPcountErpState = async (reconciliationId: string): Promise<PcountErpRow[]> => {
  const mobileToken = getErpMobileToken();
  const res = await erpRequest(
    "/api/method/qcmc_logic.api.stock_reconciliation.get_pcount_state",
    {
      method: "POST",
      body: {
        reconciliation_id: reconciliationId,
        ...(mobileToken ? { mobile_token: mobileToken } : {}),
      },
    }
  );
  const data = asRecord(res.data);
  const payload = unwrapFrappePayload(data);
  if (!res.ok || payload.success !== true) {
    throw new Error(extractErrorMessage(payload, `Sync failed (HTTP ${res.status})`));
  }
  const rows = Array.isArray(payload.entries) ? payload.entries : [];
  return rows.map((candidate): PcountErpRow => {
    const row = asRecord(candidate);
    return {
      itemCode: readString(row.item_code ?? row.itemCode) || "",
      itemName: readString(row.item_name ?? row.itemName) || "",
      warehouse: readString(row.warehouse) || "",
      inventoryLocation: readString(row.inventory_location ?? row.location_id ?? row.inventoryLocation) || "",
      inventoryLocationCode: readString(row.inventory_location_code ?? row.location_code ?? row.inventoryLocationCode) || "",
      quantity: Number(row.quantity ?? row.physical_count ?? 0),
      uom: readString(row.stock_uom ?? row.stockUom ?? row.uom) || "",
    };
  }).filter((row) => row.itemCode && row.warehouse && row.inventoryLocation && Number.isFinite(row.quantity));
};

export const getPcountItemDetails = async (itemCode: string): Promise<PcountItemDetails> => {
  const mobileToken = getErpMobileToken();
  const res = await erpRequest(
    "/api/method/qcmc_logic.api.stock_reconciliation.get_pcount_item_details",
    {
      method: "POST",
      body: {
        item_code: itemCode,
        ...(mobileToken ? { mobile_token: mobileToken } : {}),
      },
    }
  );
  const data = asRecord(res.data);
  const payload = unwrapFrappePayload(data);
  if (!res.ok || payload.success !== true) {
    throw new Error(extractErrorMessage(payload, `Item lookup failed (HTTP ${res.status})`));
  }

  return {
    itemCode: readString(payload.item_code ?? payload.itemCode) || itemCode,
    itemName: readString(payload.item_name ?? payload.itemName)?.trim() || "",
    uom: readString(payload.uom)?.trim() || "",
    stockUom: readString(payload.stock_uom ?? payload.stockUom)?.trim() || "",
  };
};

// Keep baseline compatibility local so other ERP endpoint contracts stay unchanged.
const getBaselineResponseRecords = (data: Record<string, unknown>) => {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const pending = [data];
  while (pending.length && records.length < 64) {
    const record = pending.shift()!;
    if (seen.has(record)) continue;
    seen.add(record);
    records.push(record);
    for (const key of ["message", "data", "baseline", "result"]) {
      if (isRecord(record[key])) pending.push(record[key]);
    }
  }
  return records;
};

export const getPcountItemBaseline = async (
  reconciliationId: string,
  itemCode: string,
  warehouse: string,
  inventoryLocation: string,
  batchNo = ""
): Promise<PcountItemBaseline> => {
  const mobileToken = getErpMobileToken();
  const res = await erpRequest(
    "/api/method/qcmc_logic.api.stock_reconciliation.get_pcount_item_baseline",
    {
      method: "POST",
      body: {
        reconciliation_id: reconciliationId,
        item_code: itemCode,
        warehouse,
        inventory_location: inventoryLocation,
        batch_no: batchNo,
        ...(mobileToken ? { mobile_token: mobileToken } : {}),
      },
    }
  );
  const data = asRecord(res.data);
  const records = getBaselineResponseRecords(data);
  const payload = records.find((record) =>
    record.item_code !== undefined || record.itemCode !== undefined) || records[records.length - 1];
  const rawQuantity = payload.current_erp_quantity ?? payload.currentErpQuantity ?? payload.quantity;
  const hasQuantity = (typeof rawQuantity === "number" || typeof rawQuantity === "string") &&
    !(typeof rawQuantity === "string" && rawQuantity.trim() === "");
  const currentErpQuantity = hasQuantity ? Number(rawQuantity) : Number.NaN;
  const returnedLocation = readString(payload.inventory_location ?? payload.inventoryLocation ?? payload.location_id ?? payload.locationId);
  const missing = [
    !readString(payload.item_code ?? payload.itemCode)?.trim() && "item_code",
    !readString(payload.warehouse)?.trim() && "warehouse",
    !returnedLocation?.trim() && "inventory_location",
    !Number.isFinite(currentErpQuantity) && "current_erp_quantity",
  ].filter(Boolean);
  const missingDetails = `ERPNext did not return item baseline details. Missing or invalid fields: ${missing.join(", ")}.`;
  const missingDetailsWithDiagnostics = `${missingDetails} HTTP ${res.status}. ${describeBackendPayload(payload)}`;
  const error = records.find((record) => record.success === false ||
    record.exc_type || record.exception || record.error_code || record.errorCode ||
    record.error || record._error_message || record.exc ||
    ["error", "failed", "failure"].includes(String(record.status).toLowerCase()));
  if (!res.ok || error) {
    // Retain outer Frappe server messages while giving explicit errors priority.
    const errorPayload = Object.assign({}, ...records, error || {});
    const message = getBackendValidationMessage(errorPayload, `Unable to load item baseline (HTTP ${res.status})`);
    const fallback = res.ok ? missingDetailsWithDiagnostics : `Unable to load item baseline (HTTP ${res.status})`;
    throw new Error(message.startsWith("ERPNext did not return item baseline details.") ? fallback : message);
  }
  const hasValidBaseline = Boolean(
    readString(payload.item_code ?? payload.itemCode) &&
    readString(payload.warehouse) &&
    returnedLocation &&
    Number.isFinite(currentErpQuantity)
  );
  if (!hasValidBaseline && payload.success !== true) {
    throw new Error(missingDetailsWithDiagnostics);
  }
  const uomConversionFactor = Number(payload.uom_conversion_factor ?? payload.uomConversionFactor ?? payload.conversion_factor ?? payload.conversionFactor);
  if (!Number.isFinite(currentErpQuantity)) throw new Error("ERPNext returned an invalid item baseline quantity.");
  if (
    readString(payload.item_code ?? payload.itemCode)?.trim() !== itemCode.trim() ||
    readString(payload.warehouse)?.trim() !== warehouse.trim() ||
    returnedLocation?.trim() !== inventoryLocation.trim()
  ) {
    throw new Error("ERPNext item baseline does not match the requested item, warehouse, and Storage Location.");
  }
  return {
    itemCode: readString(payload.item_code ?? payload.itemCode) || itemCode,
    itemName: readString(payload.item_name ?? payload.itemName)?.trim() || "",
    warehouse: readString(payload.warehouse) || warehouse,
    inventoryLocation: returnedLocation!,
    currentErpQuantity,
    uom: readString(payload.uom)?.trim() || "",
    stockUom: readString(payload.stock_uom ?? payload.stockUom)?.trim() || "",
    ...(Number.isFinite(uomConversionFactor) && uomConversionFactor > 0 ? { uomConversionFactor } : {}),
    batchNo: readString(payload.batch_no ?? payload.batchNo)?.trim() || "",
  };
};


/* ============================================================
 * EMPLOYEE BUILDING
 * ============================================================
 */

const buildEmployeeFromErp = (
  user: unknown,
  loginEmail: string,
  context: Record<
    string,
    unknown
  > = {}
): Employee => {
  const userObj =
    asRecord(user);

  const source = {
    ...context,
    ...userObj,
  };

  const fallbackId =
    typeof user === "string"
      ? user
      : undefined;

  const fallbackEmail =
    typeof user === "string" &&
    user.includes("@")
      ? user
      : undefined;

  const userId =
    readString(
      source.name
    ) ||
    readString(
      source.user
    ) ||
    readString(
      source.email
    ) ||
    fallbackId ||
    loginEmail;

  const userEmail =
    readString(
      source.email
    ) ||
    fallbackEmail ||
    loginEmail;

  const baseName =
    typeof user === "string"
      ? user.split("@")[0]
      : undefined;

  return {
    id:
      userId,

    employee_id:
      readString(
        source.employee
      ) ||
      readString(
        source.employee_id
      ) ||
      readString(
        source.employeeId
      ),

    email:
      userEmail,

    full_name:
      readString(
        source.full_name
      ) ||
      readString(
        source.fullName
      ) ||
      baseName ||
      loginEmail.split("@")[0] ||
      "Employee",

    department:
      readString(
        source.department
      ) ||
      readString(
        source.dept
      ) ||
      "General",

    company:
      readString(
        source.company
      ) ||
      "-",

    custom_location:
      readString(
        source.custom_location
      ) ||
      "-",

    designation:
      readString(
        source.designation
      ) ||
      "-",

    role:
      userId === "Administrator" ||
      readString(
        source.user_type
      ) === "System User"
        ? "admin"
        : "employee",
  };
};


/* ============================================================
 * SUBMIT PHYSICAL COUNT
 * ============================================================
 */

export const createPcountSubmissionId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `scan-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
    .toString(16)
    .slice(2)}`;
};

export class PcountStockChangedError extends Error {
  readonly code = "PCOUNT_STOCK_CHANGED";
  readonly expectedErpQuantity: number;
  readonly currentErpQuantity: number;
  readonly itemCode: string;
  readonly warehouse: string;
  readonly inventoryLocation: string;

  constructor(details: {
    expectedErpQuantity: number;
    currentErpQuantity: number;
    itemCode: string;
    warehouse: string;
    inventoryLocation: string;
  }) {
    super("Count synchronization changed. Review before resubmitting the complete count.");
    this.name = "PcountStockChangedError";
    this.expectedErpQuantity = details.expectedErpQuantity;
    this.currentErpQuantity = details.currentErpQuantity;
    this.itemCode = details.itemCode;
    this.warehouse = details.warehouse;
    this.inventoryLocation = details.inventoryLocation;
  }
}

export const submitPcountEntries = async (
  reconciliationId: string,
  entries: PcountEntry[],
  options: {
    submissionId: string;
    operation?: "adjustment";
  }
): Promise<{
  itemCount: number;
  submissionId: string;
  duplicateSubmission: boolean;
}> => {
  const mobileToken =
    getErpMobileToken();

  const serializedEntries = entries.map((entry) => ({
    ...entry,
    item_code: entry.itemCode,
    inventory_location: entry.inventoryLocation,
    inventory_location_code: entry.inventoryLocationCode || "",
    quantity_delta: entry.quantityDelta,
    expected_previous_count: entry.expectedPreviousCount,
    expected_erp_quantity: entry.expectedERPQuantity,
    physical_count: entry.physicalCount,
    stock_uom: entry.stockUom || entry.uom,
    total_added: entry.totalAdded || 0,
    total_deducted: entry.totalDeducted || 0,
    batch_no: entry.lotNo,
    device_id: entry.deviceId,
  }));

  const res = await erpRequest(
    "/api/method/qcmc_logic.api.stock_reconciliation.submit_pcount_entries",
    {
      method: "POST",

      body: {
        reconciliation_id:
          reconciliationId,

        operation:
          options.operation ?? "adjustment",

        submission_id:
          options.submissionId,

        entries: serializedEntries,

        ...(mobileToken
          ? {
              mobile_token:
                mobileToken,
            }
          : {}),
      },
    }
  );

  const data =
    (
      res.data &&
      typeof res.data === "object"
        ? res.data
        : {}
    ) as Record<
      string,
      unknown
    >;

  const payload =
    (
      data.message &&
      typeof data.message === "object"
        ? data.message
        : data
    ) as Record<
      string,
      unknown
    >;

  if (
    !res.ok ||
    payload.success !== true
  ) {
    const errorCode = readString(payload.error_code ?? payload.code) || "";
    throwIfPcountNotOpen(payload);
    const expected = Number(payload.expected_erp_quantity ?? payload.expected_previous_count);
    const current = Number(payload.current_erp_quantity);
    if (errorCode === "PCOUNT_STOCK_CHANGED") {
      throw new PcountStockChangedError({
        expectedErpQuantity: expected,
        currentErpQuantity: Number.isFinite(current) ? current : 0,
        itemCode: readString(payload.item_code),
        warehouse: readString(payload.warehouse),
        inventoryLocation: readString(payload.inventory_location),
      });
    }
    throw new Error(
      extractErrorMessage(
        payload,
        `Submit failed (HTTP ${res.status})`
      ) + (errorCode ? ` [${errorCode}]` : "")
    );
  }

  return {
    itemCount:
      Number(
        payload.item_count ??
          0
      ),
    submissionId:
      readString(payload.submission_id) ||
      options.submissionId,
    duplicateSubmission:
      payload.duplicate_submission === true,
  };
};


export type PcountStagingStatus =
  | "RECEIVED"
  | "QUEUED"
  | "VALIDATING"
  | "VALIDATED"
  | "PROCESSING"
  | "COMPLETED"
  | "NEEDS_REVIEW"
  | "FAILED";

export type PcountStagingResult = {
  submissionId: string;
  status: PcountStagingStatus;
  duplicateSubmission: boolean;
  totalLocations: number;
  totalEntries: number;
  totalTransactions: number;
  errorCode: string;
  errorMessage: string;
  result?: Record<string, unknown>;
};

const serializePcountEntries = (entries: PcountEntry[]) => entries.map((entry) => ({
  ...entry,
  item_code: entry.itemCode,
  inventory_location: entry.inventoryLocation,
  inventory_location_code: entry.inventoryLocationCode || "",
  quantity_delta: entry.quantityDelta,
  expected_previous_count: entry.expectedPreviousCount,
  expected_erp_quantity: entry.expectedERPQuantity,
  physical_count: entry.physicalCount,
  stock_uom: entry.stockUom || entry.uom,
  total_added: entry.totalAdded || 0,
  total_deducted: entry.totalDeducted || 0,
  batch_no: entry.lotNo,
  device_id: entry.deviceId,
}));

const readPcountStagingResult = (
  payload: Record<string, unknown>,
  fallbackSubmissionId: string
): PcountStagingResult => {
  const rawStatus = String(payload.status || "").trim().toUpperCase();
  const status: PcountStagingStatus = (
    ["RECEIVED", "QUEUED", "VALIDATING", "VALIDATED", "PROCESSING", "COMPLETED", "NEEDS_REVIEW", "FAILED"] as const
  ).includes(rawStatus as PcountStagingStatus)
    ? rawStatus as PcountStagingStatus
    : "FAILED";
  return {
    submissionId: readString(payload.submission_id) || fallbackSubmissionId,
    status,
    duplicateSubmission: payload.duplicate_submission === true,
    totalLocations: Number(payload.total_locations || 0),
    totalEntries: Number(payload.total_entries || 0),
    totalTransactions: Number(payload.total_transactions || 0),
    errorCode: readString(payload.error_code) || "",
    errorMessage: readString(payload.error_message ?? payload.message) || "",
    result: isRecord(payload.result) ? payload.result : undefined,
  };
};

export const uploadPcountSubmission = async (
  reconciliationId: string,
  entries: PcountEntry[],
  options: { submissionId: string; operation?: "adjustment" }
): Promise<PcountStagingResult> => {
  const mobileToken = getErpMobileToken();
  const res = await erpRequest(
    "/api/method/qcmc_logic.api.stock_reconciliation.upload_pcount_submission",
    {
      method: "POST",
      body: {
        reconciliation_id: reconciliationId,
        operation: options.operation ?? "adjustment",
        submission_id: options.submissionId,
        entries: serializePcountEntries(entries),
        ...(mobileToken ? { mobile_token: mobileToken } : {}),
      },
    }
  );
  const data = asRecord(res.data);
  const payload = unwrapFrappePayload(data);
  if (!res.ok || payload.success !== true) {
    throwIfPcountNotOpen(payload);
    const errorCode = readString(payload.error_code ?? payload.code) || "";
    throw new Error(
      extractErrorMessage(payload, `Physical Count upload failed (HTTP ${res.status})`) +
      (errorCode ? ` [${errorCode}]` : "")
    );
  }
  return readPcountStagingResult(payload, options.submissionId);
};

export const getPcountSubmissionStatus = async (
  submissionId: string
): Promise<PcountStagingResult> => {
  const mobileToken = getErpMobileToken();
  const res = await erpRequest(
    "/api/method/qcmc_logic.api.stock_reconciliation.get_pcount_submission_status",
    {
      method: "POST",
      body: {
        submission_id: submissionId,
        ...(mobileToken ? { mobile_token: mobileToken } : {}),
      },
    }
  );
  const data = asRecord(res.data);
  const payload = unwrapFrappePayload(data);
  if (!res.ok || payload.success !== true) {
    throwIfPcountNotOpen(payload);
    const errorCode = readString(payload.error_code ?? payload.code) || "";
    throw new Error(
      extractErrorMessage(payload, `Unable to read Physical Count submission status (HTTP ${res.status})`) +
      (errorCode ? ` [${errorCode}]` : "")
    );
  }
  return readPcountStagingResult(payload, submissionId);
};



/* ============================================================
 * ERP LOGIN
 * ============================================================
 */

export const erpLogin = async (
  loginEmail: string,
  loginPassword: string
): Promise<Employee> => {
  const loginRes =
    await erpRequest(
      "/api/method/qcmc_logic.api.login_scan.login",
      {
        method: "POST",

        body: {
          username:
            loginEmail,

          password:
            loginPassword,
        },
      }
    );

  const loginData =
    asRecord(
      loginRes.data
    );

  const payload =
    asRecord(
      loginData.message ??
        loginData
    );

  if (!loginRes.ok) {
    throw new Error(
      extractErrorMessage(
        payload,
        `Login failed (HTTP ${loginRes.status})`
      )
    );
  }

  if (
    payload.success !== true
  ) {
    throw new Error(
      extractErrorMessage(
        payload,
        "Invalid credentials or empty ERP response"
      )
    );
  }

  setErpSid(
    readString(
      payload.sid
    ) ||
    readString(
      loginData.sid
    ) ||
    ""
  );

  setErpCsrf(
    readString(
      payload.csrf_token
    ) ||
    readString(
      loginData.csrf_token
    ) ||
    ""
  );

  setErpMobileToken(
    readString(
      payload.mobile_token
    ) ||
    readString(
      loginData.mobile_token
    ) ||
    ""
  );

  const employee =
    buildEmployeeFromErp(
      payload.user ||
        loginData.user ||
        loginEmail,

      loginEmail,

      {
        ...loginData,
        ...payload,
      }
    );

  const fullName =
    readString(
      loginData.full_name
    ) ||
    readString(
      payload.full_name
    );

  return fullName
    ? {
        ...employee,
        full_name:
          fullName,
      }
    : employee;
};
