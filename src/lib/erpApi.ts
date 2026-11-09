import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { getErpSid, setErpSid, getErpCsrf, setErpCsrf, getErpMobileToken, setErpMobileToken } from "@/lib/erpSession";

// Use the same HTTPS ERP site as browser login by default.
const SCANNER_ERP_URL = "https://desktop-vlfuuk4.tail39f829.ts.net";
const DEFAULT_ERP_PRIMARY_URL = SCANNER_ERP_URL;
const DEFAULT_ERP_SECONDARY_URL = SCANNER_ERP_URL;
const DEFAULT_ERP_FALLBACK_URL = SCANNER_ERP_URL;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const useProxy =
  import.meta.env.DEV || String(import.meta.env.VITE_ERP_USE_PROXY).toLowerCase() === "true";
const proxyBase = String(import.meta.env.VITE_ERP_BASE_URL || "/erp").trim() || "/erp";
const primaryErpBase = trimTrailingSlash(String(
  import.meta.env.VITE_ERP_PRIMARY_URL ||
  import.meta.env.VITE_ERP_BASE_URL ||
  DEFAULT_ERP_PRIMARY_URL
).trim());
const fallbackErpBase = trimTrailingSlash(String(
  import.meta.env.VITE_ERP_FALLBACK_URL ||
  import.meta.env.VITE_ERP_TARGET ||
  DEFAULT_ERP_FALLBACK_URL
).trim());
const secondaryErpBase = trimTrailingSlash(String(
  import.meta.env.VITE_ERP_SECONDARY_URL ||
  DEFAULT_ERP_SECONDARY_URL
).trim());
const erpBases = Array.from(new Set(
  [primaryErpBase, secondaryErpBase, fallbackErpBase].filter(Boolean)
));
export type ErpConnectionPreference = "custom";
const ERP_CONNECTION_PREFERENCE_KEY = "qcmc.erp.connectionPreference.1";
const ERP_CUSTOM_BASE_URL_KEY = "qcmc.erp.customBaseUrl.1";
const readCustomErpBaseUrl = () => {
  try {
    return trimTrailingSlash(localStorage.getItem(ERP_CUSTOM_BASE_URL_KEY)?.trim() || primaryErpBase);
  } catch {
    return primaryErpBase;
  }
};
const readConnectionPreference = (): ErpConnectionPreference => {
  return "custom";
};
let connectionPreference = readConnectionPreference();
let customErpBaseUrl = readCustomErpBaseUrl();
const getCandidateErpBases = () => {
  // Stay on the selected site; authentication must not switch between ERP sites.
  return [customErpBaseUrl];
};
let activeErpBase = customErpBaseUrl;
let lastPrimaryProbeAt = 0;
let primaryProbePromise: Promise<void> | null = null;

export const getErpConnectionPreference = () => connectionPreference;
export const getCustomErpBaseUrl = () => customErpBaseUrl;
export const setCustomErpBaseUrl = (value: string) => {
  const trimmed = trimTrailingSlash(value.trim());
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid ERP URL, for example http://192.168.1.203:8001");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    throw new Error("ERP URL must start with http:// or https://");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("ERP URL must not contain credentials, query parameters, or a fragment.");
  }
  customErpBaseUrl = trimmed;
  try {
    localStorage.setItem(ERP_CUSTOM_BASE_URL_KEY, trimmed);
  } catch {
    // Keep the in-memory URL if storage is unavailable.
  }
  if (connectionPreference === "custom") activeErpBase = customErpBaseUrl;
  return customErpBaseUrl;
};
export const setErpConnectionPreference = (preference: ErpConnectionPreference) => {
  connectionPreference = preference;
  activeErpBase = getCandidateErpBases()[0] || primaryErpBase;
  lastPrimaryProbeAt = 0;
  try {
    localStorage.setItem(ERP_CONNECTION_PREFERENCE_KEY, preference);
  } catch {
    // Keep the in-memory selection if storage is unavailable.
  }
};
export const getErpConnectionOptions = () => ([
  { id: "custom" as const, label: "Custom ERP URL", detail: customErpBaseUrl || "Type an HTTP or HTTPS address", url: customErpBaseUrl },
]);

const isDirectFailoverEnabled = () =>
  !useProxy && getCandidateErpBases().length > 1;

const switchAfterTransportFailure = (failedBase: string) => {
  if (!isDirectFailoverEnabled()) return false;
  const candidates = getCandidateErpBases();
  const failedIndex = candidates.indexOf(failedBase);
  const alternate = candidates[(failedIndex >= 0 ? failedIndex + 1 : 0) % candidates.length];
  if (!alternate || alternate === failedBase) return false;
  activeErpBase = alternate;
  return true;
};

export const getActiveErpBaseUrl = () => useProxy ? proxyBase : activeErpBase;

export const erpApiUrl = (endpoint: string, baseOverride?: string) => {
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const base = useProxy ? proxyBase : (baseOverride || activeErpBase);

  if (useProxy || base.startsWith("/")) {
    return `${trimTrailingSlash(base.startsWith("/") ? base : "/erp")}${normalizedEndpoint}`;
  }

  return `${trimTrailingSlash(base)}${normalizedEndpoint}`;
};

