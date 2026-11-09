import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manufacturing = readFileSync(new URL("../components/ManufacturingScanner.tsx", import.meta.url), "utf8");
const manufacturingCss = readFileSync(new URL("../components/ManufacturingScanner.css", import.meta.url), "utf8");
const scan = readFileSync(new URL("../components/ScanPage.tsx", import.meta.url), "utf8");
const setupCss = readFileSync(new URL("../components/ScanPage.compact.css", import.meta.url), "utf8");

describe("Three QCMC blue-white entry screens from Android screenshots", () => {
  it("uses approved Receive Finished Goods header on actual menu stage", () => {
    expect(manufacturing).toContain('const isRoleMenuStage = stage === "menu";');
    expect(manufacturing).toContain('isRoleMenuStage ? "is-role-menu-redesign" : ""');
    expect(manufacturing).toContain('className="mfg-entry-head"');
    expect(manufacturing).toContain("<strong>Receive Finished Goods</strong>");
    expect(manufacturing).toContain("{employee.full_name} / {deviceName}");
    expect(manufacturing).toContain('onClick={goBack}');
    expect(manufacturingCss).toContain("QCMC entry screens — Receive FG roles and Checker Handover QR");
  });

  it("retains the original role choices with exact existing online actions", () => {
    expect(manufacturing).toContain('stage === "menu" && <section className="mfg-role-home"');
    expect(manufacturing).toContain('openOnlineStage("receive", "Scan a packing-label QR containing a Job Card reference.")');
    expect(manufacturing).toContain('openOnlineStage("batch", "Review the live ERPNext Pullout quantities.")');
    expect(manufacturing).toContain('openOnlineStage("picker-scan", "Scan the generated Handover QR.")');
    expect(manufacturing).toContain('disabled={busy || !checkerActivityAvailable}');
    expect(manufacturing).toContain("No active Draft Stock Entries require Checker Verification on this device.");
    expect(manufacturing).toContain("verifyReceiveFinishedGoodsConnection()");
    expect(manufacturing).not.toContain("Enter Job Card Manually");
  });

  it("displays only saved completed allocation history without imaginary ERP transactions", () => {
    expect(manufacturing).toContain("allocationHistory.length > 0");
    expect(manufacturing).toContain("allocationHistory.map((entry)");
    expect(manufacturing).toContain('setAllocation(entry.allocation); setStage("allocation");');
    expect(manufacturing).toContain("entry.stockEntryIds.length");
    expect(manufacturing).toContain("new Date(entry.completedAt).toLocaleString()");
    expect(manufacturing).not.toContain("STE-FG-000123");
  });

  it("covers actual checker handover-qr stage, including a themed header", () => {
    expect(manufacturing).toContain('const isHandoverQrStage = stage === "handover-qr";');
    expect(manufacturing).toContain('isHandoverQrStage ? "is-handover-qr-redesign" : ""');
    expect(manufacturing).toContain('isCheckerStage || isHandoverQrStage ?');
    expect(manufacturing).toContain('stage === "handover-qr" && handoverQr && <section className="mfg-checker-handover"');
    expect(manufacturing).toContain('["Pullout", "Checker", "Picker"]');
    expect(manufacturingCss).toContain('.mfg-page.is-handover-qr-redesign .mfg-checker-head');
  });

  it("keeps backend QR issuer and permission checks, without fabricated QR or identity", () => {
    expect(manufacturing).toContain("if (!canGenerateHandoverQr(handover))");
    expect(manufacturing).toContain("const active = await syncHandoverBatch()");
    expect(manufacturing).toContain("const qr = await ensureHandoverQr(active)");
    expect(manufacturing).toContain("const context = await getPickerContext(qr.parsed)");
    expect(manufacturing).toContain("setHandoverQr(qr.raw)");
    expect(manufacturing).toContain('<QRCodeSVG value={handoverQr} size={230} level="M" marginSize={2}/>');
    expect(manufacturing).toContain("handover?.batchId");
    expect(manufacturing).toContain("handover?.checker || \"Authorized Checker\"");
    expect(manufacturing).toContain("handover?.expiresAt");
    expect(manufacturing).not.toContain("STE-FG-00123");
  });

  it("retains real Picker and Return to Roles actions after handover QR", () => {
    expect(manufacturing).toContain('stage === "handover-qr" && <><button className="mfg-secondary"');
    expect(manufacturing).toContain('onClick={() => setStage("picker-scan")}');
    expect(manufacturing).toContain('onClick={() => setStage("menu")}');
    expect(manufacturing).toContain("Go to Picker");
    expect(manufacturing).toContain("Return to Roles");
    expect(manufacturingCss).toContain('.mfg-page.is-handover-qr-redesign .mfg-dock > button:first-child');
    expect(manufacturingCss).toContain('Keep the QR large enough to scan');
  });

  it("scopes Physical Count setup to its non-scanning route only", () => {
    expect(scan).toContain('!isScanSessionActive && mode === "pcount" ? "is-pcount-setup-redesign" : ""');
    expect(scan).toContain('className="scan-hero scan-setup-hero"');
    expect(scan).toContain('aria-label="Back to Inventory"');
    expect(scan).toContain("onBack();");
    expect(scan).toContain('className="mfg-workflow qcmc-scan-workflow scan-setup-workflow"');
    expect(scan).toContain('["Reference", "Location", "Items"]');
    expect(setupCss).toContain("QCMC Physical Count setup entry UI");
    expect(setupCss).toContain('.scan-page.is-setup.is-pcount-setup-redesign');
  });

  it("shows actual Physical Count reference, warehouse and selected location, no hardcoded sample", () => {
    expect(scan).toContain('className="scan-session-summary scan-setup-summary"');
    expect(scan).toContain('className="scan-session-item scan-setup-summary-card"');
    expect(scan).toContain('reconciliationCode || "Not scanned"');
    expect(scan).toContain('Warehouse: {reconciliationWarehouse}');
    expect(scan).toContain('currentBin.locationCode || currentBin.locationId');
    expect(scan).toContain('activeGroupLocations.length} locations selected');
    expect(scan).toContain('className="scan-setup-location-status"');
    expect(scan).not.toContain("MAT-RECO-2026-00038");
  });

  it("does not allow items without a location; scan ready only focuses existing hardware input", () => {
    expect(scan).toContain('className="scan-setup-scan-ready"');
    expect(scan).toContain('onClick={(event) => { event.stopPropagation(); focusScanner(); }}');
    expect(scan).toContain('Items cannot start until a location is selected.');
    expect(scan).toContain('disabled={activeGroupLocations.length === 0}');
    expect(scan).toContain('onClick={continueMultiLocationItems}');
    expect(scan).toContain('step === "item" && currentBin');
    expect(scan).toContain('onClick={() => void startScanning()}');
    expect(scan).toContain('id="scanner-input"');
    expect(scan).toContain('inputMode="none"');
    expect(scan).toContain("Scan a Storage Location before scanning items.");
  });

  it("keeps Physical Count workflow/role boundaries and app-specific breakpoints", () => {
    expect(scan).toContain('onClick={scanAnotherReconciliation}');
    expect(scan).toContain('onClick={scanAnotherBin}');
    expect(scan).toContain('isScanSessionActive && mode === "pcount" ? "is-pcount-redesign"');
    expect(setupCss).toContain('@media (max-width:360px)');
    expect(setupCss).toContain('@media (max-height:710px)');
    expect(manufacturingCss).toContain('@media (max-width:360px)');
    expect(manufacturingCss).toContain('.mfg-page.is-role-menu-redesign .mfg-role-card:disabled');
    expect(manufacturingCss).toContain('.mfg-page.is-handover-qr-redesign .mfg-checker-handover-code svg');
  });
});
