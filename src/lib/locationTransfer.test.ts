import { beforeEach, describe, expect, it, vi } from "vitest";

const { erpRequest } = vi.hoisted(() => ({ erpRequest: vi.fn() }));
vi.mock("@/lib/erpApi", () => ({ erpRequest, extractErrorMessage: (payload: Record<string, unknown>, fallback: string) => String(payload.message || fallback) }));
vi.mock("@/lib/erpSession", () => ({ getErpMobileToken: () => "mobile-token" }));

import {
  createLocationTransfer, loadSourceLocationStock, parseTransferItemQr, parseTransferQuantity,
  validateTransferDestination, validateTransferLocation, validateTransferQuantity, verifyLocationTransferConnection,
  type TransferItemStock,
} from "@/lib/locationTransfer";
import type { ResolvedStorageLocation } from "@/lib/storageLocationService";

const success = (payload: Record<string, unknown>) => ({ ok: true, status: 200, data: { message: { success: true, ...payload } } });
const failure = (code: string, message: string) => ({ ok: true, status: 200, data: { message: { success: false, error_code: code, message } } });
const source: ResolvedStorageLocation = { inventoryLocationId: "LOC-A", locationCode: "A", locationName: "A", locationType: "Bin", locationPath: "", warehouse: "FG - Guyong", isGroup: false, disabled: false, itemCode: "", storageCapacity: 0 };
const target: ResolvedStorageLocation = { ...source, inventoryLocationId: "LOC-B", locationCode: "B", locationName: "B" };
const item: TransferItemStock = { itemCode: "ITEM-1", itemName: "Finished", uom: "PCS", availableQuantity: 5000, precision: 2, batchNo: "", serialNos: [], requiresBatch: false, requiresSerial: false };
const qr = (id: string, warehouse = "FG - Guyong") => JSON.stringify({ type: "storage_location", location_id: id, warehouse });

beforeEach(() => { erpRequest.mockReset(); vi.stubGlobal("navigator", { onLine: true }); });

