import { getPcountInventoryTagEffectiveCount, type LocalScanEntry } from "@/lib/scanStorage";

export type ScannedTagLocation = { entry: LocalScanEntry; quantity: number };
export type ScannedTagGroup = {
  tag: string;
  quantity: number;
  locations: ScannedTagLocation[];
};

/** Read-only presentation grouping; never changes the underlying scanned entries.
 * Tags are aggregated per item across locations, and each contributing location
 * remains accessible for the existing audit / edit action.
 */
export const groupScannedItemsByInvTag = (entries: LocalScanEntry[]): ScannedTagGroup[] => {
  const groups = new Map<string, ScannedTagGroup>();
  const add = (tag: string, entry: LocalScanEntry, quantity: number) => {
    if (!Number.isFinite(quantity) || Math.abs(quantity) < 0.000001) return;
    const key = tag.trim().toLocaleUpperCase();
    const group: ScannedTagGroup = groups.get(key) || { tag: tag.trim() || "No Inv Tag", quantity: 0, locations: [] };
    group.quantity += quantity;
    group.locations.push({ entry, quantity });
    groups.set(key, group);
  };
  for (const entry of entries) {
    const transactions = (entry.scanTransactions || []).filter(
      (tx) => tx.action === "ADD" || tx.action === "DEDUCT"
    );
    const tags = new Map<string, string>();
    for (const tx of transactions) {
      const tag = (tx.inventoryTag || "").trim();
      if (tag && !tags.has(tag.toLocaleUpperCase())) tags.set(tag.toLocaleUpperCase(), tag);
    }
    let attributed = 0;
    for (const tag of tags.values()) {
      const count = getPcountInventoryTagEffectiveCount(entry, tag);
      if (count === null) continue;
      attributed += count;
      add(tag, entry, count);
    }
    // Legacy scans or transactions with no tag must remain visible and must
    // not be misattributed to a known Inventory Tag.
    const unassigned = entry.quantity - attributed;
    add("", entry, unassigned);
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.tag === "No Inv Tag" ? 1 : b.tag === "No Inv Tag" ? -1 : a.tag.localeCompare(b.tag)
  );
};
