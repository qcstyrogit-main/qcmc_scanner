import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const inventory = readFileSync(new URL("../components/BlankPage.tsx", import.meta.url), "utf8");

describe("Android Back exit policy", () => {
  it("exits only when unauthenticated and not restoring a saved session", () => {
    expect(app).toContain("if (!Capacitor.isNativePlatform() || employee || isRestoringSession) return");
    expect(app).toContain('CapacitorApp.addListener("backButton", () => {');
    expect(app).toContain("void CapacitorApp.exitApp()");
  });
  it("keeps the logged-in dashboard open on hardware Back", () => {
    expect(inventory).toContain('currentView !== "dashboard"');
    expect(inventory).toContain('showToast("info", "Use Log out from Profile to return to the Login screen.")');
    expect(inventory).not.toContain("CapacitorApp.exitApp()");
  });
  it("preserves navigation within authenticated screens", () => {
    expect(inventory).toContain("setShowLogoutConfirm(false)");
    expect(inventory).toContain("setOpenTransactionFilter(null)");
    expect(inventory).toContain("goBackHome()");
  });
});