const requestTimeoutFor = (base: string) => base.toLocaleLowerCase().startsWith("https://") ? 20000 : 4000;

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

let refreshErpSessionPromise: Promise<void> | null = null;

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

const maybeProbePrimaryErp = () => {
  if (!isDirectFailoverEnabled() || activeErpBase === primaryErpBase) return;
  const now = Date.now();
  if (primaryProbePromise || now - lastPrimaryProbeAt < 60000) return;
  lastPrimaryProbeAt = now;
  primaryProbePromise = (async () => {
    const candidates = getCandidateErpBases();
    const preferredBases = candidates.slice(0, Math.max(0, candidates.indexOf(activeErpBase)));
    for (const preferredBase of preferredBases) try {
      const url = erpApiUrl("/api/method/ping", preferredBase);
      if (Capacitor.isNativePlatform()) {
        const response = await CapacitorHttp.request({
          url,
          method: "GET",
          headers: { Accept: "application/json" },
          connectTimeout: 2500,
          readTimeout: 2500,
        });
        if (response.status >= 200 && response.status < 500) {
          activeErpBase = preferredBase;
          return;
        }
        continue;
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch(url, { method: "GET", signal: controller.signal });
        if (response.status < 500) {
          activeErpBase = preferredBase;
          return;
        }
      } finally {
        window.clearTimeout(timeout);
      }
    } catch {
      // Try the next preferred endpoint; retain the current working endpoint if none respond.
    }
  })().finally(() => {
    primaryProbePromise = null;
  });
};

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    // Prefer the local ERP after a network transition. Transport failover will
    // immediately restore the HTTPS endpoint if the local host is unavailable.
    activeErpBase = getCandidateErpBases()[0] || primaryErpBase;
    lastPrimaryProbeAt = 0;
  });
}

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
  const mobileToken = typeof payload.mobile_token === "string" ? payload.mobile_token.trim() : "";

  if (sid) {
    setErpSid(sid);
  }
  if (csrf) {
    setErpCsrf(csrf);
  }
  if (mobileToken) {
    setErpMobileToken(mobileToken);
  }

  return Boolean(sid || csrf);
};

type ErpSessionResumeFailure = "invalid" | "unavailable";
export type ErpSessionResumeStatus = "ok" | "offline" | ErpSessionResumeFailure;

export const isTerminalErpSessionStatus = (status: ErpSessionResumeStatus) =>
  status === "invalid";

class ErpSessionResumeError extends Error {
  constructor(readonly failure: ErpSessionResumeFailure) {
    super("Unable to resume ERP session");
    this.name = "ErpSessionResumeError";
  }
}

const resumeFailureForStatus = (status: number): ErpSessionResumeFailure =>
  status === 429 || status >= 500 ? "unavailable" : "invalid";

