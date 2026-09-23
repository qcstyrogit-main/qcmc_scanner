# Partial Package Quantities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support complete and opened packages in Physical Count and full or partial package quantities in Pullout while preserving original QR quantities, audit history, retry identities, and existing workflows.

**Architecture:** Put all package arithmetic and validation in a pure `packageQuantity` module. Persist package audit data on individual Physical Count transactions, carry it through existing submission payloads, and extend the existing Manufacture Draft request rather than adding endpoints. UI components consume the shared calculations and preserve the automatic complete-package fast path.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Capacitor Android, browser localStorage, existing ERPNext HTTP client.

**Spec:** `docs/superpowers/specs/2026-09-23-partial-package-quantities-design.md`

## Global Constraints

- Do not introduce a Bundle UOM, another item code, or a repacking transaction.
- Preserve existing QR parsing and omit `packageId` until a documented QR field exists.
- Preserve Physical Count offline storage and exact-once retry behavior.
- Keep Receive Finished Goods/Pullout online-only.
- Reuse existing ERPNext endpoints; do not silently call a nonexistent endpoint.
- Keep complete-package scans fast and existing manual multiplier counting operational.
- Deploy the ERPNext optional-argument support before deploying the scanner build that sends package audit fields.
- Do not run an APK build; verify with TypeScript, lint, and Vitest only.
- Preserve all unrelated existing working-tree changes.

## Review Focus

- UOM conversion: audit `qrQuantity`, actual quantity, and movement quantity must all use the authoritative Physical Count UOM after conversion.
- Zero boundary: Physical Count may record zero remaining in an opened package; Pullout must reject zero.
- Multiple scans: package metadata must remain distinct on each transaction after item/location aggregation.
- Retry identity: changing audit metadata changes the fingerprint; retrying unchanged data reuses the same ID and body.
- Legacy data: old localStorage transactions and old three-, four-, and five-field QR labels must continue to load and scan.

---

### Task 1: Shared Package Quantity Rules

**Files:**
- Create: `src/lib/packageQuantity.ts`
- Create: `src/lib/packageQuantity.test.ts`

**Interfaces:**
- Produces: `calculatePhysicalPackage(input): PhysicalPackageResult`
- Produces: `calculatePulloutPackage(input): PulloutPackageResult`
- Produces: `PackageQuantityError` for user-correctable validation failures.

- [ ] **Step 1: Write failing calculation tests**

```ts
expect(calculatePhysicalPackage({ qrQuantity: 500, status: "COMPLETE", input: "" }))
  .toEqual({ qrQuantity: 500, packageStatus: "COMPLETE", actualQuantity: 500, difference: 0, quantity: 500 });
expect(calculatePhysicalPackage({ qrQuantity: 500, status: "OPENED", input: "495" }))
  .toEqual({ qrQuantity: 500, packageStatus: "OPENED", actualQuantity: 495, difference: -5, quantity: 495 });
expect(calculatePulloutPackage({ qrQuantity: 500, mode: "FULL", input: "1" }).quantity).toBe(500);
expect(calculatePulloutPackage({ qrQuantity: 500, mode: "PARTIAL", input: "5" }))
  .toMatchObject({ pulloutQuantity: 5, remainingQuantity: 495, packageStatus: "OPENED", quantity: 5 });
```

Add table tests rejecting blank, nonnumeric, `NaN`, negative, and above-available input; assert Physical Count accepts opened `0` while Pullout rejects `0`. Add a complete-package multiplier test proving two packages produce 1000.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- --run src/lib/packageQuantity.test.ts`

Expected: FAIL because `@/lib/packageQuantity` does not exist.

- [ ] **Step 3: Implement minimal pure calculations**

```ts
export type PackageStatus = "COMPLETE" | "OPENED";

