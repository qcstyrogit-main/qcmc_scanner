import { beforeEach, describe, expect, it, vi } from "vitest";

const localValues = new Map<string, string>();
const sessionValues = new Map<string, string>();

const storageFor = (values: Map<string, string>) => ({
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, String(value)),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(),
});

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storageFor(localValues),
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: storageFor(sessionValues),
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: globalThis,
});

import * as erpApi from "@/lib/erpApi";
import { getErpMobileToken } from "@/lib/erpSession";

const { resumeErpSession, setErpMobileToken } = erpApi;

beforeEach(() => {
  localValues.clear();
  sessionValues.clear();
  vi.restoreAllMocks();
});

describe("ERP session resume", () => {
  it("persists the replacement mobile token returned by a successful resume", async () => {
    setErpMobileToken("old-mobile-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: {
        success: true,
        sid: "renewed-sid",
        csrf_token: "renewed-csrf",
        mobile_token: "replacement-mobile-token",
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(resumeErpSession()).resolves.toBe("ok");
    expect(getErpMobileToken()).toBe("replacement-mobile-token");
  });

  it("treats a temporary backend authentication failure as unavailable", async () => {
    setErpMobileToken("durable-mobile-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: {
        success: false,
        error_code: "AUTH_TEMPORARILY_UNAVAILABLE",
        message: "Authentication is temporarily unavailable.",
      },
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(resumeErpSession()).resolves.toBe("unavailable");
    expect(getErpMobileToken()).toBe("durable-mobile-token");
  });

  it("does not end the login when the server returns a malformed response", async () => {
    setErpMobileToken("durable-mobile-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream gateway error", {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    })));

    await expect(resumeErpSession()).resolves.toBe("unavailable");
    expect(getErpMobileToken()).toBe("durable-mobile-token");
  });

  it("ends the stored login only for a terminal authentication failure", () => {
    const isTerminal = (erpApi as typeof erpApi & {
      isTerminalErpSessionStatus?: (status: string) => boolean;
    }).isTerminalErpSessionStatus;

    expect(isTerminal?.("invalid")).toBe(true);
    expect(isTerminal?.("offline")).toBe(false);
    expect(isTerminal?.("unavailable")).toBe(false);
  });
});