const refreshErpSession = async (remainingEndpointAttempts = Math.max(0, getCandidateErpBases().length - 1)): Promise<void> => {
  const requestBase = getActiveErpBaseUrl();
  const url = erpApiUrl("/api/method/qcmc_logic.api.login_scan.resume_session", requestBase);
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
        connectTimeout: requestTimeoutFor(requestBase),
        readTimeout: requestTimeoutFor(requestBase),
      });
    } catch (error) {
      const nativeResponse = coerceNativeErrorResponse(error);
      if (!nativeResponse) {
        if (remainingEndpointAttempts > 0 && switchAfterTransportFailure(requestBase)) {
          return refreshErpSession(remainingEndpointAttempts - 1);
        }
        throw new Error("Cannot reach ERP server from the scanner. Check Wi-Fi/mobile data and ERP URL.");
      }
      response = nativeResponse;
    }

    updateSessionFromHeaderMap((response.headers || {}) as Record<string, string | string[] | undefined>);
    const payloadApplied = applySessionPayload(parsePossibleJson(response.data));
    if (response.status >= 400 || !payloadApplied) {
      throw new ErpSessionResumeError(
        response.status >= 400 ? resumeFailureForStatus(response.status) : "unavailable"
      );
    }
    return;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutFor(requestBase));
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(mobileToken ? { mobile_token: mobileToken } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (remainingEndpointAttempts > 0 && switchAfterTransportFailure(requestBase)) {
      return refreshErpSession(remainingEndpointAttempts - 1);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  updateSessionFromResponse(response);
  const payloadApplied = applySessionPayload(await parseJsonResponse(response));
  if (!response.ok || !payloadApplied) {
    throw new ErpSessionResumeError(
      !response.ok ? resumeFailureForStatus(response.status) : "unavailable"
    );
  }
};

const ensureErpSession = async () => {
  if (!refreshErpSessionPromise) {
    refreshErpSessionPromise = refreshErpSession().finally(() => {
      refreshErpSessionPromise = null;
    });
  }

  return refreshErpSessionPromise;
};

export const resumeErpSession = async (): Promise<ErpSessionResumeStatus> => {
  try {
    await ensureErpSession();
    return "ok" as const;
  } catch (error) {
    if (error instanceof ErpSessionResumeError) {
      return error.failure;
    }
    const message = error instanceof Error ? error.message : String(error || "");
    if (
      (error instanceof DOMException && error.name === "AbortError") ||
      /cannot reach|network|timed out|timeout|failed to fetch|fetch failed|connection/i.test(message)
    ) {
      return "offline" as const;
    }
    return "unavailable" as const;
  }
};

export const erpRequest = async (
  endpoint: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: Record<string, unknown> | null;
    retryOn403?: boolean;
    remainingEndpointAttempts?: number;
  } = {}
) => {
  maybeProbePrimaryErp();
  const method = options.method ?? "GET";
  const csrf = getErpCsrf();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(method === "POST" && csrf ? { "X-Frappe-CSRF-Token": csrf } : {}),
    ...options.headers,
  };
  const body = options.body ?? null;
  const retryOn403 = options.retryOn403 ?? true;
  const remainingEndpointAttempts = options.remainingEndpointAttempts ?? Math.max(0, getCandidateErpBases().length - 1);
  const isAuthBootstrapEndpoint =
    endpoint.includes("/api/method/qcmc_logic.api.login_scan.login") ||
    endpoint.includes("/api/method/qcmc_logic.api.login_scan.resume_session");
  const shouldWarmNativeSession =
    Capacitor.isNativePlatform() &&
    method === "POST" &&
    retryOn403 &&
    !isAuthBootstrapEndpoint &&
    !getErpSid() &&
    Boolean(getErpMobileToken());

  if (Capacitor.isNativePlatform()) {
    if (shouldWarmNativeSession) {
      await ensureErpSession();
    }

    const requestBase = getActiveErpBaseUrl();
    const url = erpApiUrl(endpoint, requestBase);

    const sid = getErpSid();
    const refreshedCsrf = getErpCsrf();
    const nativeHeaders = {
      ...headers,
      ...(method === "POST" && refreshedCsrf
        ? { "X-Frappe-CSRF-Token": refreshedCsrf }
        : {}),
      Accept: "application/json",
    };

    if (sid) {
      nativeHeaders["Cookie"] = `sid=${sid}`;
    }

    // Read native responses as text and parse them ourselves. This mirrors the
    // browser path and avoids Capacitor/Android returning a successful HTTP 200
    // with `data == null` when its native JSON decoder cannot decode the body.
    // Do not retry a POST just to change responseType: generic erpRequest callers
    // may be mutation endpoints, so replaying the request can duplicate writes.
    const nativeRequestOptions = {
      url,
      method,
      headers: nativeHeaders,
      data: body,
      responseType: "text" as const,
      connectTimeout: requestTimeoutFor(requestBase),
      readTimeout: requestTimeoutFor(requestBase),
    };
    let nativeResponse: NativeResponseLike;
    try {
      nativeResponse = await CapacitorHttp.request(nativeRequestOptions);
    } catch (error) {
      const nativeErrorResponse = coerceNativeErrorResponse(error);
      if (!nativeErrorResponse) {
        if (remainingEndpointAttempts > 0 && switchAfterTransportFailure(requestBase)) {
          return erpRequest(endpoint, { ...options, remainingEndpointAttempts: remainingEndpointAttempts - 1 });
        }
        throw new Error("Cannot reach ERP server from the scanner. Check Wi-Fi/mobile data and ERP URL.");
      }
      nativeResponse = nativeErrorResponse;
    }

    updateSessionFromHeaderMap((nativeResponse.headers || {}) as Record<string, string | string[] | undefined>);

    if (nativeResponse.status === 403 && method === "POST" && retryOn403) {
      await ensureErpSession();
      return erpRequest(endpoint, { ...options, retryOn403: false });
    }

    const parsedNativeData = parsePossibleJson(nativeResponse.data);
    if (nativeResponse.status >= 200 && nativeResponse.status < 300 && parsedNativeData == null) {
      throw new Error("ERP returned an empty response. Submission status is unknown; check ERP before retrying.");
    }
    return {
      ok: nativeResponse.status >= 200 && nativeResponse.status < 300,
      status: nativeResponse.status,
      data: parsedNativeData,
    };
  }

  const requestBase = getActiveErpBaseUrl();
  const url = erpApiUrl(endpoint, requestBase);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutFor(requestBase));

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
    if (remainingEndpointAttempts > 0 && switchAfterTransportFailure(requestBase)) {
      return erpRequest(endpoint, { ...options, remainingEndpointAttempts: remainingEndpointAttempts - 1 });
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("ERP login request timed out. Check the ERP URL or network connection.");
    }
    throw new Error("Cannot reach ERP server. Check the ERP URL or network connection.");
  } finally {
    window.clearTimeout(timeout);
  }

  updateSessionFromResponse(response);

  if (response.status === 403 && method === "POST" && retryOn403) {
    await ensureErpSession();
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
