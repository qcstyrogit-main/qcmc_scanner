# Partial Package Quantities Design

## Purpose

Add partially opened package support to Physical Count and Receive Finished Goods/Pullout without introducing a Bundle UOM, a second item code, or a repacking transaction. The quantity printed in the QR remains immutable audit data. Physical Count and ERPNext stock movements use only the quantity the operator actually counts or removes.

This feature must preserve the scanner's existing fast path, local Physical Count storage, blind-count behavior, retry identities, and duplicate-submission protection.

## Existing Behavior

Packing labels currently use the semicolon format:

```text
Item Code;Package Quantity;UOM;Work Order;Job Card
```

Older three- and four-field labels remain supported. The current format has no defined unique package identifier.

Physical Count parses the label, converts the printed quantity to the authoritative ERPNext stock UOM when necessary, and records a local scan transaction. A complete package is added automatically when automatic quantity mode is enabled. Manual quantity mode currently treats operator input as a multiplier of the printed QR quantity.

Receive Finished Goods/Pullout validates a Job Card online and creates a Draft Manufacture Stock Entry using the printed QR quantity multiplied by the entered package count. This workflow is intentionally online-only. The existing request ID is reused for an on-screen retry of the same draft request.

## Terminology and Quantity Semantics

- `qrQuantity`: Original quantity printed in the QR, converted to the authoritative stock UOM where Physical Count already performs UOM conversion. It is immutable audit metadata.
- `packageStatus`: `COMPLETE` or `OPENED`.
- `actualQuantity`: Quantity physically remaining in an opened package during Physical Count.
- `pulloutQuantity`: Quantity removed during Pullout.
- `remainingQuantity`: Quantity left in a package after Pullout.
- `quantityChange`: Signed quantity applied to a Physical Count transaction. Pullout sends the positive movement quantity through the existing draft endpoint; the audit representation may also record its conceptual `quantityChange` as negative.
- `packageId`: Optional unique identifier supplied by a future documented QR format. It is omitted when unavailable; the app must never infer one from Work Order, Job Card, or the legacy fourth field.

All quantities remain in the item's existing stock UOM. No Bundle UOM or item transformation is introduced.

## Shared Quantity Rules

A focused, pure quantity module will normalize numeric input and produce validated package calculations. It will keep UI components from independently implementing slightly different rules.

Physical Count rules:

- Complete package: `actualQuantity = qrQuantity`, `quantityChange = qrQuantity` for ADD.
- Opened package: `0 <= actualQuantity <= qrQuantity`, and ADD uses `actualQuantity`.
- An opened package requires an explicitly entered actual quantity. Zero is valid because an opened package may be empty.
- DEDUCT retains its existing protection against making the running physical count negative. Package metadata describes the scanned package; the action determines the sign of `quantityChange`.
- Existing manual/non-package counting remains multiplier-based and unchanged.

Pullout rules:

- Full package: `pulloutQuantity = qrQuantity`, `remainingQuantity = 0`, `packageStatus = COMPLETE` for the scanned package before removal.
- Partial pullout: `0 < pulloutQuantity <= availableQuantity`, `remainingQuantity = availableQuantity - pulloutQuantity`, and the resulting status is `OPENED` when the remainder is greater than zero.
- Before a backend package-balance contract exists, the QR quantity is the only frontend-known availability ceiling. The UI may reject values above it, but it must not claim that this proves the current server balance.
- The backend remains authoritative for the package's current available quantity and must reject stale or repeated deductions atomically.

Numeric input rejects blank, nonnumeric, non-finite, and negative values. Pullout additionally rejects zero. Decimal quantities remain supported because the existing scanner accepts decimal stock quantities.

## Physical Count Data Model

Package audit fields belong on each `LocalScanTransaction`, not only on the aggregated `LocalScanEntry`. Multiple packages of the same item and location merge into one count line, so entry-level metadata would lose the history of individual packages.

The transaction gains optional fields:

```ts
type LocalScanTransaction = {
  // existing fields remain unchanged
  qrQuantity?: number;
  packageStatus?: "COMPLETE" | "OPENED";
  actualQuantity?: number;
  remainingQuantity?: number;
  packageId?: string;
};
```

For a complete package scan, the transaction records the original QR quantity, `COMPLETE`, and the same actual quantity. For an opened package, it records the original QR quantity, `OPENED`, and the actual remaining quantity. `remainingQuantity` equals `actualQuantity` in Physical Count because the operator is measuring what remains.

