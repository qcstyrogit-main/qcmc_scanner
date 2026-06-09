import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { getErpSid, setErpSid, getErpCsrf, setErpCsrf, getErpMobileToken, setErpMobileToken } from "@/lib/erpSession";

const DEFAULT_ERP_BASE_URL = "https://erp.qcstyro.com";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const erpApiUrl = (endpoint: string) => {
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const configuredBase =
    import.meta.env.VITE_ERP_BASE_URL ||
    import.meta.env.VITE_ERP_TARGET ||
    DEFAULT_ERP_BASE_URL;
  const useProxy =
    import.meta.env.DEV || String(import.meta.env.VITE_ERP_USE_PROXY).toLowerCase() === "true";
  const base = configuredBase?.trim() || "";

  if (useProxy || base.startsWith("/")) {
    return `${trimTrailingSlash(base.startsWith("/") ? base : "/erp")}${normalizedEndpoint}`;
  }

  return `${trimTrailingSlash(base)}${normalizedEndpoint}`;
};

const parseJsonResponse = async (response: Response): Promise<unknown> => {
  const rawBody = await response.text();

  if (!rawBody.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    const preview = rawBody.replace(/\s+/g, " ").trim().slice(0, 140);
    throw new Error(
      `Server returned non-JSON response (HTTP ${response.status})${preview ? `: ${preview}` : ""}`
    );
  }
};

const parsePossibleJson = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  if (!value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

type NativeResponseLike = {
  status: number;
  data: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

const extractSidFromCookie = (cookieHeader: string) => {
  const match = cookieHeader.match(/(?:^|;\s*)sid=([^;]+)/i);
  return match?.[1]?.trim() || "";
};

const updateSessionFromHeaderMap = (headers: Record<string, string | string[] | undefined>) => {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(", ") : value || ""])
  );
  const csrf = normalized["x-frappe-csrf-token"]?.trim();
  const setCookie = normalized["set-cookie"]?.trim();

  if (csrf) {
    setErpCsrf(csrf);
  }

  if (setCookie) {
    const sid = extractSidFromCookie(setCookie);
    if (sid) {
      setErpSid(sid);
    }
  }
};

const updateSessionFromResponse = (response: Response) => {
  const csrf = response.headers.get("x-frappe-csrf-token")?.trim();
  const setCookie = response.headers.get("set-cookie")?.trim();

  if (csrf) {
    setErpCsrf(csrf);
  }

  if (setCookie) {
    const sid = extractSidFromCookie(setCookie);
    if (sid) {
      setErpSid(sid);
    }
  }
};

const coerceNativeErrorResponse = (error: unknown): NativeResponseLike | null => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const record = error as Record<string, unknown>;
  const directStatus = typeof record.status === "number" ? record.status : null;
  const directData = record.data;
  const directHeaders =
    record.headers && typeof record.headers === "object"
      ? (record.headers as Record<string, string | string[] | undefined>)
      : undefined;

  if (directStatus !== null) {
    return {
      status: directStatus,
      data: directData,
      headers: directHeaders,
    };
  }

  const nested = record.response;
  if (!nested || typeof nested !== "object") {
    return null;
  }

  const nestedRecord = nested as Record<string, unknown>;
  const nestedStatus = typeof nestedRecord.status === "number" ? nestedRecord.status : null;
  if (nestedStatus === null) {
    return null;
  }

  return {
    status: nestedStatus,
    data: nestedRecord.data,
    headers:
      nestedRecord.headers && typeof nestedRecord.headers === "object"
        ? (nestedRecord.headers as Record<string, string | string[] | undefined>)
        : undefined,
  };
};

const applySessionPayload = (data: unknown) => {
  if (!data || typeof data !== "object") return false;

  const payload =
    typeof (data as Record<string, unknown>).message === "object" &&
    (data as Record<string, unknown>).message !== null
      ? ((data as Record<string, unknown>).message as Record<string, unknown>)
      : (data as Record<string, unknown>);

  const success = payload.success;
  if (success === false) {
    return false;
  }

  const sid = typeof payload.sid === "string" ? payload.sid.trim() : "";
  const csrf = typeof payload.csrf_token === "string" ? payload.csrf_token.trim() : "";

  if (sid) {
    setErpSid(sid);
  }
  if (csrf) {
    setErpCsrf(csrf);
  }

  return Boolean(sid || csrf);
};

