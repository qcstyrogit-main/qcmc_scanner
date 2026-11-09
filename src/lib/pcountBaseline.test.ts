import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erpApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/erpApi")>()),
  erpRequest: vi.fn(),
}));
vi.mock("@/lib/erpSession", () => ({
  getErpMobileToken: () => "",
  getErpSid: () => "",
  getErpCsrf: () => "",
  setErpSid: vi.fn(),
  setErpCsrf: vi.fn(),
  setErpMobileToken: vi.fn(),
}));

import { erpRequest } from "@/lib/erpApi";
import { getPcountItemBaseline } from "@/lib/erpService";

const request = vi.mocked(erpRequest);
const baseline = {
  reconciliation_id: "MAT-RECO-1",
  item_code: "ITEM-1",
  item_name: "Test item",
  warehouse: "FG - Sta Clara",
  inventory_location: "BIN-1",
  current_erp_quantity: 7,
  quantity: 7,
  uom: "PCS",
  batch_no: "",
};
const load = () => getPcountItemBaseline("MAT-RECO-1", "ITEM-1", "FG - Sta Clara", "BIN-1");
const respond = (payload: unknown, status = 200) => request.mockResolvedValue({
  ok: status >= 200 && status < 300,
  status,
  data: { message: payload },
});

beforeEach(() => request.mockReset());

