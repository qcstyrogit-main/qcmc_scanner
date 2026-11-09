# QCMC Scanner Change Log

This file records scanner-app changes requested through ChatGPT. Changes should be appended, not replace prior entries.

## 2026-10-07

### Physical Count - Failed transaction history
- Physical Count submission preparation/staging failures are recorded in Transactions > Failed.
- Upload/submission exceptions, network errors, PCOUNT_NOT_OPEN, ERP FAILED, and NEEDS_REVIEW remain visible in failed history as applicable.
- Existing local retry/pending data behavior was preserved.

### Physical Count - Interrupted ERP connection
- When an ERP submission loses network connectivity, the existing submission loading state is allowed to finish/close.
- User-facing message now explains that the ERP connection was interrupted, asks the operator to check the network, and confirms that the Physical Count remains saved locally.
- No local count data is intentionally cleared by this failure path.

### Resume Work - Physical Count exact-state restore
- Resume Work remains a global dashboard feature shared with other scanner workflows.
- Physical Count resume now follows the durable session state instead of treating any unsubmitted row as an active Scan Items session.
- If a Physical Count location is actively being counted, Resume Work restores Scan Items.
- If the operator already finished the location / pressed Next Location, pending ERP rows may still exist but Resume Work restores Scan Location, preventing items from being scanned into the wrong location.
- Existing Codex scanner keyboard/native broadcast fallback behavior was not intentionally changed.

### Resume Work - reopen unsubmitted Physical Count
- Refined the earlier exact-state restore after confirming operators still need a direct way back to unsubmitted counts.
- Resume Work first uses the durable active Physical Count location/group when one exists.
- If the active location was cleared but pending/unsubmitted count rows remain, Resume Work finds the most recently scanned pending location, restores that exact bin, and opens Scan Items.
- This restores both the screen and `currentBin`; it does not open Scan Items with a null/guessed location.
- If there is no active location and no pending Physical Count location to restore, Resume Work stays on Scan Location.
- No new screen was added and other Resume Work workflows were not changed.

### Safety / build
- Changes were surgical patches to existing source.
- Existing Codex native scanner broadcast / guarded keyboard fallback was not intentionally changed.
- No APK build was performed by ChatGPT for these changes.

## 2026-10-19

### Physical Count — Scan Items location strip
- Kept Location Progress and View all, but moved the modal action into its own button so the location chips are not trapped inside a clickable button.
- The top progress strip now includes every ordered counted location rather than truncating at six, and supports horizontal touch/pointer scrolling with visible thin scrollbar.
- No changes to the underlying counted-location state or location completion actions.

### Physical Count — Inventory Tag vs Item Code validation
- Added a reconciliation-scoped, case-insensitive/trimmed Item Code ownership check for an Inventory Tag.
- An Inventory Tag already assigned to a different Item Code is rejected on manual tag confirmation, automatic quantity commit, and pending transaction edits. Previously submitted locally retained transactions are included in the check.
- Same-Item repeat scans, multi-location counting rules, and existing per-location duplicate controls remain in place.
- Automatic tag reuse now refuses known cross-item conflicts.
- LIMITATION: validation covers this device's locally stored reconciliation entries. ERPNext must enforce uniqueness across devices/operators and server history; no backend change was made in this update.

### Physical Count — Edit Quantity and Inventory Tag
- Extended each pending transaction's pencil editor with an editable Inventory Tag field while preserving Big Pack/Loose Pack quantity editing.
- Blank replacement is rejected for an existing nonblank tag; legacy blank tags can remain blank for quantity-only correction.
- Submitted or unavailable transactions cannot be edited; the save path rechecks current local submission state.
- Inventory Tag corrections retain an append-only local edit history (old tag, corrected tag, date, operator ID) and display that history in item details.
- Corrected transaction values are saved locally before pending ERP payload invalidation; local storage failures keep the modal open and show an error.
- Clearing only the affected active tag memory prevents silently reusing an old tag after correction.

### Physical Count — Quantity popup software keyboard
- Main Quantity popup uses a read-only display with inputMode="none" so tapping the displayed value does not request Android's keyboard.
- Existing in-popup number/expression keypad, Big/Loose Pack toggle, quantity calculation and confirmation remain in place.
- The distinct Edit Quantity dialog still allows the normal keyboard because it has no on-screen number pad.

### Safety, files and testing
- Full pre-change ScanPage source backed up at `.scanner-inspect/ScanPage.pre-invtag-updates.20261019.tsx`.
- New/extended tests: activeInventoryTag, inventoryTagReuse, scanStorage, workflowUiContract.
- Mac Bridge can edit/read files but offers no remote shell execution in this connection; npm test, TypeScript/build, Capacitor sync and Android-device swipe/keyboard checks have NOT been run.
- Do not release the APK until tests and Android acceptance checks pass. Existing APK v3.07 was not overwritten.

### 2026-10-19 build and test report follow-up
- Operator log: `npm test` reported 424/425 passed; the only failure was a stale `workflowUiContract.test.ts` assertion requiring the previously removed `New Inv Tag` UI action.
- Production `npm run build` succeeded: Vite 7.3.5, 1,621 modules transformed, 5.37 seconds. The >500 kB JS chunk warning is non-blocking and remains a performance follow-up.
- Updated the stale test assertion to verify the intended current behavior: active-tag reuse stays guarded, missing/invalid reuse prompts for Inv Tag, and the removed button is not reintroduced. No runtime application code changed during this follow-up.
- Full Vitest rerun after the test correction remains pending; do not report 425/425 until verified.

### 2026-10-19 Location Progress horizontal-swipe follow-up
- Operator confirmed the other scanner changes passed device testing, but the top Scan Items Location Progress strip still would not scroll horizontally.
- Root cause found in `src/components/ScanPage.tsx`: after the earlier `.scan-progress-pills { overflow-x: auto; touch-action: pan-x; }` CSS, a later `.scan-progress-pills { min-height: 29px; overflow: hidden; }` rule overrode scrolling.
- Changed only the later conflicting rule to `overflow-x: auto; overflow-y: hidden; touch-action: pan-x; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch;`. Kept all-location chip rendering, View all, active/completed statuses and original scanner refocus handlers.
- Strengthened `workflowUiContract.test.ts` to fail if any later `.scan-progress-pills` rule hides overflow and to verify that scanner focus handlers are retained.
- Static review done. Automated tests, web rebuild, Capacitor sync, APK build and device gesture validation still required for THIS change; previously built APK does not contain the fix.

### 2026-10-19 Physical Count pending transaction editor compact popup
- User reported that opening the pencil edit popup requires vertical scrolling to reach Save Changes.
- Scoped the fix to the pending transaction Edit Quantity & Inv Tag popup (not the Item Audit history, main Quantity keypad, or other confirmation dialogs).
- Added `scan-edit-backdrop` / `scan-edit-dialog` classes so mobile-specific bottom navigation padding and generic `overflow-y:auto` no longer make the edit dialog unnecessarily tall or scrollable.
- Reorganized the editor into compact heading, Big Pack / Loose Pack switch, side-by-side Inventory Tag and Quantity inputs, physical quantity preview, and adjacent Cancel / Save Changes actions.
- Removed the edit quantity input's automatic focus to prevent Android's software keyboard opening as soon as the pencil is tapped. Tapping an input still allows keyboard text/number entry.
- Added narrow/short-height responsive sizes; on extremely short viewports caused by the Android keyboard, Save/Cancel is prioritized at the top rather than becoming unreachable below the fields.
- Preserved existing transaction editing, Inventory Tag ownership validation, package calculation, edit history, ERP-submitted restrictions, and scanner event handling.
- Added `workflowUiContract.test.ts` assertions for the compact popup, visible actions, field editability, and non-autofocus.
- No automated test execution or updated APK build was performed by ChatGPT. Rebuild and verify physically on Android; extremely small keyboard-overlaid viewports may still require dismissing the keyboard to see every field.

