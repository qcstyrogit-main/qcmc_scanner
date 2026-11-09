import { erpRequest, getCustomErpBaseUrl, extractErrorMessage } from "@/lib/erpApi";
import { getErpMobileToken } from "@/lib/erpSession";

/**
 * Lightweight IndexedDB catalog. Entries are scoped to the selected ERP URL
 * so switching development/production sites never mixes item metadata.
 * Stock quantity and warehouse/location baselines are intentionally excluded.
 */
export type CatalogItem = {
  itemCode: string;
  itemName: string;
  description?: string;
  stockUom: string;
  modified: string;
  disabled?: boolean;
};
type StoredItem = CatalogItem & { key: string; site: string };
const DB_NAME = "qcmc-item-catalog-v1";
const DB_VERSION = 1;
const STORE = "items";
const META = "metadata";
const pageSize = 500;
let activeSync: Promise<number> | null = null;

// Separate FG-only cache from earlier all-items catalog without touching saved counts.
const siteKey = () => "fg-only-v1|" + getCustomErpBaseUrl().trim().replace(/\/+$/, "").toLowerCase();
const makeKey = (site: string, itemCode: string) => site + "|" + itemCode;
const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === "undefined") {
    reject(new Error("Offline item catalog storage is unavailable on this device."));
    return;
  }
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE)) {
      const store = db.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("site", "site");
    }
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("Unable to open item catalog."));
});
const readRequest = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("Item catalog read failed."));
});
const completed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error || new Error("Item catalog write failed."));
  tx.onabort = () => reject(tx.error || new Error("Item catalog transaction aborted."));
});

export const loadCachedItems = async (): Promise<CatalogItem[]> => {
  const db = await openDb();
  try {
    const rows = await readRequest(db.transaction(STORE, "readonly")
      .objectStore(STORE).index("site").getAll(IDBKeyRange.only(siteKey()))) as StoredItem[];
    return rows.map(({ itemCode, itemName, description, stockUom, modified }) => ({ itemCode, itemName, description: description || "", stockUom, modified }));
  } finally {
    db.close();
  }
};

export const getItemCatalogLastChecked = async (): Promise<number> => {
  const db = await openDb();
  try {
    return Number(await readRequest(db.transaction(META, "readonly")
      .objectStore(META).get("checked:" + siteKey())) || 0);
  } finally {
    db.close();
  }
};

export const getItemCatalogLastSync = async (): Promise<string> => {
  const db = await openDb();
  try {
    return String(await readRequest(db.transaction(META, "readonly")
      .objectStore(META).get(siteKey())) || "");
  } finally {
    db.close();
  }
};

export const searchCatalogItems = (items: CatalogItem[], query: string, max = 30): CatalogItem[] => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const matching = items.filter((item) =>
    item.itemCode.toLocaleLowerCase().includes(needle) ||
    item.itemName.toLocaleLowerCase().includes(needle) ||
    (item.description || "").toLocaleLowerCase().includes(needle)
  );
  matching.sort((a, b) => {
    const priority = (item: CatalogItem) =>
      item.itemCode.toLocaleLowerCase() === needle ? 0 :
      item.itemCode.toLocaleLowerCase().startsWith(needle) ? 1 :
      item.itemName.toLocaleLowerCase().startsWith(needle) ? 2 : 3;
    return priority(a) - priority(b) || a.itemCode.localeCompare(b.itemCode);
  });
  return matching.slice(0, max);
};

type CatalogPage = { items: CatalogItem[]; hasMore: boolean; nextModified: string; nextCode: string; untilModified: string };
const parseItemPage = (response: unknown): CatalogPage => {
  const wrapped = response as { message?: unknown };
  const payload = (wrapped?.message || response) as Record<string, unknown>;
  if (!payload || payload.success !== true || !Array.isArray(payload.items)) {
    throw new Error("ERPNext did not return an authorized Item catalog page.");
  }
  const candidates = payload.items;
  const items = candidates.flatMap((row): CatalogItem[] => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const itemCode = String(item.name || "").trim();
    if (!itemCode) return [];
    return [{
      itemCode,
      itemName: String(item.item_name || ""),
      description: String(item.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      stockUom: String(item.stock_uom || ""),
      modified: String(item.modified || ""),
      disabled: Number(item.disabled || 0) === 1,
    }];
  });
  return {
    items,
    hasMore: payload.has_more === true,
    nextModified: String(payload.next_cursor_modified || ""),
    nextCode: String(payload.next_cursor_item_code || ""),
    untilModified: String(payload.until_modified || ""),
  };
};

const savePage = async (site: string, items: CatalogItem[]) => {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const item of items) {
      if (item.disabled) store.delete(makeKey(site, item.itemCode));
      else store.put({ ...item, key: makeKey(site, item.itemCode), site } satisfies StoredItem);
    }
    await completed(tx);
  } finally {
    db.close();
  }
};

/** First sync fetches enabled Finished Goods; delta sync also receives deletion tombstones. */
const syncCatalog = async (onProgress?: (count: number) => void): Promise<number> => {
  const site = siteKey();
  const lastSync = await getItemCatalogLastSync();
  let cursorModified = "";
  let cursorCode = "";
  let untilModified = "";
  let received = 0;
  while (true) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new Error("Connect to ERPNext to update the catalog; cached items remain available.");
    }
    const response = await erpRequest("/api/method/qcmc_logic.api.item_catalog.get_items", {
      method: "POST",
      body: {
        ...(getErpMobileToken() ? { mobile_token: getErpMobileToken() } : {}),
        ...(lastSync ? { since_modified: lastSync } : {}),
        ...(cursorModified ? { cursor_modified: cursorModified, cursor_item_code: cursorCode } : {}),
        ...(untilModified ? { until_modified: untilModified } : {}),
        limit: pageSize,
      },
    });
    if (!response.ok) {
      throw new Error(extractErrorMessage(response.data, "Item catalog sync failed (HTTP " + response.status + ")."));
    }
    const page = parseItemPage(response.data);
    if (untilModified && page.untilModified !== untilModified) throw new Error("Catalog snapshot changed during sync.");
    untilModified = page.untilModified;
    if (page.items.length) await savePage(site, page.items);
    received += page.items.length;
    onProgress?.(received);
    if (!page.hasMore) break;
    if (!page.nextModified || !page.nextCode ||
        (cursorModified === page.nextModified && cursorCode === page.nextCode)) {
      throw new Error("Invalid Item catalog pagination cursor.");
    }
    cursorModified = page.nextModified;
    cursorCode = page.nextCode;
  }
  // Advance the watermark only when the entire sync completed successfully.
  // Overlapping modified timestamps are deliberately fetched again next time.
  const db = await openDb();
  try {
    const tx = db.transaction(META, "readwrite");
    if (untilModified) tx.objectStore(META).put(untilModified, site);
    tx.objectStore(META).put(Date.now(), "checked:" + site);
    await completed(tx);
  } finally {
    db.close();
  }
  return received;
};

export const synchronizeItemCatalog = (onProgress?: (count: number) => void) => {
  if (!activeSync) activeSync = syncCatalog(onProgress).finally(() => { activeSync = null; });
  return activeSync;
};
