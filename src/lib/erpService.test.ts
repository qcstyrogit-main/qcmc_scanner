import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erpApi", () => ({
  erpRequest: vi.fn(),
  extractErrorMessage: (payload: Record<string, unknown>, fallback: string) =>
    String(payload.message || payload.error || fallback),
  setErpSid: vi.fn(),
  setErpCsrf: vi.fn(),
  setErpMobileToken: vi.fn(),
}));

vi.mock("@/lib/erpSession", () => ({
  getErpMobileToken: () => "",
}));

import { erpRequest } from "@/lib/erpApi";
import { getPcountItemBaseline, getReconciliationContext } from "@/lib/erpService";

const mockedErpRequest = vi.mocked(erpRequest);

beforeEach(() => {
  mockedErpRequest.mockReset();
});

describe("ERP reconciliation context", () => {
  it("accepts an HTTP 200 context payload even when success flag is omitted", async () => {
    mockedErpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        message: {
          reconciliation_id: "MAT-RECO-1",
          warehouse: "FG - Guyong",
          purpose: "Stock Reconciliation",
        },
      },
    });

    await expect(getReconciliationContext("MAT-RECO-1")).resolves.toEqual({
      reconciliationId: "MAT-RECO-1",
      warehouse: "FG - Guyong",
      purpose: "Stock Reconciliation",
    });
  });

  it("preserves HTTP 200 ITEM_NOT_FOUND backend validation messages", async () => {
    mockedErpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        message: {
          success: false,
          error_code: "ITEM_NOT_FOUND",
          message: "Item ABC123 was not found in ERPNext.",
          item_code: "ABC123",
          row_number: 12,
        },
      },
    });

    await expect(getReconciliationContext("MAT-RECO-1")).rejects.toThrow(
      "Item ABC123 was not found in ERPNext. Item: ABC123. Row: 12."
    );
  });
});

describe("Physical Count item baseline", () => {
  it("preserves HTTP 200 backend validation messages", async () => {
    mockedErpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        message: {
          success: false,
          error_code: "ITEM_NOT_FOUND",
          message: "Item MNN12BSWP was not found in ERPNext.",
          item_code: "MNN12BSWP",
          row_number: 36,
        },
      },
    });

    await expect(getPcountItemBaseline(
      "MAT-RECO-1",
      "MNN12BSWP",
      "FG - Guyong",
      "B4GB2L2",
      ""
    )).rejects.toThrow(
      "Item MNN12BSWP was not found in ERPNext. Item: MNN12BSWP. Row: 36."
    );
  });
});