### 2026-10-19 Physical Count Scan Items illustration-based UI redesign
- Implemented the approved rugged-Android screenshot's white/blue Physical Count Scan Items layout in real React source, scoped by `is-pcount-redesign` so Setup and other workflows keep their current UI.
- App-bar back action now returns to Inventory via existing `onBack`; current Manual/Automatic mode remains visible.
- Reference card shows the current reconciliation and distinguishes Ready to scan, Saved on device, Offline saved locally, and Waiting for ERP sync. These are local/scanner statuses, not fabricated ERP acknowledgments.
- Added a prominent Current Location card; in Multi Location it displays selected location count and location codes rather than misleading single-location text; when no current location remains it prompts review.
- Preserved the full horizontal Location Progress strip and View all modal (including overflow-x:auto and touch-action:pan-x; Android swipe still requires a new device check).
- Main Ready to Scan Item/Confirm Inv Tag/Confirm Quantity callout is visual only; original hidden barcode capture, scanner focus recovery, Inv Tag validation, Quantity keypad, and physical-count logic stay in place.
- Added a clear Inventory Tag status: a valid active tag may be shown only for the relevant Item Code in Automatic mode; Manual mode explains that tag entry follows scanning. Original business validation unchanged.
- Last scan success feedback now uses a clear recorded/deducted label, keeps quantity and current counted quantity. No transaction data changed.
- Scanned Items totals and expandable View/Edit header are visible, but the long item history is collapsed by default. The full original list, pencil edit, audit history, remove selection and Counted Locations tools remain accessible when expanded.
- Added fixed-view two-button action dock: View/Hide Scanned Items plus Next Location while the current location is active, or Review & Submit when no active location can be finished. Existing confirmation and incomplete-location safety checks remain in place.
- The combined Total Units summary shows Mixed UOM when entries use different stock units rather than incorrectly summing unlike quantities.
- New `ScanPage.compact.css` responsive design rules keep the UI readable on handheld devices and avoid disrupting Quantity / Edit popups.
- Added `workflowUiContract.test.ts` checks covering screenshot layout sections, history access, submission safeguards, horizontal scrolling, scanner input path, and mixed-UOM totals.
- VALIDATION PENDING: Mac Bridge did not run npm test, npm run build, Capacitor sync or Gradle APK build. Do not claim the existing APK contains this UI. Verify scanner focus after touching bottom actions, 8+ horizontal location chips, all popups, offline resume, and real ERP submission on a dedicated test reconciliation.

### 2026-10-19 Scan Items UI contract assertion fix
- Operator ran `npm test` after Update 043: 432 passed, 1 failed of 433 tests, in `src/lib/workflowUiContract.test.ts` ("shows scanned item details before counted location details"). Build steps stopped correctly on test failure.
- Root cause: test searched old literal `className="scan-panel scan-history"` while redesign now renders `ref={scanListRef} className={`scan-panel scan-history ${showScannedItems ? "is-expanded" : ""}`}`.
- Updated test to anchor on actual conditional history-container markup and assert `historyStart < itemsStart < locationsStart`. This preserves the required order of Scanned Items and Counted Locations without undoing the collapse/expand redesign.
- Only test file and MD histories changed; no runtime JSX, CSS, barcode focus, stock count, Inventory Tag or ERPNext logic changed.
- Tests NOT yet rerun by Mac Bridge; operator should rerun `npm test` (or focused `npx vitest run src/lib/workflowUiContract.test.ts`) and proceed with build only on green tests.

### 2026-10-19 Completed Physical Count review UI refinements (Android screenshot feedback)
- Device screenshot showed all 15 locations completed but still rendered a large `Ready to Review` barcode card and the stale instruction `Location count completed. Scan one or more Storage Locations, then scan an Item.`; both distracted from review and submission.
- Added derived `isPcountReviewStage` UI state, true only when scanning a Physical Count, no active location/group or session activeLocationId exists, session has completed locations only, and pending local entries or queued ERP submission exist. This is display-only; all ERPNext submission guards remain unchanged.
- Completed stage now uses compact green `N/N Locations Completed` card with contextual online/offline review guidance. The redundant barcode/Ready to Review card is hidden only at this stage. The physical scanner input remains available for scanning another location when appropriate.
- Suppressed only the exact stale informational message while at completed stage. Other warnings, errors, scanner feedback and toast messages remain visible.
- Completed stage has only one prominent, full-width `Review & Submit` bottom action; Hide/View Scanned Items remains accessible from the Scanned Items header, eliminating duplicate controls. Active counting retains its two-button action dock and ready-to-scan panel.
- Simplified current Manual/Automatic mode badge. Reduced maximum progress chip width while preserving the full location ID in title/ARIA and View all. Location progress scroll is retained.
- Added explicit Stock UOM label beneath the Total Units number when all entries share a known UOM; mixed UOM still displays `Mixed UOM` rather than adding incomparable units.
- Updated workflowUiContract regression checks for the conditional completed layout, full-width submission action, retained safeguards, UOM label and location codes.
- Files changed: `src/components/ScanPage.tsx`, `src/components/ScanPage.compact.css`, `src/lib/workflowUiContract.test.ts`. No scanned entries, offline storage, Inventory Tag, package calculation or ERP service logic modified.
- PENDING: full npm test/build, Capacitor Android sync and Gradle APK build were not run by Mac Bridge. On device verify completed count summary, stale message suppression, history toggle, submission flow online/offline, then start another location and verify Ready to Scan reappears.

### 2026-10-19 Full-width reference and long-press Select All
- User's Android screenshot showed the Physical Count reconciliation reference/status card narrower than Current Location and Location Progress cards. Cause: reference card had no explicit full-width/align-self rule, while inherited scan-header styles can constrain flex child alignment; blanket removal of all screen margins was avoided.
- Fixed `ScanPage.compact.css` with explicit stretch alignment on the active Physical Count header and full width, border-box and no max-width or horizontal margin on the reference card. Preserved the normal 10px page gutter and card readability.
- User requested Select All while long-pressing Scanned Items. Existing row long-press already enters selection mode; added `Select All (N)` in the selection toolbar, using `selectAllPendingScanItems` to include all pending item/location rows in the current reconciliation.
- Bulk selection excludes entries with submitted transaction IDs/count or a submitted physical-count value. This is consistent with the existing `removeSelectedPendingEntries` submitted-history guard and confirmation; do not bulk-edit/delete ERP-submitted counts. Individual row tap, long-press, Cancel and Remove Selected logic remains.
- During bulk selection, the grouped history shows all rows instead of the normal 30-per-group preview cap, so the operator can review every selected item before confirmation.
- Added responsive three-button toolbar with Select All, Cancel and Remove Selected. Made toolbar sticky in expanded Scanned Items history so Select All stays visible even when selecting lower rows.
- Expanded UI contract tests for reference card width, long-press selection state, protected submitted records, selection action and toolbar styling.
- Mac Bridge saved source edits only; automated tests/build/Capacitor sync/Android APK verification still pending. Operator should retest on a device with narrow screen and both pending and submitted rows.

### 2026-10-19 Remove Selected location re-scan bug fix
- Operator reported: after selecting/removing all Scanned Items, re-scanning their Storage Location fails with "cannot be added"/"already counted".
- Root cause: both bulk `removeSelectedPendingEntries` and single-item `removePendingScanEntry` deleted the local count entries but left the corresponding locations marked `completed` in the persisted `LocalPcountSession`. `addPcountGroupLocation` correctly rejected those stale session records as already_counted.
- Added pure `releaseEmptyPcountLocationsAfterScanRemoval` in `pcountLocationGroup.ts`. After local entries are saved, affected completed locations are removed from the session only if no row remains at the same normalized reconciliation/location. Pending or submitted remaining rows continue to protect their location. Other completed locations and active/in-progress groups are never cleared.
- Wired session synchronization into BOTH Remove Selected and individual pending-item deletion; persists the corrected session, invalidates stale last-scan setup only for actually released locations, clears stale last-scan feedback/active Inv Tag reuse cache, and prompts re-scanning the Storage Location when appropriate. The original submit-queue invalidation, delete protection for ERP-submitted scans, and quantity/stock logic remain unchanged.
- Added `restoreEmptyCompletedPcountLocations` to repair records already affected by the previous release. During startup/Resume Work, completed session locations with no local scan or submitted audit rows are released, while completed locations with saved rows and in-progress groups are preserved. This is local-device reconciliation only, not a claim about server-side/cross-device ERP counts.
- Added pure unit tests covering: delete last scan -> re-add location, delete one of two items -> still blocked, submitted history -> protected, several locations -> only emptied location released, active group untouched, reference scoping, and legacy session restore.
- Added UI contract checks that both deletion paths call the repair helper after saving local entries, that persisted session/setup update, and that startup restores old empty session markers.
- Files updated: `src/lib/pcountLocationGroup.ts`, `src/lib/pcountLocationGroup.test.ts`, `src/components/ScanPage.tsx`, `src/lib/workflowUiContract.test.ts`; append-only MD histories.
- VALIDATION PENDING: automated Vitest, web build, Capacitor sync, Gradle build, and Android re-scan verification. This source update is not present in the previous APK.

