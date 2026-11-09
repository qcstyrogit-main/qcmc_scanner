export const normalizeErpConnectionQrValue = (value: unknown) => {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("This QR does not contain a valid ERP URL.");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    throw new Error("ERP connection QR must contain an HTTP or HTTPS URL.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("ERP connection QR must not contain credentials, query parameters, or a fragment.");
  }
  return raw;
};

export const createErpConnectionQrValue = (erpBaseUrl: string) =>
  normalizeErpConnectionQrValue(erpBaseUrl);