describe("Location Transfer", () => {
  it("parses a plain Item barcode", () => expect(parseTransferItemQr("ITEM-1").itemCode).toBe("ITEM-1"));
  it("parses Batch and Serial details from an Item QR", () => expect(parseTransferItemQr(JSON.stringify({ item_code: "ITEM-1", batch_no: "B-1", serial_nos: ["S-1"] }))).toMatchObject({ batchNo: "B-1", serialNos: ["S-1"] }));
  it("parses comma-formatted quantities", () => expect(parseTransferQuantity("5,000.25")).toBe(5000.25));
  it("rejects zero quantity", () => expect(validateTransferQuantity(0, 5000)).toContain("greater than zero"));
  it("rejects quantity above exact-location availability", () => expect(validateTransferQuantity(5001, 5000)).toContain("cannot exceed"));
  it("accepts a valid partial quantity", () => expect(validateTransferQuantity(2500, 5000)).toBe(""));
  it("accepts the full available quantity", () => expect(validateTransferQuantity(5000, 5000)).toBe(""));

  it("validates a live leaf Storage Location", async () => {
    erpRequest.mockResolvedValue(success({ inventory_location_id: "LOC-A", warehouse: "FG - Guyong", is_group: false, disabled: false }));
    await expect(validateTransferLocation(qr("LOC-A"))).resolves.toMatchObject({ inventoryLocationId: "LOC-A", warehouse: "FG - Guyong" });
    expect(erpRequest.mock.calls[0][1].body).toMatchObject({ inventory_location_id: "LOC-A", mobile_token: "mobile-token" });
  });
  it("rejects a group Source or Destination Location", async () => {
    erpRequest.mockResolvedValue(success({ inventory_location_id: "LOC-A", warehouse: "FG - Guyong", is_group: true }));
    await expect(validateTransferLocation(qr("LOC-A"))).rejects.toMatchObject({ code: "LOCATION_IS_GROUP" });
  });
  it("rejects a disabled location", async () => {
    erpRequest.mockResolvedValue(success({ inventory_location_id: "LOC-A", warehouse: "FG - Guyong", disabled: true }));
    await expect(validateTransferLocation(qr("LOC-A"))).rejects.toMatchObject({ code: "LOCATION_DISABLED" });
  });
  it("rejects the same Source and Destination", async () => {
    await expect(validateTransferDestination(source, source)).rejects.toMatchObject({ code: "SOURCE_TARGET_SAME" });
    expect(erpRequest).not.toHaveBeenCalled();
  });
  it("rejects a cross-Warehouse destination before calling ERPNext", async () => {
    await expect(validateTransferDestination(source, { ...target, warehouse: "FG - MC1" })).rejects.toMatchObject({ code: "WAREHOUSE_MISMATCH" });
    expect(erpRequest).not.toHaveBeenCalled();
  });
  it("surfaces backend destination capacity validation during submission", async () => {
    erpRequest.mockResolvedValue(failure("DESTINATION_CAPACITY_EXCEEDED", "No capacity"));
    await expect(createLocationTransfer({ item, source, target, quantity: 5000, deviceId: "S1", requestId: "transfer-1" })).rejects.toMatchObject({ code: "DESTINATION_CAPACITY_EXCEEDED", message: "No capacity" });
  });
  it("surfaces backend Item/location restrictions during submission", async () => {
    erpRequest.mockResolvedValue(failure("INVALID_DESTINATION_LOCATION", "Item is restricted"));
    await expect(createLocationTransfer({ item, source, target, quantity: 5000, deviceId: "S1", requestId: "transfer-1" })).rejects.toMatchObject({ code: "INVALID_DESTINATION_LOCATION", message: "Item is restricted" });
  });
  it("loads stock only for the exact Source Location", async () => {
    erpRequest.mockResolvedValue(success({ item_code: "ITEM-1", stock_uom: "PCS", available_quantity: 5000 }));
    const stock = await loadSourceLocationStock(source, parseTransferItemQr("ITEM-1"));
    expect(stock.availableQuantity).toBe(5000);
    expect(erpRequest.mock.calls[0][0]).toBe("/api/method/qcmc_logic.api.location_transfer.get_item_stock");
    expect(erpRequest.mock.calls[0][1].body).toMatchObject({ source_location: "LOC-A", item_code: "ITEM-1" });
  });
  it("requires a Batch for a batch-controlled Item", async () => {
    erpRequest.mockResolvedValue(success({ item_code: "ITEM-1", stock_uom: "PCS", available_quantity: 5, requires_batch: true }));
    await expect(loadSourceLocationStock(source, parseTransferItemQr("ITEM-1"))).rejects.toMatchObject({ code: "BATCH_REQUIRED" });
  });
  it("requires Serials for a serial-controlled Item", async () => {
    erpRequest.mockResolvedValue(success({ item_code: "ITEM-1", stock_uom: "PCS", available_quantity: 1, requires_serial: true }));
    await expect(loadSourceLocationStock(source, parseTransferItemQr("ITEM-1"))).rejects.toMatchObject({ code: "SERIAL_REQUIRED" });
  });
  it("submits a same-Warehouse transfer without sending a frontend Warehouse", async () => {
    erpRequest.mockResolvedValue(success({ stock_entry: "MAT-STE-1", item_code: "ITEM-1", quantity: 2500, uom: "PCS", source_location: "LOC-A", target_location: "LOC-B", warehouse: "FG - Guyong" }));
    const result = await createLocationTransfer({ item, source, target, quantity: 2500, deviceId: "S1", requestId: "transfer-1" });
    expect(result).toMatchObject({ stockEntry: "MAT-STE-1", quantity: 2500, sourceLocation: "LOC-A", targetLocation: "LOC-B" });
    expect(erpRequest.mock.calls[0][1].body).toMatchObject({ request_id: "transfer-1", source_location: "LOC-A", target_location: "LOC-B" });
    expect(erpRequest.mock.calls[0][1].body.warehouse).toBeUndefined();
  });
  it("surfaces stock changed protection with the latest quantity", async () => {
    erpRequest.mockResolvedValue(failure("STOCK_CHANGED", "Changed"));
    await expect(createLocationTransfer({ item, source, target, quantity: 5000, deviceId: "S1", requestId: "transfer-1" })).rejects.toMatchObject({ code: "STOCK_CHANGED" });
  });
  it("accepts a duplicate request response as the original success", async () => {
    erpRequest.mockResolvedValue(success({ duplicate_request: true, stock_entry: "MAT-STE-1", quantity: 5000 }));
    await expect(createLocationTransfer({ item, source, target, quantity: 5000, deviceId: "S1", requestId: "same-id" })).resolves.toMatchObject({ stockEntry: "MAT-STE-1", duplicateRequest: true });
  });
  it("blocks all work when offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await expect(verifyLocationTransferConnection()).rejects.toMatchObject({ code: "INTERNET_REQUIRED" });
    expect(erpRequest).not.toHaveBeenCalled();
  });
});