### 2026-10-19 Completed-count card removal and progress status
- Operator asked to remove the redundant large `LOCATION COUNT / All locations completed` card from the completed Physical Count screen.
- The Current Location card now renders only while actively scanning/not at `isPcountReviewStage`; the existing `Ready to Review` barcode card remains hidden at completed review.
- The Location Progress header now displays the compact green `✓ N/N Completed` status using persisted session completion counts. All horizontal location chips, full names via title/ARIA, View all modal and Review & Submit primary CTA remain.
- Removed obsolete `.scan-redesign-location.is-complete` CSS; added small responsive green completion badge styling and row-wrap within progress header. Active Current Location card, active scan-ready panel and item scan/edit submission workflow stay unchanged.
- Updated UI contract assertions to expect no completed location card and verify its completion status is in Location Progress instead. No local storage, Pcount session, Inv Tag, quantity or ERPNext business logic changed.
- Source change has been saved through Mac Bridge; npm/Vitest, Vite, Capacitor and Gradle and Android device validation remain pending.

### 2026-10-19 Offline badge and review screen gap corrections
- Android screenshot of MAT-RECO-2026-00038 showed "Offline · saved locally" despite internet access, plus a large blank gap between expanded Scanned Items and the sticky Review & Submit action.
- **Status root cause:** `isOffline` in ScanPage is set by *ERPNext network failures*, including when the device has connectivity. It can stay true without a later successful request or Android "online" event. Internet availability is not the same as ERPNext endpoint reachability.
- The Physical Count reference badge now explicitly separates `navigator.onLine === false` (device reports offline) from `isOffline === true` while device reports online (recent ERP connection issue). UI strings: `Offline · saved locally`, `ERP issue · saved locally`, `Saved on device`, and existing `Waiting for ERP sync`. Badge tooltip clarifies the last-failed-request distinction. Do not label local counts as submitted to ERP.
- Existing ERPNext reconciliation availability checks (on mount, app becoming active and document visibility) now reset the failed-network status on successful `getReconciliationContext`, or set it on transport failure. The online-event handler now waits for a successful ERP request instead of clearing network error before verification. No auto submission/queue processing guards were changed.
- **Gap root cause:** `scan-history.is-expanded` was capped at `min(46dvh,410px)` while the sticky submit dock used `margin:auto 0 0`, leaving a large unused gap between the list and button.
- Completed-review-only CSS makes the expanded Scanned Items pane `flex:1 1 auto`, lifts its height cap and scrolls inside the pane so it occupies the available space above the sticky `Review & Submit` button. Existing smaller-screen layout, collapsed-list behavior, interactive item details, selection/Remove Selected and submission logic were not modified.
- Updated workflowUiContract tests for device-vs-ERP status messages, online/reconnect verification, and flex/overflow review pane layout. This is a source-level change; npm tests, Vite build, Capacitor sync, Gradle build, and Android device validation remain pending.

### 2026-10-19 Inventory Home illustration-based UI redesign
- Operator approved applying the blue-and-white Inventory Home illustration after reviewing the QCMC Scanner warehouse module UX. UI source updated through Mac Bridge; no server/storage/data migrations.
- Preserved original `BlankPage.tsx` as `.scanner-inspect/BlankPage.pre-inventory-home-redesign.20261019.tsx` before patching.
- Replaced only the Inventory dashboard JSX in `src/components/BlankPage.tsx`, retaining existing workflow navigation handlers and all other tabs/modules.
- Header now shows actual device name (if saved) and actual Manual/Automatic scanner mode, rather than falsely claiming hardware readiness or an ERP connection.
- Resume Work section lists only available on-device Physical Count, unfinished Warehouse Allocation, and FG Handover sessions. All reference IDs, current location, progress, batch/allocations, timestamps, and status are derived from persisted session data. No illustration sample values were hardcoded.
- Warehouse Operations are shown in a clear 2-column blue-icon card grid: Physical Count, Pullout / Receive FG, Checker, Picker / Warehouse Allocation, Transfer Location, and Issue Stock. Issue Stock remains explicitly Coming soon and retains its existing Coming Soon route.
- Activity & Tools displays Transactions, Profile, and ERP Connection. ERP Connection runs the existing `testErpConnection()` when tapped and displays `Tap to test ERP`, `Testing connection…`, `Last test passed`, or `Connection test failed` depending on actual test state. It never fabricates `Connected to ERP` without a test.
- Styled the redesign with new, scoped rules appended to `src/styles/authenticated-ui.css`: blue/white cards, compact responsive grid, clear CTA, sticky navigation compatibility, 350px and 430px narrow screen rules, focus-visible accessibility, reduced clutter. Kept Inventory/Delivery/Transactions/Profile nav destinations and changed the central control label from `Mode` to `Scan Mode` without changing functionality.
- Removed newly unused dashboard icon imports. Updated the older UI contract Issue Stock casing assertion and added `src/lib/inventoryHomeUi.test.ts` with seven new source contract cases: approved hierarchy, real session metadata, six preserved role destinations, accurate ERP test status, resume/tool actions, responsive CSS, and original bottom navigation.
- The artwork's extra Home/Inventory tab duplication was intentionally not copied: the actual product already has a single Inventory Home destination, and duplicate tabs would confuse operators. Delivery and Issue Stock remain Coming Soon (not represented as functional).
- **Pending:** npm tests, Vite build, Capacitor sync, Gradle debug APK, visual comparison on actual Android scanner and hardware focus smoke tests. Existing installed APK remains unchanged until rebuild/reinstall.

### 2026-10-19 Pullout / Receive FG illustration-based UI redesign
- User approved implementation of illustrated QCMC blue-and-white Pullout / Receive FG mobile screen. Applied ONLY to `ManufacturingScanner.tsx` stages `receive` and `received` via the `is-pullout-redesign` class; Checker, Picker and allocation JSX/logic remain untouched.
- Source backups saved before changes:
  - `.scanner-inspect/ManufacturingScanner.pre-pullout-redesign.20261019.tsx`
  - `.scanner-inspect/ManufacturingScanner.pre-pullout-redesign.20261019.css`
- **Important workflow correction:** existing scanner scans a PACKING-LABEL QR containing the Job Card reference (not a standalone Job Card QR followed by a separate item scan), immediately verifies the Job Card with ERPNext, asks for Big Pack/Loose Pack quantity, then collects required Pull Out Slip and Actual Weight per Item. `createManufactureReceiveDraft` creates an ERPNext Draft Stock Entry ONLINE, not an offline-saved local draft. The illustration's generic `Saved on device`, `Scans`, `Save Draft Entry`, and editable Draft Items interactions were therefore NOT fabricated.
- Added white/navy header with real mode label `Big Pack`/`Loose Pack`, working back action, job-card reference card, job/target-warehouse details when actually known, truthful ERP draft badge, and progress steps `Packing Label → Quantity → Confirm → Draft`.
- Added barcode scan-ready panel only when waiting for a packing label, compact active package mode label, confirmation card with exact ERP Draft Stock Entry ID after success, conditional last draft item display (read-only), and summary of retained ERP Draft IDs, distinct SKUs and quantities with Mixed UOM protection.
- Added inline read-only `Draft Items` list with View all / Show less toggle, using stored handover rows. Editing existing drafts remains Checker workflow. The normal two-button `Add Another` / `Go to Checker` footer remains after draft creation; `Create Draft` stays in the original guarded confirmation form (not a second unguarded submit button).
- Updated Pullout-specific hints to instruct scanning the packing-label QR. Existing scanner event listener, readOnly scan input, hardware focus restoration, package quantity calculation/keypad, idempotency signature, quantity and weight requirements, backend registration, and Checker authorization controls are unchanged.
- Appended responsive, Pullout-scoped blue/white CSS in `src/components/ManufacturingScanner.css`, including 360px narrow-screen layout, short-height compact spacing, inline scroll and sticky footer styling. Did not restyle Picker/Checker pages.
- Harmonized the existing quantity keypad and Pull Out Slip/weight confirmation dialog colors to the same blue-and-white treatment, preserving all existing inputs, actions and modal focus rules.
- Added `src/lib/pulloutReceiveUi.test.ts` (8 static UI contract tests) covering scope, source-derived values, accurate progress, truthful ERP status, UOM sums, preserved draft validation, scanner input and other role isolation.
- **Not tested at runtime:** Mac Bridge exposes file read/write/patch but no shell execution. npm tests, Vite, Capacitor and Gradle build plus real device acceptance are still required before claiming the new APK displays this layout. No live ERP Draft Stock Entries were created during this update.

