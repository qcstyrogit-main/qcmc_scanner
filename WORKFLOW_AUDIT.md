# QCMC Scanner Workflow Audit

Date: 2026-10-12
Status: Initial read-only audit; code-level verification and device tests pending.

## Sources inspected
- docs/QCMC-Scanner-App-Workflow.html (dated 2026-09-11)
- SCANNER_CHANGELOG.md (2026-10-07)
- IMPROVEMENT_ROADMAP.md
- src/App.tsx
- package.json and component inventory

## Findings and challenges
1. **Critical: Physical Count ADD/DEDUCT semantics.** The workflow says blind count yet asks operators to choose ADD or DEDUCT. A physical count should normally record absolute observed quantity, not stock adjustments. Determine whether this means increment/decrement of a local tally or actual inventory adjustment. Never let the scanner independently decide ERP ledger variance.
2. **Critical: Offline authorization and concurrency.** The workflow allows offline scans but must enforce count scope, device/session identity, revision checks, and conflict resolution on reconnect. Verify implementation.
3. **Critical: Retry ambiguity.** Stable client transaction IDs are documented, but server-side uniqueness/idempotency must be verified before allowing automatic retries.
4. **High: Resume Work contradiction.** The 2026-10-07 changelog first restores Scan Location after Next Location, then later reopens the latest pending bin in Scan Items. This may inadvertently reopen a completed location. Introduce explicit Continue Counting vs Review Pending; never infer active work from pending uploads alone.
5. **High: Receive FG role separation.** Checker can edit quantity and weight, then submit pullouts. Verify that corrections are attributed, require re-verification, and prevent self-approval where policy requires segregation.
6. **High: Putaway capacity.** Suggested bins must be revalidated against current reservations, capacity, and concurrent allocations on final submit.
7. **High: Transfer Location.** Validate same-warehouse rules, negative-stock prevention, duplicate submits, and source/destination audit history.
8. **Medium: Documentation drift.** Workflow HTML is dated September 11, changelog October 7; roadmap may be stale. Reconcile against code before declaring features complete.
9. **Medium: App.tsx offline session.** App deliberately retains local employee on ERP outage; verify offline authorization expiry and secure local storage behavior.

## Proposed target Physical Count workflow
Assign scope -> Scan location -> Record absolute item quantities -> Complete location -> Review anomalies -> Sync idempotently -> Supervisor approves variance -> ERPNext posts controlled reconciliation -> Lock and audit.

## Proposed target Receive FG workflow
Validate Job Card -> Record production pullout -> Independent checker confirms -> Post approved manufacturing receipt -> Reserve proposed bins -> Picker scans actual placement -> Validate and submit warehouse allocation -> Reconcile any residual or exception.

## Verification backlog
- Trace ScanPage.tsx and ERP service methods for all physical-count transitions.
- Trace ManufacturingScanner components for handover/approval and Stock Entry submission.
- Trace LocationTransferScanner and backend API transaction safeguards.
- Check test coverage and run build/test when permitted.
- Verify ERPNext server implementation; frontend documentation alone cannot establish safety.

## Change policy
- Append an entry to this file for every subsequent audit or implementation update.
- Append actual source changes to SCANNER_CHANGELOG.md.
- Record evidence, risks, decision, test results, and rollback plan.
- Challenge assumptions; do not label untested behavior as correct.

## Update 001 — 2026-10-12
Initial workflow review recorded. No application logic modified. No tests executed.
## Update 002 — 2026-10-12: Stock Reconciliation draft clarification
- User confirmed scanner automatically creates **Draft** Stock Reconciliation, not submitted reconciliation.
- Corrected initial risk statement: creating ERPNext docstatus=0 draft does not itself post stock ledger entries.
- Remaining audit questions: verify actual docstatus and backend calls; draft completeness, zero-count handling, duplicate sessions, variance review, approval permissions, and whether any other linked API submits stock documents.
- Proposed control: operator records observed quantity; supervisor validates draft; authorized ERPNext user submits after reconciliation checks.
- No application logic modified; no tests executed.
## Update 003 — 2026-10-12: Final preliminary architecture assessment
Decision: Conditionally approve workflow design; do not certify production readiness without code tracing and tests.
- Draft Stock Reconciliation is the correct safety boundary if docstatus=0 is enforced and no linked posting occurs.
- Highest verification priorities: offline replay/idempotency, completed-location recount control, Resume Work state, putaway concurrency, transfer atomicity, and role separation.
- Recommended sequence: audit Physical Count source/API, verify ERPNext backend contract, test interrupted sync and duplicate retry, then review Receive FG/Allocation/Transfer.
- Confidence limitation: based on workflow HTML, changelog, App.tsx, package inventory, not full end-to-end source or runtime tests.
- No application logic modified or tests executed.
## Update 004 — 2026-10-12: Physical Count improvement plan
Recommendations (not confirmed defects):
- P0: idempotent upload with server-side unique submission/line IDs; offline durable queue and explicit retry states; safe handling of unscanned vs truly zero-counted items.
- P1: separate location workflow state (active/completed/recount) from sync state (pending/synced/failed); lock completed locations; Resume Work must restore active session only; review/edit before completion; scan-focus and feedback reliability.
- P2: authorized recount and count progress dashboard.
- Keep blind counting and draft-only Stock Reconciliation. Treat ADD/DEDUCT as local tally adjustments, not ledger adjustments.
- Challenge: avoid creating a new draft per scan; decide reconciliation scope based on ERPNext backend semantics and throughput.
- Before implementation: inspect ScanPage.tsx, storage and ERP APIs, and server handlers; create failure-mode tests.
- No application logic modified; tests not run.
## Update 005 — 2026-10-12: ERPNext ownership clarification
- User clarified Stock Reconciliation creation is handled by ERPNext, not by scanner app.
- Corrected prior recommendation: do not add scanner-side reconciliation creation, draft management, or multiple-draft prevention UI without evidence.
- Remaining concern is backend transaction replay and duplicate or overwritten count lines in the ERPNext-managed draft, not necessarily multiple draft documents.
- Verify API behavior: whether QR references an existing draft, server-side uniqueness keys, how count rows are merged, and what happens on lost acknowledgement/retry.
- Maintain ERPNext as authority for draft lifecycle and final submission.
- No source logic changed or tests executed.
## Update 006 — 2026-10-12: Ordered Physical Count implementation plan
1. Read-only frontend/backend workflow audit and test baseline.
2. Transaction integrity: idempotency, replay and count aggregation.
3. Offline queue durability, retries, failure visibility and recovery.
4. Location lifecycle: active/completed/recount, concurrency and authorization.
5. Resume Work exact-state restoration, independent of pending sync.
6. Scanner reliability: focus, first scan, quantity correction and loading states.
7. ERPNext draft validation: zero vs unscanned, permissions, scope and submission boundary.
8. Automated/device end-to-end tests, controlled rollout, rollback plan.
Gate: complete each phase only with passing evidence; preserve ERPNext ownership of Stock Reconciliation. This is a plan, not evidence of implementation. No application logic changed or tests run.
## Update 007 — 2026-10-12: Phase 1 source audit, first pass
Read-only inspected ScanPage.tsx, BlankPage.tsx, pcountSubmission.ts, pcountLocationGroup.ts, offlinePcountCache.ts, package.json.
Verified frontend safeguards: immutable transaction IDs and submitted-ID filtering; saved pending payload and source fingerprint; negative-count and per-transaction running quantity validation; incomplete-location and sync-conflict prechecks; ERP baseline conflict refresh; submitted history removal guard; active location restore state.
Notable risks requiring tests: two submission entry points (ScanPage and BlankPage) may race; localStorage cache failures are silently ignored; backend must enforce idempotency and reconciliation state; offline cached reconciliation has no apparent expiry check in cache loader; multi-location expansion replicates quantities per selected location by design and needs operational confirmation.
Next: inspect erpService submission and scanStorage persistence, backend handlers, tests. No production code modified or tests executed.

## Update 008 - 2026-10-12
Source audit confirmed silent localStorage failures in scanned-item and pending-upload saves. Changed savePendingPcountSubmission to throw on write failure. Other save paths and callers still require review. No tests executed. ERPNext backend idempotency remains unverified.

## Update 009 - 2026-10-12
Applied fail-visible local scan storage writes, protected scan loading from failed repair writes, and caught pending submission save failure in ScanPage before queued state or upload. Automated tests and additional submission paths remain to verify. Not release-ready.

## Update 010 - 2026-10-12
Reviewed History Physical Count submissions. Normal History submission already wraps pending-save in try/catch. Fixed History baseline-refresh resubmission so failed local save resets submitting state, reports error, and prevents ERP upload. Tests not executed; backend idempotency not verified.

## Update 011 - 2026-10-12
Added storage failure regression tests in scanStorage.test.ts for local scan saves and pending Physical Count submissions. Tests not executed. Backend idempotency remains unverified.

## Update 012 - 2026-10-12
Full Vitest report: 391 passed, 7 failed across 4 files. scanStorage tests passed (33/33). Fixed pcountLocationGroup missing ERP Stock UOM fallback: reject missing UOM rather than assume factor 1. Remaining failures: Android response decoding, legacy Inventory Tag baseline, four UI contract assertions. Retest required; no release approval.

## Update 013 - 2026-10-12
User executed npm test -- src/lib/pcountLocationGroup.test.ts: all 16 tests passed, including missing ERP Stock UOM validation. Six failures remain from the prior full suite (Android response decoding 1, Inventory Tag baseline 1, UI contract 4). Full suite not rerun.

## Update 014 - 2026-10-12
Reproduced native ERP response test failure. Existing erpApi.ts already requests responseType text and intentionally avoids unsafe POST replay. Changed native 2xx null body to throw an explicit unknown-status error, updated stale native response test to require one text-mode POST, and added a regression test for empty successful response without replay. Tests pending user execution; ERP idempotency unverified.

## Update 015 - 2026-10-12
User confirmed native ERP response tests 2/2 passed. Investigated legacy single-tag recount returning 30000 instead of 15000: acknowledged snapshot was added to historical scan again when submittedTransactionCount=0. Updated fallback to use acknowledged snapshot without double-counting in this ambiguous legacy state. Retest required. Caution: legacy records lacking submission markers cannot reliably distinguish subsequent pending transactions; follow-up migration/explicit tracking needed.

## Update 016 - 2026-10-12
User verified pcountSubmission.test.ts 36/36 passing, including legacy single-tag acknowledged snapshot regression. Remaining four failures from prior suite are workflowUiContract assertions; full suite rerun pending. Legacy submission-marker ambiguity remains an architectural follow-up.

## Update 017 - 2026-10-12
User ran workflowUiContract.test.ts: 34/38 passed, 4 failed. Supplied pasted output includes only final failure details (UOM conversion source-string expectation at line 235); exact other three failures not yet available. Read current ScanPage and BlankPage: UOM conversion calls exist but one is multiline; loading overlay now uses (loadingOperation || isSubmitting), not old exact assertion. No UI source changes yet; verify expectations before editing.