Older persisted transactions have none of these fields. Deserialization must preserve them as valid legacy records without fabricating package information.

The Physical Count source fingerprint includes the optional package audit fields. If an operator changes package quantity details before submission, it is a different request body and receives a new submission identity. An unchanged offline retry continues to use the same persisted submission ID and exact payload.

## Physical Count User Experience

Complete packages remain the fast path:

1. Scan the packing QR.
2. Package status defaults to Complete.
3. With automatic quantity enabled, immediately record the full QR quantity with no extra dialog.

The existing quantity dialog gains a clear Complete/Open Package choice when the operator opens quantity controls. Selecting Opened Package replaces multiplier input with:

- QR Quantity, read-only
- Actual Quantity Remaining, required
- Difference, calculated as `actualQuantity - qrQuantity`
- Status, Opened

The confirmation button states the amount that will be added or deducted and is disabled when invalid or processing. Copy must say “remaining” for Physical Count and must not describe this value as an amount being removed.

The scan-detail history and final review expose package status and original-versus-actual quantities when package metadata exists. Legacy/manual transactions retain their existing display.

## Pullout Data and User Experience

After scanning a packing label and validating its Job Card, the quantity dialog defaults to Full Package. Confirming it uses exactly one QR package quantity without an extra partial-package step.

The dialog also offers Partial Pullout. Selecting it shows:

- QR Quantity, read-only
- Pullout Quantity, required
- Remaining Package Quantity, calculated
- Package Status after Pullout, Opened when remaining quantity is greater than zero

The current package-count multiplier behavior remains available for operators processing multiple complete packages. It is visually identified as complete-package count so it cannot be confused with the number of pieces being removed.

Before Draft creation, the existing Pullout Details confirmation summarizes:

- Item and Job Card
- Original QR quantity
- Complete package count or partial pullout quantity
- Actual Stock Entry quantity
- Remaining package quantity for partial pullout
- Resulting package status
- Pull Out Slip and Actual Weight per Item

The Create Draft button is disabled while values are invalid or a request is in progress. The Stock Entry quantity passed to ERPNext is the actual pullout quantity, never the original QR quantity for a partial pullout.

Receive Finished Goods/Pullout remains online-only. This feature does not create a new persistent offline mutation queue. Existing same-screen retry behavior keeps the request ID stable.

## API Contracts

No new endpoints are invented. Existing endpoints are extended only after the ERPNext backend accepts the added optional fields.

### Physical Count

The existing `submit_pcount_entries` request retains its current entry structure. Each package-aware transaction adds camelCase fields because the scanner's current Physical Count transaction contract uses camelCase:

```json
{
  "id": "transaction-uuid",
  "action": "ADD",
  "quantityChange": 495,
  "runningQuantity": 495,
  "qrQuantity": 500,
  "packageStatus": "OPENED",
  "actualQuantity": 495,
  "remainingQuantity": 495,
  "packageId": "optional-package-id",
  "timestamp": "2026-09-23T08:00:00.000Z",
  "employeeId": "EMP-1",
  "employeeName": "Operator",
  "deviceId": "S2",
  "locationId": "GB9-STG",
  "locationLabel": "GB9-STG"
}
```

Legacy transactions may omit every package field. The backend must accept both forms.

### Pullout Draft

The existing `create_manufacture_receive_draft` endpoint gains optional snake_case fields, matching its current API convention:

```json
{
  "job_card_id": "JC-2026-00001",
  "custom_reference_document": "PULLOUT-1",
  "quantity": 5,
  "custom_actual_weight_per_item": 60,
  "qr_quantity": 500,
  "package_status": "OPENED",
  "pullout_quantity": 5,
  "remaining_quantity": 495,
  "package_id": "optional-package-id",
  "device_id": "S2",
  "request_id": "stable-uuid"
}
```

For multiple complete packages, `quantity` remains `qr_quantity * package_count`; `package_count` should be sent as optional audit metadata. For a partial pullout, `quantity` and `pullout_quantity` are identical.

## Backend Contract Gaps

The frontend cannot safely complete package-level remaining-balance enforcement until ERPNext supplies these capabilities:

