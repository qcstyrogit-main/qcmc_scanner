import type { Employee } from "@/types";
import { erpRequest, extractErrorMessage, setErpSid, setErpCsrf, setErpMobileToken } from "@/lib/erpApi";

export type PcountEntry = {
  itemCode: string;
  quantity: number;
  uom: string;
  lotNo: string;
  deviceId: string;
  bin: {
    stockroom: string;
    building: string;
    aisle: string;
    rack: string;
    bin: string;
  };
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const buildEmployeeFromErp = (
  user: unknown,
  loginEmail: string,
  context: Record<string, unknown> = {}
): Employee => {
  const userObj = asRecord(user);
  const source = { ...context, ...userObj };
  const fallbackId = typeof user === "string" ? user : undefined;
  const fallbackEmail = typeof user === "string" && user.includes("@") ? user : undefined;
  const userId =
    readString(source.name) ||
    readString(source.user) ||
    readString(source.email) ||
    fallbackId ||
    loginEmail;
  const userEmail = readString(source.email) || fallbackEmail || loginEmail;
  const baseName = typeof user === "string" ? user.split("@")[0] : undefined;

  return {
    id: userId,
    employee_id:
      readString(source.employee) || readString(source.employee_id) || readString(source.employeeId),
    email: userEmail,
    full_name:
      readString(source.full_name) ||
      readString(source.fullName) ||
      baseName ||
      loginEmail.split("@")[0] ||
      "Employee",
    department: readString(source.department) || readString(source.dept) || "General",
    company: readString(source.company) || "-",
    custom_location: readString(source.custom_location) || "-",
    designation: readString(source.designation) || "-",
    role: userId === "Administrator" || readString(source.user_type) === "System User" ? "admin" : "employee",
  };
};

export const submitPcountEntries = async (
  reconciliationId: string,
  entries: PcountEntry[]
): Promise<{ itemCount: number }> => {
  const res = await erpRequest(
    "/api/method/qcmc_logic.api.stock_reconciliation.submit_pcount_entries",
    {
      method: "POST",
      body: {
        reconciliation_id: reconciliationId,
        entries,
      },
    }
  );

  const data = (res.data && typeof res.data === "object" ? res.data : {}) as Record<string, unknown>;
  const payload = (data.message && typeof data.message === "object" ? data.message : data) as Record<string, unknown>;

  if (!res.ok || payload.success !== true) {
    throw new Error(extractErrorMessage(payload, `Submit failed (HTTP ${res.status})`));
  }

  return { itemCount: Number(payload.item_count ?? 0) };
};

export const erpLogin = async (loginEmail: string, loginPassword: string): Promise<Employee> => {
  const loginRes = await erpRequest("/api/method/qcmc_logic.api.login_scan.login", {
    method: "POST",
    body: { username: loginEmail, password: loginPassword },
  });

  const loginData = asRecord(loginRes.data);
  const payload = asRecord(loginData.message ?? loginData);

  if (!loginRes.ok) {
    throw new Error(extractErrorMessage(payload, `Login failed (HTTP ${loginRes.status})`));
  }

  if (payload.success !== true) {
    throw new Error(extractErrorMessage(payload, "Invalid credentials or empty ERP response"));
  }

  setErpSid(readString(payload.sid) || readString(loginData.sid) || "");
  setErpCsrf(readString(payload.csrf_token) || readString(loginData.csrf_token) || "");
  setErpMobileToken(readString(payload.mobile_token) || readString(loginData.mobile_token) || "");

  const employee = buildEmployeeFromErp(payload.user || loginData.user || loginEmail, loginEmail, {
    ...loginData,
    ...payload,
  });
  const fullName = readString(loginData.full_name) || readString(payload.full_name);

  return fullName ? { ...employee, full_name: fullName } : employee;
};
