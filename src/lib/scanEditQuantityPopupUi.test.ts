import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../components/ScanPage.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../components/ScanPage.compact.css", import.meta.url), "utf8");
const start = source.indexOf('{editingScanTransaction && selectedItemDetails && (() => {');
const end = source.indexOf('      })()}', start);
const edit = source.slice(start, end);

describe("Edit Quantity & Inv Tag matches compact Quantity popup", () => {
  it("reuses the existing blue-white QTY popup, without scroll to Save Changes", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(edit).toContain('scan-confirm-dialog scan-edit-dialog scan-qty-dialog scan-qty-dialog-compact');
    expect(edit).toContain('id="scan-edit-dialog-title"');
    expect(edit).toContain('className="scan-confirm-actions scan-edit-actions"');
    expect(edit).toContain("Save Changes");
    expect(styles).toContain("Edit Quantity & Inv Tag — same calculator layout as Quantity popup");
    expect(styles).toContain(".bp-root .scan-confirm-dialog.scan-edit-dialog.scan-qty-dialog-compact");
    expect(styles).toContain("overflow:hidden !important");
    expect(styles).toContain(".scan-edit-dialog .scan-edit-actions");
  });

  it("has same Big/Loose Pack selection and QR conversion preview", () => {
    expect(edit).toContain('setEditPackageStatus("COMPLETE")');
    expect(edit).toContain('setEditPackageStatus("OPENED")');
    expect(edit).toContain('calculateEditedPhysicalCount(qrQuantity, bigPackCount, loosePackQuantity)');
    expect(edit).toContain('evaluateQuantityExpression(editingScanTransaction.bigPackCount, true)');
    expect(edit).toContain('evaluateQuantityExpression(editingScanTransaction.loosePackQuantity, true)');
    expect(edit).toContain('editBreakdown.bigPackCount.toLocaleString()');
    expect(edit).toContain('editBreakdown.bigPackUnits.toLocaleString()');
    expect(edit).toContain('editBreakdown.loosePackQuantity.toLocaleString()');
    expect(edit).toContain('editBreakdown?.total ?? Number.NaN');
    expect(edit).toContain('Older scan saved only total quantity.');
    expect(edit).toContain('New physical quantity');
    expect(edit).toContain("selectedItemDetails.uom");
  });

  it("shows a working independent 4x4 calculator instead of opening Android IME", () => {
    expect(edit).toContain('id="scan-edit-quantity"');
    expect(edit).toContain('inputMode="none"');
    expect(edit).toContain("readOnly");
    expect(edit).toContain('className="scan-qty-keypad"');
    expect(edit).toContain('"7","8","9","÷","4","5","6","×","1","2","3","-",".","0","backspace","+"');
    expect(edit).toContain('onClick={() => enterEditQuantityKey(key)}');
    expect(edit).toContain('onClick={() => enterEditQuantityKey("clear")}');
    expect(source).toContain("nextEditQuantityKey(current[field], key, editQuantityFresh)");
    expect(source).toContain('editPackageStatus === "COMPLETE" ? "bigPackCount" : "loosePackQuantity"');
    expect(source).toContain('setEditPackageStatus("OPENED"); setEditQuantityFresh(true);');
    expect(source).toContain('setEditPackageStatus("COMPLETE"); setEditQuantityFresh(true);');
    expect(source).toContain("setEditQuantityFresh(true)");
    expect(source).toContain("setEditQuantityFresh(false)");
    expect(source).toContain('onClick={() => enterQuantityKey(key)}');
  });

  it("allows alphanumeric Inventory Tag editing and reserves keyboard space", () => {
    expect(edit).toContain('id="scan-edit-invtag"');
    expect(edit).toContain('value={editingScanTransaction.inventoryTag}');
    expect(edit).toContain('autoCapitalize="characters"');
    expect(edit).toContain('onFocus={() => setEditTagHasFocus(true)}');
    expect(edit).toContain('onBlur={() => setEditTagHasFocus(false)}');
    expect(edit).toContain('editTagInputRef.current?.blur()');
    expect(edit).toContain('editTagHasFocus ? (');
    expect(styles).toContain(".scan-edit-dialog.is-editing-tag");
    expect(styles).toContain("@media (max-height:450px)");
  });

  it("shows Inventory Tag conflicts and save failures inside the edit popup", () => {
    expect(edit).toContain('setEditScanPopupNotice("Inv Tag cannot be blank.');
    expect(edit).toContain('setEditScanPopupNotice(`Inv Tag ${editedTag} belongs to item ${tagConflict.itemCode}');
    expect(edit).toContain('setEditScanPopupNotice("This transaction is already submitted');
    expect(edit).toContain('setEditScanPopupNotice(error instanceof Error ? error.message');
    expect(edit).toContain('className="scan-edit-notice" role="alert" aria-live="assertive"');
    expect(edit).toContain('onChange={(event) => { setEditScanPopupNotice("");');
    expect(styles).toContain('.scan-edit-backdrop .scan-edit-dialog > .scan-edit-notice');
  });

  it("keeps original edit validation and saves correction provenance locally", () => {
    expect(edit).toContain('submittedTransactionIds?.includes(tx.id)');
    expect(edit).toContain('savedTransaction.action === "SUBMITTED"');
    expect(edit).toContain("Inv Tag cannot be blank");
    expect(edit).toContain('findInventoryTagItemConflict(all, reconciliationCode, editedTag, selectedItemDetails.itemCode, selectedItemDetails.bin.locationId || "")');
    expect(edit).toContain("inventoryTagEditHistory:");
    expect(edit).toContain("saveLocalScanEntries(employee.id, updated)");
    expect(edit).toContain("bigPackCount: editBreakdown!.bigPackCount");
    expect(edit).toContain("loosePackQuantity: editBreakdown!.loosePackQuantity");
    expect(edit).toContain("editingScanTransaction.legacyUnsplit && !editingScanTransaction.quantityTouched");
    expect(edit).toContain("clearPendingPcountSubmission(employee.id, reconciliationCode)");
    expect(edit).toContain("delete activeInventoryTagsRef.current[activeInventoryTagKey(");
    expect(edit).toContain('disabled={isSubmitting || !Number.isFinite(preview) || preview < 0}');
  });
});
