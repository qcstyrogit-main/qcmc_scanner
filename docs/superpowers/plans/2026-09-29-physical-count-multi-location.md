# Physical Count Multi-Location Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable Physical Count Multi Location mode that copies one entered item quantity in full to every location in the active location group while preserving the existing Single Location workflow.

**Architecture:** Persist location mode as a device preference and in each active Physical Count session. Put group selection and entry expansion in a small pure library, then let `ScanPage` coordinate existing ERP validations atomically before storing ordinary one-item/one-location scan entries. ERP serialization remains unchanged because expansion happens before saved-scan review and submission.

**Tech Stack:** React 18, TypeScript 5, Vite, Vitest, browser `localStorage`, existing ERPNext REST client

**Spec:** `docs/superpowers/specs/2026-09-29-physical-count-multi-location-design.md`

## Global Constraints

- The entered quantity is copied in full to every selected location; it is never divided.
- Single Location remains the default, and old saved sessions without a location-mode field load as Single Location.
- Automatic/Manual and Big Pack/Loose Pack remain independent of Single/Multi Location.
- Multi Location creates ordinary one-item/one-location entries; do not introduce a new ERP request shape.
- An item is saved for all selected locations or none of them when validation fails.
- Persist mode, active group, selected locations, and entries for offline recovery after every material change.
- Do not build an Android APK as part of this change.

## Review Focus

- A location scanned twice must remain one selection and show duplicate feedback; pin this in Task 3.
- A mode change while an active Physical Count exists must be refused without altering the session; pin this in Task 4.
- A failure on the last of several selected locations must leave every location unchanged for that item; pin this in Task 4.
- Decimal quantities and an empty barcode UOM must expand identically to every location; pin this in Task 3.
- Restoring a legacy or partially malformed session must safely select Single Location and discard invalid group metadata; pin this in Task 2.

---

### Task 1: Physical Count Location Mode Preference

**Files:**
- Modify: `src/lib/scannerPreferences.ts`
- Modify: `src/lib/scannerPreferences.test.ts`

**Interfaces:**
- Produces: `ScannerLocationMode = "single" | "multi"`
- Produces: `loadScannerLocationMode(): ScannerLocationMode`
- Produces: `saveScannerLocationMode(mode: ScannerLocationMode): ScannerLocationMode`

- [ ] **Step 1: Write failing preference tests**

Add tests asserting that an empty store defaults to `single`, saving `multi` survives a reload, and an unknown stored string falls back to `single`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm.cmd test -- src/lib/scannerPreferences.test.ts`

Expected: FAIL because the location-mode type and functions are not exported.

- [ ] **Step 3: Implement the location-mode preference**

Add `ScannerLocationMode`, a versioned `qcmc.scanner.locationMode.v1` key, and the load/save functions in `src/lib/scannerPreferences.ts`. Do not couple this preference to `resolveScannerModes` because quantity and package rules are independent.

- [ ] **Step 4: Run the focused test and verify success**

Run: `npm.cmd test -- src/lib/scannerPreferences.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/scannerPreferences.ts src/lib/scannerPreferences.test.ts
git commit -m "feat: persist physical count location mode"
```

### Task 2: Backward-Compatible Multi-Location Session State

**Files:**
- Modify: `src/lib/scanStorage.ts`
- Modify: `src/lib/scanStorage.test.ts`

**Interfaces:**
- Consumes: `ScannerLocationMode` from Task 1
- Modifies: `LocalPcountSession` with `locationMode: ScannerLocationMode` and `activeGroupId: string`
- Modifies: `LocalPcountLocation` with optional `groupId?: string`
- Produces: backward-compatible `loadPcountSession(employeeId: string): LocalPcountSession | null`

- [ ] **Step 1: Write failing session migration and restoration tests**

Extend the Physical Count session tests to assert:

- A legacy session without `locationMode`, `activeGroupId`, or location `groupId` loads as `locationMode: "single"` with an empty `activeGroupId`.
- A valid Multi Location session restores its mode, group ID, selected locations, statuses, and timestamps.
- Unknown mode values fall back to `single`.
- An `activeGroupId` is cleared when no valid restored location belongs to it.
- Invalid location records are discarded without invalidating the remaining group.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm.cmd test -- src/lib/scanStorage.test.ts`

Expected: FAIL because the persisted session does not expose the new fields.

- [ ] **Step 3: Extend the persisted session model and parser**

Import `ScannerLocationMode`, add the new fields, and parse them defensively. Preserve `activeLocationId` for Single Location. In Multi Location, allow multiple `in_progress` locations with the same `activeGroupId`; clear malformed group metadata rather than inventing membership.

- [ ] **Step 4: Update existing session fixtures**

Add `locationMode: "single"` and `activeGroupId: ""` to typed fixtures that construct `LocalPcountSession` directly. Do not alter their existing behavioral assertions.

- [ ] **Step 5: Run storage tests and verify success**

