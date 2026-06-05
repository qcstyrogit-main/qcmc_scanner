import type { Employee } from "@/types";
import { erpRequest, extractErrorMessage, setErpSid } from "@/lib/erpApi";

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

  const employee = buildEmployeeFromErp(payload.user || loginData.user || loginEmail, loginEmail, {
    ...loginData,
    ...payload,
  });
  const fullName = readString(loginData.full_name) || readString(payload.full_name);

  return fullName ? { ...employee, full_name: fullName } : employee;
};
