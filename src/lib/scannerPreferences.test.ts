import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadScannerLocationMode,
  loadScannerPackageMode,
  loadScannerQuantityMode,
  resolveScannerModes,
  saveScannerLocationMode,
  saveScannerPackageMode,
  saveScannerQuantityMode,
} from "@/lib/scannerPreferences";

describe("scanner quantity mode preference", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  it("defaults to automatic and permanently stores a manual selection", () => {
    expect(loadScannerQuantityMode()).toBe("automatic");
    expect(saveScannerQuantityMode("manual")).toBe("manual");
    expect(loadScannerQuantityMode()).toBe("manual");
  });

  it("defaults to big pack and permanently stores a loose pack selection", () => {
    expect(loadScannerPackageMode()).toBe("big");
    expect(saveScannerPackageMode("loose")).toBe("loose");
    expect(loadScannerPackageMode()).toBe("loose");
  });

  it("forces manual quantity entry for loose packs", () => {
    expect(resolveScannerModes("automatic", "loose")).toEqual({ quantityMode: "manual", packageMode: "loose" });
    expect(resolveScannerModes("automatic", "big")).toEqual({ quantityMode: "automatic", packageMode: "big" });
  });

  it("defaults to single location and permanently stores multi location", () => {
    expect(loadScannerLocationMode()).toBe("single");
    expect(saveScannerLocationMode("multi")).toBe("multi");
    expect(loadScannerLocationMode()).toBe("multi");
  });

  it("falls back to single location for an unknown saved value", () => {
    values.set("qcmc.scanner.locationMode.v1", "unknown");
    expect(loadScannerLocationMode()).toBe("single");
  });
});
