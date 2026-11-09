export const SCANNER_SHIFT_DURATION_MS = 12 * 60 * 60 * 1000;

const SHIFT_STARTED_AT_KEY = "qcmc.scanner.shiftStartedAt.v1";

export const loadScannerShiftStartedAt = () => {
  try {
    const value = Number(localStorage.getItem(SHIFT_STARTED_AT_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
};

export const startScannerShift = (now = Date.now()) => {
  try {
    localStorage.setItem(SHIFT_STARTED_AT_KEY, String(now));
  } catch {
    // Keep login usable even when persistent storage is temporarily unavailable.
  }
  return now;
};

export const ensureScannerShiftStarted = (now = Date.now()) =>
  loadScannerShiftStartedAt() || startScannerShift(now);

export const isScannerShiftExpired = (now = Date.now()) => {
  const startedAt = loadScannerShiftStartedAt();
  return startedAt > 0 && now - startedAt >= SCANNER_SHIFT_DURATION_MS;
};

export const clearScannerShift = () => {
  try {
    localStorage.removeItem(SHIFT_STARTED_AT_KEY);
  } catch {
    // Ignore storage failures during logout.
  }
};
