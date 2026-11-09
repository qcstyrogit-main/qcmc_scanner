export type ScannerTextSize = "normal" | "large";
export type ScannerQuantityMode = "automatic" | "manual";
export type ScannerPackageMode = "big" | "loose";
export type ScannerLocationMode = "single" | "multi";

const TEXT_SIZE_KEY = "qcmc.scanner.textSize.v1";
const QUANTITY_MODE_KEY = "qcmc.scanner.quantityMode.v1";
const PACKAGE_MODE_KEY = "qcmc.scanner.packageMode.v1";
const LOCATION_MODE_KEY = "qcmc.scanner.locationMode.v1";

export const loadScannerTextSize = (): ScannerTextSize => {
  try {
    return localStorage.getItem(TEXT_SIZE_KEY) === "large" ? "large" : "normal";
  } catch {
    return "normal";
  }
};

export const applyScannerTextSize = (size: ScannerTextSize) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.scannerTextSize = size;
  }
};

export const saveScannerTextSize = (size: ScannerTextSize) => {
  try {
    localStorage.setItem(TEXT_SIZE_KEY, size);
  } catch {
    // The selected size still applies for the current app session.
  }
  applyScannerTextSize(size);
  return size;
};

export const loadScannerQuantityMode = (): ScannerQuantityMode => {
  try {
    return localStorage.getItem(QUANTITY_MODE_KEY) === "automatic" ? "automatic" : "manual";
  } catch {
    return "manual";
  }
};

export const saveScannerQuantityMode = (mode: ScannerQuantityMode) => {
  try {
    localStorage.setItem(QUANTITY_MODE_KEY, mode);
  } catch {
    // Keep the selected mode for the current screen even if storage is unavailable.
  }
  return mode;
};

export const loadScannerPackageMode = (): ScannerPackageMode => {
  try {
    return localStorage.getItem(PACKAGE_MODE_KEY) === "loose" ? "loose" : "big";
  } catch {
    return "big";
  }
};

export const saveScannerPackageMode = (mode: ScannerPackageMode) => {
  try {
    localStorage.setItem(PACKAGE_MODE_KEY, mode);
  } catch {
    // Keep the selected mode for the current screen even if storage is unavailable.
  }
  return mode;
};

export const loadScannerLocationMode = (): ScannerLocationMode => {
  try {
    return localStorage.getItem(LOCATION_MODE_KEY) === "multi" ? "multi" : "single";
  } catch {
    return "single";
  }
};

export const saveScannerLocationMode = (mode: ScannerLocationMode) => {
  try {
    localStorage.setItem(LOCATION_MODE_KEY, mode);
  } catch {
    // Keep the selected mode for the current screen even if storage is unavailable.
  }
  return mode;
};

export const resolveScannerModes = (
  quantityMode: ScannerQuantityMode,
  packageMode: ScannerPackageMode,
) => packageMode === "loose"
  ? { quantityMode: "manual" as const, packageMode }
  : { quantityMode, packageMode };
