import { describe, expect, it } from "vitest";
import * as scannerFocus from "@/lib/scannerFocus";

const canCapture = (overrides: Record<string, boolean> = {}) => {
  const decide = (scannerFocus as typeof scannerFocus & {
    shouldCaptureScannerFocus?: (state: Record<string, boolean>) => boolean;
  }).shouldCaptureScannerFocus;

  return decide?.({
    resolvingLocation: false,
    showingItemDetails: false,
    showingSubmitConfirmation: false,
    showingFinishLocationConfirmation: false,
    showingExistingLocationConfirmation: false,
    showingStockChangeReview: false,
    submitting: false,
    enteringManualQuantity: false,
    ...overrides,
  });
};

describe("scanner focus ownership", () => {
  it("captures scanner keys from the page after focus moves away from the scanner input", () => {
    expect(scannerFocus.shouldCapturePageScannerKey({ allowed: true, scannerTarget: false, editableTarget: false, key: "{", hasBuffer: false, modified: false })).toBe(true);
    expect(scannerFocus.shouldCapturePageScannerKey({ allowed: true, scannerTarget: false, editableTarget: false, key: "Enter", hasBuffer: true, modified: false })).toBe(true);
  });

  it("preserves dialogs, manual fields, input-owned scans, shortcuts, and ordinary button activation", () => {
    const state = { allowed: true, scannerTarget: false, editableTarget: false, key: "A", hasBuffer: false, modified: false };
    expect(scannerFocus.shouldCapturePageScannerKey({ ...state, allowed: false })).toBe(false);
    expect(scannerFocus.shouldCapturePageScannerKey({ ...state, editableTarget: true })).toBe(false);
    expect(scannerFocus.shouldCapturePageScannerKey({ ...state, scannerTarget: true })).toBe(false);
    expect(scannerFocus.shouldCapturePageScannerKey({ ...state, modified: true })).toBe(false);
    expect(scannerFocus.shouldCapturePageScannerKey({ ...state, key: "Enter" })).toBe(false);
    expect(scannerFocus.shouldCapturePageScannerKey({ ...state, key: "Tab" })).toBe(false);
  });

  it("keeps a submission focus request pending until scanning is allowed and the input is mounted", () => {
    let focused = false;
    const input = { disabled: false, focus: () => { focused = true; } };
    expect(scannerFocus.restoreSubmittedScannerFocus(true, false, input)).toBe(false);
    expect(scannerFocus.restoreSubmittedScannerFocus(true, true, null)).toBe(false);
    expect(focused).toBe(false);
    expect(scannerFocus.restoreSubmittedScannerFocus(true, true, input)).toBe(true);
    expect(focused).toBe(true);
  });

  it("does not restore submission focus without a request or while the input is disabled", () => {
    const input = { disabled: true, focus: () => { throw new Error("must not focus"); } };
    expect(scannerFocus.restoreSubmittedScannerFocus(true, true, input)).toBe(false);
    expect(scannerFocus.restoreSubmittedScannerFocus(false, true, input)).toBe(false);
  });

  it("restores scanner focus during normal scanning", () => {
    expect(canCapture()).toBe(true);
  });

  it.each([
    "resolvingLocation",
    "showingItemDetails",
    "showingSubmitConfirmation",
    "showingFinishLocationConfirmation",
    "showingExistingLocationConfirmation",
    "showingStockChangeReview",
    "submitting",
    "enteringManualQuantity",
  ])("does not steal focus while %s owns interaction", (state) => {
    expect(canCapture({ [state]: true })).toBe(false);
  });
});
