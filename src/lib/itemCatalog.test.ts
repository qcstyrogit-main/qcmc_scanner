import { describe, expect, it } from "vitest";
import { searchCatalogItems, type CatalogItem } from "@/lib/itemCatalog";
import { readFileSync } from "node:fs";

const catalog: CatalogItem[] = [
  { itemCode: "EIEHB1BL50", itemName: "MONGOLIA 4K HB 01 PAD BOTTOM LEFT", stockUom: "PCS", modified: "" },
  { itemCode: "EIEHB1BR50", itemName: "MONGOLIA 4K HB 01 PAD BOTTOM RIGHT", stockUom: "PCS", modified: "" },
  { itemCode: "A-TEST", itemName: "BLUE PACK", description: "Polypropylene sample", stockUom: "PCS", modified: "" },
];
describe("offline ERPNext item catalog", () => {
  it("finds items by code, case-insensitively", () => {
    expect(searchCatalogItems(catalog, "eiehb1bl50").map((item) => item.itemCode)).toEqual(["EIEHB1BL50"]);
  });
  it("finds items by description without a QR label", () => {
    expect(searchCatalogItems(catalog, "bottom").map((item) => item.itemCode))
      .toEqual(["EIEHB1BL50", "EIEHB1BR50"]);
  });
  it("matches the ERP Item description field as well as the name", () => {
    expect(searchCatalogItems(catalog, "polypropylene").map((item) => item.itemCode)).toEqual(["A-TEST"]);
  });
  it("ranks exact codes and limits results", () => {
    expect(searchCatalogItems(catalog, "eiehb1bl50", 1)).toHaveLength(1);
    expect(searchCatalogItems(catalog, "")).toEqual([]);
  });
  it("anchors suggestions to the search input and asks for pack size after selection", () => {
    const page = readFileSync(new URL("../components/ScanPage.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../components/ScanPage.compact.css", import.meta.url), "utf8");
    const autocompleteStart = page.indexOf('<div className="scan-manual-item-autocomplete">');
    const searchStart = page.indexOf('placeholder="Search items..."', autocompleteStart);
    const suggestionsStart = page.indexOf('id="manual-item-suggestions"', searchStart);
    const suggestionsEnd = page.indexOf('className="scan-manual-item-status"', suggestionsStart);
    expect(autocompleteStart).toBeGreaterThan(0);
    expect(searchStart).toBeGreaterThan(autocompleteStart);
    expect(suggestionsStart).toBeGreaterThan(searchStart);
    expect(suggestionsEnd).toBeGreaterThan(suggestionsStart);
    expect(page).toContain('aria-autocomplete="list"');
    expect(page).toContain('onClick={() => chooseManualItem(item)}');
    expect(page).toContain('setManualPackItem(selectedItem);');
    expect(page).toContain('const confirmManualPackSize = (event?: React.FormEvent) => {');
    expect(page).toContain('onSubmit={confirmManualPackSize}');
    expect(page).toContain('id="manual-pack-quantity"');
    expect(page).toContain('onClick={returnToManualItemSearch}');
    expect(css).toContain('.scan-manual-item-autocomplete .scan-manual-item-results');
    expect(css).toContain('position: absolute !important;');
    expect(css).toContain('.scan-manual-pack-dialog');
    expect(page).toContain('if (step === "invtag" || manualItemOpen || manualPackItem) return;');
  });
  it("keeps the manual entry within the validated Physical Count scan path", () => {
    const page = readFileSync(new URL("../components/ScanPage.tsx", import.meta.url), "utf8");
    expect(page).toContain("Enter FG Item Code / Description");
    expect(page).toContain("const chooseManualItem = (selectedItem: CatalogItem) =>");
    expect(page).toContain("void processScan(code)");
    expect(page).toContain("selectedItem.stockUom");
    expect(page).toContain("onClick={() => chooseManualItem(item)}");
    expect(page).toContain("onClick={closeManualItemSearch}");
    expect(page).toContain('aria-label="Close Manual Item Search"');
    expect(page).toContain("const openManualItemSearch = () => {");
    expect(page).toContain('if (step === "bin" && activeGroupLocations.length)');
    expect(page).toContain("continueMultiLocationItems();");
    expect(page).toContain('mode === "pcount" && reconciliationCode && !isPcountReviewStage && (currentBin || activeGroupLocations.length > 0)');
    const css = readFileSync(new URL("../components/ScanPage.compact.css", import.meta.url), "utf8");
    expect(css).toContain("Full-screen Manual FG search");
    expect(css).toContain(".scan-manual-item-backdrop .scan-confirm-dialog.scan-manual-item-dialog");
    expect(css).toContain("height: 100dvh !important");
    expect(page).toContain('setManualPackSize("1")');
    expect(page).not.toContain("disabled={!manualSelectedItem || !manualPackSize.trim()}>Continue</button>");
    expect(page).not.toContain("onClick={closeManualItemSearch}>Cancel</button>");
    expect(page).toContain("getItemCatalogLastChecked()");
    expect(page).toContain("synchronizeItemCatalog(setManualCatalogProgress)");
    expect(page).toContain("Stock units per Big Pack");
    const service = readFileSync(new URL("./itemCatalog.ts", import.meta.url), "utf8");
    expect(service).toContain("/api/method/qcmc_logic.api.item_catalog.get_items");
    expect(service).toContain("getErpMobileToken()");
    expect(service).toContain("cursor_modified: cursorModified");
    expect(service).toContain("since_modified: lastSync");
    expect(service).not.toContain("/api/resource/Item");
    expect(service).toContain("fg-only-v1|");
  });
});