### 2026-10-19 Checker illustration-based UI redesign
- Applied the approved Checker mobile illustration to real QCMC Scanner code using Mac Bridge. Scope: `ManufacturingScanner.tsx` Checker review and assigned Checker QR scanning stages only, with new `is-checker-redesign` CSS styling. Other manufacturing roles (Pullout, Picker, Warehouse Allocation) retain their existing workflow markup and logic.
- Original TSX/CSS backed up as `.scanner-inspect/ManufacturingScanner.pre-checker-redesign.20261019.tsx` and `.scanner-inspect/ManufacturingScanner.pre-checker-redesign.20261019.css`.
- Replaced generic navy/orange Checker header with approved blue-white header, actual batch ID, Pending Check/Checked status, Warehouse Man, review instructions, and an accurate three-step indicator: Review Items → Scan Checker QR → Handover QR.
- Checker totals derive from the currently retained real Draft Stock Entry rows: distinct Draft Stock Entry IDs, distinct SKUs, and recorded quantity only if every row shares a nonblank Stock UOM; otherwise show Mixed UOM instead of adding unlike units. No image sample IDs or counts embedded in code.
- Each item shows real item name/Stock Entry/Job Card/Pull Out Slip, recorded quantity, editable verified quantity and actual weight, and correction reason when recorded and verified quantities differ. Clicking either editable value invokes the EXISTING `checkerEdit` quantity/weight modal; the original update-to-ERP Draft handlers remain authoritative. Correction reason still updates the existing handover draft state and is validated by `validateCheckerCorrections` before continuing.
- Item display collapses to first 3 rows with `View all (N)` / Show fewer, a clear notice explains that additional items exist. Checker still validates and saves the complete batch, never only the displayed preview. Before online authorization: No changes and Adjusted are NEUTRAL blue, incomplete reason/weight are amber; green Verified is reserved for backend-confirmed Checked state.
- Added compact blue-white item cards, a Draft Stock Entries source-document information panel, a role-specific sticky two-button footer `Back to Batch` and existing `Save & Scan Checker QR`, and `Back to Review` while scanning the authorized QR. `Save & Scan` continues to call `saveCheckerRows`, run ERP validation/update, and then wait for the actual assigned Checker Verification QR; QR scan still performs backend `confirmChecker` and enforces Stock Entry submission confirmation before generating a Picker handover.
- Scoped CSS uses mobile-safe layouts and 360px/short-height breakpoints. Existing read-only physical scanner input, hardware scan event, focus restoration, server-side Checker auth, and postverification Handover QR gating are unchanged. CSS does not restyle Pullout, Picker, or Allocation stages.
- Added `src/lib/checkerUi.test.ts` containing eight source-contract regression cases covering role isolation, real data, UOM safety, controls, QR verification and responsive layout.
- Adjusted the older `src/lib/pulloutReceiveUi.test.ts` Checker-isolation assertion to match the new `isCheckerStage && handover` display instead of the removed literal `stage === "checker" && handover`; Pullout contract protections remain.
- Mac Bridge file edits only; automated npm tests, TS/Vite compilation, Capacitor sync, Gradle APK build, and on-device UI and ERP verification have NOT been run. Do not label the installed APK updated until rebuilt.

### 2026-10-19 Checker entry screen routing UI correction (Update 053)
- Report: after applying approved Checker UI the Android app still showed old Checker. Confirmed root cause in source: Inventory Home uses `startManufacturingRole("checker")`; `resolveManufacturingEntryStage("checker", true)` starts at `batch`, and without saved handover starts at `checker-handover-scan`. The previous design condition `stage === "checker" || stage === "checker-scan"` covered neither initial screen. An APK rebuild/reinstall is also required for any local source edits.
- Extended `isCheckerStage` to include `batch`, `checker-handover-scan`, `checker` and `checker-scan`. Now the actual entry screen gets blue-white Checker header/role status, and the QR-required stage uses the themed Scan Handover QR prompt. The existing batch stage no longer renders duplicate outdated `Handover batch` cards.
- Unified display of actual pending batch entries with the approved checker review cards for BOTH `batch` and QR-loaded `checker` stages, showing batch ID, Draft/Item totals, UOM protection, Job Card, Work Order, Pull Out Slip, verified quantities, actual weight and corrections with View all. Checked batches may show their retained submitted entries read-only instead of an empty review.
- **Preserved important distinct quantity semantics:** in `batch` stage the editor takes `quantityMultiplier` and saves via `saveBatchQuantity` to ERPNext Draft. The QR-loaded `checker` stage edits verified quantities directly and continues through `saveCheckerRows`/`updateCheckedQuantities`. The batch correction reason remains read-only until the separately authorized checker review; no local-only unsaved correction is misrepresented as written to ERP.
- Retained batch `startBatchCheckerVerification` action with a clear `Verify Checker QR` button and `Back` button, while QR-loaded stage keeps `Save & Scan Checker QR` and `Back to Batch`. Both lead to original authorized QR scan and online confirmation; no backend, stock entry submission or permission guard was relaxed.
- Removed now-unused old `batchStockEntries` rendering helper. Updated `checkerUi.test.ts` to check both entry-stage routes and batch multiplier handling, and revised `pulloutReceiveUi.test.ts` stage-scoping assertions to match. Avoided asserting any weight unit: UI now shows `per item` rather than assuming `kg`.
- Source edits only through Mac Bridge. **Automated tests/build have not run; installed APK may still display old UI until `npm test`, `npm run build`, `npx cap sync android`, `gradlew assembleDebug`, and installation.** Device tests must cover both Checker Home entry paths, batch quantity multiplier vs scanned review quantity, server validation and QR permissions.
- Post-refactor source inspection corrected an unclosed JSX disabled expression on the correction-reason input. Compile/test validation remains pending.

