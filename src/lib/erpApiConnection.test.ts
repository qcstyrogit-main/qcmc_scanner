import { beforeEach, describe, expect, it } from "vitest";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

import {
  getCustomErpBaseUrl,
  getErpConnectionOptions,
  getErpConnectionPreference,
  setCustomErpBaseUrl,
  setErpConnectionPreference,
} from "@/lib/erpApi";

beforeEach(() => {
  storage.clear();
  setErpConnectionPreference("custom");
});

describe("ERP connection settings", () => {
  it("accepts and normalizes a typed custom ERP base URL", () => {
    expect(setCustomErpBaseUrl(" http://192.168.1.203:8001/ ")).toBe("http://192.168.1.203:8001");
    setErpConnectionPreference("custom");

    expect(getCustomErpBaseUrl()).toBe("http://192.168.1.203:8001");
    expect(getErpConnectionPreference()).toBe("custom");
  });

  it("rejects unsafe or malformed custom URLs", () => {
    expect(() => setCustomErpBaseUrl("192.168.1.203:8001")).toThrow(/valid ERP URL/i);
    expect(() => setCustomErpBaseUrl("ftp://192.168.1.203")).toThrow(/http:\/\//i);
    expect(() => setCustomErpBaseUrl("http://user:pass@192.168.1.203:8001"))
      .toThrow(/must not contain credentials/i);
  });

  it("offers only the typed custom connection choice", () => {
    expect(getErpConnectionOptions().map((option) => option.id)).toEqual([
      "custom",
    ]);
  });
});
