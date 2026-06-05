import { setErpSid } from "@/lib/erpSession";

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

export const erpRequest = async (
  endpoint: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: Record<string, unknown> | null;
  } = {}
) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);

  let response: Response;
  try {
    response = await fetch(erpApiUrl(endpoint), {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include",
      body: options.body == null ? undefined : JSON.stringify(options.body),
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

export { setErpSid };
