# QCMC Scanner Post-Login UI System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply one consistent white, blue, operator-readable UI system to every authenticated Scanner App page without changing workflow behavior or backend contracts.

**Architecture:** Add a scoped authenticated theme and extract the persistent bottom navigation/Mode selector from `BlankPage.tsx` into focused components. Migrate one workflow family at a time by changing presentation classes and CSS while leaving service calls, payloads, persistence, and state transitions intact.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, CSS, Lucide React, Capacitor App.

**Spec:** `docs/superpowers/specs/2026-09-24-post-login-ui-system-design.md`

## Global Constraints

- The Login page is excluded and must not change.
- Do not change ERPNext APIs, request payloads, stored transaction formats, QR parsers, or business rules.
- Internal package values remain `COMPLETE` and `OPENED`; only display text becomes Big Pack and Loose Pack.
- Loose Pack must require an exact remaining quantity and must never silently use the full QR quantity.
- Preserve local history, Resume Work, offline Physical Count, request idempotency, Android Back, scanner capture, and all existing validations.
- Keep primary controls at least 48px high and prevent horizontal scrolling or label overlap at 320px width.
- The bottom navigation must consume layout height and must not overlay action docks.
- Do not install a font or UI dependency.
- Do not build an APK; the user performs that manually.
- Preserve unrelated dirty-worktree changes and stage only files named by the current task.

## Review Focus

- A 320px-wide device with long document IDs and location paths: content wraps or deliberately truncates without horizontal scrolling or overlapping controls; covered in Tasks 2–6 source-contract tests.
- A short viewport with a quantity dialog and persistent navigation: confirmation controls remain reachable above the navigation; covered in Tasks 2, 4, and 5 layout-contract tests.
- Loose Pack combined with Automatic quantity: the app switches to Manual before quantity entry and never treats the QR quantity as the loose remainder; covered in Task 1 behavior tests.
- Android Back while the Mode menu or a scanner sub-screen is open: close the topmost transient layer first and preserve existing back destinations; covered in Tasks 2 and 7.
- Offline or resumed work during a visual migration: existing local sessions and Resume Work actions remain unchanged; covered by the full suite in every task and focused flow tests in Tasks 3–6.

---

### Task 1: Finish the Saved Mode Model and Package Terminology

**Files:**
- Modify: `src/lib/scannerPreferences.ts`
- Modify: `src/lib/scannerPreferences.test.ts`
- Modify: `src/components/ScanPage.tsx`
- Modify: `src/components/ManufacturingScanner.tsx`

**Interfaces:**
- Produces: `ScannerQuantityMode = "automatic" | "manual"`
- Produces: `ScannerPackageMode = "big" | "loose"`
- Produces: `loadScannerQuantityMode(): ScannerQuantityMode`
- Produces: `saveScannerQuantityMode(mode: ScannerQuantityMode): ScannerQuantityMode`
- Produces: `loadScannerPackageMode(): ScannerPackageMode`
- Produces: `saveScannerPackageMode(mode: ScannerPackageMode): ScannerPackageMode`
- Mapping: `big -> COMPLETE`, `loose -> OPENED`

- [ ] **Step 1: Extend the failing preference tests with the safety rule**

Add a pure resolver to the test contract:

```ts
import { resolveScannerModes } from "@/lib/scannerPreferences";

it("forces manual quantity entry for loose packs", () => {
  expect(resolveScannerModes("automatic", "loose")).toEqual({
    quantityMode: "manual",
    packageMode: "loose",
  });
  expect(resolveScannerModes("automatic", "big")).toEqual({
    quantityMode: "automatic",
    packageMode: "big",
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- --run src/lib/scannerPreferences.test.ts`

Expected: FAIL because `resolveScannerModes` is not exported.

- [ ] **Step 3: Implement the minimal resolver and use it when saving Mode choices**

Add:

```ts
export const resolveScannerModes = (
  quantityMode: ScannerQuantityMode,
  packageMode: ScannerPackageMode,
) => packageMode === "loose"
  ? { quantityMode: "manual" as const, packageMode }
  : { quantityMode, packageMode };
```

Initialize `ScanPage` from both saved preferences. When an item enters quantity entry, map `big` to `COMPLETE` and `loose` to `OPENED`. Save changes made by the existing package buttons. Replace user-facing Complete/Opened Package copy with Big/Loose Pack in Physical Count and Pullout, but leave stored and submitted enum values untouched.

