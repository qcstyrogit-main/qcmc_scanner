import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const blankPage = readFileSync(new URL("../components/BlankPage.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../styles/authenticated-ui.css", import.meta.url), "utf8");

const start = blankPage.indexOf('{currentView === "dashboard" && (');
const end = blankPage.indexOf('{currentView === "issue_stock_coming_soon" && (', start);
const home = blankPage.slice(start, end);

describe("Inventory Home approved illustration UI", () => {
  it("preserves an inventory dashboard and clearly separates resume, operations, and tools", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(home).toContain('className="home-scan-selector inventory-home-v2"');
    expect(home).toContain('id="home-scan-title">Inventory</h1>');
    expect(home).toContain("Resume Work");
    expect(home).toContain("Warehouse Operations");
    expect(home).toContain("Activity &amp; Tools");
    expect(home).toContain('className="inventory-home-tip"');
    expect(home).toContain("Choose an operation to start scanning");
  });

  it("uses actual persisted session references and timestamps instead of sample values", () => {
    expect(blankPage).toContain('const dashboardPcountSession = currentView === "dashboard" ? loadPcountSession(employee.id) : null;');
    expect(blankPage).toContain('const dashboardHandover = currentView === "dashboard" ? loadDeviceHandover() : null;');
    expect(blankPage).toContain('const dashboardActiveAllocation = currentView === "dashboard" ? loadActiveWarehouseAllocation() : null;');
    expect(home).toContain("dashboardPcountSession.reconciliationCode");
    expect(home).toContain("dashboardPcountSession.activeLocationId");
    expect(home).toContain("dashboardPcountSession.updatedAt");
    expect(blankPage).toContain("All recorded locations counted · Review or continue");
    expect(home).toContain("dashboardAllocation.name");
    expect(home).toContain("dashboardHandover.batchId");
    expect(home).not.toContain("MAT-RECO-2026-00038");
    expect(home).not.toContain("Last scanned 2 mins ago");
  });

  it("keeps exactly the six illustrated warehouse operations and original navigation handlers", () => {
    expect(home.match(/className="inventory-task(?: is-upcoming)?"/g)).toHaveLength(6);
    expect(home).toContain('onClick={() => startScanner("pcount")}');
    expect(home).toContain('onClick={() => startManufacturingRole("pullout")}');
    expect(home).toContain('onClick={() => startManufacturingRole("checker")}');
    expect(home).toContain('onClick={() => startManufacturingRole("picker")}');
    expect(home).toContain('onClick={() => setCurrentView("location_transfer")}');
    expect(home).toContain('onClick={() => setCurrentView("issue_stock_coming_soon")}');
    expect(home).toContain('className="inventory-home-coming-soon"');
    expect(home).toContain("Coming soon");
  });

  it("does not claim ERP is connected without a completed successful connection test", () => {
    expect(home).toContain('className="inventory-home-tool" onClick={() => void testErpConnection()}');
    expect(home).toContain('disabled={connectionTest.loading}');
    expect(home).toContain('connectionTest.ok === true ? "Last test passed"');
    expect(home).toContain('connectionTest.ok === false ? "Connection test failed"');
    expect(home).toContain('"Tap to test ERP"');
    expect(home).not.toContain("Connected to ERP");
    expect(home).toContain('scannerQuantityMode === "automatic" ? "Automatic Mode" : "Manual Mode"');
  });

  it("keeps the existing activity, settings, and Resume Work actions", () => {
    expect(home).toContain('onClick={() => startScanner("pcount", true)}');
    expect(home).toContain("onClick={resumeAllocation}");
    expect(home).toContain('onClick={() => startScanner("in")}');
    expect(home).toContain("onClick={openHistory}");
    expect(home).toContain('onClick={() => setCurrentView("profile")}');
    expect(home).toContain('className="inventory-home-saved-status"');
  });

  it("uses the approved blue-and-white mobile layout with accessible scrolling", () => {
    expect(stylesheet).toContain("/* Inventory Home v2 — approved warehouse-scanner illustration, scoped UI only */");
    expect(stylesheet).toContain(".inventory-home-v2 .inventory-home-header");
    expect(stylesheet).toContain(".inventory-home-v2 .inventory-home-operation-grid .inventory-task");
    expect(stylesheet).toContain(".inventory-home-v2 .inventory-home-tools-grid");
    expect(stylesheet).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(stylesheet).toContain("overflow-y: auto;");
    expect(stylesheet).toContain("@media (max-width: 430px)");
    expect(stylesheet).toContain("@media (max-width: 350px)");
    expect(stylesheet).toContain(".inventory-home-v2 button:focus-visible");
  });

  it("preserves the bottom navigation destinations and only clarifies Scan Mode", () => {
    expect(blankPage).toContain('aria-label="Primary navigation"');
    expect(blankPage).toContain('<span>Inventory</span>');
    expect(blankPage).toContain('<span>Delivery</span>');
    expect(blankPage).toContain('<span>Scan Mode</span>');
    expect(blankPage).toContain('<span>Transactions</span>');
    expect(blankPage).toContain('<span>Profile</span>');
    expect(blankPage).toContain('aria-label="Choose scanner quantity mode"');
    expect(blankPage).toContain("selectScannerQuantityMode(\"manual\")");
    expect(blankPage).toContain("selectScannerQuantityMode(\"automatic\")");
  });
});