### 2026-10-19 Picker / Warehouse Allocation approved UI redesign (Update 054)
- User approved the illustrated blue-and-white QCMC Scanner Picker / Warehouse Allocation mobile UI. Applied to actual Picker stages `picker-scan`, `picker-form`, and `allocation` of `src/components/ManufacturingScanner.tsx` using scoped `is-picker-redesign` styling; not merely a later stage.
- Backups saved before editing at `.scanner-inspect/ManufacturingScanner.pre-picker-redesign.20261019.tsx` and `.scanner-inspect/ManufacturingScanner.pre-picker-redesign.20261019.css`.
- Added white/navy Picker header with existing Back action, real ERPNext allocation/batch reference when known, truthful state pill, 4-step progress `Scan Handover QR → Review Details → Verify Locations → Submit`, and scan-ready panel that appears only when the existing workflow is actually accepting a handover or location QR.
- `picker-scan` remains a Handover QR scan verified via `getPickerContext` and `isPickerReadyStatus`. `picker-form` retains transaction-type, warehouse, date/time and online `createWarehouseAllocation` form/validation; uses blue-white styling and a contextual details card.
- `allocation` view now displays actual `allocation.name`, first pending row's suggested location (not a fabricated/automatically verified location), verified/total row progress, unique SKU count, and line-level **pending** quantity derived from `allocationItemBalances`. A total is shown only if all source balances share a single nonblank Stock UOM; otherwise `Mixed UOM` is displayed.
- New responsive allocation row cards show source item, original and allocated quantities, suggested versus actual location, authoritative verified/pending status and the existing online `openLocationAction("verify", row)` action. Default first 3 rows have a clear `View all` toggle; all rows remain accessible for review or re-verification. Item/source balances remain accessible using an expandable `Item balances & required quantities` section (source document + row remain distinct).
- Bottom dock: `View Allocation Rows` toggles row visibility; `Verify Next Location` calls the existing guarded online location-selection flow when an unfinished row exists; `Complete Allocation` appears as the primary action **only if** `allocationIsReadyToComplete` passes, with the existing guard and `finishAllocation` backend submission unchanged. If all rows are verified but balances are incomplete, completion remains disabled with guidance to review balances.
- Copy intentionally says `Tap Verify Next Location, then scan` before a location action has started; direct scanning is not activated by rendering the card. Row values label `Original Qty` rather than inaccurately calling the original allocation quantity an authoritative required total; authoritative required totals are in the separate balance section.
- Added mobile-scoped blue/white CSS in `ManufacturingScanner.css` for staged header, QR panel, progress steps, KPI strip, allocation cards, responsive two-button action dock, disclosure panels, small-height and narrow-screen rules. Existing QR input, Android scanner event, quantity keypad, capacity validation, From/To restriction, ERPNext row re-fetch and persisted allocation behavior unchanged.
- Added `src/lib/pickerAllocationUi.test.ts` containing 9 static UI contract tests for initial Picker routing, stage fidelity, genuine data, UOM safety, all-row access, balance visibility, QR verification safeguards, completion gating and role isolation. Static Checker and Pullout assertions continue to match the source.
- No APK or ERP records changed. **PENDING:** Vitest, TypeScript/Vite build, Capacitor sync, Gradle assembly and real Android UI/QR verification. Mac Bridge tools for file patching cannot execute these commands.

### 2026-10-19 Transactions and Transfer Location blue-and-white redesign (Updates 055–056)
- Implemented two approved illustrations as source UI changes, not backend changes. Pre-change source and CSS backups for BlankPage, authenticated-ui, LocationTransferScanner and LocationTransferScanner.css saved to .scanner-inspect with pre-tx-transfer-redesign.20261019 suffix.
- Transactions (Update 055): revamped existing Inventory -> Transactions page to white/navy cards, searchable summary receipts, local date/type filters, and Successful / Pending / Failed tabs. Successful comes from existing locally recorded successful Stock Entries and completed allocations; Failed shows existing historical Physical Count submission failures; Pending shows on-device unsubmitted Physical Count entries. Clicking Pending reopens original review, source verification and guarded submit path.
- Tapping Successful or Failed shows a read-only summary with actual stored title, reference, timestamp, route (when present), detail and error (when present). Item/Job Card/weight data not stored in these summary records is never fabricated. Android Back now returns to Transactions list from the detail screen. The filters do not mutate records, and the latest pending timestamp uses a broadly compatible reduction.
- Transfer Location (Update 056): redesigned the actual single-item ONLINE workflow: scan From Location -> Item -> To Location -> enter Quantity using built-in custom keypad -> Confirm Stock Entry. Added a consistent blue/white header, five-step indicator, source/destination summary, available stock, stage-specific scan prompts, guarded review, online-only connection warning and ERPNext-confirmed success receipt.
- The illustration's unsupported Item-first, Batch Transfer, manual entry and simulated item/Stock Entry details were deliberately not implemented. Existing scanner focus, QR parsing, validation of same Warehouse/leaf destination, stock availability, quantity/precision, idempotency request ID, ERP stock-change conflict refresh, Save Successful Transaction and online-only behavior were preserved. Android Back and on-screen Back share the existing route semantics.
- New static UI contract files: src/lib/transactionsUi.test.ts (7 cases) and src/lib/transferLocationUi.test.ts (7 cases). Styling scoped to Transactions and Transfer Location; other Warehouse screens untouched.
- Mac Bridge has file-edit access, not local build execution. Run Vitest, Vite/TypeScript, Capacitor sync, Gradle build and Android on-device checks before treating this as released. Installed APK remains old until rebuilt/reinstalled.

### 2026-10-19 Profile / Settings blue-and-white redesign (Update 057)
- User approved applying the Profile / Settings illustration. Implemented on both actual `profile` and `settings` routes in `src/components/BlankPage.tsx`, styled via scoped `settings-profile-v2` rules in `src/styles/authenticated-ui.css`. Existing bottom navigation, current scanning screens, ERPNext APIs, local scan data and safe confirmation dialogs remain unchanged.
- Source backups before changes: `.scanner-inspect/BlankPage.tsx.pre-profile-redesign.20261019.txt` and `.scanner-inspect/authenticated-ui.css.pre-profile-redesign.20261019.txt`.
- Profile identity card uses authenticated employee name, ID, designation, department, email, company/location, and actual configured device name. Shows only `Signed in`, not a fabricated device-health or scanner-focus guarantee. Real device name edit still invokes existing dialog and `saveScannerDeviceName`.
- Scanner Settings now contains functioning Manual/Automatic quantity-mode selector using existing `selectScannerQuantityMode`, and functioning Big/Loose package-mode selector using the already existing `saveScannerPackageMode` plus `resolveScannerModes`. Loose Pack safely forces Manual; Automatic is disabled while Loose selected. Mode values refresh from stored preferences when reentering Profile. The display explicitly says scanner focus is managed during scanning rather than claiming the scanner is always Ready.
- ERP/Connection shows the actual active ERP URL read-only during authentication (avoids switching servers mid-session; change URL at login), existing live `GET /api/method/ping` Test Connection button, the actual success/error message, network-interface availability (not assumed ERP availability), and the **last ERP test time for the current session only**. The illustration's fake example host and fake Last Sync date were not reproduced.
- Data & History provides Resume Pending Work (goes to Inventory Home to select saved task, or Transactions Pending if orphaned pending Physical Counts exist without a saved session), Saved Transactions (existing Successful/Pending/Failed device receipts), and Clear Saved Scans (existing confirmation and existing `clearSavedScans` path, disabled without local scans or a session). Confirmation copy now accurately states that locally saved scanner counts and Physical Count session are removed while previously submitted ERPNext records remain. No destructive action runs automatically.
- App Preferences lists Notifications as Not available, Sound/Vibration as controlled by the device, and Dark Mode as Coming soon. Deliberately no misleading interactive toggles, fabricated persistence, or inert Save Settings button. Device name and mode changes save when operated. Logout still invokes the original confirmation dialog.
- Added `src/lib/profileSettingsUi.test.ts` with 10 static UI contract checks; updated old Profile expectation in `src/lib/workflowUiContract.test.ts` to the redesigned identity card. Layout is responsive for <=400px and low-height Android handhelds; long ERP URLs/employee names wrap instead of overflowing.
- **Validation pending:** npm/Vitest, Vite/TypeScript build, Capacitor sync, Android Gradle build, actual device visual check, scanner focus regression and ERP ping test. Mac Bridge only edits source and cannot execute local shell commands. The installed APK is unchanged until rebuilt/installed.

