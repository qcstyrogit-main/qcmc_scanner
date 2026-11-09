# QCMC Scanner Post-Login UI System

## Goal

Apply one consistent, operator-friendly visual system to every authenticated QCMC Scanner screen while preserving the existing workflows, local persistence, scanner behavior, ERPNext requests, and backend contracts. The Login page is explicitly excluded.

## Users and Success Criteria

The primary users are warehouse operators, including users in their 50s who need readable text, obvious actions, and forgiving touch targets.

The redesign succeeds when:

- every post-login page visibly belongs to the same white, blue, and pale-background interface;
- all existing workflows remain reachable and behave as before;
- the bottom navigation remains visible without covering page controls;
- no label, value, dialog action, or fixed button overlaps at supported phone widths;
- long document names and location paths wrap or truncate deliberately;
- scanner capture and Android Back behavior remain functional;
- TypeScript, ESLint, and the complete automated test suite pass;
- no APK is built as part of this work.

## Scope

The shared system applies to:

- Inventory dashboard and Resume Work;
- Pullout, Checker, Picker, and Warehouse Allocation;
- Physical Count;
- Issue Stock / Delivery;
- Transfer Location;
- Transactions / Saved Scans;
- Profile and Settings;
- shared dialogs, quantity keypads, notices, loading states, and empty states;
- the five-item bottom navigation and animated Mode selector.

The Login page, ERPNext APIs, request payloads, stored transaction formats, QR parsers, and business rules are out of scope.

## Visual Foundation

### Colors

- App background: pale blue-gray (`#eaf6f8` family).
- Screen and card surfaces: white.
- Primary text: near-black navy.
- Secondary text: muted slate.
- Primary action: clear blue.
- Pullout, Checker, and Picker accents: blue family.
- Physical Count accent: purple.
- Issue Stock and Transfer Location accents: orange.
- Success, warning, and error colors retain semantic green, amber, and red.

Color must never be the only status indicator; icons and text labels remain present.

### Typography

- Use the existing application fonts; do not add a network font dependency.
- Page titles are bold and high contrast.
- Core body and control text retain the current operator-readable baseline.
- Metadata may be smaller but must remain legible.
- Controls permit wrapping and never use clipping that hides the action meaning.

### Spacing and Shape

- Page gutters: approximately 14–16px on phones.
- Card gaps: approximately 8–12px.
- Card radius: 12–14px with a light neutral border.
- Primary touch targets: minimum 48px high; high-frequency actions target 52–56px.
- Shadows are restrained and used only to establish elevation.

## Shared Application Shell

Authenticated pages use a shared shell with three regions:

1. An optional compact header containing a small device or workflow label, the page title, and at most one right-side action.
2. A scroll-safe content area that owns page scrolling.
3. The persistent five-item bottom navigation.

The bottom navigation contains:

- Inventory: opens the operation dashboard.
- Delivery: opens Issue Stock.
- Mode: raised black center control; expands the saved scanning-mode choices without navigating.
- Transactions: opens Saved Scans / transaction history.
- Profile: opens the account page.

The shell allocates layout height to navigation instead of overlaying it. Scanner docks and submit controls therefore remain visible immediately above the navigation.

## Mode Selector

The Mode button displays an animated two-by-two group of circular choices:

- Automatic;
- Manual;
- Big Pack;
- Loose Pack.

The click-away layer is transparent so the page does not become gray. Selecting a choice saves the corresponding device preference and closes the menu without navigating.

Existing ERP/audit values remain compatible: user-facing **Big Pack** maps to the existing `COMPLETE` package status, and **Loose Pack** maps to `OPENED`. Internal values and backend payloads are not renamed.

Loose Pack requires an exact remaining quantity. It must not silently submit a full QR quantity. Existing validation and quantity-entry behavior remain authoritative.

## Component Patterns

### Headers

All module headers use the same hierarchy and dimensions. Workflow pages may display the operator and scanner name below the title. Header controls use bordered square icon buttons.

### Cards

Cards use white surfaces, subtle borders, rounded corners, and consistent internal spacing. Metadata is grouped into clear label/value pairs. Document identifiers use wrapping-safe monospace where already useful.

### Buttons

- Primary: solid blue, except semantic transfer/destructive actions.
- Secondary: white with a neutral border.
- Transfer/movement: orange where this improves recognition.
- Destructive: red and confirmation-gated.
- Disabled: lower emphasis but still readable.

Sticky action docks remain part of the page layout and cannot cover content.

### Forms and Selectors

Inputs, literal dropdowns, date/time wheels, toggles, and scanner fields share border, radius, focus, and label treatments. Existing iOS-style scrolling date/time controls remain unchanged functionally.

### Dialogs and Keypads

Dialogs fit within the available viewport above the navigation. Their content scrolls only when genuinely necessary. Primary confirmation actions remain visible, and quantity keypad buttons retain large touch areas.

### Status and Feedback

Notices use a consistent icon, title, explanatory copy, and semantic border/background. Loading indicators block duplicate actions but do not erase the surrounding context.

## Page Application

### Inventory

Retain the two-column operation tile grid, Resume Work cards, compact header, and persistent navigation. Long labels wrap without changing card widths.

### Pullout, Checker, Picker, and Warehouse Allocation

Restyle the existing three-step workflow, batch cards, item rows, quantities, actual weights, QR presentation, location verification, allocation progress, and dock actions. Do not modify handover tokens, resume behavior, row reconciliation, capacity validation, or ERPNext submission logic.

### Physical Count

Restyle reference/location/item setup, scan session summaries, counted-location cards, quantity dialogs, package selectors, blind-count messages, resume state, and submission dialogs. Preserve offline storage, synchronization handling, baseline refresh logic, and audit data.

User-facing package terminology becomes Big Pack and Loose Pack while stored values remain `COMPLETE` and `OPENED`.

### Delivery / Issue Stock

Apply the shared header, cards, scanner field, quantity entry, saved-state feedback, and action dock. No stock-removal rules or payloads change.

### Transfer Location

Apply the shared header, step presentation, item/location summaries, quantity entry, validation notices, and action dock. Keep source/destination scan order, idempotent request IDs, retry behavior, and ERPNext APIs unchanged.

### Transactions

Use shared list cards, status chips, totals, empty states, and detail panels. Device-local history behavior and resubmission logic remain unchanged.

### Profile and Settings

Use grouped white settings cards with clear icons and values. Preserve scanner name, text size, connection testing, saved-scan controls, and logout behavior.

## Responsive and Accessibility Rules

- The primary target is narrow Android warehouse devices.
- Test narrow widths around 320px as well as typical phone widths.
- Use `minmax(0, 1fr)`, wrapping, and deliberate ellipsis to prevent overlap.
- No horizontal page scrolling.
- Maintain visible keyboard focus and meaningful ARIA labels.
- Respect safe-area and Android navigation insets.
- Important information cannot depend only on hover.

## Implementation Boundaries

Prefer shared CSS variables and reusable shell/pattern classes over duplicating page-specific values. Existing component boundaries and event handlers remain intact unless a small extraction is required to share presentation safely.

The migration must avoid broad business-logic refactors. Any code change outside styling or presentation wiring requires a focused regression test demonstrating why it is necessary.

## Verification

Verification includes:

- focused tests for any new shared UI-state helpers or preferences;
- existing workflow tests for handover, allocation, Physical Count, storage, and retries;
- TypeScript compilation with no emit;
- ESLint;
- the complete Vitest suite;
- source review for viewport units, sticky/fixed controls, overflow, and narrow-screen label behavior.

The APK build remains manual and is not run during this task.
