# Physical Count Multi-Location Mode

## Purpose

Add an optional Physical Count workflow for stock that is present in many storage locations. The warehouse operator scans a group of locations once, scans each item once, and enters one quantity per item. The entered quantity is copied in full to every selected location; it is never divided between locations.

The existing single-location workflow must remain unchanged and continue to be the default for existing saved sessions. One Stock Reconciliation transaction may contain completed Single Location and Multi Location work. Operators may switch in either direction only after completing the active location or location group.

## User-visible modes

The center Mode menu will expose two Physical Count location modes alongside the existing scan and package preferences:

- **Single Location**: the existing `Reconciliation -> Location -> Items -> Next Location` workflow.
- **Multi Location**: the new `Reconciliation -> Locations -> Items -> Next Location Group` workflow.

Automatic/Manual continues to control scanner input. Big Pack/Loose Pack continues to control quantity interpretation. Single/Multi Location controls only the next Physical Count location workflow and never reinterprets completed work.

## Mixed-mode transactions

A Physical Count keeps one Stock Reconciliation reference while allowing multiple completed location groups with different modes. For example, an operator may count Locations A-C in Multi Location mode, select **Next Location**, change to Single Location mode, count Location D, and submit all four locations together.

The current device preference becomes the `activeLocationMode` when the operator starts a new location or group. Once the first location is scanned, that mode is locked until **Next Location** completes the active work. A Mode-menu change attempted during unfinished work is refused with a message instructing the operator to complete the current location first.

After **Next Location**, `activeLocationMode` is cleared. The operator may select either mode for the next location/group without clearing the reconciliation, completed entries, or audit history. Both **Single -> Multi** and **Multi -> Single** are supported.

## Multi-location workflow

1. The operator selects **Multi Location** from the Mode menu.
2. The operator opens Physical Count and scans the Stock Reconciliation QR.
3. The operator scans every applicable storage-location QR.
4. The app validates each location against the reconciliation warehouse and adds it to the current location group.
5. The Location step displays the selected-location count and a scrollable list. The operator can remove an incorrectly selected location.
6. The operator selects **Continue to Items** after at least one valid location is selected.
7. The operator scans an item and enters its quantity once.
8. The app validates the item for every selected location as a single atomic operation.
9. If all validations pass, the app creates one local Physical Count entry per selected location, each containing the full entered quantity.
10. Additional items use the same selected location group.
11. The operator selects **Next Location** to complete the current group, clear its selected locations, and return to location scanning for a new group.

Example: Locations A, B, and C are selected and the operator enters `1,000 PCS`. The app records `1,000 PCS` at A, `1,000 PCS` at B, and `1,000 PCS` at C. The overall recorded quantity is `3,000 PCS`.

## Interface behavior

The existing three-step indicator remains **Reference -> Location -> Items**.

During the Location step, Multi Location mode shows:

- A summary such as `3 locations selected`.
- A scrollable selected-location list.
- A remove action on each selected location.
- A **Continue to Items** action that is disabled until at least one valid location is selected.
- An active scanner so locations can be added continuously.

During the Items step, the page shows a compact banner such as `Multi Location / 3 locations / Quantity applies to every location`.

Before quantity confirmation, the interface explicitly states the effect, for example: `1,000 PCS will be recorded at each of 3 locations.` Review and saved-scan views show both the per-location expression (`1,000 PCS x 3 locations`) and the overall recorded quantity (`3,000 PCS`).

Duplicate location scans do not add another location. The app displays a non-blocking message that the location is already selected.

Removing a location is allowed while selecting locations. Once item counts exist for the group, changing the group must not silently rewrite prior counts. The operator must finish the group with **Next Location** and start a new group.

## Session and data model

The saved Physical Count session gains an optional active location mode with values `single` and `multi`. It applies only to unfinished work. Missing legacy values deserialize safely: an unfinished legacy session infers its active mode from the former session-level mode, while a session with no unfinished location/group has no active mode.

A Multi Location session persists:

- The reconciliation identity and warehouse.
- The active location mode for unfinished work, if any.
- The current selected-location group.
- A stable local group identifier.
- Each generated item/location count entry.
- Group completion state needed for offline recovery.

Generated count entries keep the existing ERP-facing shape. Each entry has exactly one item, one location, and one quantity. The group identifier is local workflow metadata and is not required in the ERP payload.

This model keeps saved scans, transaction totals, offline recovery, and ERP submission transparent. It avoids a special multi-location ERP payload.

## Validation and atomicity

The app validates every selected location when it is scanned. It rejects locations outside the Stock Reconciliation warehouse and locations that fail existing Physical Count eligibility rules.

When an item quantity is confirmed, the app performs the existing item, UOM, baseline, and capacity validations for every selected location before saving any generated entry. If one location fails, the app identifies that location and saves none of the entries for that item. This prevents a partially applied count across the group.

The app blocks item scanning when the selected-location group is empty. Duplicate item/location entries follow the existing Physical Count merge behavior, including decimal quantity handling and UOM normalization.

**Next Location** completes the current group. If there is unfinished input, the app uses the established confirmation-dialog style before clearing the group.

## Offline behavior

Multi Location mode must retain the same offline guarantees as the existing Physical Count workflow. The selected mode, group, locations, and generated entries are persisted locally after every material change. Reloading or reopening the app restores the exact step and group without duplicating entries.

Online ERP checks resume when connectivity returns. Submission remains queued through the existing saved-scan and Physical Count submission mechanisms.

## ERP submission

No new backend request shape is required provided the existing Physical Count endpoint accepts multiple ordinary item/location entries. Submission sends one row for every item/location combination.

For three selected locations and two counted items, submission contains six rows. Each row keeps its own inventory location and the full quantity entered for that item.

The implementation must verify this assumption against the existing client serializer and endpoint contract. If the backend rejects valid repeated item codes across different locations, that is a backend contract gap and must be reported before widening frontend scope.

## Compatibility

- Single Location remains the default device preference and retains its current scan sequence.
- Existing saved sessions with a session-level location mode migrate into the active-mode model without changing unfinished work.
- Automatic/Manual and Big Pack/Loose Pack remain independent preferences.
- Existing Physical Count submission history and transaction views continue to consume ordinary item/location entries.
- Switching location mode must not reinterpret active or completed work. The app refuses switching while a location/group is unfinished, but permits switching after **Next Location** while retaining the same reconciliation and all previous counts.

## Test coverage

Automated tests will cover:

- Defaulting old saved sessions to Single Location.
- Persisting and restoring Multi Location mode and the active group.
- Selecting, displaying, removing, and rejecting duplicate locations.
- Rejecting locations outside the reconciliation warehouse.
- Requiring at least one location before continuing to Items.
- Applying the full entered quantity to every selected location.
- Computing per-location and overall totals correctly.
- Applying multiple items to the same location group.
- Preserving decimal quantities and empty-UOM handling.
- Atomic failure when one selected location fails validation.
- Next Location completing and clearing the current group.
- Offline reload without duplicate generated entries.
- ERP serialization of one row per item/location combination.
- Preventing mode changes during an unfinished location/group.
- Allowing Single-to-Multi and Multi-to-Single changes after **Next Location** within the same reconciliation.
- Preserving earlier entries and submitting mixed-mode rows together.
- Regression coverage for the existing Single Location workflow.

Verification will run the relevant unit tests, the full test suite, TypeScript checking, and linting. Android/APK builds are outside this change unless separately requested.
