import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const src = readFileSync(new URL("../components/ScanPage.tsx", import.meta.url), "utf8");
describe("Physical Count submission loading guard", () => {
  it("limits repeated status polling and preserves ERP submission identity", () => {
    expect(src).toContain("const statusDeadline = Date.now() + 30000");
    expect(src).toContain("attempt < 12");
    expect(src).toContain("getPcountSubmissionStatus(submissionId)");
    expect(src).toContain("setHasQueuedSubmission(true)");
    expect(src).toContain("do not submit a second copy");
  });
  it("still closes loading state and retains queued work when processing is unresolved", () => {
    expect(src).toContain("setIsSubmitting(false)");
    expect(src).toContain("savePendingPcountSubmission(employee.id, reconciliationCode");
  });
});