1. A documented, versioned QR field for a unique package ID. The current QR format contains no package ID. The scanner must not reinterpret Work Order, Job Card, or the legacy fourth field as one.
2. An authoritative package-balance lookup or a response from Job Card validation that returns `package_id`, original quantity, current remaining quantity, UOM, and a version/modified value.
3. Atomic validation in `create_manufacture_receive_draft` that checks the requested pullout against current package balance and updates that balance in the same database transaction.
4. Idempotency keyed by `request_id`, returning the original successful result for a retry instead of applying the movement twice.
5. Persistent audit storage for original QR quantity, actual/pulled quantity, remaining quantity, package status, package ID, user, device, timestamp, and request/transaction ID.
6. A response containing the authoritative remaining quantity and package status so the scanner can display the server-confirmed result.

Until these exist, the scanner will omit `package_id`, validate partial Pullout only against the QR quantity, clearly avoid claiming server-confirmed package availability, and rely on existing Stock Entry/idempotency protections.

## Error Handling

- Validation errors stay in the active dialog and preserve operator input.
- Backend validation messages are displayed unchanged when they are safe and specific, consistent with existing scanner behavior.
- Network failure during Physical Count preserves the local transaction and its package metadata for later submission.
- Network failure during Pullout preserves the current on-screen form and request ID for retry, but does not queue a background stock mutation.
- A successful retry must return the same Draft Stock Entry or submission result and must not apply inventory twice.
- Submission controls remain disabled during active requests.

## Compatibility and Migration

- Existing packing QR formats continue to parse unchanged.
- No existing QR field is reassigned as a package ID.
- Existing local Physical Count entries and transactions load without migration failure.
- Legacy transactions submit without package fields.
- Existing automatic complete-package Physical Count remains one scan with no extra confirmation.
- Existing manual multiplier counting remains available.
- Existing complete-package Pullout and multiple-complete-package behavior remain available.
- UOM conversion continues before package quantity calculations where the existing Physical Count flow requires it.
- No Bundle UOM, new item code, or repacking Stock Entry is created.

## Test Strategy

Pure calculation tests cover:

- Complete Physical Count of a 500-piece package produces 500.
- Opened Physical Count with 495 remaining produces 495 and difference -5.
- Full Pullout of a 500-piece package moves 500.
- Partial Pullout of 5 moves 5 and leaves 495.
- Blank, nonnumeric, negative, non-finite, zero where prohibited, and above-available values are rejected.

Persistence and payload tests cover:

- Package audit fields survive local save/load.
- Older saved transactions still load.
- Aggregated item/location rows retain audit metadata on each individual transaction.
- Physical Count payload uses actual remaining quantity and retains original QR quantity.
- The source fingerprint changes when package audit data changes.
- An unchanged offline retry restores the same submission ID and exact payload.
- Successful transaction IDs are not submitted twice.

Pullout request tests cover:

- Full package sends quantity 500.
- Partial Pullout sends quantity 5, original QR quantity 500, and remaining quantity 495.
- Retry uses the same request ID.
- Invalid quantities never call the ERPNext endpoint.

Regression tests cover existing non-package/manual Physical Count, legacy packing labels, multiple complete-package Pullout, UOM compatibility, and current duplicate-submission behavior.

## Planned File-Level Changes

- Create `src/lib/packageQuantity.ts` for shared validation and calculations.
- Create `src/lib/packageQuantity.test.ts` for quantity rules and boundary cases.
- Modify `src/lib/scanStorage.ts` and `src/lib/scanStorage.test.ts` for transaction-level package audit persistence.
- Modify `src/lib/pcountSubmission.ts`, `src/lib/pcountSubmission.test.ts`, and `src/lib/erpService.ts` for package-aware Physical Count payloads and fingerprints.
- Modify `src/components/ScanPage.tsx` and its existing styles for Complete/Opened Physical Count controls and summaries.
- Modify `src/components/ManufacturingScanner.tsx` and `src/components/ManufacturingScanner.css` for Full/Partial Pullout controls and confirmation summary.
- Modify `src/lib/manufacturingService.ts` and add focused request-contract tests for the extended existing draft endpoint.
- Modify `src/lib/packingLabelQr.ts` only after a package-ID QR format is documented; otherwise leave parsing unchanged and omit `packageId`.

No APK build is part of implementation verification. Verification will use TypeScript checking, linting, and the automated test suite.