## Update 018 - 2026-10-12
Fixed BlankPage forcing multi mode despite saved Single preference. Updated four UI contract assertions to reflect current implementation. Awaiting tests and build.

## Update 019 - 2026-10-12
User full suite 398/399 passed; sole failure UI contract missing Big Pack and Loose Pack controls. Inspected BlankPage: menu actually only offered Automatic/Manual despite saved package and location modes. Added Big Pack, Loose Pack, Single, Multi controls with persistence; Loose Pack forces Manual. Build result not supplied; rerun full suite and build required.

## Update 020 - 2026-10-12
User verified npm test: all 29 test files passed, 399/399 tests, zero failures. Build output not yet provided; Android device validation and ERP backend idempotency still pending.

## Update 021 - 2026-10-12
User verified production Vite build succeeded (1619 modules, 2.60 seconds). Non-blocking >500 kB chunk warning. Previously verified all 399/399 tests passing. Ready for Capacitor sync and real Android device testing; no device or ERP integration results yet.

## Update 022 - 2026-10-12
Android white screen reported immediately after login. Added ScannerErrorBoundary around authenticated BlankPage in App.tsx, with visible error details, console component stack, retry/reload actions and no storage clearing. Root cause not confirmed without Android runtime error; requires rebuild, sync, install and device reproduction. Tests/build not run by bridge.

## Update 023 - 2026-10-12
Device error confirmed: `MapPin is not defined` after login. Root cause: BlankPage.tsx renders `<MapPin>` for Single Location mode but omitted MapPin from lucide-react import. Added import. Rebuild, Capacitor sync, reinstall and retest required; not yet verified on device.

## Update 024 - 2026-10-12
Per user request restored bottom Mode menu to Automatic/Manual only. Removed Big/Loose Pack and Single/Multi menu buttons, their unused handlers/imports, and updated workflow UI contract test. Retained saved package/location preferences and ScanPage props/workflow logic. Requires npm test, npm run build and Android revalidation; bridge cannot execute commands.

## Update 025 - 2026-10-12
Restored Single/Multi Location selector inside Physical Count setup in ScanPage, while bottom Mode menu stays Automatic/Manual. Selection persists through scannerPreferences via BlankPage callback. Selector disabled for active group/session to avoid switching during count. Existing From-To range and offline fallback left unchanged. Added scoped styling and UI contract assertion. Bridge did not execute tests/build; device verification required.

## Update 026 - 2026-10-12
Removed mistakenly introduced Single/Multi selector from Physical Count. Removed selector callback and unused BlankPage preference state/imports. Scanner now supplies automatic multi-capable location staging; original reconciliation setup already initializes a multi-capable location group, so one scanned location can proceed to item scanning and scanning a second location enables From-To range. Preserved existing range/offline logic and persisted sessions. Updated UI contract test. Build and Android regression remain pending.

## Update 027 - 2026-10-12
Changed scanner quantity mode default from Automatic to Manual in scannerPreferences.ts for fresh/invalid/unavailable stored preferences. Explicit saved Automatic selection is still honored to preserve user choice. Big Pack default unchanged. Updated scannerPreferences.test.ts with default, persistence and unknown-value checks. Tests/build not run via Mac Bridge.

## Update 028 - 2026-10-12
Fixed Resume Work after Next Location: previously resumed the most recent pending entry's completed location as currentBin and forced step=item, causing new Storage Location scans to be rejected as item scans. Resume now restores Scan Items only for a genuinely active saved location; otherwise restores step=bin with the scanner active/ready and preserves pending entries and reconciliation. Added UI contract regression assertion. Tests/build/device validation pending.

## Update 029 - 2026-10-12
Automatic Physical Count repeated item scan: added inventoryTagReuse.ts to reuse exactly one pending, non-submitted Inventory Tag for matching reconciliation, Item Code, Storage Location and lot. ScanPage.tsx skips repeated Inv Tag prompt and enters automatic quantity processing for ADD scans outside recount, retaining original per-scan transaction/audit and duplicate-tag checks. Ambiguous/multiple tags, submitted tags, cross-location tag collisions, recount and Manual mode retain explicit Inventory Tag confirmation. Added inventoryTagReuse.test.ts regression coverage for reuse, mismatches, multiple tags, submitted/blank tags and cross-location duplicates. Mac Bridge cannot execute tests/build; verification pending.

## Update 030 - 2026-10-12
Added Active Inventory Tag indicator and New Inv Tag (next scan) button to Physical Count Automatic item scanning. Indicator is scoped to last scanned item and current Storage Location; multiple tags are labeled ambiguous. Button arms a one-shot override scoped to location ID and Item Code, so next matching item scan opens Inventory Tag entry instead of reusing the previous pending tag. Previously counted quantities and transactions are untouched; original duplicate Inventory Tag validation remains in confirmInventoryTag. Manual mode, recount, and other workflows are unchanged. Added workflowUiContract.test.ts regression assertions for button visibility, scoped override and automatic/manual scan-step contract. Tests/build/Android verification pending (Mac Bridge has no command execution).

## Update 031 - 2026-10-12
Fixed JSX syntax error in ScanPage.tsx near line 5718 introduced in Update 030: missing closing `}` on the conditional message feedback expression. User reported vite/esbuild `Expected "}" but found "{"` at line 5719. Applied one-character JSX closure fix via Mac Bridge. Build/test execution unavailable through bridge; user must rerun npm run build before Capacitor sync and Gradle assembly.

## Update 032 - 2026-10-12
User Android test: repeated item scan still opens Inventory Tag dialog. Root cause: `ScanPage.tsx` enters the `effectiveLocationMode === "multi"` item validation branch even with just one selected location; this branch unconditionally set `step="invtag"` and bypassed Update 029 reuse logic in the other branch. Fixed single-location group path to call `getReusableInventoryTag` for Automatic ADD with one selected location, matching reconciliation/item/location/lot, honoring one-shot New Inv Tag override and excluding recount. Multi-location groups with more than one location still require explicit Inventory Tag. No historical quantity or transaction mutation. Build, automated tests and Android validation pending.

## Update 033 - 2026-10-12
User confirmed different Item Code in same location must request its own Inventory Tag, and same Item+Location may have multiple tags. Implemented explicit per-session active Inventory Tag memory keyed by reconciliation/location/item/lot in ScanPage.tsx, with a new activeInventoryTag.ts validation helper and activeInventoryTag.test.ts. After a successful single-location ADD transaction, remember its confirmed tag. Repeated Automatic ADD scans reuse only that explicit active tag, even when multiple historical tags exist; New Inv Tag forces entry and successful ADD switches active tag. A different item prompts for a tag; location/reconciliation changes clear memory. Validation checks pending/non-submitted tag, exact item/location/lot and cross-location collisions. Existing duplicate Inventory Tag confirmation and recount safeguards remain. Multi-location groups (>1) still require explicit tag entry. Tests/build/Android verification pending.

## Update 034 - 2026-10-12
Fixed outdated workflowUiContract test assertion for the intentionally fixed multi locationMode prop. User log showed 413 tests passing and one failing. No production behavior changed. Rerun npm test to verify.

## Update 035 - 2026-10-12
Fixed repeated Automatic Inventory Tag prompt after successful count in a single-location group. Root cause: the effective multi-mode transaction path saves expandedEntries and returned without setting activeInventoryTagsRef; Update 033 had only remembered tags in the other single-mode save path. Now, after saving a one-location group ADD transaction, remember its tag keyed by reconciliation/location/item/lot; do not remember recount or true multi-location tags. Added UI contract regression assertion. Build, tests and Android verification pending.

## Update 036 - 2026-10-12
Removed the visible New Inv Tag (next scan) button from the Physical Count active-tag panel at user request. Retained active-tag display and underlying counting behavior. Updated the UI contract assertion. Tests and build not executed by Mac Bridge.

## Update 037 - 2026-10-12
Investigated recurrence of VFP3.5IS50 missing ERPNext Item Stock UOM during Physical Count. Baseline endpoint can omit both stock_uom and uom, causing the strict Update 012 guard to reject scanning. In ScanPage multi-location validation, now query authoritative get_pcount_item_details as fallback when baseline UOM is missing and verify item identity. Preserve failure if both endpoints omit UOM. Fixed getPhysicalCountUomConversionFactor unsafe default 1 for mismatched known UOMs without ERP conversion; updated regression test. No backend API modification; no tests/build/device verification run. Verify ERPNext baseline and Item endpoint responses if error persists.

## Update 038 - 2026-10-12
User clarified missing Stock UOM error occurs on the second scan. Inspected existing-item repeat-scan branch in ScanPage: it used existing.authoritativeUom || existing.uom || item.uom, so old/offline rows with empty UOM could fail before baseline fallback. Added authoritative Item details fallback specifically for existing entries, verified Item Code, validated conversion, and persisted repaired UOM metadata via updateValidatedLocalScanEntry without modifying counts or transactions. Strict rejection remains when ERPNext cannot resolve UOM. Tests/build/device verification pending.

## Update 039 — 2026-10-19: Requested Scan Items improvements
Scope: top location chip scroll, Inventory Tag ownership by Item Code, pending transaction tag editing, Quantity popup keyboard suppression.
- Applied targeted frontend changes; retained existing Physical Count group, scanner handling, counting, and ERP submission code.
- Added correction provenance for Inventory Tag edits and taught scanStorage parser to retain it after restart. ERPNext-side correction audit and uniqueness remain unverified.
- Operator rule: Inventory Tag identifies a single Item Code per reconciliation. Repeated same-item scans and permitted multi-location uses remain valid. Do not impose cross-reconciliation tag uniqueness without confirming business policy.
- The current edit workflow only updates unsent local transactions. Submitted transactions remain locked, requiring a supervised ERPNext correction/recount.
- Risks: local-only uniqueness cannot resolve two counters/devices concurrently using the same tag for different items. ERPNext backend must recheck at submission. Check reconciliation-level submitted history across devices.
- Risk: source UI tests are contract assertions, not real gesture/device tests. Verify Android touch drag through 7+ locations and ensure the Quantity field does not summon the IME while the built-in keypad works.
- Validation status: source modifications and regression tests written; tests, build, Capacitor sync, device and ERP integration NOT executed by bridge.
- Rollback: source pre-update ScanPage snapshot at .scanner-inspect/ScanPage.pre-invtag-updates.20261019.tsx; restore through version control/patches if necessary. Do not clear local offline scans during rollback.

## Update 040 — 2026-10-19: Build evidence and stale UI test correction
- Operator provided a Vitest log: 424 passed, 1 failed in `workflowUiContract.test.ts:24` on a deleted UI action. Vite production build passed (1,621 modules); non-fatal >500 kB chunk warning.
- Determination: the single failure was a test-vs-current-UI mismatch, not evidence of a runtime build failure. Historical behavior had already removed the New Inv Tag button while retaining automatic reuse/fallback tag prompts.
- Corrected the UI contract assertion without modifying ScanPage runtime logic. Do not re-add the removed button just to satisfy an obsolete test.
- Next gate: rerun all Vitest tests and then perform Capacitor Android sync/device checks for all four 2026-10-19 requests. ERPNext backend cross-device tag uniqueness remains unverified.

