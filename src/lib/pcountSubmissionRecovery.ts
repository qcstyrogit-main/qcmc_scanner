/**
 * A previously staged upload must be checked by submission ID before another
 * POST. Only an explicit "not found" means ERP has not accepted it.
 * Unknown/network/auth errors are NOT permission to submit another copy.
 */
export const isMissingPcountSubmissionStatus = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || "");
  return /(?:HTTP\s*404\b|\b404\s+not\s+found\b|Physical Count Submission[^\n]*does not exist|Physical Count Submission[^\n]*not found)/i.test(message);
};

export type PcountUploadTimings = {
  preparationMs: number;
  acceptanceMs: number | null;
  confirmationMs: number | null;
  totalMs: number;
  recoveredExisting: boolean;
};

/** For operator diagnostics only; never stores quantities or request bodies. */
export const formatPcountUploadTimings = (timings: PcountUploadTimings): string => {
  const seconds = (value: number) => (Math.max(0, value) / 1000).toFixed(1) + "s";
  return [
    `Prep ${seconds(timings.preparationMs)}`,
    timings.acceptanceMs === null
      ? "ERP receipt already recorded"
      : `ERP receipt ${seconds(timings.acceptanceMs)}`,
    timings.confirmationMs === null
      ? "ERP confirmation pending"
      : `ERP confirmation ${seconds(timings.confirmationMs)}`,
    `Total ${seconds(timings.totalMs)}`,
  ].join(" · ");
};
