import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveManufacturingEntryStage } from "@/lib/manufacturingEntry";

const source = readFileSync(new URL("../components/ManufacturingScanner.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/ManufacturingScanner.css", import.meta.url), "utf8");

describe("Picker / Warehouse Allocation blue-and-white mobile UI", () => {
  it("routes Inventory Picker into its actual first screen and covers all three Picker stages", () => {
    expect(resolveManufacturingEntryStage("picker", false)).toBe("picker-scan");
    expect(resolveManufacturingEntryStage("picker", true)).toBe("picker-scan");
    expect(source).toContain('const isPickerStage = stage === "picker-scan" || stage === "picker-form" || stage === "allocation";');
    expect(source).toContain('isPickerStage ? "is-picker-redesign" : ""');
    expect(source).toContain('className="mfg-picker-head"');
    expect(source).toContain("<h1>Picker / Warehouse Allocation</h1>");
    expect(source).toContain('onClick={goBack} aria-label="Back to Inventory"');
    expect(source).toContain("stage === \"picker-scan\" ? 1 : stage === \"picker-form\" ? 2");
    expect(css).toContain("QCMC Picker / Warehouse Allocation approved blue-and-white UI");
  });

  it("does not hardcode sample allocation identifiers or location codes", () => {
    expect(source).toContain('allocation?.name || pickerQr?.batch_id || "Scan Handover QR"');
    expect(source).toContain("allocationNextRow?.suggestedLocation");
    expect(source).toContain('allocationNextRow ? "Next suggested location"');
    expect(source).toContain("Allocation in progress");
    expect(source).toContain("Awaiting handover");
    expect(source).not.toContain("PUTAWAY-2026-00045");
    expect(source).not.toContain("B3GFR4L1C14");
    expect(source).not.toContain("ITEM-000123");
  });

  it("shows the actual Handover QR, transaction details, verification and submit stages", () => {
    expect(source).toContain('["Scan Handover QR", "Review Details", "Verify Locations", "Submit"]');
    expect(source).toContain('stage === "picker-scan" ? "Ready to Scan Handover QR" : "Ready to Scan Location"');
    expect(source).toContain('className="mfg-picker-form mfg-picker-form-redesign" onSubmit={createAllocation}');
    expect(source).toContain('onClick={openDatePicker}');
    expect(source).toContain('onClick={openTimePicker}');
    expect(source).toContain('pickerDropdown === "transaction"');
    expect(source).toContain('disabled={busy || !transactionType || !warehouse}');
    expect(source).toContain('createWarehouseAllocation({ batchId: pickerQr.batch_id');
    expect(source).toContain('getPickerContext(qr)');
    expect(source).toContain('if (!isPickerReadyStatus(context.status))');
  });

  it("uses actual ERPNext allocation rows and unique SKU counts with UOM-safe pending balance", () => {
    expect(source).toContain("const allocationVerifiedCount = allocation?.rows.filter");
    expect(source).toContain("const allocationNextRow = allocation?.rows.find");
    expect(source).toContain("const allocationSkuCount = new Set((allocation?.rows || []).map(");
    expect(source).toContain("const allocationBalances = allocationItemBalances(allocation)");
    expect(source).toContain("allocationRemainingUoms.size === 1");
    expect(source).toContain("const allocationPendingQty = allocationBalances.reduce");
    expect(source).toContain("allocationPendingHasUniformUom ? allocationPendingQty.toLocaleString() : \"Mixed UOM\"");
    expect(source).toContain('className="mfg-picker-progress-track"');
    expect(source).toContain('aria-valuenow={allocationVerifiedCount}');
    expect(source).toContain("allocation.rows.slice(0, showAllAllocationRows ? undefined : 3)");
  });

  it("makes every allocation row accessible with accurate location state", () => {
    expect(source).toContain("showAllAllocationRows ? \"Show fewer\"");
    expect(source).toContain("View all to access the remaining allocation rows.");
    expect(source).toContain("row.suggestedLocation || \"Not provided\"");
    expect(source).toContain("row.actualLocation || \"Scan Storage Location QR\"");
    expect(source).toContain('row.status.trim().toUpperCase() === "VERIFIED"');
    expect(source).toContain("row.originalQuantity.toLocaleString()");
    expect(source).toContain("row.allocatedQuantity.toLocaleString()");
    expect(source).toContain('onClick={() => void openLocationAction("verify", row)}');
    expect(source).toContain('Review / Reverify Location');
    expect(source).toContain('aria-expanded={showAllAllocationRows}');
    expect(source).not.toContain('className="mfg-allocation-progress-summary"');
  });

  it("retains required line-level allocation balances with optional disclosure", () => {
    expect(source).toContain('aria-expanded={showAllocationBalances}');
    expect(source).toContain("setShowAllocationBalances((shown) => !shown)");
    expect(source).toContain("balance.sourceDocument");
    expect(source).toContain("balance.sourceRow");
    expect(source).toContain("balance.required.toLocaleString()");
    expect(source).toContain("balance.allocated.toLocaleString()");
    expect(source).toContain("balance.overAllocated > 0");
    expect(source).toContain('Some required quantities remain unallocated or exceed the required amount.');
  });

  it("preserves live location scanning, capacity and quantity safeguards", () => {
    expect(source).toContain('const locationQr = requireStorageLocationQr(raw)');
    expect(source).toContain('resolveStorageLocationQr(locationQr, { forceRefresh: true })');
    expect(source).toContain('if (location.isGroup) throw new HandoverApiError');
    expect(source).toContain('onKeyDown={handleKey} onBlur={focusScanner}');
    expect(source).toContain('window.addEventListener("qcmc-scanner-data", handler)');
    expect(source).toContain('locationAction.kind !== "quantity" && !locationAction.locationId');
    expect(source).toContain("validateAllocationQuantity(allocation, locationAction.row, quantity,");
    expect(source).toContain("A reason is required for this change.");
    expect(source).toContain("verifyAllocationLocation(allocation.name, locationAction.row, locationAction.locationId!, quantity, deviceName)");
    expect(source).toContain("getWarehouseAllocation(allocation.name)");
    expect(source).toContain("saveActiveWarehouseAllocation(");
  });

  it("only enables completion after original server-backed allocation checks", () => {
    expect(source).toContain("const allocationReady = allocationIsReadyToComplete(allocation)");
    expect(source).toContain("allocationReady\n              ? <button");
    expect(source).toContain('disabled={busy || !allocationIsReadyToComplete(allocation)}');
    expect(source).toContain('onClick={() => void finishAllocation()}');
    expect(source).toContain('allocationNextRow\n                ? <button');
    expect(source).toContain('onClick={() => void openLocationAction("verify", allocationNextRow)}');
    expect(source).toContain('Review the remaining or overallocated item balances before completion.');
    expect(source).toContain("const result = await completeWarehouseAllocation(allocation.name, deviceName)");
    expect(source).toContain("if (!allocation || !allocationIsReadyToComplete(allocation))");
    expect(source).toContain('clearActiveWarehouseAllocation(authoritative.name)');
  });

  it("keeps other role screens unmodified and uses responsive Picker-only styles", () => {
    expect(source).toContain('const isPulloutStage = stage === "receive" || stage === "received";');
    expect(source).toContain('const isCheckerStage = stage === "batch" || stage === "checker-handover-scan" ||');
    expect(source).toContain('className="mfg-checker-overview"');
    expect(source).toContain('className="mfg-pullout-overview"');
    expect(css).toContain(".mfg-page.is-picker-redesign .mfg-picker-allocation-row");
    expect(css).toContain(".mfg-page.is-picker-redesign .mfg-picker-footer-actions");
    expect(css).toContain(".mfg-page.is-picker-redesign .mfg-picker-scan-ready");
    expect(css).toContain("@media (max-width: 360px)");
    expect(css).toContain("@media (max-height: 710px)");
    expect(css).toContain("focus-visible");
  });
});