- [ ] **Step 4: Run focused and workflow tests**

Run: `npm.cmd test -- --run src/lib/scannerPreferences.test.ts src/lib/packageQuantity.test.ts src/lib/pcountSubmission.test.ts src/lib/warehouseHandoverApi.test.ts`

Expected: all selected tests PASS.

- [ ] **Step 5: Run static checks**

Run: `npx.cmd tsc --noEmit`

Expected: exit 0.

Run: `npm.cmd run lint`

Expected: exit 0.

- [ ] **Step 6: Commit only Task 1 files**

```powershell
git add src/lib/scannerPreferences.ts src/lib/scannerPreferences.test.ts src/components/ScanPage.tsx src/components/ManufacturingScanner.tsx
git commit -m "feat: save scanner quantity and package modes"
```

### Task 2: Create the Authenticated Theme and Shared Shell Components

**Files:**
- Create: `src/styles/authenticated-ui.css`
- Create: `src/lib/authenticatedUi.ts`
- Create: `src/lib/authenticatedUi.test.ts`
- Create: `src/components/AuthenticatedBottomNav.tsx`
- Modify: `src/components/BlankPage.tsx`

**Interfaces:**
- Consumes: saved Mode APIs from Task 1.
- Produces: `AUTH_NAV_ITEMS` with Inventory, Delivery, Transactions, and Profile destinations.
- Produces: `authenticatedViewIsInventory(view: ViewType): boolean`.
- Produces: `<AuthenticatedBottomNav currentView scanMode onNavigate onDelivery onTransactions />`.
- Produces: scoped `.qcmc-auth-*` theme classes and CSS custom properties beneath `.bp-root`.

- [ ] **Step 1: Write failing navigation and layout-contract tests**

Create `authenticatedUi.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AUTH_NAV_ITEMS, authenticatedViewIsInventory } from "@/lib/authenticatedUi";

describe("authenticated UI contract", () => {
  it("defines the requested navigation destinations in order", () => {
    expect(AUTH_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Inventory", "Delivery", "Transactions", "Profile",
    ]);
  });

  it("treats inventory workflow views as Inventory", () => {
    expect(authenticatedViewIsInventory("dashboard")).toBe(true);
    expect(authenticatedViewIsInventory("location_transfer")).toBe(true);
    expect(authenticatedViewIsInventory("history")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- --run src/lib/authenticatedUi.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the theme contract and bottom navigation**

Define the navigation data and inventory predicate in `authenticatedUi.ts`. Extract the existing five-position navigation markup and animated four-choice Mode menu into `AuthenticatedBottomNav.tsx`. Keep the Mode click-away button transparent and expose callbacks rather than importing workflow services.

Create `authenticated-ui.css` with scoped tokens:

```css
.bp-root {
  --qcmc-auth-bg: #eaf6f8;
  --qcmc-surface: #ffffff;
  --qcmc-text: #101828;
  --qcmc-muted: #667085;
  --qcmc-border: #e5eaf0;
  --qcmc-blue: #086bf2;
  --qcmc-orange: #f05a18;
  --qcmc-purple: #6652cc;
  --qcmc-radius: 14px;
  background: var(--qcmc-auth-bg);
}