### 2026-10-19 Three overlooked entry screens — blue-white UI (Update 058)
- After user sent actual Android screenshots, found three entry stages not covered by previous visual redesigns: Receive Finished Goods **role menu** (`ManufacturingScanner.tsx` `stage=menu`), Checker **backend-issued Handover QR** (`stage=handover-qr`), and Physical Count **Reference / Storage Location setup** (`ScanPage.tsx` `!isScanSessionActive`). User approved applying all three.
- Backups saved before editing: `.scanner-inspect/ManufacturingScanner.tsx.pre-entry-screen-redesign.20261019.txt`, `ManufacturingScanner.css.pre-entry-screen-redesign.20261019.txt`, `ScanPage.pre-entry-screen-redesign.20261019.tsx` (complete ScanPage text assembled, not first-250k truncation), and `ScanPage.compact.css.pre-entry-screen-redesign.20261019.txt`. All original components/logic retained apart from scoped presentation edits.
- Receive FG role selection: new `is-role-menu-redesign` header with real employee/device ID; blue-white role intro; clean Pullout, Checker, Picker cards and chevrons. Original online click handlers `openOnlineStage("receive")`, `openOnlineStage("batch")` and `openOnlineStage("picker-scan")` remain. Checker is still disabled when `checkerActivityAvailable` is false (device has no matching active Drafts). Completed History remains sourced only from `allocationHistory`; users can still open stored completed allocations. Corrected Pullout description to packing-label QR, not unsupported manual Job Card entry.
- Checker Handover QR: added `is-handover-qr-redesign` styling **at the actual stage** (previous Checker UI only styled batch/checker/checker-scan). Styled checker header, correct Pullout→Checker→Picker status, verified notice, actual QR graphic, backend-issued batch ID, Checker name and expiration time when provided. Preserved `canGenerateHandoverQr`, online `syncHandoverBatch`, backend `ensureHandoverQr` and `getPickerContext` checks, unchanged `QRCodeSVG value={handoverQr}` and existing dock `Go to Picker` / `Return to Roles`. QR stays 230px at narrow/short screen sizes and screen scrolls rather than shrinking QR to unreadable size. No screenshot QR token hardcoded.
- Physical Count setup: scoped `is-pcount-setup-redesign` only when `!isScanSessionActive && mode==="pcount"`. White/navy blue header, real employee/device and Back, blue/white Reference→Location→Items stepper, icon-backed current reconciliation/warehouse and validated location cards (single/multi), clear step instruction with selected-location count and scan-ready control focused on the existing hardware scanner input. Existing protected `continueMultiLocationItems`, `startScanning`, disabled Start Items with zero locations, `scanAnotherReconciliation` (New Reference) and `scanAnotherBin` (Change Location) remain. Active Physical Count scanning and review are not restyled.
- CSS appended to `ManufacturingScanner.css` and imported `ScanPage.compact.css`, responsive <=360px/short handhelds. No change to ERP endpoints, QR tokens, Stock Entry submission, physical count persistence, offline queue or scanner business rules. No fake Created By/At metadata, manual QR entry, recent Job Cards, or fake transactions added.
- New `src/lib/entryScreenRedesignUi.test.ts` (10 static contract cases, 78 source-string assertions) covers three actual entry routes, real data/status, role controls, permissions, QR generation, physical counting guards, and CSS isolation. Static preflight matched all 78 strings; automated tests, TypeScript/Vite, Capacitor, Gradle APK and on-device QR/scan acceptance have NOT run.
- Updated the existing Checker UI contract for intentional handover QR stage theming: `isCheckerStage || isHandoverQrStage` still produces the same Checker-styled header. The earlier Pullout and Picker contracts remain intact.

### 2026-10-20 Edit Quantity & Inv Tag — QTY keypad UX (Update 059)
- User requested existing Scan Items pencil Edit Quantity & Inv Tag popup to look and behave like the successful compact QTY popup, without scrolling to Save Changes.
- Preserved complete previous `ScanPage.tsx` in `.scanner-inspect/ScanPage.pre-compact-edit-keypad.20261020.tsx`. Refactored only this editor's presentation and edit-quantity entry; normal scan QTY modal, ERP submission, saved scan history, active Inventory Tag policy and prior physical count UI remain intact.
- New editor reuses `scan-qty-dialog scan-qty-dialog-compact` classes, the **same 4×4 calculator** with digits, decimal, +/−/×/÷, Backspace and Clear, blue selected Big/Loose Pack controls, readonly `inputMode="none"` quantity display (Android numeric IME suppressed), calculated physical quantity preview in actual Stock UOM, and compact Cancel / Save Changes footer visible without modal scrolling on typical screen sizes.
- When operator opens an existing scan quantity, first calculator digit intentionally replaces the initial displayed count; the operator can still Backspace/Clear or start arithmetic from existing count. All calculator operations use `nextEditQuantityKey` on a separate edit state — no changes to scanner main QTY buffer. Edit quantity calculations are parsed with the app's existing safe `evaluateQuantityExpression` and multiplied by original QR Big Pack quantity when appropriate; incomplete/invalid results cannot be saved.
- Inventory Tag remains a text field supporting letters/numbers; Android keyboard appears only when editing the tag. The 4×4 calculator is hidden while that field is focused so the reduced-height keyboard view can keep Cancel / Save Changes visible. Enter/Escape dismisses tag focus; tapping back into the editor restores the calculator. No fake on-screen alphabet keypad was added.
- Existing on-save safety retained unchanged: cannot edit already-submitted transactions, tag required if original nonblank, cross-Item-Code collision guard, submitted source refreshed from storage before editing, local persistence failure handling, local tag correction provenance `inventoryTagEditHistory`, active tag reuse invalidation, pending submission invalidation. Package-status conversion and signed ADD/DEDUCT quantity running count persist.
- Added pure helper `src/lib/editQuantityKeypad.ts` with `editQuantityKeypad.test.ts` covering first-entry replacement, calculator keys, decimal validation, clear/backspace, and prohibited key values. Added `src/lib/scanEditQuantityPopupUi.test.ts` source UI contract, updated `workflowUiContract.test.ts` to reflect new combined compact QTY CSS classes. Appended scoped `ScanPage.compact.css` with 700/450/330px responsive adjustments, no scroll, 4-column keypad and accessible focus styling.
- Source changes via Mac Bridge file tools only. Local automated Vitest tests, TypeScript/Vite build, Capacitor sync, Android Gradle assembly, real keyboard/focus and editing/ERP UI acceptance tests remain pending. Do not use the old APK to validate the new modal; rebuild/install over existing app without clearing saved data.

### 2026-10-20 Big Pack multiplier plus Loose Pack edit (Update 060)
- User clarified that Edit Quantity & Inv Tag must retain Big Pack multiplication (e.g. 52 × actual Item QR quantity), and when Loose Pack is selected its loose units must **add** to the retained Big Pack amount rather than replace it, as in the regular QTY popup.
- Reworked the existing Scan Items transaction editor to keep independent `bigPackCount` and `loosePackQuantity` keypad expressions. Switching between Big Pack and Loose Pack tabs preserves both; first calculator digit replaces the displayed tab quantity as before. A live breakdown displays `Big Pack count × QR pieces per pack = subtotal`, `+ Loose Pack pieces`, and combined physical total in authoritative Stock UOM. Save validation uses the established `evaluateQuantityExpression` plus new `calculateEditedPhysicalCount` (finite, nonnegative), blocks incomplete expressions and applies the sum to the original signed ADD/DEDUCT transaction.
- Example supported: `52 Big Packs × 1000 PCS + 25 Loose PCS = 52,025 PCS`, then operators can return to Big Pack tab, change the multiplier and retain the 25 loose pieces. Big-only and loose-only remain possible.
- The normal QTY popup itself is unchanged; after operator confirms a new QTY scan, `processScan` now receives **optional audit breakdown metadata** `bigPackCount` and `loosePackQuantity`, while total quantity, original QR, validation, counting, offline persistence and ERP submit behavior remain unchanged. Both numbers are saved in optional `LocalScanTransaction` fields and restored via `scanStorage.parseTransactions` on restart. The same breakdown is kept when using multi-location workflow.
- Compatibility: legacy OPENED scans stored only the total quantity; the exact pack/loose split is not recoverable. For these existing records the editor opens with 0 Big Packs and the historical total under Loose Pack, displays an amber warning to verify the split, and does not invent a historical breakdown if an operator only corrects Inventory Tag. Original COMPLETE Big Pack scans derive a full-pack count from original quantity/QR multiplier. Newly saved and edited records reopen with their exact persisted split.
- Original editing safeguards retained: no submitted scan edits, cross-Item-Code Inventory Tag guard, append-only tag-edit correction history, local save failures, signed quantity and running count recalculation, submission queue invalidation, and active-tag reuse invalidation.
- Files updated: `ScanPage.tsx`, `scanStorage.ts`, `ScanPage.compact.css`, `scanEditQuantityPopupUi.test.ts`, `scanStorage.test.ts`; added pure `editPhysicalCountBreakdown.ts` and `editPhysicalCountBreakdown.test.ts`. Pre-change backup: `.scanner-inspect/ScanPage.pre-edit-pack-breakdown.20261020.tsx`. All prior MD history preserved. This fixes the functional behavior of Update 059, not just styling.
- Mac Bridge cannot run local node/Vitest or Gradle; tests and build remain **not executed**. Before release run npm test, npm run build, Capacitor sync, Gradle assembleDebug and on-device acceptance: 52×item-QR +25 loose, switch tab back/forth, reopen saved edit showing 52 and 25, old OPENED scan warning/total preservation, cancelled edit, cross-item Inventory Tag rejection, submitted scan lock and pending offline save.