export const calculatePhysicalPackage = ({ qrQuantity, status, input }: PhysicalPackageInput) => {
  requirePositiveQrQuantity(qrQuantity);
  if (status === "COMPLETE") return { qrQuantity, packageStatus: status, actualQuantity: qrQuantity, difference: 0, quantity: qrQuantity };
  const actualQuantity = parseRequiredQuantity(input, { allowZero: true });
  if (actualQuantity > qrQuantity) throw new PackageQuantityError("Actual quantity cannot exceed the QR quantity.");
  return { qrQuantity, packageStatus: status, actualQuantity, difference: actualQuantity - qrQuantity, quantity: actualQuantity };
};
```

Implement Pullout similarly, with `FULL` multiplying whole-package count and `PARTIAL` treating input as units removed.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm.cmd test -- --run src/lib/packageQuantity.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the task**

```powershell
git add -- src/lib/packageQuantity.ts src/lib/packageQuantity.test.ts
git commit -m "feat: add package quantity calculations"
```

### Task 2: Persist Physical Count Package Audit Data

**Files:**
- Modify: `src/lib/scanStorage.ts:7-18,423-465`
- Modify: `src/lib/scanStorage.test.ts`

**Interfaces:**
- Consumes: `PackageStatus` from Task 1.
- Produces: optional `qrQuantity`, `packageStatus`, `actualQuantity`, `remainingQuantity`, and `packageId` fields on `LocalScanTransaction`.

- [ ] **Step 1: Write failing persistence tests**

Create a transaction containing `{ qrQuantity: 500, packageStatus: "OPENED", actualQuantity: 495, remainingQuantity: 495 }`, save and reload it, and assert the fields remain exact. Add a legacy transaction fixture with no package fields and assert it still loads without fabricated values. Add two transactions for the same item/location and assert aggregation retains both audit records independently.

- [ ] **Step 2: Run the storage tests and verify RED**

Run: `npm.cmd test -- --run src/lib/scanStorage.test.ts`

Expected: FAIL because `LocalScanTransaction` and `parseTransactions` discard package fields.

- [ ] **Step 3: Extend the transaction type and parser**

```ts
export type LocalScanTransaction = {
  // existing fields
  qrQuantity?: number;
  packageStatus?: "COMPLETE" | "OPENED";
  actualQuantity?: number;
  remainingQuantity?: number;
  packageId?: string;
};
```

Parse optional numbers only when stored values are finite, accept only the two package statuses, trim optional package ID, and leave fields `undefined` for legacy data.

- [ ] **Step 4: Run storage tests and verify GREEN**

Run: `npm.cmd test -- --run src/lib/scanStorage.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the task**

```powershell
git add -- src/lib/scanStorage.ts src/lib/scanStorage.test.ts
git commit -m "feat: persist package scan audit details"
```

### Task 3: Carry Package Audit Through Physical Count Submission

**Files:**
- Modify: `src/lib/erpService.ts:15-48`
- Modify: `src/lib/pcountSubmission.ts:75-120,206-220`
- Modify: `src/lib/pcountSubmission.test.ts`

**Interfaces:**
- Consumes: package-aware `LocalScanTransaction` from Task 2.
- Produces: package-aware `PcountEntry.transactions` and package-aware source fingerprints.

- [ ] **Step 1: Write failing payload and retry tests**

Add a 500-PCS opened transaction whose `quantityChange` and `actualQuantity` are 495. Assert `buildPcountEntry` produces physical count 495 and retains `qrQuantity: 500`, `packageStatus: "OPENED"`, and `remainingQuantity: 495`. Assert changing only `actualQuantity` or `packageStatus` changes `createPcountSourceFingerprint`. Assert serializing and reading a persisted retry preserves the exact payload and submission ID.

- [ ] **Step 2: Run submission tests and verify RED**

Run: `npm.cmd test -- --run src/lib/pcountSubmission.test.ts`

Expected: FAIL because package fields are absent from the ERP type, builder, and fingerprint.

- [ ] **Step 3: Extend the existing payload mapping**

Copy optional package fields from each local transaction into the mapped ERP transaction. Include those same optional fields in the fingerprint transaction object. Do not add package fields to legacy transactions.

- [ ] **Step 4: Run submission and storage tests and verify GREEN**