describe("Physical Count baseline responses", () => {
  const camelBaseline = {
    itemCode: "ITEM-1", itemName: "Test item", warehouse: "FG - Sta Clara",
    inventoryLocation: "BIN-1", currentErpQuantity: 7, stockUom: "PCS",
    uomConversionFactor: 2, batchNo: "BATCH-1", uom: "BOX",
  };
  const shapes = {
    flat: (value: unknown) => value,
    data: (value: unknown) => ({ data: value }),
    baseline: (value: unknown) => ({ baseline: value }),
    result: (value: unknown) => ({ result: value }),
    message: (value: unknown) => ({ message: value }),
    repeatedMessage: (value: unknown) => ({ message: { message: { message: value } } }),
    mixed: (value: unknown) => ({ message: { data: { result: { baseline: value } } } }),
  };
  for (const [name, wrap] of Object.entries(shapes)) {
    it.each([ ["snake_case", baseline], ["camelCase", camelBaseline] ])(
      `accepts ${name} responses with %s fields`, async (_, fields) => {
        request.mockResolvedValue({ ok: true, status: 200, data: wrap(fields) });
        await expect(load()).resolves.toMatchObject({
          itemCode: "ITEM-1", itemName: "Test item", warehouse: "FG - Sta Clara",
          inventoryLocation: "BIN-1", currentErpQuantity: 7,
        });
        if (fields === camelBaseline) {
          await expect(load()).resolves.toMatchObject({ stockUom: "PCS", uomConversionFactor: 2, batchNo: "BATCH-1" });
        }
      }
    );
    it(`preserves explicit errors around ${name} baselines`, async () => {
      request.mockResolvedValue({ ok: true, status: 200, data: {
        success: false, error: "Count is closed.", result: wrap(baseline),
      } });
      await expect(load()).rejects.toThrow("Count is closed.");
    });
  }

  it.each([
    { error: "Count is closed." }, { _error_message: "Count is closed." },
    { exc: "Count is closed." }, { status: "error", message: "Count is closed." },
  ])("rejects explicit nested errors with valid stock fields %j", async (error) => {
    respond({ data: { ...baseline, ...error } });
    await expect(load()).rejects.toThrow("Count is closed.");
  });

  it.each([401, 404, 429, 500, 503])("keeps HTTP %s visible when the server returns no baseline or error details", async (status) => {
    request.mockResolvedValue({ ok: false, status, data: {} });
    await expect(load()).rejects.toThrow(`HTTP ${status}`);
    await expect(load()).rejects.not.toThrow("Missing or invalid fields");
  });

  it("preserves a backend failure explanation in details.reason", async () => {
    respond({ status: "failed", details: { reason: "Storage Location BIN-1 is disabled." } });
    await expect(load()).rejects.toThrow("Storage Location BIN-1 is disabled.");
  });

  it("reports malformed HTTP 200 baseline responses with safe response-field diagnostics", async () => {
    respond({ data: { itemCode: "ITEM-1", secret: "private-token", "private-key": "value" } });
    await expect(load()).rejects.toThrow("Missing or invalid fields: warehouse, inventory_location, current_erp_quantity.");
    await expect(load()).rejects.toThrow("HTTP 200");
    await expect(load()).rejects.toThrow("Response fields: itemCode.");
    await expect(load()).rejects.not.toThrow(/private-token|private-key|secret/);
  });
  it("accepts a complete HTTP 200 baseline without an optional success flag", async () => {
    respond(baseline);
    await expect(load()).resolves.toMatchObject({
      itemCode: "ITEM-1", warehouse: "FG - Sta Clara", inventoryLocation: "BIN-1",
      currentErpQuantity: 7, uom: "PCS",
    });
  });

  it("accepts an explicitly successful zero baseline", async () => {
    respond({ ...baseline, success: true, current_erp_quantity: 0, quantity: 0 });
    await expect(load()).resolves.toMatchObject({ currentErpQuantity: 0 });
  });

  it("preserves an explicit backend failure even when stock fields are present", async () => {
    respond({ ...baseline, success: false, message: "Storage Location is disabled." });
    await expect(load()).rejects.toThrow("Storage Location is disabled.");
  });

  it.each([undefined, null, "", " ", false, [], "bad", Infinity])(
    "rejects a missing or invalid quantity %j rather than assuming zero", async (quantity) => {
      respond({ ...baseline, success: true, current_erp_quantity: quantity, quantity });
      await expect(load()).rejects.toThrow(/invalid item baseline quantity/i);
    }
  );

  it("rejects a baseline returned for another location", async () => {
    respond({ ...baseline, success: true, inventory_location: "BIN-2" });
    await expect(load()).rejects.toThrow(/does not match/i);
  });

  it.each([
    { item_code: "OTHER-ITEM" },
    { warehouse: "OTHER-WAREHOUSE" },
    { inventory_location: undefined },
  ])("rejects missing or mismatched stock identity %j", async (identity) => {
    respond({ ...baseline, success: true, ...identity });
    await expect(load()).rejects.toThrow(/does not match/i);
  });

  it("rejects a backend exception even when baseline fields are present", async () => {
    respond({ ...baseline, exc_type: "ValidationError", message: "Count is closed." });
    await expect(load()).rejects.toThrow("Count is closed.");
  });

  it("shows Frappe's validation message instead of the HTTP 200 fallback", async () => {
    request.mockResolvedValue({ ok: true, status: 200, data: {
      exc_type: "ValidationError",
      _server_messages: JSON.stringify([JSON.stringify({ message: "Item <b>ITEM-1</b> is disabled.", raise_exception: 1 })]),
    }});
    await expect(load()).rejects.toThrow("Item ITEM-1 is disabled.");
  });

  it("preserves top-level Frappe validation details when message is only a string", async () => {
    request.mockResolvedValue({ ok: true, status: 200, data: {
      message: "Validation failed",
      exc_type: "ValidationError",
      _server_messages: JSON.stringify([JSON.stringify({ message: "ITEM-1 is not in this reconciliation.", raise_exception: 1 })]),
    }});
    await expect(load()).rejects.toThrow("ITEM-1 is not in this reconciliation.");
  });

  it("shows Frappe server messages when they are returned as an array", async () => {
    request.mockResolvedValue({ ok: true, status: 200, data: {
      message: { success: false },
      _server_messages: [{ message: "ITEM-1 is missing from row 36." }],
    }});
    await expect(load()).rejects.toThrow("ITEM-1 is missing from row 36.");
  });

  it.each([
    { error: "ITEM-1 is not part of this Stock Reconciliation." },
    { _error_message: "ITEM-1 has no baseline row." },
    { exc: "Traceback...\nValidationError: ITEM-1 baseline cannot be loaded." },
  ])("uses alternate backend error fields %j", async (errorFields) => {
    request.mockResolvedValue({ ok: true, status: 200, data: {
      message: { success: false, ...errorFields },
    }});
    await expect(load()).rejects.toThrow("ITEM-1");
  });

  it("reports missing fields for an unexplained HTTP 200 failure", async () => {
    request.mockResolvedValue({ ok: true, status: 200, data: {
      message: {
        status: "failed",
        details: { diagnostic: "unrecognized test shape" },
      },
    }});
    await expect(load()).rejects.toThrow("Missing or invalid fields: item_code, warehouse, inventory_location, current_erp_quantity.");
    await expect(load()).rejects.toThrow("HTTP 200");
    await expect(load()).rejects.toThrow("Response fields: status, details.");
  });
});