### 2026-10-20 Edit Quantity immediate Big Pack preview fix (Update 061)
- Fixed a device-reported regression in Update 060: Edit Quantity & Inv Tag displayed an invalid / uncalculated Big Pack total until the operator switched to Loose Pack. Root cause: the original shared-in-component `evaluateQuantityExpression` rejects results <=0, so the untouched `loosePackQuantity: "0"` made the entire combined preview invalid.
- Extracted the safe, precedence-respecting quantity calculator unchanged into `src/lib/quantityExpression.ts` with an opt-in `allowZero` argument (default `false`). The ordinary Scan Items QTY popup continues to enforce positive-only results, while Edit Quantity preview invokes `evaluateQuantityExpression(bigPackCount, true)` and `evaluateQuantityExpression(loosePackQuantity, true)`. Empty individual fields remain treated as zero, and expressions such as `0`, `0.00` and `1-1` are valid components. Negative values, partial expressions, division by zero and nonfinite results remain blocked.
- The existing `calculateEditedPhysicalCount(qrQuantity, bigPackCount, loosePackQuantity)` recalculates on each React edit state change regardless of current Big/Loose tab. Example 52 x 1000 + 0 displays **52,000 PCS immediately** while still in Big Pack; after adding 25 loose it displays 52,025 PCS. Loose-only 0 x 1000 + 25 is also valid.
- Added `src/lib/quantityExpression.test.ts` with six automated unit test cases (zero loose, zero big, add-on, zero-expression, original positive-only behavior, math precedence/errors). Updated existing `src/lib/scanEditQuantityPopupUi.test.ts` to assert each edited component uses allowZero. Existing workflow source-string contracts continue to match (55 popup + 179 workflow assertions checked statically).
- Original `ScanPage.tsx` backed up in `.scanner-inspect/ScanPage.pre-zero-pack-preview-fix.20261020.tsx`. Preserved QR multiplier, Inv Tag conflict protection, correction history, local persistence, and submitted-scan restrictions. No ERP backend or already stored records were changed.
- **Pending before deployment:** run real Vitest, Vite build, Capacitor sync, Gradle assembly, and Android on-device verification. Mac Bridge only edits files and cannot run npm on the user's PC. Do not call this fix device-verified until tests/build and APK install pass.

### 2026-10-20 Transactions inline dropdown filters (Update 062)
- Operator Android screenshots showed the native full-screen selection dialog for Transactions Period and Type; requested compact dropdowns that expand directly beneath the filter fields.
- Replaced `<select>` elements in the existing `src/components/BlankPage.tsx` Transactions view with responsive, anchored, in-page `button` + conditional `tx-v2-dropdown-menu` components. Kept exact choices: Period=All dates/Today/Last 7 days and Type=All types/Physical Count/Warehouse Allocation/Transfer Location. Current choice is rendered in the trigger and indicated with blue checkmark in the open dropdown. The original `transactionDateFilter` and `transactionTypeFilter` states and successful/pending/failed search/filtering remain unchanged; no backend work or local history mutation.
- Only one filter menu can be open at once. Selecting any option closes it and returns keyboard focus to its trigger. Outside touch/pointer and Escape close without changing selection; Android hardware Back closes the expanded menu before leaving Transactions. Opening Transactions or returning Home clears expanded dropdown state. Menus use accessible expanded/controls attributes, focusable option buttons with selected state, a compact 226px maximum-height scrollable list, and responsive 320–360px alignment. Unlike the native select, they never invoke an Android modal picker.
- Scoped CSS appended in `src/styles/authenticated-ui.css`: white panel directly under filter, blue selected state/checkmark, arrow rotation, dropdown shadow, right-aligned Type menu, sensible mobile width/scroll. Other settings' native selects remain untouched.
- Added `src/lib/transactionDropdownUi.test.ts` (five contract tests); updated older `transactionsUi.test.ts` assertions to recognize option arrays and inline dropdown markup. Pre-edit backups saved in `.scanner-inspect/src_components_BlankPage.tsx.pre-inline-dropdown.20261020.txt`, `src_styles_authenticated-ui.css.pre-inline-dropdown.20261020.txt` and `src_lib_transactionsUi.test.ts.pre-inline-dropdown.20261020.txt`.
- Source-level preflight: 10/10 invariants and 61 existing plus 40 new contract string assertions matched. Actual Vitest, TypeScript/Vite build, Capacitor sync, Android APK build, and device dropdown testing have NOT run from Mac Bridge; rebuild/install over current app without clearing local scan data.
## 2026-10-20

### Confirmation-dialog UI refresh
- Updated the shared mobile confirmation-card presentation in `src/styles/authenticated-ui.css`: blue-white compact centered card, restrained scrim, responsive height, readable explanatory copy, high-contrast action buttons, visible keyboard focus and safe-area spacing.
- The shared styling applies to existing Profile/Transactions confirmation cards (including Logout, Clear Saved Scans, and review/resubmit) without replacing their actual handlers or changing ERP submission behavior.
- Improved Logout messaging and changed ambiguous No/Yes controls to Stay logged in / Log out.
- Changed Clear Saved Scans controls to Keep saved scans / Clear scans and marked the irreversible action as destructive red. Previously submitted ERPNext records remain unaffected by this action.
- No underlying scan, Inventory Tag, quantity, local storage, or ERP workflow logic was changed.
- Validation pending: automated tests, build, Capacitor sync and Android APK/device testing were not available from Mac Bridge; the already installed APK will not reflect this update until rebuilt.

