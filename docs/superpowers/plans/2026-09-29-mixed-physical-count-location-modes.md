# Mixed Physical Count Location Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow operators to alternate between Single Location and Multi Location after each **Next Location** action while retaining the same Stock Reconciliation and all prior counts.

**Architecture:** Separate the device's next-location preference from the mode locked to unfinished work. Persist an optional `activeLocationMode` only after the first location of a location/group is scanned, clear it on **Next Location**, and derive the scanner workflow from that lock when present or the live Mode preference otherwise.

**Tech Stack:** React 18, TypeScript 5, Vite, Vitest, browser `localStorage`

**Spec:** `docs/superpowers/specs/2026-09-29-physical-count-multi-location-design.md`

## Global Constraints

- Changing Single/Multi mode never clears or changes the Stock Reconciliation reference.
- Completed counts and audit history remain unchanged when mode changes.
- Both Multi-to-Single and Single-to-Multi are allowed immediately after **Next Location**.
- An unfinished location/group retains the mode with which it started.
- ERP submission remains one ordinary row per item/location combination.
- Legacy saved sessions must resume unfinished work without reinterpretation.
- Do not build an Android APK.

## Review Focus

- A completed Multi group followed by Single must keep the same reference and earlier entries.
- A completed Single location followed by Multi must keep the same reference and earlier entries.
- A Mode-menu tap during unfinished work must not reinterpret that work.
- Reloading unfinished legacy sessions must infer the correct active mode.
- **Next Location** must clear only the active mode/group, not the reconciliation or entries.

---

### Task 1: Active Location Mode Persistence

**Files:**
- Modify: `src/lib/scanStorage.ts`
- Modify: `src/lib/scanStorage.test.ts`

**Interfaces:**
- Modifies: `LocalPcountSession` to use `activeLocationMode?: ScannerLocationMode`
- Retains temporarily for migration: legacy `locationMode?: ScannerLocationMode`
- Produces: `loadPcountSession(employeeId: string)` with safe active-mode inference

- [ ] **Step 1: Write failing migration tests**

Test that unfinished legacy Single and Multi sessions infer `activeLocationMode`, completed sessions load with no active mode, and a current-format session preserves an explicit active mode.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm.cmd test -- src/lib/scanStorage.test.ts`

Expected: FAIL because sessions still expose one reconciliation-wide mode.

- [ ] **Step 3: Implement backward-compatible active-mode parsing**

Add optional `activeLocationMode`. Infer it from legacy `locationMode` only when `activeLocationId`, `activeGroupId`, or an in-progress location proves unfinished work exists. Do not infer a lock for a completed/no-active session.

- [ ] **Step 4: Run the focused test and verify success**

Run: `npm.cmd test -- src/lib/scanStorage.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit only feature-owned changes where safe**

### Task 2: Mode Lock and Transition Rules

**Files:**
- Modify: `src/lib/pcountLocationGroup.ts`
- Modify: `src/lib/pcountLocationGroup.test.ts`

**Interfaces:**
- Produces: `getEffectivePcountLocationMode(session: LocalPcountSession | null, preference: ScannerLocationMode): ScannerLocationMode`
- Produces: `lockPcountLocationMode(session: LocalPcountSession, mode: ScannerLocationMode): LocalPcountSession`
- Produces: `completePcountLocationMode(session: LocalPcountSession): LocalPcountSession`
- Updates: `getPcountSessionRestoreState` to use `activeLocationMode`

- [ ] **Step 1: Write failing transition tests**

Assert that preference controls a session with no active lock, an active lock overrides a changed preference, completion clears the lock without clearing reconciliation/locations, and the next lock can use the opposite mode.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm.cmd test -- src/lib/pcountLocationGroup.test.ts`

Expected: FAIL because transition helpers do not exist.

- [ ] **Step 3: Implement immutable transition helpers**

Keep mode changes independent from entries and completed locations. Make completion clear `activeLocationMode`, `activeLocationId`, and `activeGroupId` only.

- [ ] **Step 4: Update restore helper and tests**

Restore unfinished work using `activeLocationMode`; restore a completed session to the Location step with scanning inactive and the live preference available.

- [ ] **Step 5: Run the focused test and verify success**

Run: `npm.cmd test -- src/lib/pcountLocationGroup.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/pcountLocationGroup.ts src/lib/pcountLocationGroup.test.ts
git commit -m "feat: support mixed physical count location modes"
```

### Task 3: Mixed-Mode Scanner Integration

**Files:**
- Modify: `src/components/ScanPage.tsx`
- Modify: `src/components/BlankPage.tsx`
- Modify: `src/lib/workflowUiContract.test.ts`

**Interfaces:**
- Consumes: Task 2 transition helpers
- Produces: live post-Next Location switching without changing reference or entries

- [ ] **Step 1: Write failing workflow contract tests**

Pin that `ScanPage` derives mode from active lock or preference, locks mode on the first scanned location, clears it through **Next Location**, and never calls the New Reference path when selecting Single/Multi.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm.cmd test -- src/lib/workflowUiContract.test.ts`

Expected: FAIL on reconciliation-wide mode behavior.

- [ ] **Step 3: Integrate active-mode locking**

Use the live `locationMode` prop whenever no location/group is active. Lock it when the first location is accepted. Continue using the lock throughout item scanning and quantity expansion.

- [ ] **Step 4: Clear the lock on Next Location**

Complete the active location/group, clear active-mode/group/location fields, return to the Location step, and preserve reconciliation code, warehouse, completed locations, and entries.

- [ ] **Step 5: Make Mode-menu selection immediate and accurate**

Save and highlight the selected device preference like Big Pack/Loose Pack. If work is unfinished, retain its active lock and show that the selection applies after **Next Location**. If no work is unfinished, the next scanned location uses the new choice immediately.

- [ ] **Step 6: Run focused tests and verify success**

Run: `npm.cmd test -- src/lib/workflowUiContract.test.ts src/lib/pcountLocationGroup.test.ts src/lib/scanStorage.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit only feature-owned changes where safe**

### Task 4: Mixed Payload Regression and Full Verification

**Files:**
- Modify: `src/lib/pcountSubmission.test.ts`

**Interfaces:**
- Confirms: completed Single and Multi entries submit together under one reconciliation

- [ ] **Step 1: Write the mixed-mode payload regression test**

Build completed Multi rows for Locations A-C and a completed Single row for Location D under one reconciliation. Assert four ordinary rows preserve their locations and full quantities.

- [ ] **Step 2: Run the submission test**

Run: `npm.cmd test -- src/lib/pcountSubmission.test.ts`

Expected: PASS without a production serializer change.

- [ ] **Step 3: Run full verification**

Run: `npm.cmd test`

Expected: all tests PASS.

Run: `npx.cmd tsc --noEmit --incremental false`

Expected: exit code 0.

Run: `npm.cmd run lint`

Expected: exit code 0.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 4: Commit test-only coverage only where safe**
