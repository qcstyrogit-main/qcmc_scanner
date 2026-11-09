import type { LocalScanEntry } from "@/lib/scanStorage";

/**
 * Within one Physical Count + Storage Location, one Inventory Tag belongs
 * to one Item Code. The same tag may identify a different item at another
 * location, and may be repeated for the same item in the same location.
 * Submitted local audit history remains relevant for conflict detection.
 * ERPNext validates this again across operators and devices.
 */
export const findInventoryTagItemConflict = (
  entries: LocalScanEntry[],
  reconciliation: string,
  inventoryTag: string,
  itemCode: string,
  locationId: string,
): { itemCode: string; locationId: string } | null => {
  const norm = (value: string | undefined) => String(value || "").trim().toLocaleUpperCase();
  const wantedTag = norm(inventoryTag);
  const wantedItem = norm(itemCode);
  const wantedLocation = norm(locationId);
  if (!wantedTag || !wantedItem || !wantedLocation) return null;
  for (const entry of entries) {
    if (entry.mode !== "pcount" || norm(entry.reconciliationCode) !== norm(reconciliation)) continue;
    if (norm(entry.itemCode) === wantedItem) continue;
    for (const tx of entry.scanTransactions || []) {
      if (tx.action !== "ADD" && tx.action !== "DEDUCT") continue;
      const txLocation = tx.locationId || entry.bin.locationId || "";
      if (norm(tx.inventoryTag) === wantedTag && norm(txLocation) === wantedLocation) {
        return { itemCode: entry.itemCode, locationId: txLocation };
      }
    }
  }
  return null;
};

/** Last actually recorded tag in this reconciliation, across items/locations.
 * Used only to prefill the next tag field; it never silently commits a new item.
 * Ignore baseline placeholders and other reconciliation references.
 */
export const getLatestUsedInventoryTag = (entries: LocalScanEntry[], reconciliation: string): string => {
  const norm = (value: string | undefined) => String(value || "").trim().toLocaleUpperCase();
  let latestTag = "";
  let latestRecordedAt = -1;
  let fallbackTag = "";
  for (const entry of entries) {
    if (entry.mode !== "pcount" || norm(entry.reconciliationCode) !== norm(reconciliation)) continue;
    const transactions = entry.scanTransactions || [];
    for (let index = transactions.length - 1; index >= 0; index -= 1) {
      const transaction = transactions[index];
      if (transaction.action !== "ADD" && transaction.action !== "DEDUCT") continue;
      const tag = String(transaction.inventoryTag || "").trim();
      if (!tag) continue;
      // For legacy rows without explicit recordedAt, QCMC transaction IDs
      // start with Date.now() (milliseconds since epoch). Unlike locale time
      // strings or grouped Item rows, this preserves ordering across locations.
      const legacyIdTime = /^(\d{13})(?:-|$)/.exec(transaction.id || "");
      const isoTime = /^\d{4}-\d{2}-\d{2}T/.test(transaction.timestamp || "")
        ? Date.parse(transaction.timestamp)
        : NaN;
      const recordedAt = typeof transaction.recordedAt === "number" && Number.isFinite(transaction.recordedAt)
        ? transaction.recordedAt
        : legacyIdTime ? Number(legacyIdTime[1]) : isoTime;
      // Use the saved order only when old transactions have no recoverable date.
      // Avoid guessing that a locally formatted clock time spans a newer day.
      if (!fallbackTag) fallbackTag = tag;
      if (Number.isFinite(recordedAt) && recordedAt >= latestRecordedAt) {
        latestRecordedAt = recordedAt;
        latestTag = tag;
      }
    }
  }
  return latestTag || fallbackTag;
};

export const activeInventoryTagKey = (reconciliation: string, location: string, item: string, lot: string) =>
  [reconciliation, location, item, lot].map((value) => String(value || "").trim().toLocaleUpperCase()).join("|");

/** A remembered tag must still have a pending transaction for the exact item/location/lot. */
export const validateActiveInventoryTag = (
  entries: LocalScanEntry[], reconciliation: string, location: string, item: string, lot: string, activeTag: string | undefined,
): string | null => {
  const norm = (value: string | undefined) => String(value || "").trim().toLocaleUpperCase();
  if (!norm(activeTag) || !norm(location)) return null;
  let found = false;
  for (const entry of entries) {
    if (entry.mode !== "pcount" || norm(entry.reconciliationCode) !== norm(reconciliation)) continue;
    for (const tx of entry.scanTransactions || []) {
      if (norm(tx.inventoryTag) !== norm(activeTag)) continue;
      const txLocation = norm(tx.locationId || entry.bin.locationId);
      // A tag at a different location/item is not the active tag for this
      // exact scan. Same-location ownership is checked below.
      if (txLocation !== norm(location) || norm(entry.itemCode) !== norm(item) || norm(entry.lotNo) !== norm(lot)) continue;
      if (tx.action !== "ADD" && tx.action !== "DEDUCT") return null;
      if ((entry.submittedTransactionIds || []).includes(tx.id)) return null;
      found = true;
    }
  }
  if (found && findInventoryTagItemConflict(entries, reconciliation, activeTag || "", item, location)) return null;
  return found ? activeTag!.trim() : null;
};