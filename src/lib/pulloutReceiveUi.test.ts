import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../components/ManufacturingScanner.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/ManufacturingScanner.css", import.meta.url), "utf8");

describe("Pullout / Receive FG approved illustration UI", () => {
  it("scopes the blue-and-white redesign to Pullout receive / received stages", () => {
    expect(source).toContain('const isPulloutStage = stage === "receive" || stage === "received";');
    expect(source).toContain("is-pullout-redesign");
    expect(source).toContain('className="mfg-pullout-head"');
    expect(source).toContain('onClick={goBack} aria-label="Back to Inventory"');
    expect(source).toContain("<h1>Pullout / Receive FG</h1>");
    expect(source).toContain('className="mfg-head"');
    expect(source).toContain('workflowStep > 0 && !isPulloutStage');
    expect(css).toContain("QCMC Pullout / Receive FG illustration redesign");
    expect(css).toContain(".mfg-page.is-pullout-redesign .mfg-pullout-overview");
  });

  it("uses actual package mode and validated Job Card identifiers, not illustration samples", () => {
    expect(source).toContain('pulloutMode === "FULL" ? "Big Pack" : "Loose Pack"');
    expect(source).toContain("pendingDraft?.label.jobCardId || pulloutLastSavedRow?.jobCardId");
    expect(source).toContain("pulloutLastSavedRow?.targetWarehouse");
    expect(source).toContain('pulloutCurrentJobCard || "Scan Packing Label"');
    expect(source).toContain('pulloutCurrentWarehouse || "Assigned by ERPNext"');
    expect(source).not.toContain("JC-2026-00412");
    expect(source).not.toContain("FG-ITEM-00123");
  });

  it("accurately represents Packing Label → Quantity → Confirm → Draft flow", () => {
    expect(source).toContain('["Packing Label", "Quantity", "Confirm", "Draft"]');
    expect(source).toContain('const pulloutStepIndex = stage === "received" ? 4 : quantityConfirmed ? 3 : pendingDraft ? 2 : 1;');
    expect(source).toContain("Ready to Scan Packing Label");
    expect(source).toContain("Scan the finished goods packing-label QR using your scanner");
    expect(source).toContain('parsePackingLabelQr(raw)');
    expect(source).toContain('validateManufactureJobCard(label.jobCardId)');
    expect(source).toContain('setPendingDraft({ label })');
    expect(source).toContain('className="mfg-pullout-scan-ready"');
  });

  it("does not misrepresent locally retained references as offline-submitted ERP drafts", () => {
    expect(source).toContain('stage === "received" ? "ERP Draft saved"');
    expect(source).toContain('"ERP required"');
    expect(source).toContain("Draft Stock Entry saved in ERPNext");
    expect(source).toContain("Checker verification required before submission");
    expect(source).toContain('const activePulloutDraftRows = handover?.stockEntriesSubmitted ? []');
    expect(source).not.toContain('Saved on device');
    expect(source).toContain("verifyReceiveFinishedGoodsConnection()");
    expect(source).toContain("createManufactureReceiveDraft(");
  });

  it("derives draft summary from retained draft identifiers, items and compatible UOMs", () => {
    expect(source).toContain("activePulloutDraftRows.map((row) => row.stockEntryId)");
    expect(source).toContain("activePulloutDraftRows.map((row) => row.itemCode.trim().toLocaleUpperCase())");
    expect(source).toContain("activePulloutDraftRows.reduce((sum, row) => sum + (Number(row.recordedQuantity) || 0), 0)");
    expect(source).toContain('pulloutUoms.length === 1 && activePulloutDraftRows.every((row) => Boolean(row.uom.trim()))');
    expect(source).toContain("Mixed UOM");
    expect(source).toContain('className="mfg-pullout-draft-list"');
    expect(source).toContain('showPulloutDrafts ? "Show less"');
    expect(source).toContain("Review in Checker");
    expect(source).not.toContain("Save Draft Entry</button>");
    expect(source).not.toContain("View / Edit");
  });

  it("keeps the keypad, Pull Out Slip, actual weight and Create Draft safety checks", () => {
    expect(source).toContain('<QuantityKeypad value={receiveQuantity} onChange={setReceiveQuantity}/>');
    expect(source).toContain('pulloutMode === "FULL" ? "Big Pack Count" : "Loose Pack Quantity"');
    expect(source).toContain('setQuantityConfirmed(true)');
    expect(source).toContain('className="mfg-confirm mfg-pullout-confirm" onSubmit={createDraft}');
    expect(source).toContain('Pull Out Slip is required.');
    expect(source).toContain("Actual Weight per Item must be numeric and greater than zero.");
    expect(source).toContain("createPulloutRequestSignature(");
    expect(source).toContain("draftCreatingRef.current = true");
    expect(source).toContain("await createManufactureReceiveDraft(");
    expect(css).toMatch(/\.mfg-pullout-confirm \.mfg-confirm-actions[\s\S]*position:\s*sticky/);
  });

  it("retains hardware barcode scanning and real completed-draft actions", () => {
    expect(source).toContain('className="mfg-input mfg-scanner-capture" readOnly inputMode="none"');
    expect(source).toContain("onKeyDown={handleKey} onBlur={focusScanner}");
    expect(source).toContain('window.addEventListener("qcmc-scanner-data", handler)');
    expect(source).toContain('stage === "received" && <div className="mfg-dock-grid"');
    expect(source).toContain('onClick={resetReceive}');
    expect(source).toContain('onClick={() => setStage("batch")}');
    expect(source).toContain("Add Another");
    expect(source).toContain("Go to Checker");
  });

  it("does not redesign other roles and accommodates narrow Android handsets", () => {
    // The Checker review now uses its own scoped design; Pullout remains isolated.
    expect(source).toContain('const isCheckerStage = stage === "batch" || stage === "checker-handover-scan" ||');
    expect(source).toContain('isCheckerStage && stage !== "checker-handover-scan" && handover');
    expect(source).toContain('stage === "picker-form" && <form');
    expect(source).toContain('stage === "allocation" && allocation');
    expect(css).toContain("@media (max-height: 720px)");
    expect(css).toContain("@media (max-width: 360px)");
    expect(css).toContain(".mfg-page.is-pullout-redesign button:focus-visible");
    expect(css).toContain("overflow-y: auto;");
    expect(css).toContain(".mfg-page.is-pullout-redesign .mfg-dock-grid .mfg-secondary:last-child");
  });
});
