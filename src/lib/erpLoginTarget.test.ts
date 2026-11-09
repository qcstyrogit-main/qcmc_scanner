import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("sends login to the saved ERP URL after applying connection settings", async () => {
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_ERP_USE_PROXY", "false");
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const api = await import("./erpApi");
  api.setCustomErpBaseUrl("https://desktop-vlfuuk4.tail39f829.ts.net/");
  api.setErpConnectionPreference("custom");
  expect(api.erpApiUrl("/api/method/qcmc_logic.api.login_scan.login")).toBe(
    "https://desktop-vlfuuk4.tail39f829.ts.net/api/method/qcmc_logic.api.login_scan.login",
  );
  vi.resetModules();
  const reloadedApi = await import("./erpApi");
  expect(reloadedApi.getActiveErpBaseUrl()).toBe("https://desktop-vlfuuk4.tail39f829.ts.net");
});
