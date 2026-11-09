import type { ManufactureReceiveContext } from "@/lib/manufacturingService";

export type PutawayLocationOverride = {
  locationId: string;
  locationCode: string;
  warehouse: string;
};

export type SavedPutawayPlan = {
  context: ManufactureReceiveContext;
  locationOverrides: Record<string, PutawayLocationOverride>;
  updatedAt: string;
};

const STORAGE_KEY = "qcmc.manufacture.putawayPlans.v1";

export const loadPutawayPlans = (): SavedPutawayPlan[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as SavedPutawayPlan[];
    return Array.isArray(parsed)
      ? parsed.filter((plan) => plan?.context?.stockEntryId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      : [];
  } catch { return []; }
};

export const savePutawayPlan = (
  context: ManufactureReceiveContext,
  locationOverrides: Record<string, PutawayLocationOverride> = {}
) => {
  const next: SavedPutawayPlan = {
    context,
    locationOverrides,
    updatedAt: new Date().toISOString(),
  };
  try {
    const plans = loadPutawayPlans().filter((plan) => plan.context.stockEntryId !== context.stockEntryId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([next, ...plans].slice(0, 30)));
  } catch { /* The active workflow remains usable when device storage is unavailable. */ }
  return next;
};

export const removePutawayPlan = (stockEntryId: string) => {
  try {
    const plans = loadPutawayPlans().filter((plan) => plan.context.stockEntryId !== stockEntryId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
  } catch { /* A storage failure must not interrupt scanner operation. */ }
};