### Change documentation policy
- For changes made through this ChatGPT + Mac Bridge workflow, append a summary, affected files, behavior/safety notes and validation status to this `SCANNER_CHANGELOG.md` for every update. Maintain historical entries rather than rewriting old reports.
### 2026-10-20 Quantity popup Clear control
- Fixed main Physical Count Quantity keypad Clear control displaying like plain text by giving it a visible full-width blue-tinted button background, border, rounded corners, minimum 42px touch target, active feedback and focus outline.
- Scoped the strong styling to main Quantity dialog, leaving the separate Edit Quantity & Inv Tag popup's compact Clear button intact.
- Files: `src/components/ScanPage.tsx`, `src/components/ScanPage.compact.css`.
- No quantity arithmetic, Big/Loose Pack multiplier, Inv Tag or Clear click handler changed.
- Source patched through Mac Bridge; npm tests, Vite build, Capacitor sync, APK build and Android physical validation remain pending.
### 2026-10-20 Recount Big Pack and Loose Pack calculation
- Updated Physical Count recount Quantity popup confirmation to use the same Big Pack/Loose Pack arithmetic as Edit Quantity & Inv Tag: full-pack count × the item's scanned QR quantity + loose individual units.
- In Loose Pack mode, the retained Big Pack count is combined with entered loose quantity, including when the Big Pack count is zero. Saved transaction breakdown preserves the pack count and loose units.
- In Big Pack-only mode, the existing `calculatePhysicalPackage` multiplier remains in effect (for example 52 packs × item QR quantity).
- Recount still uses the previously implemented replacement-count correction delta; no change to the ERPNext quantity-difference submission logic or Inventory Tag matching.
- Added `src/lib/recountQuantityUi.test.ts` to assert multiplier and additive breakdown contracts.
- Updated `src/components/ScanPage.tsx`. Automated tests, build, sync and on-device verification remain pending (Mac Bridge does not expose a terminal).
### 2026-10-20 Recount always shows quantity 1 follow-up
- Investigated the actual scanned-item path: `calculatePhysicalPackage` multiplies entered Big Pack count by `pendingItem.qrQuantity`. A generic item barcode with quantity 1 could result in a 1-per-pack count even where the earlier locally saved submitted packing label used a larger pack size.
- In the single-location recount item validation path, if the scanned converted QR quantity is exactly 1 but the matching existing saved entry recorded a pack size greater than 1, reuse that saved pack size for the recount Quantity popup. Show a warning describing the pack size used. Non-recount scans are unchanged.
- Extended the recount UI contract test to check this fallback, and preserved the prior Big Pack × item quantity + Loose Pack calculation.
- Note: this fallback does not prove the user's device issue is resolved. Tests, APK build and on-device reproduction still required; validate a real item with a known packing label and stock UOM, and avoid submitting until the preview is correct.
### 2026-10-20 Recount clarification: existing previously scanned item
- Recount explicitly means correcting an item that has already been physically scanned, not creating another count for a different item.
- Revised the earlier narrow QR=1 fallback: in single-location recount, when the matching existing local item has a valid positive saved `qrQuantity`, always retain its original pack multiplier regardless of the newly scanned code's amount. Warn only when the QR's calculated size differs.
- Recount still computes replacement physical count and correction delta, with retained Big Pack + Loose Pack support. Do not assume a default 1-per-pack from a later generic scan.
- Adjusted recount contract test. Validation, APK rebuild and real device test are still pending.
### 2026-10-20 Recount previous quantity prefill correction
- Root cause: after confirming an existing Inventory Tag, `confirmInventoryTag` unconditionally did `setScanValue("1")` even for recount, so the old physical count was never displayed in the Quantity popup.
- Recount now resolves the matching locally saved Item Code + Location record and calls `getPcountInventoryTagEffectiveCount` for the selected existing Inventory Tag before opening Quantity. If the count is unavailable, the popup does not proceed or silently assume 1.
- Derives the displayed Big Pack count and loose units from the previous quantity and saved per-pack multiplier. Sets the initial Big/Loose mode, retained pack expression and quantity input; status text explicitly shows the old count and decomposition.
- Normal fresh scans retain their previous default-1 behavior. Recount saving still computes replacement quantity and correction delta.
- Added source contract test for recount prefill. Not yet executed in Vitest or Android; rebuild and test before ERP submission.
### 2026-10-20 Android hardware Back exit policy
- Authenticated Inventory dashboard no longer calls `CapacitorApp.exitApp()` when Android Back is pressed at the dashboard root. It shows a brief informational message directing operators to Profile > Log out; navigation and dialog dismissal on other authenticated views remain intact.
- App root `src/App.tsx` now explicitly registers a native Android Back listener for the real unauthenticated Login screen only. Login Back exits the app. The temporary Login UI during saved-session restoration is excluded from exit behavior.
- Existing scan/transfer/manufacturing child component Back navigation is retained, with no change to scanning, local storage, submission, or logout functionality.
- Files: `src/App.tsx`, `src/components/BlankPage.tsx`, `src/lib/androidBackExitPolicy.test.ts`, and this changelog.
- Static source checks prepared; Vitest, Vite build, Capacitor sync, Gradle build and Android device verification remain pending.
### 2026-10-20 Transactions Stored Summary details
- Converted the static Stored Summary section in Transactions > Successful/Failed > receipt detail into a tappable, accessible expand/collapse control.
- Expanded receipt displays real locally stored metadata: transaction ID, document reference, type, timestamp, outcome, existing submission ID where available, transfer route, summary and recorded failure code/message.
- Explicitly notes that this receipt storage contains only summaries, not item-level lines or ERP Stock Entry documents; it does not invent or request missing server data.
- Scoped blue-white mobile styles in `src/styles/authenticated-ui.css`, with accessible focus and expandable chevron. Opening another receipt resets the section to collapsed.
- Updated `src/components/BlankPage.tsx`, added `src/lib/storedSummaryDetailsUi.test.ts`, and appended this changelog.
- Tests, web build, Capacitor sync, Android APK build and device verification remain pending.
### 2026-10-20 Transactions test follow-up — stale Back button assertion
- Operator reported Vitest 553 passed / 1 failed in `src/lib/transactionsUi.test.ts`; the test expected the old direct `setSelectedTransactionDetails(null)` click handler.
- Updated the assertion to the current Back to Transactions handler, which first collapses Stored Summary then clears selected transaction details.
- Added assertions for Stored Summary's accessible expand/collapse behavior. No runtime UI, scanner storage, or ERPNext submission logic changed.
- Mac Bridge patched only the test and changelog. The updated test and full suite have not been executed by this bridge.
### 2026-10-20 Stored Summary item breakdown follow-up
- User reported Stored Summary opens without useful detailed item content. Root cause: successful Physical Count receipts previously stored summary text only; expanding the UI could not display individual rows.
- Extended optional `SuccessfulTransaction.items` in `src/lib/transactionHistory.ts` and `createPhysicalCountTransaction` to preserve per-item location, item code, previous count, adjustment, physical count, UOM and Inventory Tags from already-built successful Physical Count submission entries.
- `src/components/BlankPage.tsx` now displays these actual recorded rows as cards inside expanded Stored Summary. Existing receipts lacking items show an explicit legacy-data notice; no fictional backfill or ERP query.
- Updated responsive card CSS and stale static contract assertions in `transactionsUi.test.ts` and `storedSummaryDetailsUi.test.ts`.
- Does not modify ERP submission payload or clear existing receipts. New successful Physical Count receipts will carry item data; legacy summary-only receipts are unchanged. Automated tests, APK build and device acceptance are pending.
## 2026-10-20 — Intermittently long Physical Count submit loading
- Inspected `ScanPage.tsx`: after upload the app polled ERP status as many as 80 times with 750ms waits plus network request durations. This can hold the loading overlay for a long time if the server remains processing.
- Changed foreground polling to at most 12 status checks with a roughly 30-second deadline between requests. An individual network request or initial upload can still extend elapsed time; this is not a hard network cancellation deadline.
- When ERP still reports nonterminal processing, the popup closes in existing finally logic, pending local count/submission ID stay retained, and a warning says not to submit another copy. The app does not falsely mark completion or silently clear the stored count.
- No ERP background job timing was measured; server latency, request timeouts and any other submission paths need separate profiling. Existing FAILED/NEEDS_REVIEW/COMPLETED branches retained.
- Added `src/lib/pcountSubmitLoadingUi.test.ts`. Tests, Vite build, Capacitor sync and Android verification were not executed by Mac Bridge.
### 2026-10-20 Stored Summary still blank after new submission
- User reported new Physical Count receipt details still blank. Source inspection confirms successful Physical Count creation paths provide entries to receipt snapshots, but presentation relied on an extra `showStoredSummaryDetails` toggle and a clipped card.
- Changed Transactions receipt-detail view to render the Stored Summary metadata and available item cards immediately, without a second nested click or visibility state. No new backend fetch and no assumptions about unrecorded item rows.
- Removed unused summary toggle state and reset statements, updated existing Transactions contract tests, and changed summary card overflow to visible.
- Older receipt records with no `items` remain explicitly marked as summary-only, and new receipt snapshots are displayed only if they actually exist. The exact user's installed APK content and device local storage have not been inspected; this remains unverified pending build and Android testing.
### 2026-10-20 Stored Summary mobile overflow and collapse fix (retry)
- Successfully restored a controlled Stored Summary disclosure in Transactions details, collapsed by default, with accessible expand/collapse button and chevron.
- Opening a different successful/failed receipt resets the disclosure to collapsed; Back also resets it. Existing item breakdown remains inside the expanded section and is not fetched or fabricated.
- Fixed oversized/overlapping item content by preventing flex shrink on detail sections, constraining summary and item cards to card width, using flow-positioned content, and scrolling the Transactions detail viewport. No item count limit or data deletion.
- Updated `src/components/BlankPage.tsx`, `src/styles/authenticated-ui.css`, `src/lib/transactionsUi.test.ts` and `src/lib/storedSummaryDetailsUi.test.ts`.
- Mac Bridge edits saved successfully. Automated Vitest, Vite build, Capacitor sync and Android APK/device acceptance remain pending.
