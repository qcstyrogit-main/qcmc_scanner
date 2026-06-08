import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { getErpSid, setErpSid, getErpCsrf, setErpCsrf } from "@/lib/erpSession";

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

export const erpRequest = async (
  endpoint: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: Record<string, unknown> | null;
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

  if (Capacitor.isNativePlatform()) {
    try {
      const sid = getErpSid();
      const nativeHeaders = { ...headers };

      if (sid) {
        nativeHeaders["Cookie"] = `sid=${sid}`;
      }

      const nativeResponse = await CapacitorHttp.request({
        url,
        method,
        headers: nativeHeaders,
        data: body,
        connectTimeout: 20000,
        readTimeout: 20000,
      });

      return {
        ok: nativeResponse.status >= 200 && nativeResponse.status < 300,
        status: nativeResponse.status,
        data: parsePossibleJson(nativeResponse.data),
      };
    } catch {
      throw new Error("Cannot reach ERP server from the scanner. Check Wi-Fi/mobile data and ERP URL.");
    }
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

export { setErpSid, setErpCsrf };