## Update 041 — 2026-10-19: Android horizontal location strip follow-up
- User device report: all other requested changes work; horizontal swipe in Location Progress remains broken. Device tests 1.1, 1.2, 1.3 could not be completed.
- Verified conflicting CSS cascade in ScanPage: early `overflow-x:auto`, later `overflow:hidden`; later declaration wins, so the initial implementation and test were insufficient.
- Surgically replaced the later `overflow:hidden` with explicit horizontal scrolling and touch gesture rules. Reverted a tentative scanner-focus exemption to preserve existing hidden hardware scanner refocus functionality, especially after touch interaction and on second scan.
- Regression UI-contract assertion now reads every Location Progress strip CSS block (not only the first) and checks the final rule allows scroll.
- No Inventory Tag, transaction editing, Quantity popup, stock calculations, ERP submission or persisted count code changed.
- Static validation only. Gate before release: npm test; npm run build; npx cap sync android; Gradle assembleDebug; install a NEW APK; swipe left/right with 8+ recorded locations and verify scanner focus works immediately afterward.

## Update 042 — 2026-10-19: Make pending transaction Edit popup fully visible without scrolling
- Root issue: the pencil Edit Quantity & Inv Tag popup inherits the generic scrollable `scan-confirm-dialog` with large mobile navigation clearance, long vertical spacing and an auto-focused Quantity input that immediately summons Android keyboard.
- Scoped UI patch: new edit-only modal classes and compact responsive CSS in `ScanPage.compact.css`; arrange Inventory Tag/Quantity inputs side by side, keep all edit controls and the Cancel/Save Changes row visible on standard phone viewports without dialog scroll.
- Removed only the editor's initial `autoFocus`, not its keyboard typing ability. Short viewport CSS keeps Save/Cancel first if the keyboard compresses the screen.
- No changes to persisted counts, Inventory Tag ownership rules, backend ERP payload, submitted transaction locks, quantity calculation, physical count location scroll or scanner focus handling.
- Contract tests added for new DOM structure, no automatic keyboard focus, no modal scrolling, and retention of Big Pack/Loose Pack controls. Tests/build/Capacitor sync and Android screenshots remain unverified.
- Acceptance: pencil → Edit Quantity & Inv Tag dialog shows both fields, Big/Loose controls, preview and Save Changes on opening without scrolling. Test keyboard open/close, 320–430px phone widths, regular/large font settings, successful save and corrected tag persistence.

## Update 043 — 2026-10-19: Approved visual redesign of Physical Count / Scan Items
User approved implementing their supplied illustration. Scope is a deliberate Scan Items visual refresh, not a new scanning backend.
- Modified only `src/components/ScanPage.tsx`, `src/components/ScanPage.compact.css` and `src/lib/workflowUiContract.test.ts`; preserved named ScanPage event handlers, local storage, inventory tag matching, UOM conversion, recount, authorization and ERP service APIs.
- Added `is-pcount-redesign` selector for active Physical Count; no restyling of setup, FG Receive, Picker/Checker, Transfer Location or Qty/Edit modal screens.
- Implemented picture hierarchy: title + return; reconciliation/status; current location; horizontally swipeable progress; ready scanner; active tag; last scan; totals; View/Edit items; sticky two-action dock.
- Operator safety: never label local persistence as submitted to ERP. During Multi Location show selected locations, not a single-location implication. Mixed UOM totals are labeled rather than aggregated numerically. Location finish uses the existing confirmation. ERP Review & Submit keeps the existing incomplete-location guard, queued sync protection and submit routine.
- Interaction change: item history starts collapsed and expands via View/Edit header or dock View Scanned Items. Preserve all original edit/remove/recount actions within expanded history. Next Location/Review & Submit no longer compete side by side while an active location is finishable.
- A full device UX test is required before production: normal/small screens; default collapsed and expanded audit list; physical scanner focus/second scan; restart/offline resume; Automatic vs Manual, Big/Loose Package; Inv Tag per item; Multi Location multiplication; seven-plus location swiping; Finish Location confirmation; pending count review and ERPNext submission. Do not clear any offline count history.
- Mac Bridge offers file read/edit, not a remote command shell. Contract tests were updated but NOT RUN. npm, Vite, Capacitor and Gradle build must be executed locally with results provided for further fixes.

