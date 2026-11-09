import type { LocalScanEntry } from "@/lib/scanStorage";
import { findInventoryTagItemConflict } from "@/lib/activeInventoryTag";

/**
 * Reuse only one unambiguous, still-pending Inventory Tag for this exact
 * reconciliation, item, location and lot. Never reuse submitted tags or tags
 * from another location, and never guess when several tags exist.
 */
export const getReusableInventoryTag = (
  entries: LocalScanEntry[],
  reconciliationCode: string,
  itemCode: string,
  locationId: string,
  lotNo: string,
): string | null => {
  const normalize = (value: string | undefined) => String(value || "").trim().toLocaleUpperCase();
  if (!normalize(locationId)) return null;
  const matching = entries.filter((entry) =>
    entry.mode === "pcount" &&
    normalize(entry.reconciliationCode) === normalize(reconciliationCode) &&
    normalize(entry.itemCode) === normalize(itemCode) &&
    normalize(entry.bin.locationId) === normalize(locationId) &&
    normalize(entry.lotNo) === normalize(lotNo)
  );
  const tags = new Map<string, string>();
  for (const entry of matching) {
    const submitted = new Set(entry.submittedTransactionIds || []);
    for (const transaction of entry.scanTransactions || []) {
      if (transaction.action !== "ADD" && transaction.action !== "DEDUCT") continue;
      const tag = String(transaction.inventoryTag || "").trim();
      if (!tag) return null;
      // Never silently reuse a tag that was already submitted.
      if (submitted.has(transaction.id)) return null;
      tags.set(normalize(tag), tag);
      if (tags.size > 1) return null;
    }
  }
  if (tags.size !== 1) return null;
  const selectedTag = [...tags.values()][0];
  // A remembered/reused tag must not belong to any different Item Code.
  if (findInventoryTagItemConflict(entries, reconciliationCode, selectedTag, itemCode, locationId)) return null;
  // Same tag at another Storage Location is allowed; only a different
  // Item Code at this exact location makes this reuse unsafe.
  return selectedTag;
};
