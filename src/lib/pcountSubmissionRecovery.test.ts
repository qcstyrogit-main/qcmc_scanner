import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatPcountUploadTimings, isMissingPcountSubmissionStatus } from "./pcountSubmissionRecovery";

describe("Physical Count existing-submission recovery", () => {
  it("allows a repeat POST only if ERP explicitly reports a missing submission", () => {
    expect(isMissingPcountSubmissionStatus(new Error("Unable to read Physical Count submission status (HTTP 404)"))).toBe(true);
    expect(isMissingPcountSubmissionStatus(new Error("Physical Count Submission xyz does not exist"))).toBe(true);
    expect(isMissingPcountSubmissionStatus(new Error("Failed to fetch"))).toBe(false);
    expect(isMissingPcountSubmissionStatus(new Error("Session expired (HTTP 401)"))).toBe(false);
    expect(isMissingPcountSubmissionStatus(new Error("ERP server unavailable (HTTP 500)"))).toBe(false);
    expect(isMissingPcountSubmissionStatus(new Error("request timed out"))).toBe(false);
  });

  it("reports stage timings without including scanned stock data", () => {
    expect(formatPcountUploadTimings({
      preparationMs: 1250,
      acceptanceMs: 240,
      confirmationMs: 5000,
      totalMs: 6490,
      recoveredExisting: false,
    })).toBe("Prep 1.3s · ERP receipt 0.2s · ERP confirmation 5.0s · Total 6.5s");
  });

  it("checks queued upload status first and preserves the old ID on retry", () => {
    const source = readFileSync(new URL("../components/ScanPage.tsx", import.meta.url), "utf8");
    const handler = source.slice(source.indexOf("const handleSubmitToErp ="), source.indexOf("const resubmitAfterBaselineRefresh ="));
    const statusCall = handler.indexOf("status = await getPcountSubmissionStatus(submissionId)");
    const uploadCall = handler.indexOf("status = await uploadPcountSubmission(reconciliationCode, stagedEntries");
    expect(statusCall).toBeGreaterThan(0);
    expect(uploadCall).toBeGreaterThan(statusCall);
    expect(handler).toContain("if (!isMissingPcountSubmissionStatus(statusError)) throw statusError");
    expect(handler).toContain("const submissionId = reuse ? persisted!.submissionId : createPcountSubmissionId()");
    expect(handler).toContain("markPcountSubmissionTransactionsSubmitted(employee.id, reconciliationCode, stagedEntries)");
    expect(handler).toContain("formatPcountUploadTimings({");
  });
});