Run: `npm.cmd test -- src/lib/scanStorage.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/scanStorage.ts src/lib/scanStorage.test.ts
git commit -m "feat: persist multi-location count sessions"
```

### Task 3: Pure Location-Group and Entry-Expansion Rules

**Files:**
- Create: `src/lib/pcountLocationGroup.ts`
- Create: `src/lib/pcountLocationGroup.test.ts`

**Interfaces:**
- Consumes: `LocalBinLocation`, `LocalPcountLocation`, and `LocalScanEntry` from `src/lib/scanStorage.ts`
- Produces: `addPcountGroupLocation(locations: LocalPcountLocation[], bin: LocalBinLocation, groupId: string, scannedAt: string): { locations: LocalPcountLocation[]; added: boolean }`
- Produces: `removePcountGroupLocation(locations: LocalPcountLocation[], locationId: string, groupId: string): LocalPcountLocation[]`
- Produces: `getActivePcountGroupLocations(locations: LocalPcountLocation[], groupId: string): LocalPcountLocation[]`
- Produces: `expandPcountEntryForLocations(entry: LocalScanEntry, locations: LocalPcountLocation[], transactionId: (locationId: string) => string): LocalScanEntry[]`
- Produces: `getMultiLocationQuantitySummary(quantityPerLocation: number, locationCount: number): { quantityPerLocation: number; locationCount: number; totalQuantity: number }`

- [ ] **Step 1: Write failing group-selection tests**

Test that the first scan adds a group member, a repeated location ID returns `added: false` without changing order or count, removal only affects the active group, and active-group selection excludes completed or differently grouped locations.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm.cmd test -- src/lib/pcountLocationGroup.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement group selection helpers**

Implement the four selection operations as immutable pure functions. Compare normalized exact location IDs; do not infer identity from display labels.

- [ ] **Step 4: Write failing expansion and total tests**

Assert that an entry with quantity `1000` expands across A, B, and C into three entries of `1000` and total `3000`; each entry and scan transaction contains its own location. Also assert that `1000.25` and an empty `barcodeUom` are preserved identically across all locations and that source objects are not mutated.

- [ ] **Step 5: Run the focused test and verify failure**

Run: `npm.cmd test -- src/lib/pcountLocationGroup.test.ts`

Expected: FAIL because expansion and summary behavior is incomplete.

- [ ] **Step 6: Implement entry expansion and totals**

Clone the entry per location, replace `bin`, rewrite each cloned transaction's `id`, `locationId`, and `locationLabel`, and retain quantity/UOM/audit metadata. Return an empty list for an empty location group and calculate total as `quantityPerLocation * locationCount`.

- [ ] **Step 7: Run the focused test and verify success**

Run: `npm.cmd test -- src/lib/pcountLocationGroup.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/lib/pcountLocationGroup.ts src/lib/pcountLocationGroup.test.ts
git commit -m "feat: add physical count location group rules"
```

### Task 4: Multi-Location Physical Count Workflow

**Files:**
- Modify: `src/components/ScanPage.tsx`
- Modify: `src/lib/workflowUiContract.test.ts`
- Modify: `src/lib/pcountLocationGroup.test.ts`

**Interfaces:**
- Consumes: `ScannerLocationMode`, persisted `LocalPcountSession` fields, and every helper from Task 3
- Modifies: `ScanPageProps` to accept `locationMode: ScannerLocationMode`
- Produces: Multi Location selection, atomic validation, expanded local entries, group completion, and restore behavior

- [ ] **Step 1: Add failing workflow contract tests**

Pin the presence of the Multi Location banner, selected-location count, selected-location remove action, **Continue to Items**, per-location quantity confirmation copy, and a group-aware **Next Location** path. Retain existing assertions for Single Location controls.

- [ ] **Step 2: Add a failing atomic-validation helper test**

Extract or add a helper in `pcountLocationGroup.ts` named `validatePcountLocationGroup<T>(locations: LocalPcountLocation[], validate: (location: LocalPcountLocation) => Promise<T>): Promise<T[]>`. Test that it preserves input order and rejects without calling any persistence callback when the final location fails. Persistence stays outside the helper and occurs only after its promise resolves.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `npm.cmd test -- src/lib/pcountLocationGroup.test.ts src/lib/workflowUiContract.test.ts`

Expected: FAIL on the missing helper and Multi Location UI contract.

- [ ] **Step 4: Restore the correct workflow from saved state**

In `ScanPage`, derive the effective mode from the active saved session when one exists; otherwise use the `locationMode` prop. Restore Multi Location to the Location step when its active group is empty, or to Items when its group has selected locations and counting has started. Keep existing Single Location restoration unchanged.

- [ ] **Step 5: Implement Multi Location selection**

Reuse existing storage-location QR parsing and ERP warehouse validation. In Multi mode, add the validated location to `activeGroupId` without moving immediately to Items. Show duplicate feedback for `added: false`, provide removal before item counting begins, and enable **Continue to Items** only when the active group is nonempty.

