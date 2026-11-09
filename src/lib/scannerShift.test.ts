import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearScannerShift,
  ensureScannerShiftStarted,
  isScannerShiftExpired,
  loadScannerShiftStartedAt,
  SCANNER_SHIFT_DURATION_MS,
  startScannerShift,
} from "@/lib/scannerShift";

describe("scanner shift session", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  it("starts and restores the same shift", () => {
    expect(ensureScannerShiftStarted(1_000)).toBe(1_000);
    expect(ensureScannerShiftStarted(2_000)).toBe(1_000);
    expect(loadScannerShiftStartedAt()).toBe(1_000);
  });

  it("keeps the login valid during the 12-hour shift", () => {
    startScannerShift(5_000);
    expect(isScannerShiftExpired(5_000 + SCANNER_SHIFT_DURATION_MS - 1)).toBe(false);
  });

  it("expires the login at the end of the 12-hour shift", () => {
    startScannerShift(5_000);
    expect(isScannerShiftExpired(5_000 + SCANNER_SHIFT_DURATION_MS)).toBe(true);
  });

  it("clears shift metadata on logout", () => {
    startScannerShift(5_000);
    clearScannerShift();
    expect(loadScannerShiftStartedAt()).toBe(0);
  });
});
