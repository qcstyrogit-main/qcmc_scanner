import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../components/ManufacturingScanner.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/ManufacturingScanner.css", import.meta.url), "utf8");

describe("Checker blue-and-white approved illustration UI", () => {
  it("scopes the new design to Checker review and assigned Checker QR stages", () => {
    expect(source).toContain('const isCheckerStage = stage === "batch" || stage === "checker-handover-scan" ||');
    expect(source).toContain('isCheckerStage || isHandoverQrStage ? "is-checker-redesign" : ""');
    expect(source).toContain('className="mfg-checker-head"');
    expect(source).toContain('<h1>Checker</h1>');
    expect(source).toContain('onClick={goBack} aria-label="Back to previous screen"');
    expect(source).toContain('className="mfg-head"');
    expect(source).toContain('workflowStep > 0 && !isPulloutStage && !isCheckerStage');
    expect(css).toContain("/* QCMC Checker approved blue-and-white review — 2026-10-19 */");
  });

  it("shows actual batch identity and statuses without imaginary example rows", () => {
    expect(source).toContain('<strong>{handover.batchId}</strong>');
    expect(source).toContain('handover.status === "CHECKED" ? "Checked" : "Pending Check"');
    expect(source).toContain("Warehouse Man: {handover.warehouseMan");
    expect(source).toContain("Review Pullout Batch");
    expect(source).not.toContain("BATCH-2026-0041");
    expect(source).not.toContain("VFP8SM25");
    expect(source).not.toContain("MAT-PP-001");
  });

  it("counts real Draft Stock Entries and SKUs with stock UOM protection", () => {
    expect(source).toContain('handover.status === "CHECKED" ? handover.drafts : pendingCheckerItems(handover.drafts, handover.status)');
    expect(source).toContain("checkerRows.map((row) => row.stockEntryId)");
    expect(source).toContain("checkerRows.map((row) => row.itemCode.trim().toUpperCase())");
    expect(source).toContain("checkerRows.every((row) => Boolean(row.uom.trim()))");
    expect(source).toContain("checkerRows.reduce((sum, row) => sum + row.recordedQuantity, 0)");
    expect(source).toContain('checkerRecordedUnits === null ? "Mixed UOM"');
    expect(source).toContain('checkerRows.length === 0 ? "—"');
  });

  it("makes the three actual Checker stages clear while keeping all rows reachable", () => {
    expect(source).toContain('["Review Items", "Scan Checker QR", "Handover QR"]');
    expect(source).toContain('stage === "checker" || stage === "batch" ? 1 : 2');
    expect(source).toContain('className="mfg-checker-items-heading"');
    expect(source).toContain('checkerRows.length > 3 && <button');
    expect(source).toContain('aria-expanded={showAllCheckerItems}');
    expect(source).toContain('showAllCheckerItems ? "Show fewer"');
    expect(source).toContain('checkerRows.slice(0, showAllCheckerItems ? undefined : 3)');
    expect(source).toContain("Select View all to review the entire batch.");
  });

  it("reuses the existing verified quantity and actual weight editors for each row", () => {
    expect(source).toContain('className="mfg-checker-item"');
    expect(source).toContain('className="mfg-checker-edit-value"');
    expect(source).toContain('setCheckerEditKind("quantity")');
    expect(source).toContain('setCheckerEditKind("weight")');
    expect(source).toContain('setCheckerEdit(draftIndex)');
    expect(source).toContain('setCheckerQuantity(String(stage === "batch" ? row.quantityMultiplier ?? 1 : row.verifiedQuantity))');
    expect(source).toContain('setCheckerQuantity(String(row.actualWeightPerItem || ""))');
    expect(source).toContain('disabled={busy || handover.status === "CHECKED"}');
    expect(source).toContain('Correction reason');
    expect(source).toContain('input value={row.correctionReason}');
    expect(source).toContain('persist({ ...handover, drafts: handover.drafts.map(');
    expect(source).toContain('missingReason ? "Needs reason" : missingWeight ? "Needs weight"');
    expect(source).toContain('"No changes"');
  });

  it("maintains ERPNext draft and Checker verification safeguards, without fake submit", () => {
    expect(source).toContain("validateCheckerCorrections(handover.drafts)");
    expect(source).toContain("await updateCheckedQuantities(handover.batchId, handover.drafts, deviceName)");
    expect(source).toContain('setCheckerScanOrigin("checker"); setStage("checker-scan")');
    expect(source).toContain("const submitCheckerVerification = React.useCallback");
    expect(source).toContain("await confirmChecker(handover.batchId, raw, deviceName)");
    expect(source).toContain('if (!result.stockEntriesSubmitted)');
    expect(source).toContain("if (!canGenerateHandoverQr(handover))");
    expect(source).toContain("ERPNext Draft Stock Entries remain the source documents.");
    expect(source).not.toContain("Checker saved offline");
  });

  it("retains Save & Scan Checker QR while adding a safe Back to Batch action", () => {
    expect(source).toContain('className="mfg-checker-dock-actions"');
    expect(source).toContain('onClick={() => setStage("batch")}><ClipboardCheck size={16}/> Back to Batch');
    expect(source).toContain('onClick={() => void saveCheckerRows()}><QrCode size={16}/> Save & Scan Checker QR');
    expect(source).toContain('stage === "checker-scan" && handover?.status !== "CHECKED"');
    expect(source).toContain('onClick={() => setStage("checker")}');
    expect(source).toContain('stage === "handover-qr" && handoverQr');
    expect(source).toContain('onClick={() => void showHandoverQr()}');
  });

  it("redesigns the actual Checker entry stages without skipping verification", () => {
    expect(source).toContain('stage === "batch" || stage === "checker-handover-scan"');
    expect(source).toContain('const isCheckerStage = stage === "batch"');
    expect(source).toContain('isCheckerStage && stage !== "checker-handover-scan" && handover');
    expect(source).toContain('(stage === "checker" || stage === "batch") && <>');
    expect(source).toContain('stage === "checker-handover-scan" && <div className="mfg-scan-prompt"');
    expect(source).toContain('getCheckerReview(qr)');
    expect(source).toContain('setCheckerQr(qr); persist(next); setStage("checker")');
    expect(source).toContain('stage === "batch" ? row.quantityMultiplier ?? 1 : row.verifiedQuantity');
    expect(source).toContain('if (stage === "batch") { void saveBatchQuantity(); return; }');
    expect(source).toContain('onClick={() => void startBatchCheckerVerification()}');
    expect(source).toContain('Verify Checker QR');
    expect(source).toContain('await syncHandoverBatch()');
    expect(source).toContain('setCheckerScanOrigin("batch")');
    expect(source).toContain('stage === "checker" && handover?.status !== "CHECKED"');
    expect(source).not.toContain('stage === "batch" && handover && <><div className="mfg-kicker">Handover batch');
  });

  it("keeps physical QR scanning and other warehouse workflows intact", () => {
    expect(source).toContain('stage === "checker-scan"');
    expect(source).toContain('className="mfg-input mfg-scanner-capture" readOnly inputMode="none"');
    expect(source).toContain('onKeyDown={handleKey} onBlur={focusScanner}');
    expect(source).toContain('window.addEventListener("qcmc-scanner-data", handler)');
    expect(source).toContain('stage === "receive"');
    expect(source).toContain('stage === "picker-form" && <form');
    expect(source).toContain('stage === "allocation" && allocation');
    expect(css).toContain(".mfg-page.is-checker-redesign .mfg-checker-dock-actions");
    expect(css).toContain(".mfg-page.is-checker-redesign .mfg-checker-reason input");
    expect(css).toContain("@media (max-width: 360px)");
    expect(css).toContain("@media (max-height: 710px)");
    expect(css).toContain(".mfg-page.is-checker-redesign button:focus-visible");
  });
});
