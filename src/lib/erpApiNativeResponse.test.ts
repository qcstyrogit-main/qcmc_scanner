import { beforeEach, describe, expect, it, vi } from "vitest";

const { nativeRequest } = vi.hoisted(() => ({ nativeRequest: vi.fn() }));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { request: nativeRequest },
}));

vi.mock("@/lib/erpSession", () => ({
  getErpSid: () => "active-sid",
  getErpCsrf: () => "active-csrf",
  getErpMobileToken: () => "active-mobile-token",
  setErpSid: vi.fn(),
  setErpCsrf: vi.fn(),
  setErpMobileToken: vi.fn(),
}));

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => "https://erp-dev.tailabc5e7.ts.net",
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
});

import { erpRequest } from "@/lib/erpApi";

beforeEach(() => nativeRequest.mockReset());

describe("native ERP response decoding", () => {
  it("reads native JSON as text without replaying a POST", async () => {
    nativeRequest.mockResolvedValueOnce({
        status: 200,
        data: JSON.stringify({
          message: {
            success: true,
            item_code: "ITEM-1",
            warehouse: "FG - Sta Clara",
            inventory_location: "BIN-1",
            current_erp_quantity: 7,
          },
        }),
        headers: { "content-type": "application/json" },
      });

    const response = await erpRequest("/api/method/qcmc_logic.api.stock_reconciliation.get_pcount_item_baseline", {
      method: "POST",
      body: {
        reconciliation_id: "MAT-RECO-1",
        item_code: "ITEM-1",
        warehouse: "FG - Sta Clara",
        inventory_location: "BIN-1",
      },
    });

    expect(response).toMatchObject({
      ok: true,
      status: 200,
      data: { message: { item_code: "ITEM-1", current_erp_quantity: 7 } },
    });
    expect(nativeRequest).toHaveBeenCalledTimes(1);
    expect(nativeRequest.mock.calls[0][0]).toMatchObject({ responseType: "text" });
  });

  it("rejects an empty successful native response without replaying a POST", async () => {
    nativeRequest.mockResolvedValueOnce({ status: 200, data: null, headers: { "content-type": "application/json" } });
    await expect(erpRequest("/api/method/qcmc_logic.api.stock_reconciliation.get_pcount_item_baseline", {
      method: "POST", body: { reconciliation_id: "MAT-RECO-1" },
    })).rejects.toThrow("ERP returned an empty response");
    expect(nativeRequest).toHaveBeenCalledTimes(1);
  });
});
