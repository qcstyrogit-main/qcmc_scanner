import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../components/BlankPage.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/authenticated-ui.css", import.meta.url), "utf8");
const start = screen.indexOf('{currentView === "history" && (');
const end = screen.indexOf('{historyStockChangeReview && (', start);
const section = screen.slice(start, end > start ? end : undefined);

describe("QCMC Transactions blue-and-white UI", () => {
  it("scopes Successful, Pending and Failed tabs to the configured scanner device", () => {
    expect(screen).toContain("const historyDeviceId = loadScannerDeviceName()");
    expect(screen).toContain("isTransactionForDevice(entry, historyDeviceId)");
    expect(screen).toContain(".every((tx) => isTransactionForDevice(tx, historyDeviceId))");
    expect(screen).toContain("loadFailedTransactionHistory().filter((entry) => isTransactionForDevice(entry, historyDeviceId))");
    expect(screen).toContain("loadSuccessfulTransactionHistory().filter((entry) => isTransactionForDevice(entry, historyDeviceId))");
    expect(screen).toContain("loadCompletedAllocationHistory()");
    expect(screen).toContain(".filter((entry) => isTransactionForDevice(entry, historyDeviceId))");
  });


  it("retains actual Transactions entry screen with local-history summary", () => {
    expect(start).toBeGreaterThan(-1);
    expect(section).toContain('id="history-title"');
    expect(section).toContain("Inventory Transactions");
    expect(section).toContain("Review stored receipts, pending Physical Counts and failures on this device.");
    expect(css).toContain("QCMC Transactions approved blue-and-white mobile UI");
  });

  it("supports search, date and transaction-type filters on actually stored fields", () => {
    expect(screen).toContain("const [transactionSearch, setTransactionSearch]");
    expect(screen).toContain("const [transactionTypeFilter, setTransactionTypeFilter]");
    expect(screen).toContain("const [transactionDateFilter, setTransactionDateFilter]");
    expect(screen).toContain('type="search" value={transactionSearch}');
    expect(screen).toContain('{ value: "today", label: "Today" }');
    expect(screen).toContain('{ value: "week", label: "Last 7 days" }');
    expect(screen).toContain('{ value: "location_transfer", label: "Transfer Location" }');
    expect(section).toContain('className="tx-v2-dropdown-trigger"');
    expect(section).toContain('className="tx-v2-dropdown-menu"');
    expect(screen).toContain("const transactionWithinDate = React.useCallback");
    expect(screen).toContain("const filteredSuccessfulTransactions = successfulTransactions.filter");
    expect(screen).toContain("const filteredFailedTransactions = failedTransactions.filter");
    expect(screen).toContain("const filteredPendingReconciliations = reconciliationGroups.filter");
  });

  it("displays only real Successful, Pending and Failed history classes", () => {
    expect(screen).toContain('React.useState<"successful" | "failed" | "pending">');
    expect(section).toContain('historyTab === "successful"');
    expect(section).toContain('historyTab === "pending"');
    expect(section).toContain('historyTab === "failed"');
    expect(section).toContain("filteredSuccessfulTransactions.map");
    expect(section).toContain("filteredPendingReconciliations.map");
    expect(section).toContain("filteredFailedTransactions.map");
    expect(screen).toContain("loadSuccessfulTransactionHistory()");
    expect(screen).toContain("loadFailedTransactionHistory()");
    expect(screen).toContain("loadPendingLocalScanEntries(employee.id)");
    expect(section).toContain("Saved locally");
    expect(section).not.toContain("STE-FG-000123");
  });

  it("pending Physical Counts use the preexisting review and submission safeguards", () => {
    expect(section).toContain('onClick={() => openReconciliation(group.reference)}');
    expect(screen).toContain("const openReconciliation = (reference: string) =>");
    expect(screen).toContain("historyReviewConfirmed");
    expect(screen).toContain("markPcountSubmissionTransactionsSubmitted");
    expect(screen).toContain("historySubmitAttemptRef");
    expect(screen).toContain("getPcountNegativeCountIssue");
    expect(screen).toContain("PCOUNT_BLIND_CONFLICT_TITLE");
    expect(section).toContain('item/location count');
    expect(section).not.toContain('Retry Sync');
  });

  it("shows safe receipt details without fabricating item-level ERP records", () => {
    expect(screen).toContain("const [selectedTransactionDetails, setSelectedTransactionDetails]");
    expect(section).toContain('aria-label="Transaction details"');
    expect(section).toContain("setSelectedTransactionDetails(entry)");
    expect(section).toContain('onClick={() => { setShowStoredSummaryDetails(false); setSelectedTransactionDetails(null); }}');
    expect(section).toContain('aria-expanded={showStoredSummaryDetails}');
    expect(section).toContain('onClick={() => setShowStoredSummaryDetails((open) => !open)}');
    expect(section).toContain('id="tx-v2-summary-expanded"');
    expect(section).toContain('className="tx-v2-item-breakdown"');
    expect(section).toContain("selectedTransactionDetails.reference");
    expect(section).toContain("selectedTransactionDetails.detail");
    expect(section).toContain('"completedAt" in selectedTransactionDetails');
    expect(section).toContain('"errorMessage" in selectedTransactionDetails');
    expect(section).toContain("Full Stock Entry documents must be reviewed in ERPNext.");
    expect(section).not.toContain("Job Card: JC-2024-0015");
  });

  it("supports device Back from details, and never resets stored scans on navigation", () => {
    expect(screen).toContain('currentView === "history" && selectedTransactionDetails');
    expect(screen).toContain("setSelectedTransactionDetails(null)");
    expect(screen).toContain("setHistoryRevision((revision) => revision + 1)");
    expect(screen).toContain("const openHistory = () =>");
    expect(screen).not.toContain("clearLocalScanEntries(employee.id);\n    setSelectedTransactionDetails(null)");
  });

  it("keeps styling scoped and scrollable within handheld available height", () => {
    expect(css).toContain(".tx-v2-filters input");
    expect(css).toContain(".tx-v2-dropdown-menu");
    expect(css).toContain(".tx-v2-tabs");
    expect(css).toContain(".transaction-success-list.tx-v2-list");
    expect(css).toContain(".tx-v2-detail");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("@media (max-width: 360px)");
    expect(section).toContain('className="transaction-success-list tx-v2-list"');
  });
});