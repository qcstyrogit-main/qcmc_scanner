import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erpApi", () => ({
  erpRequest: vi.fn(),
  extractErrorMessage: (data: Record<string, unknown>, fallback: string) =>
    typeof data.message === "string" ? data.message : fallback,
}));

vi.mock("@/lib/erpSession", () => ({
  getErpMobileToken: () => "mobile-token",
}));

import { erpRequest } from "@/lib/erpApi";
import {
  clearStorageLocationCache,
  parseStorageLocationQr,
  requireStorageLocationQr,
  resolveStorageLocationQr,
  StorageLocationError,
} from "@/lib/storageLocationService";

const compact = JSON.stringify({
  type: "storage_location",
  location_id: "B9GFB1L1",
  warehouse: "FG - Guyong",
});

const erpLocation = {
  success: true,
  inventory_location_id: "B9GFB1L1",
  location_code: "B9-GF-B1-L1",
  location_name: "Building 9 Ground Floor Block 1 Lot 1",
  location_type: "Lot",
  location_path: "Guyong / Building 9 / Lot 1",
  warehouse: "FG - Guyong",
  is_group: false,
  disabled: false,
  item_code: "ITEM-ERP",
  storage_capacity: 10000,
};

const persistedStorage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => persistedStorage.get(key) ?? null,
    setItem: (key: string, value: string) => persistedStorage.set(key, String(value)),
    removeItem: (key: string) => persistedStorage.delete(key),
    clear: () => persistedStorage.clear(),
  },
});

describe("Storage Location QR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistedStorage.clear();
    clearStorageLocationCache();
  });

  it("accepts the compact format without optional descriptions", () => {
    const result = parseStorageLocationQr(compact);
    expect(result).toMatchObject({ locationId: "B9GFB1L1", warehouse: "FG - Guyong" });
    expect(result?.locationName).toBe("");
  });

  it("accepts the legacy full format", () => {
    const result = parseStorageLocationQr(JSON.stringify({
      type: "storage_location",
      location_id: "B9GFB1L1",
      warehouse: "FG - Guyong",
      location_name: "Old label name",
      location_type: "Lot",
      location_path: "Old / Path",
      storage_capacity: 50,
      is_group: 0,
    }));
    expect(result?.locationName).toBe("Old label name");
  });

  it("rejects a missing location_id and a wrong QR type", () => {
    expect(parseStorageLocationQr(JSON.stringify({ type: "storage_location", warehouse: "FG - Guyong" }))).toBeNull();
    expect(parseStorageLocationQr(JSON.stringify({ type: "item", location_id: "B9GFB1L1", warehouse: "FG - Guyong" }))).toBeNull();
    expect(() => requireStorageLocationQr("{}"))
      .toThrowError(expect.objectContaining({ code: "INVALID_STORAGE_LOCATION_QR" }));
  });

  it("replaces stale legacy descriptions with ERPNext details", async () => {
    vi.mocked(erpRequest).mockResolvedValue({ ok: true, status: 200, data: { message: erpLocation } });
    const qr = requireStorageLocationQr(JSON.stringify({
      type: "storage_location",
      location_id: "B9GFB1L1",
      warehouse: "FG-Guyong",
      location_name: "STALE NAME",
      storage_capacity: 1,
    }));
    const result = await resolveStorageLocationQr(qr);
    expect(result.locationName).toBe("Building 9 Ground Floor Block 1 Lot 1");
    expect(result.storageCapacity).toBe(10000);
    expect(result.warehouse).toBe("FG - Guyong");
  });

  it("rejects a genuine warehouse mismatch", async () => {
    vi.mocked(erpRequest).mockResolvedValue({ ok: true, status: 200, data: { message: erpLocation } });
    const qr = requireStorageLocationQr(JSON.stringify({
      type: "storage_location", location_id: "B9GFB1L1", warehouse: "RM - Guyong",
    }));
    await expect(resolveStorageLocationQr(qr)).rejects.toMatchObject({ code: "LOCATION_WAREHOUSE_MISMATCH" });
  });

  it("rejects a disabled location", async () => {
    vi.mocked(erpRequest).mockResolvedValue({
      ok: true, status: 200, data: { message: { ...erpLocation, disabled: true } },
    });
    await expect(resolveStorageLocationQr(requireStorageLocationQr(compact)))
      .rejects.toMatchObject({ code: "LOCATION_DISABLED" });
  });

  it("returns group status so the active workflow can reject it", async () => {
    vi.mocked(erpRequest).mockResolvedValue({
      ok: true, status: 200, data: { message: { ...erpLocation, is_group: true } },
    });
    expect((await resolveStorageLocationQr(requireStorageLocationQr(compact))).isGroup).toBe(true);
  });

  it("uses the session cache for repeated scans", async () => {
    vi.mocked(erpRequest).mockResolvedValue({ ok: true, status: 200, data: { message: erpLocation } });
    const qr = requireStorageLocationQr(compact);
    await resolveStorageLocationQr(qr);
    await resolveStorageLocationQr(qr);
    expect(erpRequest).toHaveBeenCalledTimes(1);
  });

  it("uses a previously ERP-validated location when the network is offline", async () => {
    vi.mocked(erpRequest).mockResolvedValueOnce({ ok: true, status: 200, data: { message: erpLocation } });
    const qr = requireStorageLocationQr(compact);
    await resolveStorageLocationQr(qr);

    clearStorageLocationCache();
    vi.mocked(erpRequest).mockRejectedValueOnce(new Error("Cannot reach ERP server"));

    await expect(resolveStorageLocationQr(qr)).resolves.toMatchObject({
      inventoryLocationId: "B9GFB1L1",
      warehouse: "FG - Guyong",
    });
  });

  it("does not trust a QR-only location that was never validated by ERP", async () => {
    vi.mocked(erpRequest).mockRejectedValueOnce(new Error("Cannot reach ERP server"));

    await expect(resolveStorageLocationQr(requireStorageLocationQr(compact)))
      .rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});