## Update 044 — 2026-10-19: Stale Scanned Items markup assertion corrected
- Evidence: 31 Vitest test files: 30 passed, 1 failed; tests 432 passed / 1 failed. Failing `workflowUiContract.test.ts:123` had `historyStart=-1` due to an old hardcoded `className="scan-panel scan-history"` selector.
- Current ScanPage intentionally has a dynamically expanded/collapsed item-history class. The original grouped items and counted-locations list remain present in the documented order.
- Updated the test to search for `ref={scanListRef} className={`scan-panel scan-history`, with strict increasing source offsets for history -> scanned item rows -> counted locations. No runtime code changed.
- Follow-up: run full Vitest suite and then web/Capacitor/Gradle build if green. Device QA for screenshot fidelity and scanner behavior remains pending.

## Update 045 — 2026-10-19: Completed-count review screen from actual Android screenshot
- User asked to proceed with refinements and questioned necessity of the `Ready to Review` barcode card. Decision: the card is redundant once all physical count locations have been completed; keep Ready to Scan while an operator is actively counting.
- Implemented a UI-only `isPcountReviewStage` predicate based on stored session completion, no active location/group, and pending/queued records. Avoid false green completion on an active, empty or partially complete session.
- Completed screen: smaller green checkmark summary `N/N Locations Completed`; contextual offline/online review text; no redundant barcode panel; no stale post-location `scan more locations` info; location IDs retained and compacted in progress strip.
- Single primary bottom CTA `Review & Submit`. Scanned Items header is still the editable history toggle; dock View/Hide control hidden only while completed. Previously available location finishing, review dialog, negative/unfinished count submission checks, offline/queued submissions and ERP methods remain untouched.
- Manual mode badge shortened; totals show a unit when uniform and `Mixed UOM` when values should not be combined.
- Tests expanded for completion predicate, no barcode panel in review state, stale message handling, single CTA, and full ID accessibility; previous assertion on label/class updated for deliberate UI changes.
- Mac Bridge static source edits completed; automated tests, builds and actual Android device verification still pending. Do not report visual success before new APK is installed and tested.

## Update 046 — 2026-10-19: Reference card width and Scanned Items Select All
- Visual issue: Physical Count reference+offline indicator card width did not reach the same right edge as adjacent location/progress cards. Updated scoped CSS with align-items:stretch, width:100%, max-width:none, margin:0 and border-box sizing on the active Physical Count reference; page-wide safe inset unchanged.
- User workflow: Scan Items → View/Edit → long-press any scan row (550 ms) → existing selection bar now offers Select All, Cancel, Remove Selected. Select All selects unique current-reconciliation pending item/location keys, not ERP-submitted rows. Existing confirmed bulk removal flow and submitted-history safety checks remain.
- Toolbar is sticky/3-column responsive for phone screens. Selection mode continues to be entered only by long press; normal tapping still opens audit details; touching a selection-mode row still toggles its checkbox.
- Bulk selection displays all scan rows, including entries normally beyond the 30-per-group preview, to avoid silently selecting unseen pending records.
- Source files changed: `src/components/ScanPage.tsx`, `src/components/ScanPage.compact.css`, `src/lib/workflowUiContract.test.ts`; appended MD only. Storage persistence, Inventory Tag matching, barcode focus, counting mode, QR quantity, offline queue, ERPNext submission and reconciliation data were not modified.
- Validate: 320–430px device reference card aligns to Location Progress; scrolling Scanned Items keeps Select All available; 1/All/Cancel, Remove Selected confirmation, pending-only selection, submitted protection, no unintended data removal; normal scan input after exiting selection; rerun full unit tests, Vite build, Capacitor sync and Gradle APK build.

## Update 047 — 2026-10-19: Repair orphaned location completion after deleting all scan entries
- Repro: a Physical Count with completed locations, use Scanned Items long press -> Select All -> Remove Selected -> confirm. Local entries disappear; completed session locations remain. Subsequent location scan is rejected as already_counted/cannot be added, despite the absence of local count rows.
- Cause: session persistence and entry persistence were not synchronized in bulk/single deletion flows. Current scan-progress UI may visually hide the now-empty location, masking the stale persisted session.
- Fix: release only *affected completed* session locations with zero remaining local rows for that reconciliation. Do not clear other completed locations, retained submitted audit rows, or in-progress groups. Normalize reference and Location ID case/whitespace. Saved count rows are persisted first, then session state is reconciled.
- Legacy repair on ScanPage mount or Resume Work: detect orphaned completed location markers with no corresponding local entry and release them so older affected sessions are usable after APK upgrade. This does not query or rewrite ERPNext; a cross-device submission must be evaluated separately.
- Post-deletion cleanup: stale 'Load setup' references for freed locations cleared; stale scan-success display and active Inv Tag cache cleared; explicit prompt to scan location again if not already actively counting somewhere else. Existing submitted-transaction guard, scanner focus handling, LocalScanTransaction audit and submit/queue behavior are retained.
- Tests added in pcountLocationGroup.test.ts for last-item removal, partial removal, submitted audit retention, multi-group safety, unrelated reconciliation, old-session repair. UI contract tests cover wiring and rehydration.
- Test/build/runtime not run by Mac Bridge; QA required after rebuilding: delete only item in a completed location, rescan location and recount; delete one of several items and verify still blocked; select all across multiple completed locations then re-add; restart app/Resume Work with previously stuck session; submitted rows are unselectable and previously submitted locations stay protected; normal From–To and offline location scanning work.

## Update 048 — 2026-10-19: Remove duplicate completed-location panel
- Goal: when every Physical Count location is completed and pending for review, avoid large duplicate Location Count and Ready to Review panels. Keep only compact `✓ completed/total Completed` in Location Progress with View all.
- Scope: JSX condition now gates Current Location visual on `!isPcountReviewStage`. Progress header shows a dynamic completed/total summary with green pill. Existing mobile CSS for large completed card retired; no changes to the progress scrolling/chips.
- Safeguards: review-stage predicate and ERP submit dialog remain unchanged. Active scanning still shows Current Location, active tag and scan readiness. Scanner field remains mounted even when visual cards are hidden. No count records, submitted history or other persisted user data were deleted or modified.
- Test contract revised to assert the completion status is in Location Progress and the old completed card is absent. Run `npm test`, `npm run build`, `npx cap sync android`, Gradle assembly; verify an active location screen, completed review screen, 8+ horizontal chips and Review & Submit on Android.

## Update 049 — 2026-10-19: ERP connectivity label and excessive review whitespace
- Reported screenshot: Physical Count completed 14/14, 37 Scanned Items rows, browser shows apparent internet connection yet reference card says `Offline · saved locally`. List ends well above sticky Review & Submit leaving blank space.
- Diagnosis: `isOffline` carries ERPNext request failure signals, not just actual device/network availability; an ERPNext request may fail while `navigator.onLine` remains true. A previous failed request can latch status despite restored ERP access if no further request/online event updated it.
- Fix: display true device offline only when browser reports offline; when connection interface is online but recent ERP transport failed, show `ERP issue · saved locally` instead of claiming the device is offline. Existing background reconciliation-context refresh now clears the failed-request flag on verified success and reasserts it on a network exception; browser online handler no longer resets before checking ERP. Queued uploads and automatic retry behavior remain guarded exactly as before.
- Layout: keep Review & Submit dock visible, and let the expanded Scanned Items panel consume flex surplus in the completed-review viewport instead of respecting 46dvh/410px maximum and leaving blank space. The item list remains internally scrollable; counts, bottom navigation, other scanning modes, pending edits and deletion safeguards unchanged.
- Regression contract assertions added/updated, including status classification, successful ERP refresh, list flex/grow scroll, and primary CTA retention. No user count data or server records touched. Mac Bridge cannot run npm/Gradle; require local test/build and Android verification before declaring complete.

## Update 050 — 2026-10-19: Apply approved Inventory Home blue-and-white illustration
- Scope: Inventory Home display only (`BlankPage.tsx` dashboard branch + `authenticated-ui.css` scoped `inventory-home-v2` rules). No scan transaction, ERPNext endpoint, offline queue, physical-count session, checker approval, or picker allocation business logic modified.
- Backup: `D:\qcmc scanner\.scanner-inspect\BlankPage.pre-inventory-home-redesign.20261019.tsx`.
- Operational mapping preserved: Resume Physical Count -> `startScanner("pcount",true)`; Resume Allocation -> `resumeAllocation`; Resume FG -> `startScanner("in")`; dashboard operations -> existing `startScanner`/`startManufacturingRole`/Location Transfer/Coming Soon; tools -> `openHistory`/Profile/`testErpConnection`.
- UX state accuracy: no fake screenshot reference or timestamp; live locally persisted sessions only. Header shows actual scanner quantity mode rather than claiming scanner connectivity. ERP tile displays last connection-test outcome only; no arbitrary green `Connected to ERP` status.
- Operator clarity: Resume Work first when saved tasks exist; next Warehouse Operations with six distinct blue-white cards, including clearly labeled Issue Stock Coming Soon; last Activity & Tools and a contextual hint. Bottom nav stays the established 5 destinations with a clarified Scan Mode label, never adds a redundant Home tab.
- QA gates: small screen 320/350/360px, normal Android handheld 390–430px, longer employee/device names, zero/one/multiple resumable workflows, offline saved-count and active location display, scanner modes and picker/checker role routes, Issue Stock/Delivery Coming Soon, Transactions/Profile routing, ERP Connection test fail/success states, focus retention after navigating, no page overflow, and adequate touch-target sizing.
- New `inventoryHomeUi.test.ts` plus updated `workflowUiContract.test.ts` exercise display contracts only. Mac Bridge edits are saved but npm/Vitest/Vite/Capacitor/Gradle have NOT been executed; run them before releasing.

## Update 051 — 2026-10-19: Pullout / Receive FG blue-and-white UI approval
- Approved illustration translated into actual existing Pullout receiving workflow rather than inventing extra backend stages or offline queues.
- Scope limited to `ManufacturingScanner.tsx` receive/received UI and new scoped `ManufacturingScanner.css` rules. No API contracts, stock calculations, handover persistence, authorization, Checker QR, Picker Warehouse Allocation, or downstream workflow handler logic changed.
- Operator sequence retained: packing-label QR (contains Job Card) -> server Job Card validation -> quantity keypad (Big/Loose) -> confirm Pull Out Slip and positive actual weight -> ERPNext Draft Stock Entry create/register -> Add Another or Go to Checker. New progress stepper represents these phases visually. Do NOT show `Saved on device` as if an unsent Pullout draft were available offline.
- New summary cards use locally retained SERVER-ISSUED Draft Stock Entry references only, with distinct draft and SKU counts, Stock UOM safety, optional last Draft Item and read-only expand/collapse. No fabricated data/sample Job Card or fake editable Draft action.
- UX keeps existing scanner focus and custom keypad, with layout compact on narrow/short Android screens. Original 3-role Pullout→Checker→Picker workflow progress is displayed only outside Pullout stages; existing Checker and Picker screens remain identical.
- Pullout quantity and confirmation modals received blue/white visual accents only; all existing form requirements and modal focus paths retained.
- Backup pre-change TSX and CSS kept in `.scanner-inspect`. Contract-only `pulloutReceiveUi.test.ts` added with 8 cases. No automated tests/build/Android validation have run.
- QA: correct packing label QR scan on Android; verify no extra scan required after validation; Big Pack and Loose Pack quantities, Cancel/Review keypad, Pull Out Slip/Weight requirements, duplicate scanner input, idempotent Create Draft, Stock Entry Draft ID, no auto submission or putaway, Add Another, Go to Checker, connection failure, draft list expand, UOM combinations, device screen 320–430px, hardware scanner focus after modal and ERP failures. Verify ERP Draft created once only.

## Update 052 — 2026-10-19: Checker blue-and-white mobile review redesign
- User approved earlier Checker illustration and asked to apply it. Scope: Checker review (`stage=checker`) plus QR scanning (`stage=checker-scan`), styled by `is-checker-redesign`; not a business-process rewrite.
- Preserved actual sequence: Pullout Draft Stock Entries → Checker reviews recorded qty/actual weight → optionally corrects quantity and supplies reason → `updateCheckedQuantities` saves review to ERPNext → assigned Checker scans QR → `confirmChecker` verifies authority and successful linked Stock Entry submission → only then may Handover QR be generated / Picker Allocation proceed.
- The illustration's data and some implied statuses cannot be assumed. All counts and IDs are dynamic, never fake sample values. Verified means backend CHECKED only; plain No changes or Adjusted remain neutral. Cannot claim a row is independently reviewed merely because its values match. Corrections needing reason/weight are visually amber and still validated by existing backend/validation logic.
- Stats: Draft Stock Entry distinct IDs, SKU distinct item codes, and recorded unit sum only for a single nonblank UOM. Mixed UOM makes units non-additive. Actual weight is per item, not a grand total.
- Existing quantity/weight edit modal, persistence, source-doc change handling, required correction reason, prevention of edit after CHECKED, and QR hardware capture remain untouched. All Handover/Checker authentication and ERP Draft update methods still used.
- Review list shows first 3 rows with explicit View all (N) action; all rows are still included in validation and ERP submission. Source-document note and two-button Back to Batch / Save & Scan QR footer added; QR scanner stage gains Back to Review without circumventing verification.
- Backups: `.scanner-inspect/ManufacturingScanner.pre-checker-redesign.20261019.tsx`, `.scanner-inspect/ManufacturingScanner.pre-checker-redesign.20261019.css`. Code changes: `src/components/ManufacturingScanner.tsx`, `src/components/ManufacturingScanner.css`, new `src/lib/checkerUi.test.ts`.
- Existing Pullout UI contract assertion updated for Checker stage scoping; all other Pullout protections retained. Checker test source checks were statically preflighted against markup but have not been run with Vitest.
- QA before production: npm/Vitest, Vite/TypeScript build, Capacitor Android sync, Gradle debug assembly. Test 1/3/12+ draft items, mixed UOM, quantity correction requiring reason, positive weight, save / ERP rejection, stale-source refresh, verified read-only, Back to Batch, assigned Checker QR scanning including denied QR, Handover QR access only after successful authorized submission, Scanner focus and small-screen UI. Mac Bridge cannot execute build/tests, so runtime result is still unknown.

## Update 053 — 2026-10-19: Fix redesigned Checker not visible on Home entry
- Source evidence: Inventory Home invokes `startManufacturingRole("checker")`; `resolveManufacturingEntryStage` returns `batch` when a device handover exists and `checker-handover-scan` otherwise. Update 052 styled only `checker` and `checker-scan`; this missed BOTH Checker entry views and left old `Handover batch` UI visible to operators.
- Visual patch now scopes to `batch`, `checker-handover-scan`, `checker`, `checker-scan`. Replaced old batch JSX with shared Checker review layout (without changing underlying batch editor, draft update functions or QR confirmation) and themed the Handover QR intake state. New header appears immediately when entering Checker from Inventory Home.
- Batch quantity values remain multiplier-based in editor and route to `saveBatchQuantity`; QR-loaded Checker review quantities use physical verified-quantity editor. Existing `startBatchCheckerVerification`, `saveCheckerRows`, `confirmChecker`, backend stock-entry submission checks, verified-only handover and Picker gating remain unchanged. Correction reason read-only on local batch, editable in Checker review; verified state only after actual backend status.
- Maintains multi-item View all, Draft/source refs, stock UOM safety, checked-batch history rows. Generic weight UI does not invent units. Existing Checklist/Pullout regression contract adapted for intentional stage scoping.
- No shell command execution in current Mac Bridge connector. Source-level review is not a passing Vitest or APK build. Required: run npm tests and build with logs, sync Capacitor, compile/install APK, then test entry with/without local handover and compare screenshot. Do NOT clear local app data: it stores pending warehouse work.

## Update 054 — 2026-10-19: Picker / Warehouse Allocation illustration applied
- Implementation limited to the `ManufacturingScanner` Picker UI stages `picker-scan`, `picker-form`, and `allocation`, plus scoped CSS and source contract test. The original manufacturing APIs, Handover QR authorization, Checker gates, quantity/capacity validation, stock entry permissions, transaction history, local resume and submission handling are retained.
- Entry from Inventory Home is `resolveManufacturingEntryStage("picker", ...)` → `picker-scan`; the UI redesign covers this actual entry, the ERPNext transaction details form, and the active allocation screen so users see the new theme immediately.
- Authoritative data: display actual `allocation.name` or handover QR batch; suggested location from first not-yet-verified ERP allocation row; progress from server row statuses; unique SKU set; pending quantity from `allocationItemBalances` grouped by source document, row, UOM and target warehouse. Never sum incompatible units. Row detail differentiates `Original Qty` from required source totals and shows unverified actual location as unscanned.
- Safety: scanning a suggested location does NOT mark it verified; operator must select Verify Location/Verify Next Location, scan the actual QR, enter positive quantity, pass capacity/over-allocation limits and confirm via ERPNext. Existing update/refresh, duplicate prevention and `allocationIsReadyToComplete` gate remain. `Complete Allocation` is not available until every location is VERIFIED and each source-line required quantity fully allocated; a disabled state explains unresolved balance.
- UI includes both row preview and View all toggle plus optional full item-balances panel; hidden rows are never excluded from backend completion validation. Back and scanner focus preserved. `picker-form` still requires transaction type, Warehouse and Date; no offline allocation submission is implied.
- Preserve Checker/Pullout: separate `is-picker-redesign` CSS only, no changes to their respective role UI or API methods. Source backups: `.scanner-inspect/ManufacturingScanner.pre-picker-redesign.20261019.tsx` and `ManufacturingScanner.pre-picker-redesign.20261019.css`.
- QA: run npm/Vitest and Vite build, sync Android Capacitor, assemble APK, and verify on device: Picker initial QR screen; authorized and unauthorized Handover QR; transaction form; allocation with 1/3/10+ rows and multiple source lines; scrolling/View all; suggested vs actual location; manual quantity and wrong warehouse scans; capacity overflow; pending/mixed UOM balances; no scanning until Verify; resume unfinished allocation; ready vs incomplete final submission; Checker and Pullout regression. Runtime NOT yet tested.

## Update 055 — 2026-10-19: Transactions
- Changes: existing BlankPage.tsx history UI and authenticated-ui.css scoped styles only. Search and period/type filters operate on local receipt data; success/failure history is not rewritten. Pending tab uses existing locally pending Physical Count entry grouping and opens the original guarded audit/review/submission screen rather than adding unauthorized retry.
- Details screens show only stored transaction summary fields and explicitly direct users to ERPNext for item-level records not present on the phone. Android Back closes details before leaving screen. Do not infer all server ERP transactions from on-device logs.
- Backup: .scanner-inspect/BlankPage.tsx.pre-tx-transfer-redesign.20261019.txt and authenticated-ui.css.pre-tx-transfer-redesign.20261019.txt.
- Test cases added in src/lib/transactionsUi.test.ts; full npm/Android runtime testing pending.
## Update 056 — 2026-10-19: Transfer Location
- Changes: LocationTransferScanner.tsx and LocationTransferScanner.css layout only. Preserves actual single-item online scanner steps Source Location, Item QR, Destination Location, Quantity, Review/Confirm. Five-step UI and From/To summary match actual workflow rather than the illustration's Item-first or unsupported Batch Transfer.
- Verified source/target warehouses, QR decoding, leaf restrictions, available stock, precision, idempotency request IDs, revalidation and backend Stock Entry confirmation not bypassed. Custom numerical keypad and hardware scanner focus maintained. No offline transfer queue; connection error and Retry remain.
- Back button uses shared goBackStep on both Android hardware Back and visible header. Success screen uses real Stock Entry response.
- Backups: .scanner-inspect/LocationTransferScanner.tsx.pre-tx-transfer-redesign.20261019.txt and LocationTransferScanner.css.pre-tx-transfer-redesign.20261019.txt.
- Test cases added in src/lib/transferLocationUi.test.ts. Need npm test, Vite/TypeScript compilation, Capacitor sync, Android APK build and device tests with scanner focus, invalid location/quantity, online/offline behavior and ERP record confirmation.

## Update 057 — 2026-10-19: Profile / Settings approved UI applied
- Scope: replace old Settings-only presentation shared by `profile` and `settings` routes with blue-white 5-section Profile & Settings screen. No ERP or stored count mutation. Back goes to Inventory; bottom nav preserved.
- Employee identity uses actual signed-in Employee fields; role/department/device are sourced from session and scanner storage. No artificial sample employee, login ID, domain, sync timestamp, hardware Ready status or fake successful ERP state.
- Functional Scanner Settings: Device Name launches previous protected dialog; Quantity Mode Manual/Automatic uses existing persisted mode policy; Package Mode Big/Loose persists through scannerPreferences and forces Manual when Loose. Reentering Profile reloads the stored preference values. No unsupported mode is enabled.
- ERPNext URL displayed from active connection configuration, read-only while authenticated to prevent cross-server session/token confusion. The existing connection test pings the actual configured server; timestamp is written only after an attempted real test, and network interface availability is reported distinctly from ERPNext reachability. An internet-connected phone may still fail to reach ERPNext, as observed in earlier wrong-URL incident.
- Pending Work routes to Home to choose saved Physical Count, Handover, Allocation or to Transactions Pending when orphaned pending count entries exist without a resumable session; saved transaction shortcut opens original local summary receipts. Clear Saved Scans runs only via the previously existing confirmation and storage cleanup path, never on render; explicitly warns that local unsubmitted scans are lost. Existing ERPNext submitted records remain intact.
- Illustration limitations: scanner focus does not have an honest global diagnostic; status is explained rather than falsely Green/Ready. Notifications, scan Sound/Vibration, Dark Mode and Last Sync have no verified settings/persistence in current project, so they are shown as informational/unavailable; there is no decorative Save button pretending to change backend or local behavior.
- Source files: `src/components/BlankPage.tsx`, `src/styles/authenticated-ui.css`, new `src/lib/profileSettingsUi.test.ts`, updated existing `src/lib/workflowUiContract.test.ts`. Pre-change backups in `.scanner-inspect`.
- Before release: run npm test, npm run build, Capacitor sync/Gradle APK build; test Profile via Inventory nav, 320–430px widths, long names and URLs, amount of saved work, Manual/Automatic/Big/Loose consistency after reopening, ERP test success/failure while online and offline, navigation to Transactions Pending and Inventory Resume, clear-scans Cancel and explicit Confirm, logout Cancel, no data loss from opening screen, and other modules' scanner input focus. Mac Bridge cannot run these tests.

## Update 058 — 2026-10-19: Three missed entry screens (Receive FG menu, Checker Handover QR, Physical Count setup)
- User-provided device screenshots showed older UI from distinct stages not previously redesigned. Audited actual React route conditions and patched those exact branches. No new mode/role/permission/ERP business workflow added.
- Receive FG menu: `stage=menu` displays a role selection list, selected operator/device identity and completed allocation history. `checkerActivityAvailable` still gates Checker when no local eligible Drafts exist; Pullout/Picker still enforce online connection via `openOnlineStage`. Navigation remains on the original handlers, not fake illustration buttons. Historical allocations originate from saved history only; no phantom Stock Entries.
- Checker Handover QR: `stage=handover-qr` only when existing backend permission, signed QR, `getPickerContext` and `canGenerateHandoverQr` allow it. The source `handoverQr` is unmodified, `QRCodeSVG size=230 marginSize=2` preserved for readability; backend batch, Checker, expiresAt are real and optional. Go to Picker and Return to Roles preserved. Visually green checks only reflect this already-verified handover stage, not unverified Checker review.
- Physical Count setup: `!isScanSessionActive` and mode=pcount shows reference, current validated location(s), real reconciliation warehouse, and 3-step progression. Newly styled "Ready to Scan Location QR" focuses the existing physical scanner input; does not pretend to open a camera or bypass QR validation. Items still require selected validated location and existing Start Items actions. New Reference/Change Location preserved. No active scanning stage touched.
- Pre-edit backups in `.scanner-inspect`: ManufacturingScanner.tsx/CSS, full ScanPage.tsx and ScanPage.compact.css. New `entryScreenRedesignUi.test.ts` with ten UI contracts. First static preflight of 78 source-strings found zero mismatches; style files' braces balanced. Runtime Vitest/TypeScript build not run (Mac Bridge has file operations only).
- QA before deployment: run complete npm test and npm run build; sync Capacitor, Gradle compile, install APK as upgrade without clearing data. Verify Receive FG role chooser with Checker enabled/disabled, Pullout opening real packing-label QR scanning, Picker Handover QR acceptance, completed allocation history; Checker Handover QR scanned by another device, expired QR handling, QR visually scannable at 320/360px; Physical Count setup reference scan, Storage Location scan, 0/1/multiple selected locations, item start disabled without location, from-to range, Change Location/New Reference and scanner focus. Inspect screenshots and keep offline pending counts before/after install.

## Update 059 — 2026-10-20: Compact Edit Quantity & Inv Tag calculator
- Scope: active Physical Count Scan Items history pencil editor. Quantity input switched from Android decimal keyboard to readOnly, inputMode none with the exact 4-column in-app QTY keypad and arithmetic expression preview. Tag input remains ordinary editable alphanumeric with native text keyboard; calculator temporarily hides while tag field focused to give IME space. Cancel / Save stay at bottom without modal internal scroll. Compact style based on the existing Quantity dialog, not a wholly different screen.
- New pure quantity-key state transition in `editQuantityKeypad.ts`; separate React edit buffer `editQuantityFresh` and text focus `editTagHasFocus` state keep scanner scan input and main Quantity modal unaffected. Source transaction edit validation, QR multiplier, Big/Loose package conversion, ADD/DEDUCT signs, transaction audit, original submission restrictions and local persistence remain. Number expressions validated by existing `evaluateQuantityExpression` before commit; invalid calculation disables save.
- Backend risks unaltered: local Inventory Tag uniqueness is per device/reconciliation; an ERPNext server-side validation is still advisable for cross-device collisions. Editing a submitted scan stays impossible via UI.
- Backed up full `ScanPage.tsx` as `.scanner-inspect/ScanPage.pre-compact-edit-keypad.20261020.tsx`. Updated `ScanPage.tsx`, `ScanPage.compact.css`, `workflowUiContract.test.ts`, and added `editQuantityKeypad.ts`, `editQuantityKeypad.test.ts`, `scanEditQuantityPopupUi.test.ts`.
- Manual QA required after npm/Vitest, npm build, Capacitor sync and Gradle APK: edit a Big Pack Qty, type new numeric via keypad (first key replaces existing), arithmetic (multiply/divide), decimal, Backspace, Clear, invalid partial expression (Save disabled), switch Loose/Big, edit text Inv Tag using Android keyboard, tap Done then Save without scrolling, cancel without persistence, verify tag uniqueness, ensure submitted scans cannot edit, reopen and verify running-count and audit persist. Test shorter 320×568 Android device while IME open and normal 360×800.

## Update 060 — 2026-10-20: Big Pack multiplier retained when editing Loose Pack
- User required the Edit Quantity & Inv Tag popup to replicate Quantity popup cumulative formula: total = (Big Pack count × ITEM QR units/pack) + Loose Pack units. Earlier editor switched interpretation of a **single** value, dropping Big count when Loose was entered; fixed by independent persisted expressions, safe live total calculation, and unchanged physical count submission processing.
- On edit Save, the authoritative QR quantity is used as multiplier (not a hardcoded Item/UOM). Pack status is OPENED only when loose units >0. Edited transaction retains sign, update of Running Qty, Inventory Tag conflict protection, and local audit trail; Save remains blocked when calculation invalid or transaction already submitted.
- Normal QTY scan now optionally passes the actual Big and Loose split into `processScan` so future edits accurately reconstruct the original values; scanStorage reads both optional numeric fields from local storage. Original package quantity and Stock UOM remain unchanged, and ERPNext payload behavior is not altered.
- Legacy OPENED scans cannot be mathematically decomposed uniquely from a total. They display a warning and initial 0 Big + original total Loose pending user correction. On an Inventory Tag-only correction, do not persist fabricated split metadata. Legacy COMPLETE scans may derive Big Pack count as total divided by actual QR pack size.
- Pure breakdown tests cover exact example 52×1000+25=52,025, fractional stock units, zero-only values, invalid values, saved mixed reconstruction and legacy fallback. scanStorage tests validate round-trip of both saved numeric components and that older records remain unsplit.
- Pre-edit full source backup: `.scanner-inspect/ScanPage.pre-edit-pack-breakdown.20261020.tsx`. UI and tests changed in project; Mac Bridge file tools do not run npm/Gradle. Test device cases: Switch Big→Loose→Big; change Big after adding Loose; decimal/arith keypad; update Inv Tag only on old unsplit scan; Cancel; confirm cumulative total on physical count review and after Android restart; verify ERP Stock Reconciliation submission with correct sum; check narrow screen Save button visibility.

## Update 061 — 2026-10-20: Immediate Big Pack preview with zero Loose Pack
- Regression observed by operator: Edit Quantity & Inv Tag did not calculate until Loose Pack tab was visited. Cause confirmed in source: the popup evaluated both Big and Loose fields with a positive-only expression parser; default `"0"` loose field caused validation failure and whole preview became NaN. Switching tabs and entering positive loose value hid the issue.
- Fixed by extracting scanner calculator to pure `lib/quantityExpression.ts` and allowing `allowZero=true` **only for edit-pack components**. Original Quantity popup and scanner input still require a positive quantity. Combined formula remains `(Big Pack count x actual Item QR multiplier) + Loose Pack units`; it now updates as soon as Big count changes, without switching tabs or entering loose units.
- Separate Big/Loose persisted fields, calculator keypad, on-device audit, original ERPNext submission checks and tag uniqueness validation are untouched. Legacy unsplit warnings retained. Negative/incomplete expressions and division by zero are still rejected.
- Six unit cases added for zero Big and/or zero Loose plus arithmetic and default strict semantics; updated popup UI contract. Source preflight verified 55 popup assertions, 179 existing workflow assertions and other direct invariants; Vitest/build/handset not yet executed.
- Pre-fix full backup: `.scanner-inspect/ScanPage.pre-zero-pack-preview-fix.20261020.tsx`. QA: edit original Big-only count, enter 52 with 1000 per pack and untouched Loose=0, observe 52000 immediately; switch to Loose=25, observe 52025, return to Big, change number, verify 25 remains; attempt zero Big and positive Loose; reopen and verify persists; cancel without changes; confirm no keyboard/focus regressions.

## Update 062 — 2026-10-20: Transactions Period and Type inline dropdown
- Actual Android screenshot from Transactions: tapping Period/Type HTML native select launched a large centered OS radio-selection dialog obscuring list. User requested a small dropdown instead. Replaced only those select widgets with React-controlled menus anchored to their fields and app-standard blue/white styling.
- Functional semantics preserved: `transactionDateFilter` (all/today/week), `transactionTypeFilter` (all/physical_count/warehouse_allocation/location_transfer), search input, status tabs and source-limited successful/failed/pending transaction lists. New menu state is ephemeral, does not change stored records, and closes on selection/outside tap/Escape/Android Back/reopening Transactions.
- Accessibility: button shows selected human label, exposes aria-expanded and aria-controls; option buttons use aria-pressed; selected item has blue checkmark; focusing returns to trigger after choice. Small Type panel aligns to right, scrolls if needed without OS modal. Sibling dropdown closes when opening the other.
- Changed `src/components/BlankPage.tsx`, `src/styles/authenticated-ui.css`, `src/lib/transactionsUi.test.ts`; added `src/lib/transactionDropdownUi.test.ts`. Backups of original files stored in `.scanner-inspect/*pre-inline-dropdown.20261020.txt`.
- Static preflight passed but npm/Vitest, Vite/TypeScript, Capacitor/Gradle and Android UI checks are still pending. Test on the actual scanner: tap Period, menu under button; choose Today and list filters; reopen/switch to Last 7 days; tap Type, 4 choices shown beneath Type, choose Physical Count; touch outside, press Android Back, reopen and confirm menu closes without leaving page, check no full-screen Android selection dialog; verify small screen width and both filters combined. Do not uninstall app/clear local data.


## Update 063 — 2026-11-05: Physical Count Manual Item Entry and offline item catalog
- User requested searching ERPNext Item by Item Code or description without scanning an item QR. ERP count supplied: 44,495 enabled items; approximately 2.19 MB raw text. IndexedDB footprint is higher.
- Added `src/lib/itemCatalog.ts`: IndexedDB catalog scoped by ERP URL; authenticated, paginated Frappe Item API sync (500 per page); modified-timestamp incremental refresh; disabled item removal; periodic 24-hour refresh plus explicit Sync Items button.
- Added `src/components/ScanPage.tsx` Manual Item Entry modal with local item-code/description search, stock UOM, explicit units per Big Pack (1 means stock-unit counting), and safe handoff to original `processScan` validation/Inventory Tag/Quantity flow. Manual entry is disabled until an active Physical Count location exists. Supports offline lookup from previously synchronized catalog and native Back cancellation.
- Added `src/components/ScanPage.compact.css` mobile modal styling and `src/lib/itemCatalog.test.ts` search/source contract tests.
- Safety: ERPNext still validates the baseline when online, preserves offline queue and submission checks, and remains authoritative for physical-count posting. No assumption about package conversion from text description. Catalog is separate from pending scans and cannot erase them.
- Limitation: Item read permission for the scanner account on the standard ERPNext Item resource API is unverified. If blocked, add a scoped authenticated bulk Item catalog endpoint in qcmc_logic on the ERPNext server.
- Verification pending: TypeScript and Vitest, ERP permissions, first 44,495-item sync, incremental disabled-item removal, offline search, real-device UI/keyboard/focus, QR regression, multi-location and recount, and ERP submission. Do not clear app data or uninstall before preserving offline scans.


## Update 064 — 2026-11-05: Restricted ERPNext Item Catalog backend
- Created `apps/qcmc_logic/qcmc_logic/api/item_catalog.py` in local WSL ERPNext v16 `/home/qcmc_admin/frappe-bench`. Whitelisted POST endpoint `qcmc_logic.api.item_catalog.get_items` requires authenticated ERP session or valid mobile device token, enabled user, and Role Profile warehouse list-view access. Guest/invalid token/no warehouse access rejected. No general Item DocType Read permission granted.
- Endpoint returns only `name`, `item_name`, `description`, `stock_uom`, `modified`, `disabled`; no pricing, balances or valuation. Pagination capped at 500, ordered by (modified, name) cursor with fixed upper bound. Initial sync returns enabled items; incremental changes include disabled-item tombstones. Endpoint is read-only.
- Updated Android `src/lib/itemCatalog.ts` to POST through existing `erpRequest`, including the mobile token, since watermark and stable cursor. Removed generic `/api/resource/Item` access. Uses existing IndexedDB catalog and 24h sync logic; no automatic grant of Item Read.
- Added `apps/qcmc_logic/qcmc_logic/tests/test_item_catalog.py` and updated `src/lib/itemCatalog.test.ts` for endpoint contract.
- Status: files written to local WSL backend + Windows scanner; TypeScript, Vitest, Python Frappe test, bench reload and true mobile token permissions have not been run or verified. The user must ensure the Android app's ERP URL points to the ERPNext instance containing this new endpoint. Do not deploy to production or grant elevated permissions without integration QA.
- Acceptance: authorized scanner sync downloads all ~44,495 enabled items, handles changed/disabled items, rejects unauthorized/Guest access, works offline from cache, and sends manually selected item through existing Physical Count validation/Inventory Tag/Quantity/ERP workflow.


## Update 065 — 2026-11-05: Restrict manual Item catalog to Finished Goods
- User requested only FG items be fetched for Manual Item Entry, not the full 44,495-item Item master.
- Backend `qcmc_logic/api/item_catalog.py`: initial page filters enabled Item rows by the Item Group nested-set hierarchy under roots named `Finished Goods` or `FG` (including child groups). No prefix/description guessing. If neither root exists, endpoint fails explicitly; actual group names in ERP have not been checked against live data.
- Delta pages retain modified timestamp pagination; non-FG/disabled changes are returned as code-only tombstones with blank name/description/UOM and disabled=1, allowing previously cached FG items moved out of FG or disabled to be deleted without leaking extra fields.
- Frontend `src/lib/itemCatalog.ts`: cache site scope now prefixed `fg-only-v1|` so any old all-item cache is excluded, while existing scans/pending submissions remain untouched. `ScanPage.tsx` displays FG-only labels. Updated `itemCatalog.test.ts` and backend `test_item_catalog.py` for filtering, cursor and tombstones.
- Existing green backend 4/4 tests precede this change; new 5-test suite and Android TypeScript/build/real-device have not been run. Validate Item Group root names, then run targeted tests. Catalog FG filtering affects manual lookup only; existing QR scan validation remains unchanged.


## Update 066 — 2026-11-05: Physical Count recount upload baseline validation
- User reported inability to submit recount locations. Inspected `ScanPage.tsx` recount correction transaction and `handleSubmitToErp` staging, `scanStorage.ts` pending/submitted transaction semantics and ERPNext `stock_reconciliation.py` conflict handling. Identified risk: a previously ERP-submitted count can retain an older `erpBaselineQuantity` even after ERP applied the submitted count, and the later recount payload reuses that stale baseline.
- In `ScanPage.tsx`, for fresh online uploads containing a previously ERP-acknowledged count, obtain the ERPNext Item+Location baseline again; require its quantity to equal the last acknowledged physical count before staging. If it differs, block with a clear review message and retain all saved local scans. If equal, refresh *baseline metadata only*, preserving recount delta, scan transactions, and Inventory Tags. Queued submissions with an existing idempotency ID are never rewritten. Offline Physical Count still permits local queueing using existing path.
- Added workflow UI-contract regression assertions for recount baseline and queued submission preservation.
- NOT YET VERIFIED: TS typecheck, Vitest, Android test, or exact operator error; no evidence yet that this change fully resolves the reported recount submit bug. If submission still fails, capture the actual inline warning or ERP `Physical Count Submission` status/error code instead of bypassing guards. No backend change was made.

## Update 067 — 2026-11-05: Recount Review & Submit blocks on stale active locations
- User screenshot for MAT-RECO-2026-00038 showed current recount B3GFAR4L1C10, Location Progress "0 completed · 2 active", and warning "Complete these locations before submitting: B3GFAR4L1C9."
- Root cause: `reopenLocation` marked the chosen location in_progress without finalizing the previously active location. The Review & Submit handler rejected every other in_progress session location before finalizing the current group, even if the other location already had real saved count transactions.
- Added pure `completeCountedInactiveRecountLocations` in `src/lib/pcountLocationGroup.ts`. It promotes only previously counted, inactive in_progress locations with recorded ADD/DEDUCT transactions for the exact reconciliation to completed. It never marks the active target or an uncounted/placeholder location completed, never drops entries or modifies quantities, and retains the original session on no-op.
- `src/components/ScanPage.tsx` uses the helper when reopening a location and again when the user taps Review & Submit, to heal already persisted stale statuses. The existing final active-location completion, submission confirmation, pending-transaction checks, and idempotent upload remain unchanged.
- Added regression tests in `src/lib/pcountLocationGroup.test.ts` covering B3GFAR4L1C9/B3GFAR4L1C10, untouched empty location and foreign reconciliation. Updated `workflowUiContract.test.ts`.
- Verification still pending: TypeScript, Vitest, Android build/device tests. Do not clear user scan storage or existing queued submission. If a location has no actual scanned count, the warning must remain until the user counts/removes it.


## Update 068 — 2026-11-06: Manual FG Item dialog simplified
- User requested removing redundant Cancel and Continue buttons in Manual FG Item Entry: tap a search result to proceed; tap outside the dialog or Android Back to dismiss.
- `ScanPage.tsx`: removed the Manual FG modal's Cancel/Continue action bar and unused selected-item confirmation panel. A search-result click calls `chooseManualItem(item)`, which validates the chosen Item's Stock UOM and operator-entered pack size and then reuses `processScan` so Inventory Tag, Quantity, recount and ERP baseline validation remain unchanged.
- Pack size moved above results with default 1 stock unit per Big Pack; operators can change it before selecting the Item. Invalid pack sizes keep the modal open with an error. Existing backdrop tap-to-close and Android Back behavior retained. No saved scan counts or queue changed.
- Updated `src/lib/itemCatalog.test.ts` contract; no TypeScript/Vitest/Android build run in this session. Test on handheld with both search-result selection and backdrop dismissal, including pack size different from 1.


## Update 069 — 2026-11-06: Manual FG search visible after scanning location; full-screen picker
- User reported that Manual FG Item Search was missing after scanning a Storage Location and requested a full-screen popup with Close.
- Root cause: both the render guard and `openManualItemSearch` required `step === "item"` and `isScanSessionActive`, although a newly selected Storage Location may still be in `step === "bin"` while the operator selects location(s). The button now becomes eligible whenever a reconciliation and at least one current/selected Storage Location exist (outside final Review). Opening from the location-selection step uses `continueMultiLocationItems` to activate the selected location or changes the single-location step to Items.
- The Manual FG picker now has an explicit labeled Close button, retains tap-on-backdrop close and Android Back, and is full-screen via scoped high-specificity `ScanPage.compact.css` styles. Results fill the remaining viewport and scroll, while search, sync and pack size remain accessible. No Cancel/Continue buttons were restored; tapping a result still enters the existing Inventory Tag/Quantity flow.
- Suppressed scanner auto-focus while the Manual FG picker is open to prevent the hidden scanner input stealing focus from Item search typing.
- Updated `src/lib/itemCatalog.test.ts` contract checks. Local TypeScript, Vitest, Android build/device confirmation remain pending. Preserve existing scans/reconciliation state.


## Update 070 — 2026-11-06: Show latest used Inv Tag in Physical Count dialog
- User reported that the Inventory Tag entry dialog did not display the latest used Inventory Tag after Manual FG Item Search and ordinary scanning.
- `src/lib/activeInventoryTag.ts` previously sorted per-scan `timestamp` lexicographically. Real scanned transactions use locale time strings (e.g., 9:59 PM and 10:01 PM), so string ordering is not chronological. Updated `getLatestUsedInventoryTag` to rely on canonical persisted newest-first item entry ordering and last transaction in each entry, while excluding other reconciliation references, empty tags, and non-count transactions.
- `src/components/ScanPage.tsx` Inventory Tag input now displays a visible `Last used Inv Tag: <tag>` line from the current reconciliation's locally recorded scan history. Existing prefill logic still applies, and recounts prioritize the exact prior Item + Location Inventory Tag rather than overwriting it.
- Styled the label in `ScanPage.compact.css` and added regression cases to `activeInventoryTag.test.ts` and `workflowUiContract.test.ts`. No user counts or submission records modified.
- Pending: Windows TypeScript check, targeted Vitest, Android build and actual device test. Last-used tag is device-local, not a cross-device ERP lookup.


## Update 071 — 2026-11-06: Correct Inventory Tag JSX build error
- User reported TypeScript TS2657 at ScanPage.tsx:7364 and Vite esbuild "Expected ')' but found ref" at 7368 after the Last used Inv Tag label was inserted before the Inventory Tag input.
- Root cause: the else branch of a JSX conditional returned two sibling elements (last-used label and input) with no single parent. Wrapped those siblings in a React fragment (`<>` and `</>`) in `src/components/ScanPage.tsx`. Existing conditional recount tag dropdown, input behavior and saved count logic unchanged.
- User-confirmed before this fix: `activeInventoryTag.test.ts` 11 tests passed; `workflowUiContract.test.ts` 93 tests passed; TypeScript/Vite build failed due to this JSX syntax error. New typecheck/build not yet verified; run `npx tsc --noEmit -p tsconfig.app.json` and `npm run build`.


## Update 072 — 2026-11-06: Latest Inventory Tag INV-008 incorrectly suggesting INV-006
- User confirmed last used Inventory Tag was INV-008 but scanner suggested INV-006. Previous fix relied on locally saved item row order; this is not trustworthy after row consolidation/restoration and existing-item scans.
- `src/lib/activeInventoryTag.ts`: latest-used lookup now compares per-transaction epoch milliseconds, preferring explicit `recordedAt`, else legacy transaction ID leading Date.now() timestamp, else ISO datetime. Locale-formatted time strings are not used for ordering. Only current reconciliation's ADD/DEDUCT transactions with nonblank Inventory Tags are eligible; order fallback is retained only for records without recoverable timestamps.
- `src/lib/scanStorage.ts`: preserve optional `recordedAt` on transaction load/parse; `ScanPage.tsx`: add `recordedAt: Date.now()` to new Physical Count scan transactions.
- New regression tests in `src/lib/activeInventoryTag.test.ts` reproduce INV-006 being first in loaded row order even though INV-008 has the later transaction epoch and verify explicit recordedAt.
- No previously saved counts, historical transaction IDs, ERP submissions or queue altered. Pending: TS, targeted Vitest, build and device test. Existing historical transactions whose IDs lack absolute times retain a best-effort fallback.


## Update 073 — 2026-11-06: Search autocomplete + separate Big Pack modal
- User asked that Manual FG item suggestions appear as an anchored dropdown *within/under the Item Search field*, and that Big Pack size be entered in a popup only *after* an item is selected.
- `src/components/ScanPage.tsx`: added a scoped autocomplete wrapper with a search-field combobox, conditional inline result list positioned by CSS directly below the search input. Removed the Big Pack field from the full-screen search UI. Selecting an item now records `manualPackItem` and switches from the search to a separate compact Big Pack modal with item identity, editable pack-size (default 1), Back to Search and Continue. Only after confirmation does it create the standard manual packing label and invoke the unchanged `processScan` flow for Inventory Tag, Quantity, recount and offline validation.
- Android Back returns from Big Pack to Search, and dismisses the full-screen search normally. Scanner focus restrictions include both Manual Search and Big Pack modal. Native scanner event ingestion is paused during those modal steps. Invalid/nonpositive pack sizes are rejected and the popup stays open.
- `ScanPage.compact.css`: anchored scrollable suggestion dropdown, overlaid beneath search field; separate compact Big Pack modal styling, while preserving full-screen search view. `src/lib/itemCatalog.test.ts`: added new UI-contract checks for suggestion location and second-stage pack-size submission.
- No local saved counts, pending submission IDs, ERP API or backend files were modified. TypeScript/Vitest/Vite/Android device verification is pending; check for any existing contract tests assuming pack field is on search screen.


## Update 074 — 2026-11-06: First submission-reliability optimization (safe recovery and timing)
- User approved beginning optimization after read-only audit. Implemented a **targeted first stage**, not batching or a fabricated live benchmark.
- `src/lib/pcountSubmissionRecovery.ts`: new conservative recovery classifier. When a persisted submission with unchanged source fingerprint exists, look up its original ERPNext submission ID before sending. Only explicit not-found evidence permits re-sending the exact original payload with the same submission ID. Network timeout, authentication and server errors must not trigger an additional POST. The existing backend request-hash/idempotency and transaction-ID safeguards remain unchanged.
- `src/components/ScanPage.tsx`: reused queued submissions bypass unnecessary fresh reconciliation-context fetch; only new submissions refresh ERP warehouse context. Queue submission logic now performs status-first recovery, then follows existing COMPLETED/NEEDS_REVIEW/FAILED/polling behavior. Existing on-device counts are only acknowledged and cleared after `COMPLETED`.
- Added safe client-side timing instrumentation using `performance.now()`: preparation time, request acceptance time (or status lookup if already received), confirmation polling time, and total observed time. Successful uploads log stage timings to the WebView console and show observed total seconds in the success toast. No stock contents, tokens or payloads are logged.
- `src/lib/pcountSubmissionRecovery.test.ts`: checks 404 versus network/auth/server failures, timing format and status-first source contract. Existing backend `stock_reconciliation.py` was inspected only and **not modified**. No sample data or test submissions were sent.
- Still pending: TypeScript type-check, targeted Vitest, Vite build, physical SmartPDA tests, and real development ERPNext timings with test-approved reconciliation. No claim of meeting 30s/90s targets. Recount baseline comparisons remain unchanged pending targeted investigation; arbitrary chunking is deferred until measurements justify it.


## Update 075 — 2026-11-06: Reject duplicate Inventory Tag only for different Item in same Storage Location
- New explicit rule per user example: Location A / Item A / INV-001 is allowed, but Location A / Item B / INV-001 is rejected. Same Inventory Tag at Location B is allowed, even for another Item. Scope is one Physical Count reconciliation.
- Client `src/lib/activeInventoryTag.ts`: conflict helper now requires exact Storage Location, compares tag/Item/Location case-insensitively and retains checks against locally submitted audit transactions. Active-tag validation ignores unrelated locations before checking conflicts at target location. `src/lib/inventoryTagReuse.ts`: matches same-location ownership rule; no longer treats a tag elsewhere as a conflict.
- Client `src/components/ScanPage.tsx`: Inventory Tag confirmation checks all currently targeted Storage Locations (including Multi Location) against locally saved counts, gives clear conflicting tag/Item/Location error, and blocks progression to Quantity. Edit Quantity & Inv Tag also enables the existing conflict validator for the edited row's location rather than bypassing it.
- ERPNext `apps/qcmc_logic/qcmc_logic/api/stock_reconciliation.py` (WSL local development): new `_validate_inventory_tag_location_ownership` invoked after normalized entry validation and with reconciliation row lock. It checks all incoming transactions, current reconciliation result groups and prior audit transactions for the same reconciliation/location/tag, rejecting cross-device duplicate tags on different Items without modifying accepted counts. The backend does not prohibit reusing a tag in another location.
- Targeted regression tests updated in `src/lib/activeInventoryTag.test.ts`, `src/lib/inventoryTagReuse.test.ts`, `src/lib/workflowUiContract.test.ts`, `src/lib/scanEditQuantityPopupUi.test.ts`; backend tests added to `test_stock_reconciliation_increment.py` and registered in `run_inventory_tag_tests()`.
- No sample scans, saved counts or ERP records were modified. Pending: compile and focused tests, mobile build/reinstall, Python/Frappe backend restart and focused inventory-tag tests, then same-location and cross-location device integration check. No DocType/schema migration required.


## Update 076 — 2026-11-06: Fix quoted-string syntax in Inv Tag editing UI test
- User's verification: 115 tests passed across three suites, but `scanEditQuantityPopupUi.test.ts` could not parse because its `toContain` expected string used double quotes around a nested `|| ""`. The Vite production build succeeded; the chunk-size warning is non-blocking.
- Corrected the test assertion's outer string delimiter to single quotes, preserving the intended exact match. No scanner business logic, backend, Physical Count records, or inventory tags changed in this fix.
- Pending rerun only the failing suite and TypeScript check; do not repeat the already successful 115 tests unnecessarily.


## Update 077 — 2026-11-06: Scope ERP Inventory Tag test count to its submission
- User ran `run_inventory_tag_tests` on `erp.qcstyro.local`: 7/8 passed. Legacy `test_adjustment_inventory_tags_remain_per_transaction_and_searchable` failed `9 != 1` because it counted every `INV-002` ADD audit transaction in the entire site, including data from other submissions.
- Updated `apps/qcmc_logic/qcmc_logic/tests/test_stock_reconciliation_increment.py` in WSL: limit the assertion by test-created reconciliation ID and submission ID as well as tag/action. No records are deleted; this fixes test isolation only.
- Bench's subsequent `NameError: name 'qcmc_logic' is not defined` comes from Bench's fallback after the test runner raises on failure, not a separate backend import defect.
- All four new same-location duplicate-tag backend tests passed in the user's run. Rerun only the focused eight-test suite. No migration necessary for this test edit, and no source business-rule changes made.


## Update 078 — 2026-11-06: Physical Count Scanned Items full-screen popup
- User requested Scanned Items to open in a full-screen popup because the Physical Count main display is crowded. No scanning, quantity, reconciliation or ERP backend changes.
- `src/components/ScanPage.tsx`: Physical Count now renders the existing Scanned Items/history view only when View / Edit opens it; the existing card content is reused in a `role="dialog"` full-screen overlay with a blue header, item count, reconciliation reference and Close button. Close clears temporary selection mode (does not delete scans) and restores scanner focus; Android Back also closes the overlay. The historical edit, transaction details, select-all/remove controls remain in the same reused content.
- Non-Physical Count modes retain their former inline/toggle history behavior through mode-specific rendering and toggle.
- `src/components/ScanPage.compact.css`: full viewport `100dvh`, safe-area header/bottom padding, scrollable Scanned Items content, explicit header styling and edit-dialog stacking so Edit Quantity / Inv Tag can appear over the full-screen history view. Full-screen CSS overrides older limited-height review-stage card rules.
- `src/lib/workflowUiContract.test.ts`: updated static contracts that expected inline Scanned Items and added dedicated full-screen / close / Back coverage.
- Verification still pending: focused Vitest, TypeScript, Vite build, and SmartPDA opening/editing/deleting/back + return-to-scanner flow. No migration required. Existing saved Physical Count records untouched.

## Update 089 — 2026-11-06: Show Inventory Tag edit validation inside Scanned Items editor
- Per user request, extended inline Inventory Tag trapping/validation notifications to Scanned Items → audit history → pencil Edit Quantity & Inv Tag.
- Replaced behind-the-popup error toasts with local inline alerts for already-submitted/unavailable transactions, blank Inventory Tags, same-location tag/item conflicts and local correction save failures. Also shows invalid quantity feedback when Save is invoked with an invalid preview.
- The alert appears above Cancel / Save Changes, clears on Inventory Tag edits and when opening another edit transaction, and keeps the edit popup open to correct the value. Added modal-specific styling designed to preserve the full-screen SmartPDA keypad and action buttons.
- Added regression assertions in `src/lib/scanEditQuantityPopupUi.test.ts`. Existing Inventory Tag validation, correction history, counts and ERP submission logic unchanged.
- Local focused Vitest, TypeScript check, Vite build and SmartPDA visual verification are pending.

## Update 088 — 2026-11-06: Show Inventory Tag trapping notifications inside Inv Tag popup
- The user requested that the validation label/notification displayed when an Inventory Tag is trapped or invalid be visible inside the Inv Tag popup instead of behind the overlay on the scanning screen.
- Added a dedicated `inventoryTagPopupNotice` state and inline alert in the Enter Inv Tag form; it displays same-location tag/item conflicts, missing tags, invalid existing recount tag selection, and unavailable saved recount quantity.
- The alert clears upon changing the typed/selected tag or changing recount operation, and when leaving the Inventory Tag step. The validation rules remain unchanged; previously background toasts/messages are now in-modal where an operator can act on them.
- Added compact, readable, scroll-safe modal alert styling in `ScanPage.compact.css` and a UI-contract regression assertion. No local scan storage, inventory tags, submission logic or ERPNext schema changed.
- Vitest, TypeScript, Vite build and SmartPDA popup testing pending.

## Update 087 — 2026-11-06: Align Multi Location scanner focus test with comma-formatted feedback
- User's focused Vitest run reported 103/104 tests passing. The failing `keeps the Physical Count scanner field focused during Multi Location scanning` contract expected the pre-formatting `Math.abs(signedQuantity)` interpolation in an inline feedback message.
- Updated only the assertion to match `formatScanQuantity(Math.abs(signedQuantity))`, while retaining the check that `refocusPhysicalCountScanner()` follows the message. No production scanner logic, submission behavior, or saved counts modified.
- Focused rerun pending on the user's Windows machine.

## Update 086 — 2026-11-06: Thousands separators on Physical Count displayed quantities
- User requested commas for all displayed quantities. Added `formatScanQuantity(value)` using `en-US` grouping and two decimal places for Physical Count numeric display, keeping all underlying count values and arithmetic unchanged.
- Updated By Location SKU totals and current physical counts, By Inv Tag totals and location quantities, previous item, edit preview, Inv Tag confirmation, physical-count calculator count previews, location summary, and inline saved-scan quantity messages. Existing `toLocaleString` totals/audit formatting remains.
- Added `workflowUiContract.test.ts` assertions for key grouped displays. TypeScript, Vitest, Vite build and SmartPDA verification pending; no ERPNext migration required.

## Update 085 — 2026-11-06: Scanned Items By Location / By Inv Tag selector
- User requested reversal of the previous addition of an Inventory Tag line under Current Physical Count and a selectable Scanned Items view: By Location (existing expanded item/location rows) or By Inv Tag (Inventory Tag and summed quantity).
- Physical Count now defaults to By Location; tagged labels are removed from its Current Physical Count rows. By Inv Tag retains the existing per-item expand/collapse header but shows two columns, Inv Tag and Qty, grouped from saved transaction Inventory Tags across that item's locations. Repeated tags are case-insensitively combined; opened tag rows provide each contributing storage-location row and a direct route to the existing audit/edit popup. Missing/legacy Inventory Tags are labeled No Inv Tag rather than guessed, with unmatched quantities kept separate.
- The new read-only helper is `src/lib/scannedItemsByInvTag.ts`, covered by `src/lib/scannedItemsByInvTag.test.ts`. UI contract assertions updated; `ScanPage.compact.css` adds selector and tag grouping layout. No scan storage modifications, submission, or ERPNext schema changes.
- Focused Vitest, TypeScript check, Vite build, Android sync and SmartPDA visual validation remain pending.

## Update 084 — 2026-11-06: Fix TypeScript narrowing after Scanned Items accordion
- User ran focused 97 UI contracts successfully, but `tsc --noEmit -p tsconfig.app.json` identified TS2367 at lines 6769 and 6770: inside `mode !== "pcount"` conditional button, checking `mode === "pcount"` was unreachable.
- Simplified only the non-Physical Count button's aria-label and toggle callback, preserving existing behavior. Updated the corresponding static workflow UI contract to match.
- Pending: rerun focused Vitest, TypeScript check, Vite build and Android sync on user's development machine. No ERP migration or scan-data changes.

## Update 083 — 2026-11-06: Fixed Scanned Items totals and expandable SKU details
- User requested fixed Scans / SKUs / Total Units at top of full-screen Scanned Items, removal of redundant View / Edit and its count in the list header, and SKU headers that expand to show physical count details including Inventory Tag.
- `src/components/ScanPage.tsx`: added dedicated sticky-top wrapper around popup title and totals; View / Edit button in list header is now omitted in Physical Count only. Added per-SKU expand/collapse state and accessible header controls; expanded rows retain existing tap-to-audit, edit and remove-selection handlers, and show distinct nonblank scan-transaction Inv Tags beside Current physical count. Other modes retain expanded rows.
- `src/components/ScanPage.compact.css`: sticky combined header and totals, accordion chevron and expanded-row styles, natural height of item rows. Counted Locations stays hidden in the Physical Count popup; saved scans and business logic untouched.
- Added `workflowUiContract.test.ts` assertions. TypeScript, Vitest, production build, and SmartPDA testing still pending. No ERPNext migration required.

## Update 082 — 2026-11-06: Repair clipped Scanned Items cards in full-screen scroll
- User's Android screenshot showed SKU cards compressed vertically, with quantities and transaction/location details chopped off. Previous z-index repair and Counted Locations test fix did not address the actual card sizing regression.
- Root cause: `.scan-history.scan-items-fullscreen` is a column flex container, so its direct `.scan-sku-group` children defaulted to `flex-shrink: 1`; with multiple SKUs, children shrank to fit one viewport, clipping overflow from `.scan-sku-group { overflow: hidden; }`.
- Fix in `src/components/ScanPage.compact.css`: force direct SKU groups to `flex: 0 0 auto`, natural auto height and visible overflow; keep the full-screen panel as the vertical scrolling surface. Keep headers and scan rows at their natural height. Counted Locations stays hidden only in the Physical Count popup, and editing/audit handlers stay untouched.
- Added a UI contract regression assertion in `src/lib/workflowUiContract.test.ts`. Automated test and on-device verification still pending; no ERPNext migration required.

## Update 081 — 2026-11-06: Repair stale Scanned Items UI test
- User reported 94/95 workflow UI tests passing; legacy `shows scanned item details before counted location details` failed because it searched for the pre-removal unguarded Counted Locations condition.
- Updated the test to assert scanned items render first while the Counted Locations toggle and details are both guarded by `mode !== "pcount"`. This preserves the requested Physical Count hiding and the old non-Physical Count behavior; scanner business logic unchanged.
- Focused test rerun pending user terminal verification.

## Update 080 — 2026-11-06: Hide Counted Locations from Physical Count Scanned Items
- Per user request, hide the Counted Locations toggle and its expanded location summary from the Physical Count full-screen Scanned Items popup. Other modes retain their prior behavior.
- Kept counted-location state and saved data unchanged; this is presentation-only. Added a static regression assertion to `src/lib/workflowUiContract.test.ts`.
- Android build and device validation are still pending; no ERPNext migration required.

## Update 079 — 2026-11-06: Restore pencil Edit over full-screen Scanned Items
- Reported regression: tapping a scanned item no longer exposed its Edit action after moving the Scanned Items view to full screen.
- Root cause: the existing item-detail overlay inherited z-index 90, below the new full-screen list at 200. The edit pencil inside the item-detail overlay was therefore hidden behind the list.
- Fixed `src/components/ScanPage.compact.css` by layering the item-detail backdrop at 300 and keeping Edit Quantity / Inv Tag above it at 350. Existing item details, edit handlers, quantities and Inventory Tags remain untouched.
- Added a stacking-order assertion in `src/lib/workflowUiContract.test.ts`. Pending local focused test/build and SmartPDA tap item → pencil Edit → Save → Close verification; no migration required.