Run: `npm.cmd test -- --run src/lib/pcountSubmission.test.ts src/lib/scanStorage.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the task**

```powershell
git add -- src/lib/erpService.ts src/lib/pcountSubmission.ts src/lib/pcountSubmission.test.ts
git commit -m "feat: submit physical count package audit data"
```

### Task 4: Add Opened Package Controls to Physical Count

**Files:**
- Modify: `src/components/ScanPage.tsx:98-110,1300-1615,1703-1760,3973-4040`
- Modify: embedded Physical Count styles in `src/components/ScanPage.tsx`
- Test: `src/lib/packageQuantity.test.ts`

**Interfaces:**
- Consumes: `calculatePhysicalPackage` and package-aware local transactions.
- Produces: existing scan flow with Complete Package default and an Opened Package input path.

- [ ] **Step 1: Add failing integration-oriented calculation cases**

Add tests proving an opened ADD records 495 while its audit QR quantity remains 500, and an opened DEDUCT signs only the actual 495. Name the mutation each test catches: accidentally using `qrQuantity` instead of `actualQuantity`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm.cmd test -- --run src/lib/packageQuantity.test.ts`

Expected: FAIL until the shared result exposes the signed movement helper or equivalent interface used by `ScanPage`.

- [ ] **Step 3: Add component state and transaction mapping**

Add `packageStatus` state defaulting to `COMPLETE`. Preserve current automatic mode by calling the complete calculation immediately. In prompted mode:

- Render the status selector below `.scan-qty-item`.
- Label complete input `Package Count` and keep multiplier behavior.
- Label opened input `Actual Quantity Remaining` and treat it as units.
- Show QR Quantity, Difference, and Quantity to be Counted for opened packages.
- Disable confirmation on validation error or `isAllocating`.
- Store audit fields on the newly created `scanTransactions[0]`.
- Reset package state after success, cancellation, reference/location changes, and a new scan.

- [ ] **Step 4: Keep the dialog visible without overlap**

Use the existing compact modal breakpoints. Make the dialog body vertically scrollable only on very short screens while keeping actions in normal flow; do not shrink the current keypad or font sizes.

- [ ] **Step 5: Run focused and type checks**

Run: `npm.cmd test -- --run src/lib/packageQuantity.test.ts src/lib/scanStorage.test.ts src/lib/pcountSubmission.test.ts`

Run: `npx.cmd tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit the task**

```powershell
git add -- src/components/ScanPage.tsx src/lib/packageQuantity.ts src/lib/packageQuantity.test.ts
git commit -m "feat: count opened packages in physical count"
```

### Task 5: Extend the Existing Pullout Draft Request

**Files:**
- Modify: `src/lib/manufacturingService.ts:229-260`
- Create: `src/lib/manufacturingService.test.ts`

**Interfaces:**
- Consumes: calculated Pullout package details.
- Produces: optional `qrQuantity`, `packageStatus`, `pulloutQuantity`, `remainingQuantity`, `packageCount`, and `packageId` options on `createManufactureReceiveDraft`.

- [ ] **Step 1: Write failing request-contract tests**

Stub the ERP request boundary and assert a full package sends `quantity: 500`, `qr_quantity: 500`, `package_status: "COMPLETE"`, and `package_count: 1`. Assert a partial pullout sends `quantity: 5`, `pullout_quantity: 5`, `remaining_quantity: 495`, and `package_status: "OPENED"`. Call the same request twice after a simulated network failure and assert its `request_id` is unchanged.

- [ ] **Step 2: Run the service test and verify RED**

Run: `npm.cmd test -- --run src/lib/manufacturingService.test.ts`

Expected: FAIL because the request options and payload omit package metadata.

- [ ] **Step 3: Extend options and body without changing endpoint**

```ts
type ManufactureDraftOptions = {
  quantity?: number;
  actualWeightPerItem?: number;
  deviceId?: string;
  requestId?: string;
  qrQuantity?: number;
  packageStatus?: "COMPLETE" | "OPENED";
  pulloutQuantity?: number;
  remainingQuantity?: number;
  packageCount?: number;
  packageId?: string;
};
```

Map defined values to existing snake_case body conventions. Include package mode and quantities in the pending-request key so a changed form cannot reuse an unrelated mutation body.

- [ ] **Step 4: Run the service tests and verify GREEN**

Run: `npm.cmd test -- --run src/lib/manufacturingService.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the task**

```powershell
git add -- src/lib/manufacturingService.ts src/lib/manufacturingService.test.ts
git commit -m "feat: send pullout package audit fields"
```

