export type CachedReconciliationContext = {
  reconciliationId: string;
  warehouse: string;
  purpose: string;
  validatedAt: string;
};

const CACHE_KEY = "qcmc.pcount.reconciliations.1";

const readCache = (): Record<string, CachedReconciliationContext> => {
  try {
    if (typeof localStorage === "undefined") return {};
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, CachedReconciliationContext>
      : {};
  } catch {
    return {};
  }
};

const keyFor = (value: string) => value.trim().toLocaleUpperCase();

export const saveReconciliationContextOffline = (context: {
  reconciliationId: string;
  warehouse: string;
  purpose?: string;
}) => {
  const reconciliationId = context.reconciliationId.trim();
  const warehouse = context.warehouse.trim();
  if (!reconciliationId || !warehouse) return;
  try {
    if (typeof localStorage === "undefined") return;
    const cache = readCache();
    cache[keyFor(reconciliationId)] = {
      reconciliationId,
      warehouse,
      purpose: context.purpose?.trim() || "",
      validatedAt: new Date().toISOString(),
    };
    const newest = Object.entries(cache)
      .sort(([, left], [, right]) => right.validatedAt.localeCompare(left.validatedAt))
      .slice(0, 100);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // Offline caching must not interrupt online scanning.
  }
};

export const loadReconciliationContextOffline = (reconciliationId: string) => {
  const cached = readCache()[keyFor(reconciliationId)];
  if (!cached?.reconciliationId || !cached.warehouse) return null;
  return cached;
};

export const removeReconciliationContextOffline = (reconciliationId: string) => {
  try {
    if (typeof localStorage === "undefined") return;
    const cache = readCache();
    delete cache[keyFor(reconciliationId)];
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache cleanup must not interrupt the scanner.
  }
};
