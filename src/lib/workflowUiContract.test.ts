import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manufacturing = readFileSync(new URL("../components/ManufacturingScanner.tsx", import.meta.url), "utf8");
const scanPage = readFileSync(new URL("../components/ScanPage.tsx", import.meta.url), "utf8");
const manufacturingCss = readFileSync(new URL("../components/ManufacturingScanner.css", import.meta.url), "utf8");
const compactCss = readFileSync(new URL("../components/ScanPage.compact.css", import.meta.url), "utf8");
const authenticatedCss = readFileSync(new URL("../styles/authenticated-ui.css", import.meta.url), "utf8");
const blankPage = readFileSync(new URL("../components/BlankPage.tsx", import.meta.url), "utf8");
const statusPageUrl = new URL("../components/StatusPage.tsx", import.meta.url);
const statusPage = existsSync(statusPageUrl) ? readFileSync(statusPageUrl, "utf8") : "";

describe("workflow mode UI contract", () => {
  it("displays the latest locally used Inventory Tag inside the Inv Tag dialog", () => {
    expect(scanPage).toContain("const latestUsedInvTag = React.useMemo(");
    expect(scanPage).toContain('Last used Inv Tag: <strong>{latestUsedInvTag || "None recorded"}</strong>');
    expect(compactCss).toContain(".scan-invtag-last-used");
  });
  it("validates ERP-acknowledged recount baseline without changing counted corrections or queued submission IDs", () => {
    expect(scanPage).toContain("const submittedCount = effectiveEntry.submittedPhysicalCount ?? effectiveEntry.submittedQuantity;");
    expect(scanPage).toContain("const repairedSession = pcountSession?.activeGroupId?.startsWith(\"recount-\")");
    expect(scanPage).toContain("const incomplete = (repairedSession?.locations || []).filter(");
    expect(scanPage).toContain("const reconciled = completeCountedInactiveRecountLocations(");
    expect(scanPage).toContain("const recountBaseline = await getPcountItemBaseline(");
    expect(scanPage).toContain("Math.abs(erpNow - submittedCount) > 0.000001");
    expect(scanPage).toContain("expectedErpQuantity = erpNow;");
    expect(scanPage).toContain("repairedEntries.push(effectiveEntry);");
    expect(scanPage).toContain("if (reuse) {\n        stagedEntries = savedPayload!.entries!;");
  });

  it("hides removed and zero-placeholder locations from Scanned Items and prevents their submission", () => {
    expect(scanPage).toContain("const visibleCountEntries = React.useMemo(() => {");
    expect(scanPage).toContain("selectedIds.has(String(entry.bin.locationId || \"\").trim().toUpperCase())");
    expect(scanPage).toContain("Math.abs(entry.quantity) > 0.000001");
    expect(scanPage).toContain("for (const entry of visibleCountEntries)");
    expect(scanPage).toContain('<span className="scan-list-count">{visibleCountEntries.length}</span>');
    expect(scanPage).toContain("{visibleCountEntries.length > 0 ? (");
    expect(scanPage).toContain("}, [visibleCountEntries]);");
    expect(scanPage).toContain("const pendingEntryCount = visibleCountEntries.filter(isPendingLocalScanEntry).length");
    expect(scanPage).toContain("const pendingQuantityTotal = visibleCountEntries.reduce(");
    expect(scanPage).toContain("const eligibleForSubmission = (entry: LocalScanEntry) =>");
    expect(scanPage).toContain("sessionLocationIds.has(String(entry.bin.locationId || \"\").trim().toUpperCase())");
    expect(scanPage).toContain("const pendingEntries = entries.filter((entry) => eligibleForSubmission(entry) && isPendingLocalScanEntry(entry))");
    expect(scanPage).toContain("clearPendingPcountSubmission(employee.id, reconciliationCode)");
  });


  it("uses Windows Calculator-style readouts in every scanner quantity keypad", () => {
    const readout = readFileSync(new URL("../components/CalculatorReadout.tsx", import.meta.url), "utf8");
    const style = readFileSync(new URL("../components/CalculatorReadout.css", import.meta.url), "utf8");
    const manufacturingLegacy = readFileSync(new URL("../components/ManufacturingScanner1.tsx", import.meta.url), "utf8");
    const transfer = readFileSync(new URL("../components/LocationTransferScanner.tsx", import.meta.url), "utf8");
    expect(readout).toContain("getCalculatorReadout");
    expect(readout).toContain("qcmc-calculator-history");
    expect(readout).toContain("qcmc-calculator-current");
    expect(style).toContain("text-align: right");
    expect(scanPage).toContain("<CalculatorReadout value={scanValue}/>");
    expect(scanPage).toContain('<CalculatorReadout value={editPackageStatus === "COMPLETE" ? editingScanTransaction.bigPackCount : editingScanTransaction.loosePackQuantity}/>');
    expect(manufacturing).toContain("<CalculatorReadout value={receiveQuantity}/>");
    expect(manufacturing).toContain("<CalculatorReadout value={checkerQuantity}/>");
    expect(manufacturing).toContain("<CalculatorReadout value={actionQuantity}/>");
    expect(manufacturingLegacy).toContain("<CalculatorReadout value={checkerQuantity}/>");
    expect(manufacturingLegacy).toContain("<CalculatorReadout value={actionQuantity}/>");
    expect(transfer).toContain("<CalculatorReadout value={draft} unit={uom}/>");
  });


  it("uses the shared Windows-style readout while preserving the no-IME quantity inputs", () => {
    expect(scanPage).toContain("const moveCalculatorCaretToEnd = (field: HTMLInputElement | null) => {");
    expect(scanPage).toContain("field.setSelectionRange(field.value.length, field.value.length)");
    expect(scanPage).toContain("field.scrollLeft = field.scrollWidth");
    expect(scanPage).toContain("ref={editQuantityInputRef}");
    expect(scanPage).toContain('onClick={() => moveCalculatorCaretToEnd(editQuantityInputRef.current)}');
    expect(scanPage).toContain('onClick={() => moveCalculatorCaretToEnd(inputRef.current)}');
    expect(scanPage).toContain('inputMode="none" readOnly aria-label="Quantity: use the on-screen number keypad"');
    const marker = "/* Calculator-style entry field:";
    const css = compactCss.slice(compactCss.indexOf(marker));
    expect(css).toContain(".scan-qty-main > .scan-qty-input");
    expect(css).toContain("#scan-edit-quantity");
    expect(scanPage).toContain("<CalculatorReadout value={scanValue}/>");
    expect(scanPage).toContain('<CalculatorReadout value={editPackageStatus === "COMPLETE" ? editingScanTransaction.bigPackCount : editingScanTransaction.loosePackQuantity}/>');
  });


  it("stacks home notifications above the Inventory page instead of splitting the screen into columns", () => {
    expect(blankPage).toContain('<main className="bp-main">');
    expect(blankPage).toContain('<AppToast toast={toast} onClose={dismissToast} />');
    expect(blankPage).toMatch(/\.bp-main\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
    expect(blankPage).toContain(".bp-main > .app-status-label {");
    expect(blankPage).toContain(".bp-main > .bp-blank,");
    expect(blankPage).toContain(".bp-main > .bp-surface {");
  });


  it("fills the edit quantity dialog with a full-height SmartPDA keypad without scrolling", () => {
    const marker = "/* Edit Quantity SmartPDA viewport-filling keypad.";
    const start = compactCss.indexOf(marker);
    expect(start).toBeGreaterThan(0);
    const editLayout = compactCss.slice(start);
    expect(editLayout).toContain(".scan-edit-backdrop .scan-confirm-dialog.scan-edit-dialog.scan-qty-dialog-compact");
    expect(editLayout).toContain("height: 100dvh !important");
    expect(editLayout).toContain("overflow: hidden !important");
    expect(editLayout).toContain("> .scan-edit-calculator");
    expect(editLayout).toContain("flex: 1 1 0 !important");
    expect(editLayout).toContain("grid-template-rows: repeat(4, minmax(0,1fr))");
    expect(editLayout).toContain("height: 100% !important");
    expect(editLayout).toContain("position: static !important");
    expect(editLayout).toContain("> .scan-edit-actions");
  });


  it("displays Big Packs, location count and total across all active locations in the calculator", () => {
    expect(scanPage).toContain("<span>Calculate Big Packs</span>");
    expect(scanPage).toContain("<span>Number of Location</span>");
    expect(scanPage).toContain('effectiveLocationMode === "multi" ? Math.max(1, activeGroupLocations.length) : 1');
    expect(scanPage).toContain("<span>Total Quantity</span>");
    expect(scanPage).toContain('(recountLoadedTotal !== null && !recountCalculatorEdited ? recountLoadedTotal : combinedQuantityPreview) * (effectiveLocationMode === "multi" ? Math.max(1, activeGroupLocations.length) : 1)');
    expect(scanPage).not.toContain("will be recorded at each of");
    expect(scanPage).not.toContain("Overall recorded quantity:");
  });


  it("discards wrong-location pending item scans and staged ERP payloads while keeping submitted audit", () => {
    expect(scanPage).toContain("discardPendingPcountLocationCounts(all, reconciliationCode, locationId)");
    expect(scanPage).toContain("saveLocalScanEntries(employee.id, cleaned.entries)");
    expect(scanPage).toContain("clearPendingPcountSubmission(employee.id, reconciliationCode)");
    expect(scanPage).toContain("submitAttemptRef.current = null");
    expect(scanPage).toContain("setHasQueuedSubmission(false)");
    expect(scanPage).toContain("const next = removePcountLocationFromSession(current, locationId)");
    expect(scanPage).toContain("Previously ERP-submitted records will remain in the audit history.");
    expect(scanPage).toContain("they will not be sent to ERP.");
    expect(scanPage).not.toContain("ERP-submitted counts and pending corrections are retained; review the pending corrections before submitting.");
  });


  it("fits the main Physical Count calculator within the SmartPDA viewport without scrolling or obscuring totals", () => {
    expect(scanPage).toContain("scan-qty-dialog-compact scan-qty-main");
    const cssStart = compactCss.lastIndexOf("/* Fit the entire Physical Count calculator into one SmartPDA viewport.");
    expect(cssStart).toBeGreaterThan(0);
    const fittedCss = compactCss.slice(cssStart);
    expect(fittedCss).toContain(".scan-quantity-backdrop .scan-confirm-dialog.scan-qty-dialog.scan-qty-dialog-compact.scan-qty-main");
    expect(fittedCss).toContain("overflow: hidden !important");
    expect(fittedCss).toContain("grid-template-rows: repeat(4, minmax(0, 1fr))");
    expect(fittedCss).toContain("flex: 1 1 0 !important");
    expect(fittedCss).toContain("> .scan-qty-total");
    expect(fittedCss).toContain("> .scan-confirm-actions");
    expect(fittedCss).toContain("position: static !important");
    expect(fittedCss).toContain("height: 100dvh !important");
  });


  it("renders warehouse mismatch warning at the previous blue scanner feedback location", () => {
    expect(scanPage).toContain('if (errorMessage.startsWith("Wrong warehouse.")) {');
    expect(scanPage).toContain('showToast("warning", errorMessage)');
    expect(scanPage).toContain('{toast ? (\n              <AppToast toast={toast} onClose={() => setToast(null)} />');
    expect(scanPage).toContain('<div className="scan-feedback" role="status">{message}</div>');
    expect(scanPage).not.toContain('        <AppToast toast={toast} onClose={() => setToast(null)} />\n        {locationToRemove && (');
  });

  it("defaults new manual quantity entries to zero but restores automatic recount calculations", () => {
    expect(scanPage).toContain('setScanValue(recounting\\n      ? String(oldLooseUnits > 0 ? oldLooseUnits : oldBigPacks)\\n      : "0");'.replaceAll("\\n", "\n"));
    expect(scanPage).toContain('setScanValue(retainedBigPackExpression || "0")');
    expect(scanPage).toContain('if (qtyDefaultActive || current === "0") return normalizedKey');
    expect(scanPage).toContain('setScanValue(value === "0" ? "" : value.replace(/^0/, ""))');
    expect(scanPage).toContain("recountCalculatorRestoreRef.current = {");
    expect(scanPage).toContain("setRecountLoadedTotal(recounting ? previousRecountQuantity : null)");
    expect(scanPage).toContain('setScanValue(restored.count)');
  });


  it("prevents full-screen quantity calculator tabs, label and totals from overlapping on SmartPDA", () => {
    expect(compactCss).toContain("SmartPDA full-screen calculator layout repair");
    expect(compactCss).toContain("> :not(.scan-confirm-actions)");
    expect(compactCss).toContain("flex-shrink: 0 !important");
    expect(compactCss).toContain("> .scan-qty-package-toggle");
    expect(compactCss).toContain("> .scan-qty-label");
    expect(compactCss).toContain("> .scan-qty-total");
    expect(compactCss).toContain("min-height: 40px !important");
    expect(compactCss).toContain("overflow-y: auto !important");
    expect(compactCss).toContain("> .scan-confirm-actions");
  });


  it("long-presses location badges inside Location Progress to request removal", () => {
    expect(scanPage).toContain("scan-progress-pill scan-progress-pill-removable");
    expect(scanPage).toContain('onPointerUp={cancelLocationLongPress}');
    expect(scanPage).toContain('onPointerCancel={cancelLocationLongPress}');
    expect(scanPage).toContain("requestRemoveMultiLocation(location.bin.locationId");
    expect(scanPage).toContain('role="alertdialog"');
    expect(scanPage).toContain('onClick={() => setLocationToRemove(null)}>Cancel</button>');
    expect(scanPage).toContain('onClick={() => removeMultiLocation(locationToRemove.id)}>Remove</button>');
    expect(scanPage).toContain('location.status === "in_progress"');
    expect(scanPage).toContain("const remainingActive = activeGroupLocations.filter");
    expect(scanPage).toContain("discardPendingPcountLocationCounts(all, reconciliationCode, locationId)");
    expect(scanPage).not.toContain("Only an active location can be removed. Submitted and completed locations remain in history.");
    expect(scanPage).toContain('setStep("bin")');
    expect(compactCss).toContain(".scan-progress-pills .scan-progress-pill-removable");
  });


  it("opens Cancel / Remove confirmation after long-pressing a selected Physical Count location", () => {
    expect(scanPage).toContain("const startLocationLongPress = (locationId: string, label: string)");
    expect(scanPage).toContain("}, 550);");
    expect(scanPage).toContain("className=\"scan-location-card scan-location-longpress\"");
    expect(scanPage).toContain("onPointerDown={(event) => {");
    expect(scanPage).toContain("onPointerCancel={cancelLocationLongPress}");
    expect(scanPage).toContain("requestRemoveMultiLocation(location.bin.locationId");
    expect(scanPage).toContain('role="alertdialog"');
    expect(scanPage).toContain('id="scan-remove-location-title">Remove Location?</div>');
    expect(scanPage).toContain('onClick={() => setLocationToRemove(null)}>Cancel</button>');
    expect(scanPage).toContain('onClick={() => removeMultiLocation(locationToRemove.id)}>Remove</button>');
    expect(scanPage).toContain("const locationEntries = all.filter(matchesLocation)");
    expect(scanPage).toContain("discardPendingPcountLocationCounts(all, reconciliationCode, locationId)");
    expect(scanPage).toContain("saveLocalScanEntries(employee.id, cleaned.entries)");
    expect(scanPage).toContain("clearPendingPcountSubmission(employee.id, reconciliationCode)");
    expect(scanPage).toContain("Boolean(pendingExistingLocation) || Boolean(locationToRemove)");
    expect(compactCss).toContain(".scan-location-longpress");
  });


  it("releases Android soft-keyboard focus when quantity or edit calculators open", () => {
    expect(scanPage).toContain('const editCalculatorOpen = Boolean(editingScanTransaction)');
    expect(scanPage).toContain('if (!(step === "qty" && pendingItem) && !editCalculatorOpen) return;');
    expect(scanPage).toContain('active instanceof HTMLElement && active !== document.body');
    expect(scanPage).toContain('focused instanceof HTMLInputElement');
    expect(scanPage).toContain('focused.blur()');
    expect(scanPage).toContain('inputMode="none" readOnly aria-label="Quantity: use the on-screen number keypad"');
    expect(scanPage).toContain('id="scan-edit-quantity"');
  });

  it("renders notifications as inline status labels rather than floating toast popups", () => {
    const status = readFileSync(new URL("../components/AppToast.tsx", import.meta.url), "utf8");
    const transfer = readFileSync(new URL("../components/LocationTransferScanner.tsx", import.meta.url), "utf8");
    const jobCard = readFileSync(new URL("../components/JobCardTimeScanner.tsx", import.meta.url), "utf8");
    expect(status).toContain("position: static");
    expect(status).toContain("app-status-label-message");
    expect(status).not.toContain("position: fixed");
    expect(status).toContain('toast.kind === "error"');
    expect(scanPage).toMatch(/<section ref=\{scanSessionTopRef\}[\s\S]*?<AppToast toast=\{toast\}/);
    expect(manufacturing).toMatch(/<main className="mfg-body"[\s\S]*?<AppToast toast=\{toast\}/);
    expect(transfer).toMatch(/<div className="lt-body">\s*<AppToast toast=\{toast\}/);
    expect(jobCard).toMatch(/<main className="jct-body"[\s\S]*?<AppToast toast=\{toast\}/);
  });

  it("shows item code and ERP item description in the Physical Count and Edit calculators", () => {
    expect(scanPage).toContain('<div className="scan-qty-item-code">{pendingItem.itemCode}</div>');
    expect(scanPage).toContain('className="scan-qty-item-name"');
    expect(scanPage).toContain("pendingItem.itemName || itemNameCacheRef.current.get");
    expect(scanPage).toContain('className="scan-edit-item-name"');
    expect(scanPage).toContain('selectedItemDetails.itemName || itemNameCacheRef.current.get');
    expect(compactCss).toContain(".scan-qty-item-name, .scan-edit-item-name");
  });

  it("shows item identity above manufacturing and transfer keypads", () => {
    const transfer = readFileSync(new URL("../components/LocationTransferScanner.tsx", import.meta.url), "utf8");
    expect(manufacturing).toContain('className="mfg-qty-item-description"');
    expect(manufacturing).toContain("pendingDraftItemName");
    expect(manufacturing).toContain("handover.drafts[checkerEdit]?.itemName");
    expect(transfer).toContain('className="lt-qty-item-identity"');
    expect(transfer).toContain("itemCode={item.itemCode}");
    expect(transfer).toContain('itemName={item.itemName || ""}');
  });

  it("keeps manufacturing, receiving and transfer quantity keypads full-screen on SmartPDA", () => {
    const receivingCss = readFileSync(new URL("../components/ManufacturingScanner1.css", import.meta.url), "utf8");
    const transferCss = readFileSync(new URL("../components/LocationTransferScanner.css", import.meta.url), "utf8");
    for (const styles of [manufacturingCss, receivingCss]) {
      expect(styles).toContain("Full-screen");
      expect(styles).toContain(".mfg-qty-bg .mfg-qty-modal");
      expect(styles).toContain("height:100dvh");
      expect(styles).toContain(".mfg-qty-bg .mfg-qty-key");
      expect(styles).toContain("position:sticky");
    }
    expect(transferCss).toContain(".lt-qty-modal .lt-qty-modal-card");
    expect(transferCss).toContain("height:100dvh");
    expect(transferCss).toContain(".lt-qty-modal .lt-keypad button");
    expect(transferCss).toContain("position:sticky");
  });

  it("uses a full-screen quantity workspace on SmartPDA without changing calculator logic", () => {
    expect(scanPage).toContain('className="scan-confirm-backdrop scan-quantity-backdrop"');
    expect(compactCss).toContain(".scan-confirm-backdrop.scan-quantity-backdrop");
    expect(compactCss).toContain("height: 100vh !important");
    expect(compactCss).toContain("height: 100dvh !important");
    expect(compactCss).toContain("grid-template-columns: repeat(4, minmax(0,1fr))");
    expect(compactCss).toContain(".scan-edit-dialog .scan-edit-actions");
  });

  it("reloads the latest used Inventory Tag for new item scans without bypassing confirmation", () => {
    expect(scanPage).toContain("getLatestUsedInventoryTag(loadLocalScanEntries(employee.id), reconciliationCode)");
    expect(scanPage).toContain('setStep(reusableTag ? "qty" : "invtag")');
    expect(scanPage).toContain('setStep("invtag")');
  });

  it("renders Physical Count progress without depending on Manufacturing Scanner CSS", () => {
    expect(scanPage).toContain('className="mfg-loading-overlay scan-submit-loading-overlay"');
    expect(scanPage).toContain("scan-submit-loading-card");
    expect(compactCss).toContain(".scan-submit-loading-overlay {");
    expect(compactCss).toContain("z-index: 9999");
    expect(compactCss).toContain("@keyframes scan-submit-spin");
  });

  it("yields a paint opportunity before preparing a large Physical Count upload", () => {
    expect(scanPage).toMatch(/setIsPreparingSubmission\(true\);[\s\S]*?await new Promise<void>\(\(resolve\) => \{\s*window\.requestAnimationFrame\(\(\) => window\.setTimeout\(resolve, 0\)\)/);
  });

  it("shows preparation progress before the ERP upload and blocks duplicate preparation taps", () => {
    expect(scanPage).toContain("const [isPreparingSubmission, setIsPreparingSubmission]");
    expect(scanPage).toContain("isSubmitting || submitPreparationRef.current");
    expect(scanPage).toContain("setIsPreparingSubmission(true)");
    expect(scanPage).toContain("setIsPreparingSubmission(false)");
    expect(scanPage).toContain("(loadingOperation || isPreparingSubmission || isSubmitting)");
    expect(scanPage).toContain("Checking saved scans and ERPNext warehouse...");
  });

  it("sizes Physical Count review for short Android viewports and safe areas", () => {
    expect(scanPage).toContain('className="scan-confirm-backdrop scan-review-backdrop"');
    expect(scanPage).toContain("height:min(640px, calc(100vh - 24px))");
    expect(scanPage).toContain("env(safe-area-inset-bottom, 0px)");
    expect(scanPage).toContain("min-height:0;");
  });

  it("keeps the Physical Count review submit buttons visible while its location list scrolls", () => {
    expect(scanPage).toContain('className="scan-confirm-dialog scan-review-dialog"');
    expect(scanPage).toMatch(/\.bp-root \.scan-confirm-dialog\.scan-review-dialog\s*\{[^}]*overflow-y:\s*auto/);
    expect(scanPage).toContain("max-height:30vh;");
    expect(scanPage).toContain("position:sticky;");
    expect(scanPage).toMatch(/\.scan-review-dialog \.scan-review-list\s*\{[^}]*overflow-y:\s*auto/);
    expect(scanPage).toMatch(/\.scan-review-dialog \.scan-confirm-actions\s*\{[^}]*flex-shrink:\s*0/);
  });

  it("does not set submitting before the Physical Count submit handler guard runs", () => {
    const confirmation = scanPage.slice(scanPage.indexOf("{showSubmitConfirm && ("), scanPage.indexOf("{stockChangeReview && ("));
    expect(confirmation).toContain("void handleSubmitToErp();");
    expect(confirmation).not.toContain("setIsSubmitting(true)");
    expect(confirmation).not.toContain("requestAnimationFrame");
  });

  it("uses the ERP reconciliation warehouse when preparing new Physical Count uploads without rewriting queued requests", () => {
    expect(scanPage).toContain("await getReconciliationContext(reconciliationCode)");
    expect(scanPage).toContain("const warehouse = verifiedWarehouse;");
    expect(scanPage).toContain("stagedEntries = savedPayload!.entries!;");
    expect(scanPage).toContain("Queued submission warehouse differs from ERPNext");
    expect(scanPage).toContain("saved Storage Location warehouse differs from ERPNext");
  });
  it("remembers the confirmed active tag after saving a one-location group transaction", () => {
    expect(scanPage).toContain('groupLocations.length === 1 && !recounting && effectiveAction === "ADD"');
    expect(scanPage).toContain('activeInventoryTagsRef.current[activeInventoryTagKey(reconciliationCode, groupLocations[0].bin.locationId || "", pendingItem.itemCode, pendingItem.lotNo)] = inventoryTag.trim()');
  });
  it("shows the active tag during automatic scanning without reintroducing the removed New Inv Tag button", () => {
    expect(scanPage).toContain('aria-label="Active Inventory Tag"');
    expect(scanPage).not.toContain('New Inv Tag (next scan)');
    expect(scanPage).toContain('quantityMode === "automatic" && isScanSessionActive && step === "item"');
  });

  it("prompts for Inv Tag when no valid active tag can be reused without restoring the removed button", () => {
    expect(scanPage).not.toContain('setNewInventoryTagForItem(`${currentBin.locationId || ""}|${activeTagItemCode.trim().toLocaleUpperCase()}`)');
    expect(scanPage).toContain('validateActiveInventoryTag(');
    expect(scanPage).toContain('setStep(reusableTag ? "qty" : "invtag")');
    expect(scanPage).toContain('setNewInventoryTagForItem(null)');
  });

  it("uses the global Mode selection without duplicate package buttons", () => {
    expect(manufacturing).not.toContain('<div className="mfg-package-mode"');
    expect(scanPage).not.toContain('<div className="scan-package-status"');
  });

  it("uses the global Mode selection without a Physical Count automatic toggle", () => {
    expect(scanPage).not.toContain('<span className="scan-quantity-option-copy">');
    expect(scanPage).not.toContain("Automatically use the quantity printed in the QR");
  });

  it("does not reactivate a completed location when resuming after Next Location", () => {
    expect(scanPage).toContain('const resumeBin = restoredState?.currentBin || null;');
    expect(scanPage).not.toContain('pendingResumeEntry?.bin');
    expect(scanPage).toContain('setIsScanSessionActive(isPhysicalCountResume ? true');
    expect(scanPage).toContain('setStep(isPhysicalCountResume ? (resumeToScanItems ? "item" : "bin")');
  });

  it("uses automatic location detection without Single/Multi selector buttons", () => {
    expect(scanPage).not.toContain('aria-label="Physical Count location mode"');
    expect(scanPage).toContain('getBidirectionalStorageLocationRange(');
    expect(scanPage).toContain('activeGroupLocations.length > 0');
    expect(blankPage).toContain('locationMode="multi"');
  });

  it("returns a completed allocation to the Checker scan view", () => {
    expect(manufacturing).toContain('setStage("checker-handover-scan")');
    expect(manufacturing).toContain("Warehouse Allocation completed. Scan the next Handover QR for Checker review.");
  });

  it("stores a compact successful Warehouse Allocation transaction", () => {
    expect(manufacturing).toContain("createWarehouseAllocationTransaction");
    expect(manufacturing).toMatch(/saveSuccessfulTransaction\(createWarehouseAllocationTransaction\(/);
  });

  it("keeps Pullout confirmation actions visible above the keyboard", () => {
    expect(manufacturingCss).toMatch(/\.mfg-pullout-confirm \.mfg-confirm-actions[\s\S]*position:\s*sticky/);
    expect(authenticatedCss).toMatch(/animation:\s*qcmc-page-enter\s+180ms[^;]*backwards/);
  });

  it("passes live Mode selections into an already-open scan workflow", () => {
    expect(scanPage).toContain("quantityMode: ScannerQuantityMode");
    expect(scanPage).toContain("packageMode: ScannerPackageMode");
    expect(scanPage).toContain("React.useLayoutEffect(() => {");
    expect(scanPage).toContain('const quantityPromptEnabled = quantityMode === "manual"');
    expect(blankPage).toContain("resolveScannerModes(mode, scannerPackageMode)");
    expect(blankPage).toContain("quantityMode={scannerQuantityMode}");
    expect(blankPage).toContain("packageMode={scannerPackageMode}");
  });

  it("keeps the bottom Mode menu limited to Automatic and Manual while preserving workflow preferences", () => {
    const menu = blankPage.slice(blankPage.indexOf('className="inventory-scan-actions"'), blankPage.indexOf('aria-expanded={scannerQuickMenuOpen}', blankPage.indexOf('className="inventory-scan-actions"')));
    expect(menu).toContain("<span>Automatic</span>");
    expect(menu).toContain("<span>Manual</span>");
    expect(menu).not.toContain("<span>Big Pack</span>");
    expect(menu).not.toContain("<span>Loose Pack</span>");
    expect(menu).not.toContain("<span>Single</span>");
    expect(menu).not.toContain("<span>Multi</span>");
    expect(blankPage).toContain("packageMode={scannerPackageMode}");
    // Location grouping is resolved inside ScanPage; the hidden Single/Multi selector is not used.
    expect(blankPage).toContain('locationMode="multi"');
  });

  it("removes the old cream Pullout dock treatment", () => {
    expect(authenticatedCss).toMatch(/\.mfg-dock\s*\{[\s\S]*?background:\s*var\(--qcmc-surface\)/);
  });

  it("uses the current white-and-blue Scan Items treatment", () => {
    expect(authenticatedCss).toContain(".scan-page.is-scanning .scan-focus-header");
    expect(authenticatedCss).toContain(".scan-page.is-scanning .scan-totals-strip");
  });

  it("keeps the item audit dialog full-screen with only its history scrolling", () => {
    expect(authenticatedCss).toMatch(/\.bp-root \.scan-detail-dialog\s*\{[\s\S]*?max-width:\s*none[\s\S]*?max-height:\s*100dvh[\s\S]*?overflow:\s*hidden/);
    expect(authenticatedCss).toMatch(/\.bp-root \.scan-detail-history\s*\{[\s\S]*?overflow-y:\s*auto/);
  });

  it("keeps audit timestamps on one line beside a compact action chip", () => {
    expect(scanPage).toMatch(/\.scan-detail-transaction\s*\{[\s\S]*?grid-template-columns:\s*max-content max-content/);
    expect(scanPage).toMatch(/\.scan-detail-transaction\s*>\s*span:first-child\s*\{[\s\S]*?white-space:\s*nowrap/);
    expect(scanPage).toMatch(/\.scan-detail-action\s*\{[\s\S]*?width:\s*max-content[\s\S]*?border-radius:\s*5px[\s\S]*?line-height:\s*1/);
  });

  it("shows the complete reconciliation reference on one dedicated line", () => {
    expect(scanPage).toMatch(/\.scan-focus-header\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
    expect(scanPage).toMatch(/\.scan-focus-copy\s*\{[\s\S]*?display:\s*contents/);
    expect(scanPage).toMatch(/\.scan-focus-reference\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1[\s\S]*?max-width:\s*none[\s\S]*?text-overflow:\s*clip[\s\S]*?white-space:\s*nowrap/);
  });

  it("shows scanned items first and hides counted-location details in Physical Count", () => {
    const historyStart = scanPage.indexOf('ref={scanListRef} role={mode === "pcount" ? "dialog" : undefined}');
    const itemsStart = scanPage.indexOf("groupedScanItems.map", historyStart);
    const locationsStart = scanPage.indexOf('{mode !== "pcount" && countedLocations.length > 0 && (', historyStart);
    const locationDetailsStart = scanPage.indexOf('{mode !== "pcount" && showCountedLocations && countedLocations.length > 0 && (', historyStart);
    expect(historyStart).toBeGreaterThan(-1);
    expect(itemsStart).toBeGreaterThan(historyStart);
    expect(locationsStart).toBeGreaterThan(itemsStart);
    expect(locationDetailsStart).toBeGreaterThan(locationsStart);
  });

  it("keeps a readable scanned-details viewport on short screens", () => {
    const workspaceStyles = scanPage.slice(scanPage.indexOf("/* Fixed viewport scan workspace */"));
    const pageLayout = workspaceStyles.match(/\.scan-page\.is-scanning\s*\{([^}]*)\}/)?.[1] || "";
    const historyLayout = workspaceStyles.match(/\.scan-page\.is-scanning \.scan-history\s*\{([^}]*)\}/)?.[1] || "";
    expect(pageLayout).toMatch(/overflow-y:\s*auto/);
    expect(historyLayout).toMatch(/min-height:\s*clamp\(180px,\s*32dvh,\s*280px\)/);
    expect(historyLayout).toMatch(/flex:\s*1 0/);
  });

  it("does not reserve duplicate space below the sticky submit dock", () => {
    const workspaceStyles = scanPage.slice(scanPage.indexOf("/* Fixed viewport scan workspace */"));
    const actionDockLayout = workspaceStyles.match(/\.scan-page\.is-scanning\.has-action-dock\s*\{([^}]*)\}/)?.[1] || "";
    expect(actionDockLayout).toMatch(/padding-bottom:\s*0/);
    expect(actionDockLayout).not.toContain("66px");
  });

  it("centers the review submit icon together with its label", () => {
    expect(scanPage).toContain('className="scan-confirm-button scan-qty-button-primary scan-review-submit"');
    expect(scanPage).toMatch(/\.scan-review-submit\s*\{[\s\S]*?display:\s*inline-flex[\s\S]*?align-items:\s*center[\s\S]*?justify-content:\s*center[\s\S]*?gap:\s*6px/);
  });

  it("does not trap fixed audit overlays below the mobile navigation", () => {
    expect(authenticatedCss).toMatch(/\.bp-root \.bp-main\s*\{[\s\S]*?z-index:\s*auto/);
    expect(authenticatedCss).not.toContain(".bp-main:has(.scan-detail-backdrop)");
  });

  it("routes Issue Stock to the reusable Coming Soon page", () => {
    expect(statusPage).toContain('type StatusPageVariant = "coming-soon" | "maintenance"');
    expect(blankPage).toContain('setCurrentView("issue_stock_coming_soon")');
    expect(blankPage).toMatch(/<StatusPage\s+variant="coming-soon"/);
    expect(blankPage).toMatch(/setCurrentView\("issue_stock_coming_soon"\)[\s\S]*Issue Stock/);
  });

  it("routes the bottom Delivery navigation to the reusable Coming Soon page", () => {
    expect(blankPage).toContain('setCurrentView("delivery_coming_soon")');
    expect(blankPage).toMatch(/currentView === "delivery_coming_soon"[\s\S]*<StatusPage\s+variant="coming-soon"[\s\S]*title="Delivery"/);
    expect(blankPage).toMatch(/currentView === "delivery_coming_soon" \? "is-active"/);
  });

  it("uses the Job Card target warehouse automatically on the Picker form", () => {
    expect(manufacturing).toContain("getPickerTargetWarehouse(context.items, context.warehouses)");
    expect(manufacturing).toContain('className="mfg-picker-warehouse-readonly"');
    expect(manufacturing).not.toContain('aria-label="Warehouse"');
  });

  it("confirms before reopening a Physical Count location with existing items", () => {
    expect(scanPage).toContain("hasExistingLocationCount");
    expect(scanPage).toContain("pendingExistingLocation");
    expect(scanPage).toContain("Existing count found");
    expect(scanPage).toContain("Location Already Counted");
    expect(scanPage).toContain("Recount Location");
    expect(scanPage).toMatch(/setPendingExistingLocation\(\{ bin, requiredWarehouse \}\);[\s\S]*refocusPhysicalCountScanner\(\);/);
    expect(scanPage).toContain("reopenLocation(pending.bin.locationId || \"\", pending.bin);");
  });

  it("keeps scanner focus after a Physical Count location validation error", () => {
    expect(scanPage).toMatch(/Wrong warehouse\. This location belongs to/);
    expect(scanPage).toContain('const errorMessage = error instanceof Error ? error.message : "Unable to validate this Storage Location."');
    expect(scanPage).toContain('showToast("warning", errorMessage)');
    expect(scanPage).toContain("refocusPhysicalCountScanner();");
  });

  it("blocks the Physical Count screen with the ERP loading overlay while submitting", () => {
    expect(scanPage).toMatch(/\(loadingOperation\s*\|\|\s*isPreparingSubmission\s*\|\|\s*isSubmitting\)\s*&&\s*\(\s*<div className="mfg-loading-overlay scan-submit-loading-overlay"/);
    expect(scanPage).toContain("Submitting Physical Count");
    expect(scanPage).toContain("Resubmitting Physical Count");
    expect(scanPage).toContain("Please wait for ERPNext.");
  });

  it("supports selecting and reviewing a Physical Count location group", () => {
    expect(scanPage).toContain("Multi Location");
    expect(scanPage).toContain("locations selected");
    expect(scanPage).toContain("Long press to remove location");
    expect(scanPage).toContain("Start Items (");
    expect(scanPage).toContain("<span>Number of Location</span>");
    expect(scanPage).toContain("<span>Total Quantity</span>");
    expect(scanPage).toContain("completeActiveLocationGroup");
    expect(scanPage).toContain("nextLocationQr");
  });

  it("automatically changes the active Physical Count location when a different location QR is scanned", () => {
    expect(scanPage).toContain('const nextLocationQr = mode === "pcount" && step === "item" ? parseStorageLocationQr(code) : null;');
    expect(scanPage).toContain("sameActiveLocation");
    expect(scanPage).not.toContain("Finish or review this group before switching");
    expect(scanPage).toContain('const oldLocationIds = (effectiveLocationMode === "multi"');
    expect(scanPage).toContain("const sameActiveLocation = oldLocationIds.some");
    expect(scanPage).toContain("if (sameActiveLocation)");
    expect(scanPage).toContain('const nextLocations = current.locations.flatMap((location) => {');
    expect(scanPage).toContain('const previousIds = new Set(oldLocationIds.map');
    expect(scanPage).toContain('status: "completed" as const');
    expect(scanPage).toContain('const nextGroup = `group-${Date.now()}`');
    expect(scanPage).toContain('activeGroupId: nextGroup');
    expect(scanPage).toContain('setCurrentBin(nextBin)');
    expect(scanPage).toContain('setIsScanSessionActive(true)');
    expect(scanPage).toContain("hasExistingLocationCount(saved, reconciliationCode, nextBin.locationId)");
    expect(scanPage).toContain("const finished = completePcountLocationMode(current)");
    expect(scanPage).toContain("const fresh = addPcountLocationToSession(");
    expect(scanPage).toContain('setStep("item");');
    expect(scanPage).not.toContain("{canFinishActivePcountLocation && (");
    expect(scanPage).toMatch(/showPcountActionDock\s*=\s*isScanSessionActive[\s\S]*activeGroupLocations\.length > 0/);
  });

  it("loads an active Multi Physical Count session instead of only the old single-location setup", () => {
    expect(scanPage.indexOf("const refocusPhysicalCountScanner = React.useCallback")).toBeLessThan(
      scanPage.indexOf("const loadPreviousSetup = React.useCallback")
    );
    const loadStart = scanPage.indexOf("const loadPreviousSetup = React.useCallback");
    const loadEnd = scanPage.indexOf("const hydrateItemName", loadStart);
    const loadBody = scanPage.slice(loadStart, loadEnd);
    expect(loadBody).toContain("loadPcountSession(employee.id)");
    expect(loadBody).toContain("getPcountSessionRestoreState(savedSession)");
    expect(loadBody).toContain("setIsScanSessionActive(restoredState.isScanSessionActive)");
  });

  it("clears Physical Count resume state when saved scans are cleared", () => {
    const clearStart = blankPage.indexOf("const clearSavedScans = () => {");
    const clearEnd = blankPage.indexOf("const submitSelectedReconciliation", clearStart);
    const clearBody = blankPage.slice(clearStart, clearEnd);
    expect(clearBody).toContain("loadLocalScanEntries(employee.id)");
    expect(clearBody).toContain("loadLastScanSetup(employee.id, \"pcount\")");
    expect(clearBody).toContain("removePcountFromLastActivity(employee.id, reconciliationCode)");
    expect(clearBody).toContain("clearPcountSession(employee.id)");
    expect(clearBody).toContain("clearLocalScanEntries(employee.id)");
  });

  it("does not depend on asynchronous state updaters for the Multi Location selected message", () => {
    const selectStart = scanPage.indexOf("const selectPhysicalCountLocation = React.useCallback");
    const selectEnd = scanPage.indexOf("const continueMultiLocationItems", selectStart);
    const selectBody = scanPage.slice(selectStart, selectEnd);
    expect(selectBody).not.toContain("let added = false");
    expect(selectBody).toContain("const result = addPcountLocationToSession");
    expect(selectBody).toContain("result.added");
  });

  it("keeps Physical Count scanning active when closing the final location for review", () => {
    const completeStart = scanPage.indexOf("const completeActiveLocationGroup = () => {");
    const completeEnd = scanPage.indexOf("const reopenLocation", completeStart);
    const completeBody = scanPage.slice(completeStart, completeEnd);
    expect(completeBody).toContain('setStep("bin");');
    expect(completeBody).toContain("setIsScanSessionActive(true);");
    expect(completeBody).not.toContain("setIsScanSessionActive(false);");
    expect(scanPage).toContain("Scan one or more Storage Locations");
  });

  it("allows Multi Location item scanning from the active location group without requiring currentBin", () => {
    expect(scanPage).toContain("const activeScanBin = effectiveLocationMode === \"multi\" ? currentBin || activeGroupLocations[0]?.bin || null : currentBin;");
    expect(scanPage).toMatch(/if \(!activeScanBin\) \{[\s\S]*Scan the storage location QR first/);
    expect(scanPage).toMatch(/const baseEntry: LocalScanEntry = \{[\s\S]*bin: activeScanBin/);
  });

  it("auto-enters Multi Scan Items when an item is scanned after selecting locations", () => {
    expect(scanPage).toContain("const scannedItemWhileSelectingMultiLocations = parseItem(code);");
    expect(scanPage).toContain("setQueuedScans((current) => [...current, code]);");
    expect(scanPage).toContain("Quantity applies to all selected locations.");
  });

  it("ignores item QR UOM during Physical Count calculation and uses ERP Stock UOM", () => {
    expect(scanPage).toContain("const conversionFactor = 1;");
    expect(scanPage).toContain("effectiveQrQuantity = item.qrQuantity;");
    expect(scanPage).toContain("const validConversionFactor = 1;");
    expect(scanPage).toContain('uom: "", barcodeUom: item.uom');
    expect(scanPage).toContain("const conversionFactor = effectiveEntry.uomConversionFactor ?? 1;");
    expect(scanPage).not.toContain("getPhysicalCountUomConversionFactor(");
    expect(blankPage).toContain("const conversionFactor = entry.uomConversionFactor ?? 1;");
  });

  it("blocks negative Physical Count rows before submitting to ERP", () => {
    expect(scanPage).toContain("getPcountNegativeCountIssue(pendingEntries)");
    expect(scanPage).toContain("getPcountNegativeCountMessage(negativeCountIssue)");
    expect(blankPage).toContain("getPcountNegativeCountIssue(pendingEntries)");
    expect(blankPage).toContain("getPcountNegativeCountMessage(negativeCountIssue)");
  });

  it("keeps the Physical Count scanner field focused during Multi Location scanning", () => {
    expect(scanPage).toContain("refocusPhysicalCountScanner");
    expect(scanPage).toMatch(/refocusPhysicalCountScanner\(\);\s*return;\s*\}\s*updatePcountSession/);
    expect(scanPage).toMatch(/setMessage\(`\$\{formatScanQuantity\(Math\.abs\(signedQuantity\)\)\}[\s\S]*recorded at each of \$\{groupLocations\.length\} locations\.`\);\s*refocusPhysicalCountScanner\(\);/);
  });

  it("keeps the active Physical Count scanner capture hidden from the UI", () => {
    expect(scanPage).toContain("hideScannerCapture");
    expect(scanPage).toContain('className={`scan-input-wrap ${hideScannerCapture ? "is-focus-only" : ""}`}');
    expect(scanPage).toMatch(/\.scan-input-wrap\.is-focus-only\s*\{[\s\S]*position:\s*fixed/);
    expect(scanPage).toMatch(/\.scan-input-wrap\.is-focus-only\s*\{[\s\S]*left:\s*-10px/);
    expect(scanPage).toMatch(/\.scan-input-wrap\.is-focus-only\s*\{[\s\S]*opacity:\s*\.01/);
    expect(scanPage).toMatch(/\.scan-input-wrap\.is-focus-only\s+\.scan-input-icon\s*\{[\s\S]*display:\s*none/);
  });

  it("does not expose single-location Edit / Reopen while Multi Location is active", () => {
    expect(scanPage).toContain('effectiveLocationMode === "single" && !isActive');
  });

  it("shows the signed-in user details on Profile without a Saved Scans setting", () => {
    expect(blankPage).toContain('className="profile-user-card settings-profile-identity"');
    expect(blankPage).toContain("employee.full_name");
    expect(blankPage).toContain("employee.employee_id || employee.id");
    expect(blankPage).toContain("employee.department");
    expect(blankPage).toContain("employee.email");
    expect(blankPage).not.toContain('<span className="settings-action-title">Saved Scans</span>');
  });

  it("uses the shared current style for saved-scan review and confirmation dialogs", () => {
    expect(authenticatedCss).toContain(".history-review-page");
    expect(authenticatedCss).toContain(".logout-dialog-backdrop");
    expect(authenticatedCss).toMatch(/\.logout-dialog-button-primary[\s\S]*background:\s*var\(--qcmc-blue\)/);
  });
  it("shows completion only inside Location Progress and hides both redundant cards", () => {
    expect(scanPage).toContain("const isPcountReviewStage = isScanSessionActive");
    expect(scanPage).toContain('(pcountSession?.locations || []).every((location) => location.status === "completed")');
    expect(scanPage).toContain('isScanSessionActive && mode === "pcount" && !isPcountReviewStage && (');
    expect(scanPage).toContain('<div className="scan-redesign-location" aria-label="Current Storage Location">');
    expect(scanPage).toContain('className={isPcountReviewStage ? "scan-progress-complete-summary" : ""}');
    expect(scanPage).toContain('✓ ${reviewedLocationCount}/${pcountSession?.locations.length || reviewedLocationCount} Completed');
    expect(scanPage).toContain('isPcountReviewStage && isStaleCompletedLocationMessage');
    expect(scanPage).not.toContain('isPcountReviewStage ? "Location Count Complete"');
    expect(compactCss).toContain(".is-review-stage .scan-progress-complete-summary");
    expect(compactCss).not.toContain(".scan-redesign-location.is-complete");
  });

  it("distinguishes device offline from an ERPNext request problem and clears stale status after ERP recovery", () => {
    expect(scanPage).toContain('const isDeviceOffline = typeof navigator !== "undefined" && navigator.onLine === false');
    expect(scanPage).toContain('isDeviceOffline ? "Offline · saved locally"');
    expect(scanPage).toContain('isOffline ? "ERP issue · saved locally"');
    expect(scanPage).toContain("The last ERPNext network request failed.");
    expect(scanPage).toContain("setIsOffline(false)");
    expect(scanPage).toContain("setIsOffline(true)");
    const checkStart = scanPage.indexOf("const refreshAvailability = async () =>");
    const checkEnd = scanPage.indexOf("void refreshAvailability()", checkStart);
    const check = scanPage.slice(checkStart, checkEnd);
    expect(checkStart).toBeGreaterThan(-1);
    expect(check).toContain("getReconciliationContext(reconciliationCode)");
    expect(check).toContain("setIsOffline(false)");
    expect(check).toContain("if (isNetworkFailure(error))");
    expect(check).toContain("setIsOffline(true)");
    expect(scanPage).toContain("if (reconciliationCode && loadPendingPcountSubmission(employee.id, reconciliationCode))");
  });

  it("keeps the Scanned Items overlay full-screen without hiding the main screen Submit", () => {
    const selector = ".bp-root .scan-page.is-scanning.is-pcount-redesign.is-review-stage .scan-history.is-expanded";
    const start = compactCss.indexOf(selector);
    expect(start).toBeGreaterThan(-1);
    const rule = compactCss.slice(start, compactCss.indexOf("}", start));
    expect(rule).toMatch(/flex:\s*1 1 auto/);
    expect(compactCss).toContain(".scan-history.scan-items-fullscreen");
    expect(rule).toMatch(/max-height:\s*none/);
    expect(rule).toMatch(/overflow-y:\s*auto/);
    expect(compactCss).toContain(".is-review-stage .scan-submit-dock");
    expect(compactCss).toContain(".is-review-stage .scan-submit-dock .scan-submit-button");
    expect(scanPage).toContain("scan-items-fullscreen");
  });

  it("shows a single full-width Review & Submit button at completed-count stage", () => {
    expect(scanPage).toContain('isPcountReviewStage ? "is-review-stage" : ""');
    expect(scanPage).toContain("setShowSubmitConfirm(true)");
    expect(scanPage).toContain('className="scan-redesign-view-items"');
    expect(compactCss).toContain(".is-review-stage .scan-submit-dock .scan-redesign-items-button");
    expect(compactCss).toContain(".is-review-stage .scan-submit-dock .scan-submit-button");
    expect(compactCss).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(scanPage).toContain('isDeviceOffline ? "Offline · saved locally"');
  });

  it("keeps full location codes available while compacting completed chips and explaining totals UOM", () => {
    expect(scanPage).toContain('title={`Long press to remove ${location.bin.locationCode || location.bin.locationId}`}');
    expect(scanPage).toContain('aria-label={`Long press to remove location ${location.bin.locationCode || location.bin.locationId}:');
    expect(scanPage).toContain('className="scan-total-uom"');
    expect(scanPage).toContain("const uniformScanUom =");
    expect(scanPage).toContain('hasMixedScanUom ? "Mixed UOM"');
    expect(compactCss).toContain("max-width: 116px");
  });

  it("stretches the Physical Count reference card to align with all other cards", () => {
    const focusHeaderCss = compactCss.match(/\.bp-root \.scan-page\.is-scanning\.is-pcount-redesign \.scan-focus-header\s*\{([^}]*)\}/)?.[1] || "";
    const referenceCss = compactCss.match(/\.bp-root \.scan-page\.is-scanning\.is-pcount-redesign \.scan-redesign-reference-card\s*\{([^}]*)\}/)?.[1] || "";
    expect(focusHeaderCss).toMatch(/align-items:\s*stretch\s*;/);
    expect(referenceCss).toMatch(/width:\s*100%\s*;/);
    expect(referenceCss).toMatch(/max-width:\s*none\s*;/);
    expect(referenceCss).toMatch(/box-sizing:\s*border-box\s*;/);
    expect(referenceCss).toMatch(/align-self:\s*stretch\s*;/);
    // Maintain the existing page gutter, not an accidental screen-wide overflow.
    expect(compactCss).toContain("padding: 8px 10px 5px;");
  });

  it("offers Select All after holding a Scanned Items row, without selecting submitted records", () => {
    expect(scanPage).toContain("const startScanRowLongPress = React.useCallback((entry: ItemScan) => {");
    expect(scanPage).toContain("setRemoveSelectionMode(true)");
    expect(scanPage).toContain("setRemoveSelectedKeys(new Set([getRemoveEntryKey(entry)]))");
    expect(scanPage).toContain("const selectablePendingScanKeys = React.useMemo(");
    expect(scanPage).toContain("!(entry.submittedTransactionIds || []).length");
    expect(scanPage).toContain("!(entry.submittedTransactionCount || 0)");
    expect(scanPage).toContain("entry.submittedPhysicalCount === undefined");
    expect(scanPage).toContain("const selectAllPendingScanItems = React.useCallback(");
    expect(scanPage).toContain("setRemoveSelectedKeys(new Set(selectablePendingScanKeys))");
    // When bulk selecting, do not hide rows beyond the usual 30-per-group preview.
    expect(scanPage).toContain("group.entries.slice(0, removeSelectionMode ? undefined : 30)");
    expect(scanPage).toContain('className="scan-select-all-pending"');
    expect(scanPage).toContain("selectAllPendingScanItems()");
    expect(scanPage).toContain("Select All");
    expect(scanPage).toContain("removeSelectedPendingEntries");
    expect(scanPage).toContain("const protectedEntries = selected.filter");
    expect(scanPage).toContain("showToast(\"warning\", \"One or more selected items already have ERP-submitted history.");
    expect(compactCss).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(compactCss).toContain(".scan-remove-selection-bar button.scan-select-all-pending");
    expect(compactCss).toContain("position: sticky;");
  });

  it("releases empty completed locations after Remove Selected and single-item deletion", () => {
    const bulkStart = scanPage.indexOf("const removeSelectedPendingEntries = React.useCallback");
    const bulk = scanPage.slice(bulkStart, scanPage.indexOf("React.useEffect(", bulkStart));
    expect(bulkStart).toBeGreaterThan(-1);
    expect(bulk).toContain("const released = syncCompletedLocationsAfterScanRemoval(selected, updated)");
    expect(bulk.indexOf("saveLocalScanEntries(employee.id, updated)")).toBeLessThan(
      bulk.indexOf("syncCompletedLocationsAfterScanRemoval(selected, updated)")
    );
    expect(scanPage).toContain("syncCompletedLocationsAfterScanRemoval(removed, updated)");
    expect(scanPage).toContain("savePcountSession(employee.id, result.session)");
    expect(scanPage).toContain("clearPcountLastScanSetup(employee.id, storedSession.reconciliationCode)");
    expect(scanPage).toContain('setMessage("Removed counts are cleared. Scan the Storage Location again to recount.")');
    expect(scanPage).toContain("const protectedEntries = selected.filter");
  });

  it("repairs old empty location completion markers during Physical Count resume", () => {
    expect(scanPage).toContain("const repaired = persistedSession");
    expect(scanPage).toContain("restoreEmptyCompletedPcountLocations(persistedSession, savedPhysicalCountEntries");
    expect(scanPage).toContain("if (savedSession && repaired?.releasedLocationIds.length)");
    expect(scanPage).toContain("savePcountSession(employee.id, savedSession)");
    expect(scanPage).toContain("setPcountSession(savedSession)");
  });

  it("renders the approved blue-and-white Physical Count scan screen without replacing scanner logic", () => {
    expect(scanPage).toContain('is-pcount-redesign');
    expect(scanPage).toContain('className="scan-redesign-appbar"');
    expect(scanPage).toContain('className="scan-redesign-reference-card"');
    expect(scanPage).toContain('className="scan-redesign-location"');
    expect(scanPage).toContain('className="scan-progress-board"');
    expect(scanPage).toContain('className="scan-redesign-ready-card"');
    expect(scanPage).toContain('className="scan-redesign-tag-card"');
    expect(scanPage).toContain('className="scan-totals-strip"');
    expect(scanPage).toContain('className="scan-redesign-items-button"');
    expect(scanPage).toContain('Saved on device');
    expect(scanPage).toContain('Waiting for ERP sync');
    expect(scanPage).toContain('isDeviceOffline ? "Offline · saved locally"');
    expect(scanPage).toContain('quantityMode === "automatic" ? "Automatic" : "Manual"');
    expect(scanPage).toContain('step === "item" ? "Ready to Scan Item"');
    expect(scanPage).toContain("handleSubmitToErp");
    expect(scanPage).toContain('ref={inputRef}');
    expect(scanPage).toContain('onKeyDown={handleKeyDown}');
  });

  it("keeps the original Scanned Items history and pencil editor accessible via View / Edit", () => {
    expect(scanPage).toContain('const [showScannedItems, setShowScannedItems] = React.useState(false);');
    expect(scanPage).toContain('scan-items-fullscreen" : ""');
    expect(scanPage).toContain('className="scan-redesign-view-items"');
    expect(scanPage).toContain('aria-expanded={showScannedItems}');
    expect(scanPage).toContain('setShowScannedItems((visible) => !visible)');
    expect(scanPage).toContain('aria-label="Close Scanned Items"');
    expect(scanPage).toContain('setSelectedItemDetails(entry)');
    expect(compactCss).toContain(".scan-history:not(.is-expanded) > :not(.scan-totals-strip):not(.scan-list-header)");
    expect(compactCss).toContain(".scan-history.is-expanded");
  });

  it("does not shrink or clip Scanned Items cards inside the full-screen scroll view", () => {
    expect(compactCss).toContain(".scan-history.scan-items-fullscreen > .scan-sku-group");
    expect(compactCss).toContain("flex: 0 0 auto !important");
    expect(compactCss).toContain("height: auto !important");
    expect(compactCss).toContain("overflow: visible !important");
    expect(compactCss).toContain("overflow-y: auto !important");
  });

  it("pins scanned totals and expands SKU details in Physical Count", () => {
    expect(scanPage).toContain('className={mode === "pcount" ? "scan-items-fixed-top" : "scan-items-normal-top"}');
    expect(compactCss).toContain(".scan-history.scan-items-fullscreen > .scan-items-fixed-top");
    expect(compactCss).toContain("position: sticky !important");
    expect(scanPage).toContain('{mode !== "pcount" && <button');
    expect(scanPage).toContain('const [expandedScannedSkuCodes, setExpandedScannedSkuCodes]');
    expect(scanPage).toContain('aria-expanded={mode === "pcount" ? expandedScannedSkuCodes.has(group.itemCode) : undefined}');
    expect(scanPage).toContain('(mode !== "pcount" || expandedScannedSkuCodes.has(group.itemCode))');
    expect(scanPage).not.toContain('className="scan-history-tags">Inv Tag:');
    expect(scanPage).toContain('className="scan-history-code">Current physical count');
    expect(scanPage).toContain('setSelectedItemDetails(entry)');
  });

  it("formats visible Physical Count quantities with grouping commas in both views", () => {
    expect(scanPage).toContain('const formatScanQuantity = (value: number): string => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });');
    expect(scanPage).toContain('{formatScanQuantity(group.total)}');
    expect(scanPage).toContain('{formatScanQuantity(tagGroup.quantity)}');
    expect(scanPage).toContain('{formatScanQuantity(entry.quantity)}');
    expect(scanPage).toContain('{formatScanQuantity(quantity)} {entry.uom}');
    expect(scanPage).toContain('Number.isFinite(preview) ? formatScanQuantity(preview)');
  });

  it("renders Inventory Tag trapping and validation messages inside the Inv Tag popup", () => {
    expect(scanPage).toContain('const [inventoryTagPopupNotice, setInventoryTagPopupNotice]');
    expect(scanPage).toContain('setInventoryTagPopupNotice(warning)');
    expect(scanPage).toContain('setInventoryTagPopupNotice("Inv Tag is required.")');
    expect(scanPage).toContain('setInventoryTagPopupNotice("Recount must use an existing Inv Tag for this item.")');
    expect(scanPage).toContain('className="scan-confirm-dialog scan-invtag-dialog"');
    expect(scanPage).toContain('className="scan-invtag-notice" role="alert" aria-live="assertive"');
    expect(compactCss).toContain('.scan-confirm-dialog.scan-invtag-dialog .scan-invtag-notice');
  });

  it("switches between By Location and By Inv Tag without changing saved counts", () => {
    expect(scanPage).toContain('aria-label="Scanned Items view"');
    expect(scanPage).toContain('>By Location</button>');
    expect(scanPage).toContain('>By Inv Tag</button>');
    expect(scanPage).toContain('groupScannedItemsByInvTag(group.entries)');
    expect(scanPage).toContain('className="scan-tag-columns"><span>Inv Tag</span><span>Qty</span>');
    expect(scanPage).toContain('className="scan-tag-location-row"');
    expect(scanPage).toContain('onClick={() => setSelectedItemDetails(entry)}');
    expect(compactCss).toContain(".scan-history.scan-items-fullscreen .scan-items-view-selector");
  });

  it("hides Counted Locations from the Physical Count Scanned Items popup without deleting location data", () => {
    expect(scanPage).toContain('{mode !== "pcount" && countedLocations.length > 0 && (');
    expect(scanPage).toContain('{mode !== "pcount" && showCountedLocations && countedLocations.length > 0 && (');
  });

  it("opens a dedicated Physical Count Scanned Items screen with close and back support", () => {
    expect(scanPage).toContain('(mode !== "pcount" || showScannedItems)');
    expect(scanPage).toContain('role={mode === "pcount" ? "dialog" : undefined}');
    expect(scanPage).toContain('aria-modal={mode === "pcount" ? true : undefined}');
    expect(scanPage).toContain('className="scan-items-fullscreen-header"');
    expect(scanPage).toContain('aria-label="Close Scanned Items"');
    expect(scanPage).toContain('setShowScannedItems(false)');
    expect(scanPage).toContain('if (showScannedItems) {');
    expect(compactCss).toContain('height: 100dvh !important');
    expect(compactCss).toContain('overflow-y: auto !important');
    expect(compactCss).toContain('.scan-items-fullscreen-header');
    expect(compactCss).toContain('.bp-root .scan-confirm-backdrop.scan-detail-backdrop {\n  z-index: 300 !important;');
    expect(compactCss).toContain('z-index: 350 !important');
  });

  it("offers Review & Submit for the final location without a manual Next Location button", () => {
    expect(scanPage).toContain('{(pendingEntryCount > 0 || hasQueuedSubmission) && <button');
    expect(scanPage).toContain('if (activeIds.size > 0 && incomplete.length > 0) completeActiveLocationGroup();');
    expect(scanPage).toContain('setShowSubmitConfirm(true)');
    expect(scanPage).not.toContain('className="scan-finish-location"');
    expect(scanPage).toContain("Review & Submit");
    expect(compactCss).toContain(".scan-submit-dock .scan-submit-button");
    expect(compactCss).toContain("position: sticky;");
  });

  it("preserves the horizontal scroll fix and doesn't add unlike UOMs together in the summary", () => {
    expect(scanPage).toContain("const visibleProgressLocations = orderedProgressLocations;");
    expect(scanPage).toContain("hasMixedScanUom");
    expect(scanPage).toContain('hasMixedScanUom ? "Mixed UOM"');
    expect(compactCss).toContain("overflow-x: auto;");
    expect(compactCss).toContain("touch-action: pan-x;");
  });

  it("lets operators swipe through all top location chips independent of View all", () => {
    expect(scanPage).toContain("const visibleProgressLocations = orderedProgressLocations;");
    expect(scanPage).toContain('className="scan-progress-pills" role="region"');
    expect(scanPage).toContain('aria-label="Locations, swipe horizontally to see all"');
    expect(scanPage).toContain('className="scan-progress-view-all" onClick={() => setShowLocationProgressModal(true)}');
    expect(scanPage).toMatch(/\.scan-progress-pills\s*\{[\s\S]*?overflow-x:\s*auto;[\s\S]*?touch-action:\s*pan-x/);
  });

  it("does not re-hide the location strip after an earlier overflow-x:auto rule", () => {
    const rules = [...scanPage.matchAll(/\.scan-progress-pills\s*\{([^}]*)\}/g)].map((match) => match[1]);
    expect(rules.length).toBeGreaterThanOrEqual(2);
    // The earlier UI contract checked only the first CSS rule. Android used
    // the later overflow:hidden rule and the strip could not be swiped.
    expect(rules.some((rule) => /\boverflow\s*:\s*hidden\s*;/.test(rule))).toBe(false);
    expect(rules.at(-1)).toMatch(/overflow-x:\s*auto\s*;/);
    expect(rules.at(-1)).toMatch(/touch-action:\s*pan-x\s*;/);
  });

  it("preserves the working scanner focus handlers while fixing only location-strip CSS", () => {
    expect(scanPage).toContain('onClick={focusScanner} onPointerUpCapture={() => window.setTimeout(focusScanner, 0)}');
  });

  it("rejects a duplicate Inventory Tag for a different Item in the same Storage Location", () => {
    const confirmStart = scanPage.indexOf("const confirmInventoryTag =");
    const confirmEnd = scanPage.indexOf("let previousRecountQuantity", confirmStart);
    const confirmBody = scanPage.slice(confirmStart, confirmEnd > confirmStart ? confirmEnd : undefined);
    expect(confirmBody).toContain("findInventoryTagItemConflict(");
    expect(confirmBody).toContain("loadLocalScanEntries(employee.id)");
    expect(confirmBody).toContain("pendingItem.itemCode");
    expect(confirmBody).toContain("currentBin?.locationId");
    expect(confirmBody).toContain("setInventoryTagPopupNotice(warning)");
    expect(scanPage).toContain("if (tagConflict) {");
    expect(scanPage).not.toContain("if (tagConflict && false)");
    expect(scanPage).toContain("Recount must use an existing Inv Tag for this item.");
  });

  it("keeps the complete Edit Quantity & Inv Tag popup visible without scrolling to Save Changes", () => {
    const editorStart = scanPage.indexOf('className="scan-confirm-backdrop scan-edit-backdrop"');
    const editorEnd = scanPage.indexOf('      })()}', editorStart);
    const editor = scanPage.slice(editorStart, editorEnd);
    expect(editorStart).toBeGreaterThan(-1);
    expect(editorEnd).toBeGreaterThan(editorStart);
    expect(editor).toContain('scan-confirm-dialog scan-edit-dialog scan-qty-dialog scan-qty-dialog-compact');
    expect(editor).toContain('className="scan-edit-fields"');
    expect(editor).toContain('id="scan-edit-invtag"');
    expect(editor).toContain('id="scan-edit-quantity"');
    expect(editor).toContain('className="scan-confirm-actions scan-edit-actions"');
    expect(editor).toContain("Save Changes");
    expect(editor).not.toContain("autoFocus");
    expect(compactCss).toMatch(/\.bp-root \.scan-confirm-dialog\.scan-edit-dialog\s*\{[^}]*overflow:\s*hidden;/);
    expect(compactCss).toMatch(/\.scan-edit-dialog \.scan-edit-fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(compactCss).toMatch(/\.scan-edit-dialog \.scan-edit-actions\s*\{[^}]*margin:\s*0;/);
  });

  it("preserves editable Inventory Tag, Big/Loose Pack and Quantity behavior in the compact dialog", () => {
    expect(scanPage).toContain('aria-label="Edit Inventory Tag"');
    expect(scanPage).toContain('aria-label="Edit Quantity"');
    expect(scanPage).toContain('setEditPackageStatus("COMPLETE")');
    expect(scanPage).toContain('setEditPackageStatus("OPENED")');
    expect(compactCss).toContain(".bp-root .scan-confirm-backdrop.scan-edit-backdrop");
    expect(compactCss).toContain("When Android's keyboard compresses the WebView, keep Save visible first.");
  });

  it("offers Inv Tag editing on pending scan transactions and retains correction history", () => {
    expect(scanPage).toContain("inventoryTag: tx.inventoryTag || \"\"");
    expect(scanPage).toContain('aria-label="Edit Inventory Tag"');
    expect(scanPage).toContain("inventoryTagEditHistory:");
    expect(scanPage).toContain("matchingEntry?.submittedTransactionIds?.includes(tx.id)");
    expect(scanPage).toContain("Save Changes");
  });

  it("suppresses the phone keyboard on Quantity only, keeping the existing numeric keypad", () => {
    expect(scanPage).toMatch(/className="scan-qty-input"[\s\S]*?inputMode="none" readOnly/);
    expect(scanPage).toContain('["7","8","9","÷","4","5","6","×","1","2","3","-",".","0","backspace","+"]');
    expect(scanPage).toContain('className="scan-qty-key" onClick={() => enterQuantityKey(key)}');
  });

});