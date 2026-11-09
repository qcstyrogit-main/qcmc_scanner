import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../components/BlankPage.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/authenticated-ui.css", import.meta.url), "utf8");
const start = page.indexOf('<div className="tx-v2-filters">');
const end = page.indexOf('className="transaction-tabs tx-v2-tabs"', start);
const filter = page.slice(start, end);

describe("Transactions on-page Period and Type dropdowns", () => {
  it("renders regular anchored dropdowns, not Android native select dialogs", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(filter).toContain('className="tx-v2-dropdown-trigger"');
    expect(filter).toContain('className="tx-v2-dropdown-menu"');
    expect(filter).not.toContain("<select");
    expect(filter).not.toContain("<option");
    expect(filter).toContain("aria-expanded={openTransactionFilter === \"period\"}");
    expect(filter).toContain("aria-expanded={openTransactionFilter === \"type\"}");
    expect(styles).toContain("Transactions custom anchored dropdowns");
    expect(styles).toContain("top: calc(100% + 5px)");
    expect(styles).toContain("position: absolute");
  });

  it("keeps existing date and type filter values and labels", () => {
    for (const [value, label] of [
      ["all", "All dates"], ["today", "Today"], ["week", "Last 7 days"],
      ["all", "All types"], ["physical_count", "Physical Count"],
      ["warehouse_allocation", "Warehouse Allocation"], ["location_transfer", "Transfer Location"],
    ]) {
      expect(page).toContain(`{ value: "${value}", label: "${label}" }`);
    }
    expect(filter).toContain("setTransactionDateFilter(option.value)");
    expect(filter).toContain("setTransactionTypeFilter(option.value)");
    expect(page).toContain("const transactionWithinDate = React.useCallback");
    expect(page).toContain("transactionTypeFilter === \"all\"");
  });

  it("only opens one menu at a time, closes after choosing and shows the selected item", () => {
    expect(page).toContain('React.useState<"period" | "type" | null>(null)');
    expect(filter).toContain('current === "period" ? null : "period"');
    expect(filter).toContain('current === "type" ? null : "type"');
    expect(filter).toContain("setOpenTransactionFilter(null)");
    expect(filter).toContain("transactionDateFilter === option.value");
    expect(filter).toContain("transactionTypeFilter === option.value");
    expect(filter).toContain("TRANSACTION_PERIOD_OPTIONS.find(");
    expect(filter).toContain("TRANSACTION_TYPE_OPTIONS.find(");
    expect(filter).toContain("<CheckCircle2 size={17}");
  });

  it("dismisses on outside tap, Escape, Android Back and reopening Transactions", () => {
    expect(page).toContain('document.addEventListener("pointerdown", dismissOutside)');
    expect(page).toContain('document.removeEventListener("pointerdown", dismissOutside)');
    expect(page).toContain('if (event.key === "Escape")');
    expect(page).toContain('document.addEventListener("keydown", dismissEscape)');
    expect(page).toContain('currentView === "history" && openTransactionFilter');
    expect(page).toContain('const openHistory = () => {\n    setOpenTransactionFilter(null)');
    expect(page).toContain('const goBackHome = () => {\n    setOpenTransactionFilter(null)');
  });

  it("remains accessible and scrollable without changing the history list", () => {
    expect(filter).toContain('aria-controls="tx-period-options"');
    expect(filter).toContain('aria-controls="tx-type-options"');
    expect(filter).toContain('aria-pressed={transactionDateFilter === option.value}');
    expect(filter).toContain('aria-pressed={transactionTypeFilter === option.value}');
    expect(filter).toContain("periodFilterButtonRef.current?.focus()");
    expect(filter).toContain("typeFilterButtonRef.current?.focus()");
    expect(styles).toContain("max-height: 226px");
    expect(styles).toContain("overflow-y: auto");
    expect(page).toContain('filteredSuccessfulTransactions.map');
    expect(page).toContain('filteredPendingReconciliations.map');
    expect(page).toContain('filteredFailedTransactions.map');
  });
});
