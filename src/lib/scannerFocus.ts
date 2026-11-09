export type ScannerFocusState = {
  resolvingLocation: boolean;
  showingItemDetails: boolean;
  showingSubmitConfirmation: boolean;
  showingFinishLocationConfirmation: boolean;
  showingExistingLocationConfirmation: boolean;
  showingStockChangeReview: boolean;
  submitting: boolean;
  enteringManualQuantity: boolean;
};

export const shouldCaptureScannerFocus = (state: ScannerFocusState) =>
  !Object.values(state).some(Boolean);

// Consume a successful submission's focus request only after the UI is ready.
export const restoreSubmittedScannerFocus = (
  requested: boolean,
  allowed: boolean,
  input: Pick<HTMLInputElement, "disabled" | "focus"> | null
) => {
  if (!requested || !allowed || !input || input.disabled) return false;
  input.focus({ preventScroll: true });
  return true;
};

export const shouldCapturePageScannerKey = (state: {
  allowed: boolean;
  scannerTarget: boolean;
  editableTarget: boolean;
  key: string;
  hasBuffer: boolean;
  modified: boolean;
}) => {
  if (!state.allowed || state.scannerTarget || state.editableTarget || state.modified) return false;
  if (state.key.length === 1) return true;
  return state.hasBuffer && ["Enter", "Backspace", "Delete", "Escape"].includes(state.key);
};
