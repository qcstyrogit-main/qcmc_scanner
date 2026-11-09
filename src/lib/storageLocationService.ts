import { erpRequest, extractErrorMessage } from "@/lib/erpApi";
import { getErpMobileToken } from "@/lib/erpSession";

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const number = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const bool = (value: unknown) =>
  value === true || value === 1 || value === "1" || String(value ?? "").toLocaleLowerCase() === "true";

export const normalizeWarehouseName = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/[\s-]+/g, "");

export const getBidirectionalStorageLocationRange = (fromId: string, toId: string): string[] => {
  const from = fromId.trim();
  const to = toId.trim();
  const fromMatch = from.match(/^(.*?)(\d+)$/);
  const toMatch = to.match(/^(.*?)(\d+)$/);
  if (!fromMatch || !toMatch || fromMatch[1].toLocaleUpperCase() !== toMatch[1].toLocaleUpperCase()) {
    throw new StorageLocationError(
      `From and To must be in the same numbered Storage Location sequence: ${from} → ${to}.`,
      "LOCATION_RANGE_MISMATCH"
    );
  }

  const fromNumber = Number(fromMatch[2]);
  const toNumber = Number(toMatch[2]);
  const step = fromNumber <= toNumber ? 1 : -1;
  // ERP Storage Location IDs are authoritative. Do not zero-pad generated
  // range members: B3GFAROW3P-1 → B3GFAROW3P-10 must produce ...-2, not ...-02.
  const prefix = fromMatch[1];
  const count = Math.abs(toNumber - fromNumber) + 1;
  if (count > 200) {
    throw new StorageLocationError("From–To range is too large. Maximum is 200 locations.", "LOCATION_RANGE_TOO_LARGE");
  }

  return Array.from({ length: count }, (_, index) =>
    `${prefix}${fromNumber + (index * step)}`
  );
};

export class StorageLocationError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "StorageLocationError";
    this.code = code;
  }
}

export type StorageLocationQr = {
  rawBarcode: string;
  locationId: string;
  warehouse: string;
  locationCode: string;
  locationName: string;
  locationType: string;
  locationPath: string;
  itemCode: string;
  storageCapacity: number;
  isGroup: boolean;
};

export type ResolvedStorageLocation = {
  inventoryLocationId: string;
  locationCode: string;
  locationName: string;
  locationType: string;
  locationPath: string;
  warehouse: string;
  isGroup: boolean;
  disabled: boolean;
  itemCode: string;
  storageCapacity: number;
};

export const parseStorageLocationQr = (rawValue: string): StorageLocationQr | null => {
  const rawBarcode = rawValue.trim();
  if (!rawBarcode.startsWith("{")) return null;

  try {
    const payload = record(JSON.parse(rawBarcode));
    if (text(payload.type).toLocaleLowerCase() !== "storage_location") return null;

    const locationId = text(payload.location_id ?? payload.locationId);
    const warehouse = text(
      payload.warehouse ?? payload.warehouse_name ?? payload.warehouseName ?? payload.target_warehouse
    );
    if (!locationId || !warehouse) return null;

    return {
      rawBarcode,
      locationId,
      warehouse,
      locationCode: text(payload.location_code ?? payload.locationCode),
      locationName: text(payload.location_name ?? payload.locationName),
      locationType: text(payload.location_type ?? payload.locationType),
      locationPath: text(payload.location_path ?? payload.locationPath),
      itemCode: text(payload.item_code ?? payload.itemCode),
      storageCapacity: number(payload.storage_capacity ?? payload.storageCapacity),
      isGroup: bool(payload.is_group ?? payload.isGroup),
    };
  } catch {
    return null;
  }
};

export const requireStorageLocationQr = (rawValue: string) => {
  const qr = parseStorageLocationQr(rawValue);
  if (!qr) {
    throw new StorageLocationError(
      "Invalid Storage Location QR. The QR must contain type, location_id, and warehouse.",
      "INVALID_STORAGE_LOCATION_QR"
    );
  }
  return qr;
};

const resolvedLocationCache = new Map<string, ResolvedStorageLocation>();
const inFlightResolutions = new Map<string, Promise<ResolvedStorageLocation>>();
const STORAGE_LOCATION_CACHE_KEY = "qcmc.storageLocations.validated.1";

type PersistedStorageLocation = {
  location: ResolvedStorageLocation;
  validatedAt: string;
};