.qcmc-auth-card {
  min-width: 0;
  border: 1px solid var(--qcmc-border);
  border-radius: var(--qcmc-radius);
  background: var(--qcmc-surface);
}
```

The shell must be flex-column: content is `min-height: 0; flex: 1`, navigation is `flex: 0 0 auto`. Do not use a fixed overlay for navigation.

- [ ] **Step 4: Add Android Back and click-away behavior**

When the Mode menu is open, its close callback is the first back action handled by the authenticated shell. Retain the existing child scanner back handlers when the menu is closed. Add `aria-expanded`, `role="menu"`, and selection state.

- [ ] **Step 5: Verify focused tests and shell compilation**

Run: `npm.cmd test -- --run src/lib/authenticatedUi.test.ts src/lib/navigationPolicy.test.ts src/lib/scannerPreferences.test.ts`

Expected: all selected tests PASS.

Run: `npx.cmd tsc --noEmit`

Expected: exit 0.

- [ ] **Step 6: Commit only Task 2 files**

```powershell
git add src/styles/authenticated-ui.css src/lib/authenticatedUi.ts src/lib/authenticatedUi.test.ts src/components/AuthenticatedBottomNav.tsx src/components/BlankPage.tsx
git commit -m "feat: add authenticated scanner UI shell"
```

### Task 3: Migrate Inventory, Resume Work, Transactions, Profile, and Settings

**Files:**
- Modify: `src/components/BlankPage.tsx`
- Modify: `src/styles/authenticated-ui.css`
- Test: `src/lib/authenticatedUi.test.ts`

**Interfaces:**
- Consumes: shared shell, nav component, theme tokens, and `.qcmc-auth-card` from Task 2.
- Produces: dashboard tiles and account/list pattern classes used as visual references by later tasks.

- [ ] **Step 1: Add a failing copy-and-route contract test**

Extend `authenticatedUi.test.ts` with exported operation metadata:

```ts
expect(INVENTORY_OPERATIONS.map((item) => item.label)).toEqual([
  "Pullout", "Checker", "Picker", "Physical count", "Issue stock", "Transfer location",
]);
expect(new Set(INVENTORY_OPERATIONS.map((item) => item.accent))).toEqual(
  new Set(["blue", "purple", "orange"]),
);
```

Expected RED: `INVENTORY_OPERATIONS` is not exported.

- [ ] **Step 2: Implement operation metadata without changing callbacks**

Move only labels, descriptions, icons keys, and accent names into `authenticatedUi.ts`. Keep `startManufacturingRole`, `startScanner`, `resumeAllocation`, `openHistory`, logout, connection testing, and clear-history handlers in `BlankPage.tsx`.

- [ ] **Step 3: Apply shared patterns to all `BlankPage` views**

Use shared header, card, list, status-chip, icon-button, primary/secondary button, dialog, and empty-state classes. Remove conflicting duplicate inline rules only after their replacement exists in `authenticated-ui.css`.

Ensure:

- Resume Work remains above operations and scrolls with content;
- transaction totals and long references wrap;
- Settings retains Saved Scans, Scanner Name, Text Size, ERP connection, version, clear data, and logout;
- Profile retains existing employee information and actions;
- the Login component and its CSS are not touched.

- [ ] **Step 4: Add narrow-screen source contracts**

Add assertions that every operation has a non-empty short description and that labels are unique. In CSS, use `grid-template-columns: repeat(2, minmax(0, 1fr))`, `min-width: 0`, and `overflow-wrap: anywhere` on text containers.

- [ ] **Step 5: Run verification**

Run: `npm.cmd test -- --run src/lib/authenticatedUi.test.ts src/lib/scanStorage.test.ts src/lib/pcountSubmission.test.ts`

Expected: all selected tests PASS.

Run: `npx.cmd tsc --noEmit`

Expected: exit 0.

Run: `npm.cmd run lint`

Expected: exit 0.

- [ ] **Step 6: Commit only Task 3 files**

```powershell
git add src/components/BlankPage.tsx src/styles/authenticated-ui.css src/lib/authenticatedUi.ts src/lib/authenticatedUi.test.ts
git commit -m "style: unify inventory and account screens"
```

### Task 4: Migrate Pullout, Checker, Picker, and Warehouse Allocation

**Files:**
- Modify: `src/components/ManufacturingScanner.tsx`
- Modify: `src/components/ManufacturingScanner.css`
- Test: `src/lib/manufacturingWorkflow.test.ts`
- Test: `src/lib/warehouseHandover.test.ts`

**Interfaces:**
- Consumes: Task 2 theme tokens and shell height contract.
- Preserves: every manufacturing stage, handover token, Checker submission, same-device proceed action, allocation resume, capacity validation, and completion logic.

- [ ] **Step 1: Add failing presentation-state tests for workflow steps**

Extract a pure display helper into `manufacturingWorkflow.ts` and test:

```ts
expect(getManufacturingStepState("receive")).toEqual({ current: 1, title: "Pullout" });
expect(getManufacturingStepState("checker")).toEqual({ current: 2, title: "Checker" });
expect(getManufacturingStepState("allocation")).toEqual({ current: 3, title: "Warehouse Allocation" });
```

Expected RED: `getManufacturingStepState` is not exported.

- [ ] **Step 2: Implement the pure display helper and use it in the component**

The helper maps existing stages only; it must not change stage transitions. Replace the local heading/step ternaries with the tested display output.

- [ ] **Step 3: Restyle the workflow**

Apply consistent white headers/cards, blue stepper, semantic accent cards, form controls, QR panel, allocation progress, item rows, actual weight controls, notices, and action docks. Replace full-viewport sizing with `height: 100%` inside `.bp-surface` so persistent navigation receives its own layout row.

Keep `.mfg-scroll` as the only main scroll region and `.mfg-dock` as a non-overlapping flex child. Long Stock Entry, Work Order, item, and location values require `min-width: 0` plus wrapping/ellipsis.

- [ ] **Step 4: Verify manufacturing behavior**

Run: `npm.cmd test -- --run src/lib/manufacturingWorkflow.test.ts src/lib/warehouseHandover.test.ts src/lib/warehouseHandoverApi.test.ts src/lib/packageQuantity.test.ts`

Expected: all selected tests PASS.

Run: `npx.cmd tsc --noEmit`

Expected: exit 0.

Run: `npm.cmd run lint`

Expected: exit 0.

- [ ] **Step 5: Commit only Task 4 files**

```powershell
git add src/components/ManufacturingScanner.tsx src/components/ManufacturingScanner.css src/lib/manufacturingWorkflow.ts src/lib/manufacturingWorkflow.test.ts
git commit -m "style: unify finished goods workflow screens"
```

### Task 5: Migrate Physical Count and Delivery / Issue Stock

**Files:**
- Modify: `src/components/ScanPage.tsx`
- Modify: `src/styles/authenticated-ui.css`
- Test: `src/lib/packageQuantity.test.ts`
- Test: `src/lib/pcountSubmission.test.ts`
- Test: `src/lib/scanStorage.test.ts`

**Interfaces:**
- Consumes: saved quantity/package modes from Task 1 and shared theme tokens from Task 2.
- Preserves: offline cache, blind count, baseline refresh, scan queue, Resume Work, package audit metadata, and submission behavior.

- [ ] **Step 1: Add the Loose Pack regression test**

Add a focused test proving that `OPENED` uses the entered remainder and never the QR quantity:

```ts
expect(calculatePhysicalPackage({ qrQuantity: 500, status: "OPENED", input: "73" })).toMatchObject({
  quantity: 73,
  actualQuantity: 73,
  packageStatus: "OPENED",
});
```

Run the test first. If it already passes, retain it as explicit regression coverage and record that this is an existing-behavior characterization, not a new implementation test.

- [ ] **Step 2: Apply shared Physical Count presentation**

Restyle the header, three-step setup, reference/location cards, Automatic/Manual toggle, start action, scan summary, counted locations, empty state, messages, and submit dock. Preserve the current scroll container and keep the setup action visible without forcing page-level horizontal or nested scrolling.

- [ ] **Step 3: Apply shared quantity dialog and package terminology**

Use Big Pack/Loose Pack labels, large keypad controls, a visible total, and confirmation actions that fit above the bottom navigation. Do not rename enum values in transactions or payloads.

- [ ] **Step 4: Apply the same visual patterns to Delivery / Issue Stock**

Use the orange accent for removal actions while retaining existing scan modes, quantities, validations, local records, and submission logic.

- [ ] **Step 5: Verify Physical Count and Delivery**

Run: `npm.cmd test -- --run src/lib/packageQuantity.test.ts src/lib/pcountSubmission.test.ts src/lib/scanStorage.test.ts src/lib/storageLocationService.test.ts`

Expected: all selected tests PASS.

Run: `npx.cmd tsc --noEmit`

Expected: exit 0.

Run: `npm.cmd run lint`

Expected: exit 0.

- [ ] **Step 6: Commit only Task 5 files**

```powershell
git add src/components/ScanPage.tsx src/styles/authenticated-ui.css src/lib/packageQuantity.test.ts
git commit -m "style: unify physical count and delivery screens"
```

### Task 6: Migrate Transfer Location and Remaining Authenticated Scanner Pages

**Files:**
- Modify: `src/components/LocationTransferScanner.tsx`
- Modify: `src/components/LocationTransferScanner.css`
- Modify: `src/components/JobCardTimeScanner.tsx`
- Modify: `src/components/JobCardTimeScanner.css`
- Test: `src/lib/locationTransfer.test.ts`
- Test: `src/lib/jobCardTimeService.test.ts`

**Interfaces:**
- Consumes: Task 2 theme tokens and shell layout.
- Preserves: transfer scan order, stock lookup, idempotent request IDs, retries, backend messages, and Job Card time behavior.

- [ ] **Step 1: Add/retain transfer idempotency coverage**

Ensure the test suite explicitly proves the same request ID is reused for a retried transaction. Run:

`npm.cmd test -- --run src/lib/locationTransfer.test.ts`

Expected: PASS before presentation edits; if absent, add a failing test against the existing request builder before changing production logic.

- [ ] **Step 2: Restyle Transfer Location**

Apply the shared header, step treatment, blue/orange cards, scanner prompts, item/source/destination summaries, quantity form, backend validation notice, success state, and dock. Do not reintroduce an on-screen Back button; Android Back remains the navigation method requested by the user.

- [ ] **Step 3: Restyle Job Card Time if reachable**

Apply the same authenticated header, cards, status, and buttons without changing time-log service calls. If the page is feature-gated, style it anyway because it is an authenticated page in the repository.

- [ ] **Step 4: Verify remaining workflows**

Run: `npm.cmd test -- --run src/lib/locationTransfer.test.ts src/lib/jobCardTimeService.test.ts src/lib/storageLocationService.test.ts`

Expected: all selected tests PASS.

Run: `npx.cmd tsc --noEmit`

Expected: exit 0.

Run: `npm.cmd run lint`

Expected: exit 0.

- [ ] **Step 5: Commit only Task 6 files**

```powershell
git add src/components/LocationTransferScanner.tsx src/components/LocationTransferScanner.css src/components/JobCardTimeScanner.tsx src/components/JobCardTimeScanner.css
git commit -m "style: unify transfer and job card scanner screens"
```

### Task 7: Whole-App Responsive and Regression Gate

**Files:**
- Modify only files already named by Tasks 1–6 when a verified defect is found.
- Test: all `src/**/*.test.ts` files.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: a verified post-login UI migration ready for the user's manual APK build.

- [ ] **Step 1: Audit the source against the spec**

Search for stale user-facing package terms and unsafe viewport/layout patterns:

```powershell
rg -n "Complete Package|Opened Package|100dvh|position:\s*fixed|overflow-x" src/components src/styles
```

Expected: no stale package labels; every fixed/viewport rule is reviewed and intentionally compatible with the shell.

- [ ] **Step 2: Audit every authenticated route**

Review Inventory, Pullout, Checker, Picker, Allocation, Physical Count, Delivery, Transfer Location, Transactions, Settings, Profile, and Job Card Time markup for:

- one bounded vertical scroll region;
- bottom actions above navigation;
- `min-width: 0` on grid/flex text children;
- wrapping or intentional ellipsis on IDs and location paths;
- minimum 48px high primary controls;
- semantic focus states and labels.

- [ ] **Step 3: Verify Android Back ownership**

Confirm the Mode menu closes before page navigation. Confirm each scanner component still owns its existing sub-screen back behavior after the menu is closed. Add a focused pure-state test for any defect before changing code.

- [ ] **Step 4: Run complete verification**

Run: `npx.cmd tsc --noEmit`

Expected: exit 0.

Run: `npm.cmd run lint`

Expected: exit 0 with no warnings.

Run: `npm.cmd test -- --run`

Expected: all test files and tests PASS with zero failures.

- [ ] **Step 5: Review the final diff and confirm exclusions**

Run:

```powershell
git diff -- src/components/LoginPage.tsx
git diff -- src/lib/erpApi.ts src/lib/erpService.ts src/lib/manufacturingService.ts
```

Expected: no Login visual changes and no unplanned API/business-logic changes.

- [ ] **Step 6: Do not build the APK**

Record that TypeScript, lint, and tests passed. Leave `npm run build`, Capacitor sync, Gradle, and APK generation to the user.

- [ ] **Step 7: Confirm the verification gate introduced no untracked scope**

Run: `git status --short`

Expected: only the files named by Tasks 1–6 and the approved spec/plan are changed. If Step 1–5 exposed a defect, return to its owning task, reproduce it with a failing test, fix it there, and repeat Task 7 from Step 1.