const refreshErpSession = async () => {
  const url = erpApiUrl("/api/method/qcmc_logic.api.login_scan.resume_session");
  const mobileToken = getErpMobileToken();

  if (Capacitor.isNativePlatform()) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const sid = getErpSid();
    if (sid) {
      headers["Cookie"] = `sid=${sid}`;
    }

    let response: NativeResponseLike;
    try {
      response = await CapacitorHttp.request({
        url,
        method: "POST",
        headers,
        data: mobileToken ? { mobile_token: mobileToken } : {},
        connectTimeout: 20000,
        readTimeout: 20000,
      });
    } catch (error) {
      const nativeResponse = coerceNativeErrorResponse(error);
      if (!nativeResponse) {
        throw new Error("Cannot reach ERP server from the scanner. Check Wi-Fi/mobile data and ERP URL.");
      }
      response = nativeResponse;
    }

    updateSessionFromHeaderMap((response.headers || {}) as Record<string, string | string[] | undefined>);
    const payloadApplied = applySessionPayload(parsePossibleJson(response.data));
    if (response.status >= 400 || !payloadApplied) {
      throw new Error("Unable to resume ERP session");
    }
    return;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(mobileToken ? { mobile_token: mobileToken } : {}),
  });
  updateSessionFromResponse(response);
  const payloadApplied = applySessionPayload(await parseJsonResponse(response));
  if (!response.ok || !payloadApplied) {
    throw new Error("Unable to resume ERP session");
  }
};

export const resumeErpSession = async () => {
  try {
    await refreshErpSession();
    return true;
  } catch {
    return false;
  }
};

export const erpRequest = async (
  endpoint: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: Record<string, unknown> | null;
    retryOn403?: boolean;
  } = {}
) => {
  const method = options.method ?? "GET";
  const csrf = getErpCsrf();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(method === "POST" && csrf ? { "X-Frappe-CSRF-Token": csrf } : {}),
    ...options.headers,
  };
  const body = options.body ?? null;
  const url = erpApiUrl(endpoint);
  const retryOn403 = options.retryOn403 ?? true;

  if (Capacitor.isNativePlatform()) {
    const sid = getErpSid();
    const nativeHeaders = { ...headers, Accept: "application/json" };

    if (sid) {
      nativeHeaders["Cookie"] = `sid=${sid}`;
    }

    let nativeResponse: NativeResponseLike;
    try {
      nativeResponse = await CapacitorHttp.request({
        url,
        method,
        headers: nativeHeaders,
        data: body,
        connectTimeout: 20000,
        readTimeout: 20000,
      });
    } catch (error) {
      const nativeErrorResponse = coerceNativeErrorResponse(error);
      if (!nativeErrorResponse) {
        throw new Error("Cannot reach ERP server from the scanner. Check Wi-Fi/mobile data and ERP URL.");
      }
      nativeResponse = nativeErrorResponse;
    }

    updateSessionFromHeaderMap((nativeResponse.headers || {}) as Record<string, string | string[] | undefined>);

    if (nativeResponse.status === 403 && method === "POST" && retryOn403) {
      await refreshErpSession();
      return erpRequest(endpoint, { ...options, retryOn403: false });
    }

    return {
      ok: nativeResponse.status >= 200 && nativeResponse.status < 300,
      status: nativeResponse.status,
      data: parsePossibleJson(nativeResponse.data),
    };
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: "include",
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("ERP login request timed out. Check the ERP URL or network connection.");
    }
    throw new Error("Cannot reach ERP server. Check the ERP URL or network connection.");
  } finally {
    window.clearTimeout(timeout);
  }

  updateSessionFromResponse(response);

  if (response.status === 403 && method === "POST" && retryOn403) {
    await refreshErpSession();
    return erpRequest(endpoint, { ...options, retryOn403: false });
  }

  return {
    ok: response.ok,
    status: response.status,
    data: await parseJsonResponse(response),
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
};

const stripMarkup = (value: string) =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

export const extractErrorMessage = (data: unknown, fallback: string) => {
  if (typeof data === "string" && data.trim()) {
    return stripMarkup(data);
  }

  const record = asRecord(data);
  const message = record?.message;
  const exception = record?.exception;

  if (typeof message === "string" && message.trim()) {
    return stripMarkup(message);
  }

  if (typeof exception === "string" && exception.trim()) {
    return stripMarkup(exception);
  }

  return fallback;
};

export { setErpSid, setErpCsrf, setErpMobileToken };