const loadPersistedLocations = (): Record<string, PersistedStorageLocation> => {
  try {
    if (typeof localStorage === "undefined") return {};
    const value = JSON.parse(localStorage.getItem(STORAGE_LOCATION_CACHE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, PersistedStorageLocation>
      : {};
  } catch {
    return {};
  }
};

const loadPersistedLocation = (locationId: string): ResolvedStorageLocation | null => {
  const candidate = loadPersistedLocations()[locationId.trim()];
  const location = candidate?.location;
  if (!location || location.inventoryLocationId !== locationId.trim() || !location.warehouse) return null;
  return location;
};

const persistResolvedLocation = (location: ResolvedStorageLocation) => {
  try {
    if (typeof localStorage === "undefined") return;
    const locations = loadPersistedLocations();
    locations[location.inventoryLocationId] = {
      location,
      validatedAt: new Date().toISOString(),
    };
    const newest = Object.entries(locations)
      .sort(([, left], [, right]) => String(right.validatedAt).localeCompare(String(left.validatedAt)))
      .slice(0, 500);
    localStorage.setItem(STORAGE_LOCATION_CACHE_KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // A failed cache write must never interrupt scanning.
  }
};

export const clearStorageLocationCache = () => {
  resolvedLocationCache.clear();
  inFlightResolutions.clear();
};

export const invalidateStorageLocationCache = (locationId: string) => {
  resolvedLocationCache.delete(locationId.trim());
  inFlightResolutions.delete(locationId.trim());
  try {
    if (typeof localStorage === "undefined") return;
    const locations = loadPersistedLocations();
    delete locations[locationId.trim()];
    localStorage.setItem(STORAGE_LOCATION_CACHE_KEY, JSON.stringify(locations));
  } catch {
    // Ignore storage failures.
  }
};

const verifyQrWarehouse = (qr: StorageLocationQr, location: ResolvedStorageLocation) => {
  if (normalizeWarehouseName(qr.warehouse) !== normalizeWarehouseName(location.warehouse)) {
    invalidateStorageLocationCache(qr.locationId);
    throw new StorageLocationError(
      `Location ${qr.locationId} belongs to ${location.warehouse} in ERPNext, but the QR contains ${qr.warehouse}.`,
      "LOCATION_WAREHOUSE_MISMATCH"
    );
  }
  return location;
};

const fetchStorageLocation = async (locationId: string): Promise<ResolvedStorageLocation> => {
  const mobileToken = getErpMobileToken();
  let response;
  try {
    response = await erpRequest(
      "/api/method/qcmc_logic.api.stock_entry_scanner.get_storage_location_details",
      {
        method: "POST",
        body: {
          inventory_location_id: locationId,
          ...(mobileToken ? { mobile_token: mobileToken } : {}),
        },
      }
    );
  } catch (error) {
    throw new StorageLocationError(
      error instanceof Error ? error.message : "Cannot reach ERPNext while checking the Storage Location.",
      "NETWORK_ERROR"
    );
  }

  const outer = record(response.data);
  const payload = record(outer.message ?? outer);
  const errorCode = text(payload.error_code ?? payload.code);
  if (!response.ok || payload.success !== true) {
    throw new StorageLocationError(
      extractErrorMessage(payload, `Unable to resolve Storage Location ${locationId}.`),
      errorCode || (response.status === 403 ? "PERMISSION_DENIED" : "STORAGE_LOCATION_NOT_FOUND")
    );
  }

  const inventoryLocationId = text(
    payload.inventory_location_id ?? payload.location_id ?? payload.inventory_location ?? payload.name
  );
  const warehouse = text(payload.warehouse ?? payload.warehouse_name ?? payload.target_warehouse);
  if (!inventoryLocationId || inventoryLocationId !== locationId || !warehouse) {
    throw new StorageLocationError(
      `ERPNext did not return authoritative details for Storage Location ${locationId}.`,
      "STORAGE_LOCATION_NOT_FOUND"
    );
  }

  const resolved: ResolvedStorageLocation = {
    inventoryLocationId,
    locationCode: text(payload.location_code) || inventoryLocationId,
    locationName: text(payload.location_name) || inventoryLocationId,
    locationType: text(payload.location_type),
    locationPath: text(payload.location_path),
    warehouse,
    isGroup: bool(payload.is_group),
    disabled: bool(payload.disabled),
    itemCode: text(payload.item_code),
    storageCapacity: number(payload.storage_capacity),
  };

  if (resolved.disabled) {
    throw new StorageLocationError(
      `Storage Location ${locationId} is disabled in ERPNext.`,
      "LOCATION_DISABLED"
    );
  }

  resolvedLocationCache.set(locationId, resolved);
  persistResolvedLocation(resolved);
  return resolved;
};

export const resolveStorageLocationQr = async (
  qr: StorageLocationQr,
  options: { forceRefresh?: boolean } = {}
) => {
  if (options.forceRefresh) invalidateStorageLocationCache(qr.locationId);

  const cached = resolvedLocationCache.get(qr.locationId);
  if (cached) return verifyQrWarehouse(qr, cached);

  let pending = inFlightResolutions.get(qr.locationId);
  if (!pending) {
    pending = fetchStorageLocation(qr.locationId).finally(() => {
      inFlightResolutions.delete(qr.locationId);
    });
    inFlightResolutions.set(qr.locationId, pending);
  }

  try {
    return verifyQrWarehouse(qr, await pending);
  } catch (error) {
    if (error instanceof StorageLocationError && error.code === "NETWORK_ERROR") {
      const persisted = loadPersistedLocation(qr.locationId);
      if (persisted) {
        resolvedLocationCache.set(qr.locationId, persisted);
        return verifyQrWarehouse(qr, persisted);
      }
    }
    throw error;
  }
};
