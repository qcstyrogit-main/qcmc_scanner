import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const page = readFileSync(new URL("../components/BlankPage.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/authenticated-ui.css", import.meta.url), "utf8");
describe("Transactions Stored Summary detail disclosure", () => {
  it("keeps stored receipt details collapsed until tapped", () => {
    expect(page).toContain('id="tx-v2-summary-expanded"');
    expect(page).toContain('setSelectedTransactionDetails(entry)');
    expect(page).toContain('showStoredSummaryDetails && <div');
    expect(page).toContain('aria-expanded={showStoredSummaryDetails}');
    expect(page).toContain('setShowStoredSummaryDetails(false); setSelectedTransactionDetails(entry)');
  });
  it("displays only available local receipt metadata", () => {
    for (const label of ["Transaction ID", "Document reference", "Recorded on", "Submission ID", "Failure reason", "From → To"]) expect(page).toContain(label);
    expect(page).toContain("Item-level details were not retained in this device receipt");
    expect(css).toContain(".tx-v2-summary-expanded");
  });
});