### Task 6: Add Full and Partial Pullout Controls

**Files:**
- Modify: `src/components/ManufacturingScanner.tsx:20-30,229-475,918-919`
- Modify: `src/components/ManufacturingScanner.css:291-337,715-807`
- Test: `src/lib/packageQuantity.test.ts`

**Interfaces:**
- Consumes: `calculatePulloutPackage` and extended `createManufactureReceiveDraft` from Tasks 1 and 5.
- Produces: Full Package default, multiple-complete-package count, Partial Pullout quantity, and confirmation summary.

- [ ] **Step 1: Add failing state-transition calculation tests**

Test that changing from full count `2` to partial resets input rather than interpreting `2` as two pieces, and changing back defaults to one complete package. Test that invalid partial input cannot produce request options.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- --run src/lib/packageQuantity.test.ts`

Expected: FAIL until mode-specific defaults/validation are exposed by the shared module.

- [ ] **Step 3: Implement Pullout UI state and summary**

Add `pulloutMode: "FULL" | "PARTIAL"` defaulting to `FULL`. Place a two-option selector below the item card. In full mode, label input `Complete Package Count`; in partial mode label it `Pullout Quantity`. Show QR quantity, remaining package quantity, and resulting Opened status only in partial mode. Use the calculation result for the Draft `quantity` and audit options.

Expand Pullout Details into the required confirmation summary before Create Draft. Keep Pull Out Slip and Actual Weight inputs and all existing Job Card/UOM validation.

- [ ] **Step 4: Preserve retry and reset semantics**

Do not clear `draftRequestIdRef` after a failed request. Reset it, package mode, and quantity only after success or explicit cancellation/new label. Keep controls disabled while `busy`.

- [ ] **Step 5: Style for existing scanner dimensions**

Reuse current modal colors and minimum font sizes. Keep keypad/button dimensions unchanged. Allow the modal content to scroll on short screens so labels and actions cannot overlap.

- [ ] **Step 6: Run focused checks**

Run: `npm.cmd test -- --run src/lib/packageQuantity.test.ts src/lib/manufacturingService.test.ts`

Run: `npx.cmd tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit the task**

```powershell
git add -- src/components/ManufacturingScanner.tsx src/components/ManufacturingScanner.css src/lib/packageQuantity.ts src/lib/packageQuantity.test.ts
git commit -m "feat: support partial package pullout"
```

### Task 7: Regression and Final Verification

**Files:**
- Modify only files required to fix failures caused by Tasks 1-6.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified feature with no APK build.

- [ ] **Step 1: Run all tests**

Run: `npm.cmd test -- --run`

Expected: every test passes, including legacy QR, Physical Count storage/submission, manufacturing workflow, and idempotency tests.

- [ ] **Step 2: Run TypeScript and lint**

Run: `npx.cmd tsc --noEmit`

Run: `npm.cmd run lint`

Expected: both exit successfully with no new errors.

- [ ] **Step 3: Review the diff for scope and payload safety**

Run: `git diff --check`

Run: `git diff -- src/lib/packageQuantity.ts src/lib/scanStorage.ts src/lib/pcountSubmission.ts src/lib/erpService.ts src/components/ScanPage.tsx src/lib/manufacturingService.ts src/components/ManufacturingScanner.tsx src/components/ManufacturingScanner.css`

Confirm no endpoint was added, no QR field was reinterpreted as package ID, no unrelated user changes were removed, and no APK/build command was run.

- [ ] **Step 4: Commit any verification-only fixes**

```powershell
git add -p -- src/lib/packageQuantity.ts src/lib/packageQuantity.test.ts src/lib/scanStorage.ts src/lib/scanStorage.test.ts src/lib/pcountSubmission.ts src/lib/pcountSubmission.test.ts src/lib/erpService.ts src/lib/manufacturingService.ts src/lib/manufacturingService.test.ts src/components/ScanPage.tsx src/components/ManufacturingScanner.tsx src/components/ManufacturingScanner.css
git commit -m "test: cover partial package workflows"
```

Skip this commit when verification required no code changes. Stage only verification-fix hunks because these files contained user work before this plan began.
