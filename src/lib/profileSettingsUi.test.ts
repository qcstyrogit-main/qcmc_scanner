import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveScannerModes } from "@/lib/scannerPreferences";

const screen = readFileSync(new URL("../components/BlankPage.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/authenticated-ui.css", import.meta.url), "utf8");
const start = screen.indexOf('{(currentView === "settings" || currentView === "profile") && (');
const end = screen.indexOf('{currentView === "history" && (', start);
const profile = screen.slice(start, end);

describe("QCMC Profile / Settings blue-and-white approved mobile UI", () => {
  it("covers the actual Profile and Settings entry routes, not a fake standalone page", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(profile).toContain('className="simple-view settings-profile-v2"');
    expect(profile).toContain("Profile &amp; Settings");
    expect(profile).toContain('onClick={goBackHome}');
    expect(profile).toContain('className="profile-user-card settings-profile-identity"');
    expect(styles).toContain("QCMC Profile & Settings approved blue-and-white mobile design");
  });

  it("uses the signed-in employee, role, department and device instead of artwork samples", () => {
    expect(profile).toContain('employee.full_name');
    expect(profile).toContain('employee.employee_id || employee.id');
    expect(profile).toContain('employee.designation');
    expect(profile).toContain('employee.department');
    expect(profile).toContain('employee.email');
    expect(profile).toContain('employee.custom_location || employee.company');
    expect(profile).toContain('loadScannerDeviceName() || "Not named"');
    expect(profile).not.toContain("John Dela Cruz");
    expect(profile).not.toContain("EMP-00123");
    expect(profile).not.toContain("QC-SCAN-01");
  });

  it("keeps Device Name editing with its existing safe dialog", () => {
    expect(profile).toContain("setShowDeviceNameDialog(true)");
    expect(profile).toContain('Name this scanner device');
    expect(screen).toContain("const saveDeviceName = () =>");
    expect(screen).toContain("saveScannerDeviceName(deviceNameInput)");
    expect(screen).toContain("setShowDeviceNameDialog(false)");
    expect(screen).toContain('id="device-name-input"');
  });

  it("persists real quantity and package preferences while respecting the Loose Pack manual rule", () => {
    expect(profile).toContain('aria-label="Scanner quantity mode"');
    expect(profile).toContain('selectScannerQuantityMode("manual")');
    expect(profile).toContain('selectScannerQuantityMode("automatic")');
    expect(profile).toContain('disabled={scannerPackageMode === "loose"}');
    expect(profile).toContain('aria-label="Package mode"');
    expect(profile).toContain('selectScannerPackageMode("big")');
    expect(profile).toContain('selectScannerPackageMode("loose")');
    expect(screen).toContain("setScannerPackageMode(saveScannerPackageMode(resolved.packageMode))");
    expect(screen).toContain("setScannerQuantityMode(saveScannerQuantityMode(resolved.quantityMode))");
    expect(resolveScannerModes("automatic", "loose")).toEqual({quantityMode: "manual", packageMode: "loose"});
    expect(resolveScannerModes("automatic", "big")).toEqual({quantityMode: "automatic", packageMode: "big"});
  });

  it("shows ERP base URL read-only and only reports real connection test results", () => {
    expect(profile).toContain("{getActiveErpBaseUrl()}");
    expect(profile).toContain("Current authenticated ERP server · Change at sign-in");
    expect(profile).toContain('disabled={connectionTest.loading} onClick={() => void testErpConnection()}');
    expect(screen).toContain('erpRequest("/api/method/ping", { method: "GET", retryOn403: false })');
    expect(screen).toContain("setConnectionTest({ loading: false, ok: true, message, checkedAt: new Date().toISOString() })");
    expect(screen).toContain("setConnectionTest({ loading: false, ok: false, message, checkedAt: new Date().toISOString() })");
    expect(profile).toContain('connectionTest.ok ? "is-success" : "is-error"');
    expect(profile).not.toContain("https://erp.yourcompany.com");
    expect(profile).not.toContain("Last Sync Check");
  });

  it("separates device network from ERP reachability and does not invent a sync timestamp", () => {
    expect(screen).toContain('window.addEventListener("online", refreshNetwork)');
    expect(screen).toContain('window.addEventListener("offline", refreshNetwork)');
    expect(profile).toContain('deviceNetworkOnline ? "Interface online" : "Offline"');
    expect(profile).toContain("Device-reported interface status; test ERP separately");
    expect(profile).toContain("Last ERP Connection Test");
    expect(profile).toContain("This is not a Stock Entry sync timestamp");
    expect(profile).toContain("connectionTest.checkedAt");
    expect(profile).toContain('"Not tested yet"');
  });

  it("shows actual locally saved work and gives pending counts a meaningful navigation path", () => {
    expect(screen).toContain('const profilePcountSession = isProfileView ? loadPcountSession(employee.id) : null');
    expect(screen).toContain("loadPendingLocalScanEntries(employee.id).filter((entry) => entry.mode === \"pcount\")");
    expect(screen).toContain("loadActiveWarehouseAllocation()?.allocation");
    expect(screen).toContain("loadDeviceHandover()");
    expect(profile).toContain("profilePendingWorkflowCount");
    expect(profile).toContain("Resume Pending Work");
    expect(profile).toContain('openHistory()');
    expect(profile).toContain('setHistoryTab("pending")');
    expect(profile).toContain('goBackHome()');
  });

  it("keeps saved-transaction routing and requires existing confirmation for destructive scan clearing", () => {
    expect(profile).toContain('onClick={openHistory}');
    expect(profile).toContain("successfulTransactions.length + failedTransactions.length");
    expect(profile).toContain("setShowClearSavedConfirm(true)");
    expect(profile).toContain('disabled={profileScanEntryCount === 0 && !profilePcountSession}');
    expect(screen).toContain('showClearSavedConfirm && (');
    expect(screen).toContain("clearLocalScanEntries(employee.id)");
    expect(screen).toContain("clearPcountSession(employee.id)");
    expect(screen).toContain("Previously submitted ERPNext transactions are not deleted.");
    expect(profile).toContain("onClick={() => setShowLogoutConfirm(true)}");
    expect(screen).toContain('showLogoutConfirm && (');
  });

  it("labels unsupported preferences instead of offering fake toggles or fake Save Settings action", () => {
    expect(profile).toContain("Scanner Focus Status");
    expect(profile).toContain("Check while scanning");
    expect(profile).toContain("Custom in-app notification preference");
    expect(profile).toContain("Not available");
    expect(profile).toContain("Device controlled");
    expect(profile).toContain("Dark Mode");
    expect(profile).toContain("Coming soon");
    expect(profile).toContain("No extra Save button needed.");
    expect(profile).not.toContain("Save Settings</button>");
    expect(profile).not.toContain('type="checkbox"');
  });

  it("uses responsive scoped styling and retains five-tab bottom navigation", () => {
    expect(styles).toContain(".settings-profile-v2 .settings-profile-section");
    expect(styles).toContain(".settings-profile-v2 .settings-profile-scroll");
    expect(styles).toContain(".settings-profile-v2 .settings-profile-choice");
    expect(styles).toContain("overflow-y: auto");
    expect(styles).toContain("@media (max-width: 400px)");
    expect(styles).toContain("@media (max-height: 710px)");
    expect(styles).toContain(".settings-profile-v2 button:focus-visible");
    expect(screen).toContain('aria-label="Primary navigation"');
    expect(screen).toContain('<span>Inventory</span>');
    expect(screen).toContain('<span>Delivery</span>');
    expect(screen).toContain('<span>Scan Mode</span>');
    expect(screen).toContain('<span>Transactions</span>');
    expect(screen).toContain('<span>Profile</span>');
  });
});