- [ ] **Step 6: Implement atomic item validation and expansion**

When quantity is confirmed in Multi mode, run the existing baseline, UOM, item, and capacity checks for every active-group location through `validatePcountLocationGroup`. Only after all checks pass, expand the direct entry, merge all expanded entries into React state and local storage, and update every group's `lastScanTime`. On failure, identify the failing location in the existing toast/dialog style and persist no entry for that item.

- [ ] **Step 7: Implement group-aware totals and completion**

Show `quantity x location count` and overall total in quantity confirmation/review. Make **Next Location** mark every active-group location completed, clear `activeGroupId` and `activeLocationId`, generate the next group ID when location scanning resumes, and preserve earlier entries. Prevent submission while any group member is still in progress.

- [ ] **Step 8: Prevent unsafe mode switching**

When an active Physical Count session exists, retain its stored location mode even if the device preference changes. Display a warning that the current count must be completed or discarded before changing modes; do not reinterpret locations or entries.

- [ ] **Step 9: Run focused tests and verify success**

Run: `npm.cmd test -- src/lib/pcountLocationGroup.test.ts src/lib/workflowUiContract.test.ts src/lib/scanStorage.test.ts src/lib/packageQuantity.test.ts src/lib/uom.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add src/components/ScanPage.tsx src/lib/pcountLocationGroup.ts src/lib/pcountLocationGroup.test.ts src/lib/workflowUiContract.test.ts
git commit -m "feat: add multi-location physical counting"
```

### Task 5: Mode Menu Integration and Responsive Styling

**Files:**
- Modify: `src/components/BlankPage.tsx`
- Modify: `src/index.css`
- Modify: `src/lib/workflowUiContract.test.ts`

**Interfaces:**
- Consumes: Task 1 preference functions and `ScanPage`'s `locationMode` prop from Task 4
- Produces: Six-option Mode menu with Single Location and Multi Location selection

- [ ] **Step 1: Write failing Mode-menu contract tests**

Assert that the menu includes **Single Location** and **Multi Location**, passes the selected value into `ScanPage`, reloads the preference whenever the menu opens, and retains Automatic, Manual, Big Pack, and Loose Pack.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm.cmd test -- src/lib/workflowUiContract.test.ts src/lib/scannerPreferences.test.ts`

Expected: FAIL because the menu exposes only four options.

- [ ] **Step 3: Wire location mode through `BlankPage`**

Load the preference into component state, add a selection handler with the established toast behavior, render two transparent circular actions with clear selected states, and pass `scannerLocationMode` to `ScanPage`. If an active session uses the other mode, keep the session mode authoritative and show the Task 4 warning.

- [ ] **Step 4: Extend the radial menu styling**

Update the existing `inventory-scan-actions` layout and animation for six controls without grayscale overlays. Keep touch targets, labels, safe-area spacing, and the bottom navigation usable on the narrow supported Android viewport.

- [ ] **Step 5: Run focused tests and verify success**

Run: `npm.cmd test -- src/lib/workflowUiContract.test.ts src/lib/scannerPreferences.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/components/BlankPage.tsx src/index.css src/lib/workflowUiContract.test.ts
git commit -m "feat: expose physical count location modes"
```

### Task 6: Submission Compatibility and Full Verification

**Files:**
- Modify: `src/lib/pcountSubmission.test.ts`
- Modify if required by a failing contract: `src/lib/pcountSubmission.ts`

**Interfaces:**
- Consumes: expanded ordinary `LocalScanEntry[]` from Task 4
- Confirms: existing ERP payload sends one row per item/location combination without a new backend schema

- [ ] **Step 1: Add the ERP payload compatibility test**

Build six local entries for two item quantities across locations A, B, and C. Assert that the current serializer produces six ERP rows, retains repeated item codes, assigns the correct inventory location to each row, and sends each full per-location quantity rather than a divided quantity.

- [ ] **Step 2: Run the submission test**

Run: `npm.cmd test -- src/lib/pcountSubmission.test.ts`

Expected: PASS without production changes. If it fails because the frontend serializer collapses locations, make the smallest serializer correction and rerun. If the documented backend contract rejects these rows, stop and report the backend gap rather than inventing a new payload.

- [ ] **Step 3: Run the full automated suite**

Run: `npm.cmd test`

Expected: all tests PASS.

- [ ] **Step 4: Run TypeScript validation**

Run: `npx.cmd tsc --noEmit`

Expected: exit code 0.

- [ ] **Step 5: Run lint**

Run: `npm.cmd run lint`

Expected: exit code 0.

- [ ] **Step 6: Review the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only task-related files are staged/committed, while pre-existing user changes remain untouched.

- [ ] **Step 7: Commit test-only compatibility coverage if needed**

```powershell
git add src/lib/pcountSubmission.test.ts src/lib/pcountSubmission.ts
git commit -m "test: verify multi-location count submission"
```
