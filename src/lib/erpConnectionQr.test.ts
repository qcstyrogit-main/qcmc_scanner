import { describe, expect, it } from "vitest";
import { createErpConnectionQrValue, normalizeErpConnectionQrValue } from "@/lib/erpConnectionQr";

describe("ERP connection QR", () => {
  it("generates a QR payload containing only the normalized ERP URL", () => {
    expect(createErpConnectionQrValue(" http://qcmc.qcstyro.com/ ")).toBe("http://qcmc.qcstyro.com");
  });

  it("accepts local HTTP ERP URLs scanned by another device", () => {
    expect(normalizeErpConnectionQrValue("http://192.168.1.203:8001/"))
      .toBe("http://192.168.1.203:8001");
  });

  it("accepts HTTPS ERP URLs", () => {
    expect(normalizeErpConnectionQrValue("https://desktop-vlfuuk4.tail39f829.ts.net"))
      .toBe("https://desktop-vlfuuk4.tail39f829.ts.net");
  });

  it("rejects non-URL QR values and unsafe URL metadata", () => {
    expect(() => normalizeErpConnectionQrValue("ITEM;20;PCS;OLD")).toThrow(/valid ERP URL/i);
    expect(() => normalizeErpConnectionQrValue("ftp://qcmc.qcstyro.com")).toThrow(/HTTP or HTTPS/i);
    expect(() => normalizeErpConnectionQrValue("http://user:pass@qcmc.qcstyro.com")).toThrow(/credentials/i);
  });
});
