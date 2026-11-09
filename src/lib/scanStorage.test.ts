import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPcountSession,
  clearPendingPcountSubmission,
  loadPcountSession,
  loadPendingPcountSubmission,
  loadLocalScanEntries,
  mergeLocalScanEntries,
  saveLocalScanEntries,
  savePcountSession,
  savePendingPcountSubmission,
  isPcountReconciliationUnavailable,
  hasExistingLocationCount,
  removePcountFromLastActivity,
  restorePcountToLastActivity,
  updateValidatedLocalScanEntry,
  type LocalPcountSession,
  type LocalScanEntry,
} from "@/lib/scanStorage";
import {
  loadReconciliationContextOffline,
  removeReconciliationContextOffline,
  saveReconciliationContextOffline,
} from "@/lib/offlinePcountCache";

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

beforeEach(() => {
  storage.clear();
  vi.restoreAllMocks();
});

describe("Physical Count storage failure handling", () => {
  it("reports a failed scanned-item save without destroying the prior saved count", () => {
    saveLocalScanEntries("EMP-1", [entry({ quantity: 20 })]);
    const prior = loadLocalScanEntries("EMP-1");
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(() => saveLocalScanEntries("EMP-1", [entry({ quantity: 40 })])).toThrow("Unable to save scanned items locally");
    expect(storage.size).toBeGreaterThan(0);
    expect(prior[0].quantity).toBe(20);
  });

  it("rejects an unsaved pending submission rather than claiming it was queued", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(() => savePendingPcountSubmission("EMP-1", "MAT-RECO-1", {
      fingerprint: "count-1", submissionId: "uuid-1", payload: { entries: [] },
    })).toThrow("Unable to save the Physical Count submission locally");
    expect(loadPendingPcountSubmission("EMP-1", "MAT-RECO-1")).toBeNull();
  });
});

const entry = (overrides: Partial<LocalScanEntry> = {}): LocalScanEntry => ({
  raw: "ITEM;20;PCS;LEGACY",
  mode: "pcount",
  reconciliationCode: "MAT-RECO-1",
  bin: {
    raw: "",
    warehouse: "Stockroom - Sta Clara",
    stockroom: "",
    building: "",
    aisle: "",
    rack: "",
    bin: "R1",
    locationId: "R1",
  },
  itemCode: "ITEM",
  qrQuantity: 20,
  multiplier: 13,
  quantity: 260,
  uom: "PCS",
  lotNo: "",
  timestamp: "07:00:00 AM",
  deviceId: "S1",
  submittedQuantity: 260,
  erpBaselineQuantity: 0,
  scanTransactions: [],
  submittedTransactionCount: 0,
  ...overrides,
});

describe("package scan audit persistence", () => {
  const transaction = (id: string, actualQuantity: number) => ({
    id,
    action: "ADD" as const,
    quantityChange: actualQuantity,
    runningQuantity: actualQuantity,
    timestamp: "2026-09-23T08:00:00.000Z",
    locationId: "R1",
    locationLabel: "R1",
    employeeId: "EMP-1",
    employeeName: "User",
    deviceId: "S1",
    qrQuantity: 500,
    packageStatus: "OPENED" as const,
    actualQuantity,
    remainingQuantity: actualQuantity,
    packageId: "PKG-1",
  });

  it("restores the original QR quantity and actual opened-package quantity", () => {
    saveLocalScanEntries("EMP-1", [entry({ quantity: 495, scanTransactions: [transaction("scan-1", 495)] })]);

    expect(loadLocalScanEntries("EMP-1")[0].scanTransactions?.[0]).toMatchObject({
      qrQuantity: 500,
      packageStatus: "OPENED",
      actualQuantity: 495,
      remainingQuantity: 495,
      packageId: "PKG-1",
    });
  });

  it("loads legacy transactions without inventing package metadata", () => {
    saveLocalScanEntries("EMP-1", [entry({ scanTransactions: [{
      id: "legacy-scan", action: "ADD", quantityChange: 20, runningQuantity: 20,
      timestamp: "07:00:00 AM", locationId: "R1", locationLabel: "R1",
      employeeId: "EMP-1", employeeName: "User", deviceId: "S1",
    }] })]);

    expect(loadLocalScanEntries("EMP-1")[0].scanTransactions?.[0]).not.toHaveProperty("packageStatus");
  });

  it("keeps each package audit record when scans merge into one item and location", () => {
    const first = entry({ quantity: 495, scanTransactions: [transaction("scan-1", 495)] });
    const second = entry({ quantity: 490, scanTransactions: [{ ...transaction("scan-2", 490), packageId: "PKG-2" }] });

    const merged = mergeLocalScanEntries([first], second);

    expect(merged).toHaveLength(1);
    expect(merged[0].scanTransactions?.map((scan) => [scan.id, scan.actualQuantity, scan.packageId])).toEqual([
      ["scan-1", 495, "PKG-1"],
      ["scan-2", 490, "PKG-2"],
    ]);
  });
});

describe("Inventory Tag correction persistence", () => {
  it("retains the tag and append-only edit trail after saving and restoring an offline scan", () => {
    const transaction = {
      id: "scan-tag-edit", action: "ADD" as const, quantityChange: 10, runningQuantity: 10,
      timestamp: "2026-10-19T00:00:00.000Z", locationId: "R1", locationLabel: "R1",
      employeeId: "EMP-1", employeeName: "User", deviceId: "S1",
      inventoryTag: "TAG-CORRECT",
      inventoryTagEditHistory: [
        { from: "TAG-ORIGINAL", to: "TAG-TYPO", at: "2026-10-19T00:01:00.000Z", employeeId: "EMP-1" },
        { from: "TAG-TYPO", to: "TAG-CORRECT", at: "2026-10-19T00:02:00.000Z", employeeId: "EMP-1" },
      ],
    };
    saveLocalScanEntries("EMP-1", [entry({ scanTransactions: [transaction] })]);
    const saved = loadLocalScanEntries("EMP-1")[0].scanTransactions?.[0];
    expect(saved?.inventoryTag).toBe("TAG-CORRECT");
    expect(saved?.inventoryTagEditHistory).toEqual(transaction.inventoryTagEditHistory);
    saveLocalScanEntries("EMP-1", loadLocalScanEntries("EMP-1"));
    expect(loadLocalScanEntries("EMP-1")[0].scanTransactions?.[0].inventoryTagEditHistory).toHaveLength(2);
  });
});

describe("Physical Count baseline tracking", () => {
  it("merges compatible piece aliases into one item/location row", () => {
    const result = mergeLocalScanEntries([entry({ uom: "PCS", barcodeUom: "PCS" })], entry({
      uom: "PC",
      barcodeUom: "PC",
      authoritativeUom: "PC",
      quantity: 20,
      multiplier: 1,
      submittedQuantity: 0,
    }));

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(280);
  });

  it("matches a repeated Physical Count scan when its barcode UOM is blank", () => {
    const saved = entry({ uom: "PCS", barcodeUom: "", authoritativeUom: "PCS", quantity: 1000 });
    const repeated = entry({ uom: "", barcodeUom: "", authoritativeUom: undefined, qrQuantity: 1000, quantity: 1000 });

    const result = mergeLocalScanEntries([saved], repeated);

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(2000);
    expect(result[0].authoritativeUom).toBe("PCS");
  });

  it("preserves offline scans when validation is unavailable", () => {
    saveLocalScanEntries("EMP-1", [entry({ erpBaselineQuantity: undefined, authoritativeUom: undefined })]);

    expect(loadLocalScanEntries("EMP-1")).toHaveLength(1);
    expect(loadLocalScanEntries("EMP-1")[0].quantity).toBe(260);
  });

  it("updates stale cached UOM after validation without deleting scan history", () => {
    const offline = entry({
      uom: "PCS",
      barcodeUom: "PCS",
      authoritativeUom: undefined,
      erpBaselineQuantity: undefined,
      scanTransactions: [{
        id: "scan-1", action: "ADD", quantityChange: 20, runningQuantity: 20,
        timestamp: "07:00:00 AM", locationId: "R1", locationLabel: "R1",
        employeeId: "EMP-1", employeeName: "User", deviceId: "S1",
      }],
    });
    saveLocalScanEntries("EMP-1", [offline]);

    updateValidatedLocalScanEntry("EMP-1", offline, {
      authoritativeUom: "PC",
      erpBaselineQuantity: 10,
    });

    const validated = loadLocalScanEntries("EMP-1")[0];
    expect(validated.barcodeUom).toBe("PCS");
    expect(validated.authoritativeUom).toBe("PC");
    expect(validated.uom).toBe("PC");
    expect(validated.quantity).toBe(260);
    expect(validated.scanTransactions).toHaveLength(1);
  });

  it("persists ERP UOM conversion factors for later rescans", () => {
    const offline = entry({
      uom: "PCS",
      barcodeUom: "BOX",
      authoritativeUom: undefined,
      uomConversionFactor: undefined,
    });
    saveLocalScanEntries("EMP-1", [offline]);

    updateValidatedLocalScanEntry("EMP-1", offline, {
      authoritativeUom: "PCS",
      erpBaselineQuantity: 10,
      uomConversionFactor: 500,
    });

    expect(loadLocalScanEntries("EMP-1")[0].uomConversionFactor).toBe(500);
  });

  it("keeps the stock-ledger baseline separate from the Draft count", () => {
    const followUp = entry({
      multiplier: 5000,
      quantity: 100000,
      submittedQuantity: 0,
      erpBaselineQuantity: undefined,
    });
    const merged = mergeLocalScanEntries([entry()], followUp)[0];

    expect(merged.submittedQuantity).toBe(260);
    expect(merged.quantity).toBe(100260);
    expect(merged.erpBaselineQuantity).toBe(0);
  });

  it("keeps the same item in two exact Storage Locations as separate rows", () => {
    const rack1 = entry({ bin: { ...entry().bin, locationId: "R1", bin: "R1" } });
    const rack2 = entry({ bin: { ...entry().bin, locationId: "R2", bin: "R2" }, quantity: 220 });

    const result = mergeLocalScanEntries([rack1], rack2);

    expect(result).toHaveLength(2);
    expect(result.map((row) => row.bin.locationId).sort()).toEqual(["R1", "R2"]);
  });

  it("merges follow-up scans only into the matching exact location", () => {
    const rack1 = entry({ quantity: 20, submittedQuantity: 0 });
    const rack2 = entry({ bin: { ...entry().bin, locationId: "R2", bin: "R2" }, quantity: 40, submittedQuantity: 0 });
    const followUpRack2 = entry({ bin: { ...entry().bin, locationId: "R2", bin: "R2" }, quantity: 20, submittedQuantity: 0 });

    const result = mergeLocalScanEntries([rack1, rack2], followUpRack2);

    expect(result.find((row) => row.bin.locationId === "R1")?.quantity).toBe(20);
    expect(result.find((row) => row.bin.locationId === "R2")?.quantity).toBe(60);
  });
});

describe("multi-location Physical Count session persistence", () => {
  const session: LocalPcountSession = {
    reconciliationCode: "MAT-RECO-1",
    reconciliationWarehouse: "Stockroom - Sta Clara",
    locationMode: "single",
    activeGroupId: "",
    activeLocationId: "R2",
    locations: [
      { bin: entry().bin, status: "completed", lastScanTime: "2026-08-27T08:00:00Z", completedAt: "2026-08-27T08:01:00Z" },
      { bin: { ...entry().bin, locationId: "R2", bin: "R2" }, status: "in_progress", lastScanTime: "2026-08-27T08:02:00Z" },
    ],
    updatedAt: "2026-08-27T08:02:00Z",
  };

  it("restores reconciliation, completed locations, and active location after restart", () => {
    savePcountSession("EMP-1", session);

    const restored = loadPcountSession("EMP-1");
    expect(restored?.reconciliationCode).toBe(session.reconciliationCode);
    expect(restored?.reconciliationWarehouse).toBe(session.reconciliationWarehouse);
    expect(restored?.activeLocationId).toBe("R2");
    expect(restored?.locations.map((location) => ({
      id: location.bin.locationId,
      status: location.status,
      lastScanTime: location.lastScanTime,
    }))).toEqual([
      { id: "R1", status: "completed", lastScanTime: "2026-08-27T08:00:00Z" },
      { id: "R2", status: "in_progress", lastScanTime: "2026-08-27T08:02:00Z" },
    ]);
  });

  it("loads a legacy session as single location without an active group", () => {
    localStorage.setItem("qcmc.pcount.session.1.EMP-1", JSON.stringify({
      reconciliationCode: "MAT-RECO-LEGACY",
      reconciliationWarehouse: "FG - MC2",
      activeLocationId: "R1",
      locations: [{ bin: entry().bin, status: "in_progress", lastScanTime: "2026-09-29T01:00:00Z" }],
      updatedAt: "2026-09-29T01:00:00Z",
    }));

    expect(loadPcountSession("EMP-1")).toMatchObject({
      locationMode: "single",
      activeGroupId: "",
      activeLocationId: "R1",
    });
  });

  it("restores a valid multi-location group and discards malformed locations", () => {
    localStorage.setItem("qcmc.pcount.session.1.EMP-1", JSON.stringify({
      reconciliationCode: "MAT-RECO-MULTI",
      reconciliationWarehouse: "FG - MC2",
      locationMode: "multi",
      activeGroupId: "GROUP-1",
      activeLocationId: "",
      locations: [
        { bin: entry().bin, status: "in_progress", groupId: "GROUP-1", lastScanTime: "2026-09-29T02:00:00Z" },
        { bin: { ...entry().bin, locationId: "R2", bin: "R2" }, status: "in_progress", groupId: "GROUP-1", lastScanTime: "2026-09-29T02:01:00Z" },
        { bin: { warehouse: "FG - MC2" }, status: "in_progress", groupId: "GROUP-1", lastScanTime: "invalid" },
      ],
      updatedAt: "2026-09-29T02:01:00Z",
    }));

    const restored = loadPcountSession("EMP-1");
    expect(restored?.locationMode).toBe("multi");
    expect(restored?.activeGroupId).toBe("GROUP-1");
    expect(restored?.locations.map(({ bin, groupId, status, lastScanTime }) => ({ id: bin.locationId, groupId, status, lastScanTime }))).toEqual([
      { id: "R1", groupId: "GROUP-1", status: "in_progress", lastScanTime: "2026-09-29T02:00:00Z" },
      { id: "R2", groupId: "GROUP-1", status: "in_progress", lastScanTime: "2026-09-29T02:01:00Z" },
    ]);
  });

  it("restores unfinished Multi work even when the next-mode preference is Single", () => {
    localStorage.setItem("qcmc.pcount.session.1.EMP-1", JSON.stringify({
      reconciliationCode: "MAT-RECO-MIXED",
      reconciliationWarehouse: "FG - MC2",
      locationMode: "single",
      activeLocationMode: "multi",
      activeGroupId: "GROUP-ACTIVE",
      activeLocationId: "",
      locations: [
        { bin: entry().bin, status: "in_progress", groupId: "GROUP-ACTIVE", lastScanTime: "2026-09-29T03:00:00Z" },
        { bin: { ...entry().bin, locationId: "R2", bin: "R2" }, status: "in_progress", groupId: "GROUP-ACTIVE", lastScanTime: "2026-09-29T03:01:00Z" },
      ],
      updatedAt: "2026-09-29T03:01:00Z",
    }));

    expect(loadPcountSession("EMP-1")).toMatchObject({
      locationMode: "single",
      activeLocationMode: "multi",
      activeGroupId: "GROUP-ACTIVE",
    });
  });

  it("infers unfinished Multi work from the active group even without activeLocationMode", () => {
    localStorage.setItem("qcmc.pcount.session.1.EMP-1", JSON.stringify({
      reconciliationCode: "MAT-RECO-LEGACY-MULTI",
      reconciliationWarehouse: "FG - MC2",
      locationMode: "single",
      activeGroupId: "GROUP-LEGACY",
      activeLocationId: "",
      locations: [
        { bin: entry().bin, status: "in_progress", groupId: "GROUP-LEGACY", lastScanTime: "2026-09-29T04:00:00Z" },
      ],
      updatedAt: "2026-09-29T04:00:00Z",
    }));

    expect(loadPcountSession("EMP-1")).toMatchObject({
      locationMode: "single",
      activeLocationMode: "multi",
      activeGroupId: "GROUP-LEGACY",
    });
  });

  it("falls back to single location for an unknown persisted mode", () => {
    localStorage.setItem("qcmc.pcount.session.1.EMP-1", JSON.stringify({ ...session, locationMode: "other" }));
    expect(loadPcountSession("EMP-1")?.locationMode).toBe("single");
  });

  it("clears an active group that has no valid restored member", () => {
    localStorage.setItem("qcmc.pcount.session.1.EMP-1", JSON.stringify({
      ...session,
      locationMode: "multi",
      activeGroupId: "MISSING",
      locations: session.locations.map((location) => ({ ...location, groupId: "OTHER" })),
    }));
    expect(loadPcountSession("EMP-1")?.activeGroupId).toBe("");
  });

  it("preserves a completed location when another location becomes active", () => {
    savePcountSession("EMP-1", session);
    const restored = loadPcountSession("EMP-1");

    expect(restored?.locations[0].status).toBe("completed");
    expect(restored?.activeLocationId).toBe("R2");
  });

  it("clears the active session only when explicitly requested", () => {
    savePcountSession("EMP-1", session);
    clearPcountSession("EMP-1");

    expect(loadPcountSession("EMP-1")).toBeNull();
  });

  it("rejects a persisted active location that is not in the session", () => {
    savePcountSession("EMP-1", { ...session, activeLocationId: "UNKNOWN" });

    expect(loadPcountSession("EMP-1")?.activeLocationId).toBe("");
  });

  it("ignores malformed session data safely", () => {
    localStorage.setItem("qcmc.pcount.session.1.EMP-1", "{bad json");

    expect(loadPcountSession("EMP-1")).toBeNull();
  });

  it("restores an offline-started reconciliation before its warehouse is validated", () => {
    savePcountSession("EMP-1", {
      reconciliationCode: "MAT-RECO-OFFLINE",
      reconciliationWarehouse: "",
      locationMode: "single",
      activeGroupId: "",
      activeLocationId: "",
      locations: [],
      updatedAt: "2026-08-27T09:00:00Z",
      validationStatus: "pending",
    });

    expect(loadPcountSession("EMP-1")).toMatchObject({
      reconciliationCode: "MAT-RECO-OFFLINE",
      reconciliationWarehouse: "",
      validationStatus: "pending",
    });
  });
});

describe("existing Physical Count location detection", () => {
  it("requires an actual scan transaction in the same reconciliation and location", () => {
    const counted = entry({ scanTransactions: [{
      id: "scan-1", action: "ADD", quantityChange: 20, runningQuantity: 20,
      timestamp: "2026-09-25T08:00:00Z", locationId: "R1", locationLabel: "R1",
      employeeId: "EMP-1", employeeName: "User", deviceId: "S1",
    }] });
    expect(hasExistingLocationCount([counted], "MAT-RECO-1", "R1")).toBe(true);
    expect(hasExistingLocationCount([counted], "MAT-RECO-2", "R1")).toBe(false);
    expect(hasExistingLocationCount([entry()], "MAT-RECO-1", "R1")).toBe(false);
  });
});

describe("offline reconciliation context cache", () => {
  it("stores an ERP-validated reconciliation for later offline setup", () => {
    saveReconciliationContextOffline({
      reconciliationId: "MAT-RECO-1",
      warehouse: "Stockroom - Sta Clara",
      purpose: "Stock Reconciliation",
    });

    expect(loadReconciliationContextOffline("mat-reco-1")).toMatchObject({
      reconciliationId: "MAT-RECO-1",
      warehouse: "Stockroom - Sta Clara",
    });
  });

  it("removes a closed reconciliation from the offline context cache", () => {
    saveReconciliationContextOffline({
      reconciliationId: "MAT-RECO-CLOSED",
      warehouse: "Stockroom - Sta Clara",
    });

    removeReconciliationContextOffline("mat-reco-closed");

    expect(loadReconciliationContextOffline("MAT-RECO-CLOSED")).toBeNull();
  });
});

describe("retry-safe final Physical Count submission", () => {
  it("restores the same UUID and exact payload for an identical retry", () => {
    const pending = {
      fingerprint: "same-count",
      submissionId: "uuid-123",
      payload: { reconciliation_id: "MAT-RECO-1", operation: "adjustment", entries: [{ itemCode: "ITEM", quantity: 20 }] },
    };
    savePendingPcountSubmission("EMP-1", "MAT-RECO-1", pending);

    expect(loadPendingPcountSubmission("EMP-1", "MAT-RECO-1")).toEqual(pending);
  });

  it("keeps retry identities isolated by reconciliation", () => {
    savePendingPcountSubmission("EMP-1", "MAT-RECO-1", { fingerprint: "one", submissionId: "uuid-1", payload: {} });
    savePendingPcountSubmission("EMP-1", "MAT-RECO-2", { fingerprint: "two", submissionId: "uuid-2", payload: {} });

    expect(loadPendingPcountSubmission("EMP-1", "MAT-RECO-1")?.submissionId).toBe("uuid-1");
    expect(loadPendingPcountSubmission("EMP-1", "MAT-RECO-2")?.submissionId).toBe("uuid-2");
  });

  it("removes a retry identity only after explicit success cleanup", () => {
    savePendingPcountSubmission("EMP-1", "MAT-RECO-1", { fingerprint: "one", submissionId: "uuid-1", payload: {} });
    clearPendingPcountSubmission("EMP-1", "MAT-RECO-1");

    expect(loadPendingPcountSubmission("EMP-1", "MAT-RECO-1")).toBeNull();
  });
});

describe("Physical Count Last Activity cleanup", () => {
  it("removes resumable and retry state without deleting immutable scan history", () => {
    saveLocalScanEntries("EMP-1", [entry()]);
    savePcountSession("EMP-1", {
      reconciliationCode: "MAT-RECO-1",
      reconciliationWarehouse: "Stockroom - Sta Clara",
      locationMode: "single",
      activeGroupId: "",
      activeLocationId: "R1",
      locations: [{ bin: entry().bin, status: "in_progress", lastScanTime: "now" }],
      updatedAt: "now",
    });
    savePendingPcountSubmission("EMP-1", "MAT-RECO-1", {
      fingerprint: "same-count",
      submissionId: "immutable-submit-id",
      payload: { entries: [] },
    });
    const auditBefore = loadLocalScanEntries("EMP-1")[0].scanTransactions;

    removePcountFromLastActivity("EMP-1", "mat-reco-1");

    expect(isPcountReconciliationUnavailable("EMP-1", "MAT-RECO-1")).toBe(true);
    expect(loadPcountSession("EMP-1")).toBeNull();
    expect(loadPendingPcountSubmission("EMP-1", "MAT-RECO-1")).toBeNull();
    expect(loadLocalScanEntries("EMP-1")[0].scanTransactions).toEqual(auditBefore);
  });

  it("allows a later successful context validation to restore the activity", () => {
    removePcountFromLastActivity("EMP-1", "MAT-RECO-1");
    restorePcountToLastActivity("EMP-1", "MAT-RECO-1");

    expect(isPcountReconciliationUnavailable("EMP-1", "MAT-RECO-1")).toBe(false);
  });
});


describe("Physical Count Big + Loose edit breakdown persistence", () => {
  const tx = {
    id: "combined-pack-scan", action: "ADD" as const, quantityChange: 52025, runningQuantity: 52025,
    timestamp: "2026-10-20T00:00:00.000Z", locationId: "R1", locationLabel: "R1",
    employeeId: "EMP-1", employeeName: "User", deviceId: "S1",
    inventoryTag: "TAG-COMBINED", qrQuantity: 1000,
    packageStatus: "OPENED" as const,
    bigPackCount: 52, loosePackQuantity: 25,
    actualQuantity: 52025, remainingQuantity: 52025,
  };
  it("reopens and restores 52 Big Packs plus 25 loose pieces after device persistence", () => {
    saveLocalScanEntries("EMP-1", [entry({
      qrQuantity: 1000, quantity: 52025, scanTransactions: [tx],
    })]);
    const restored = loadLocalScanEntries("EMP-1")[0].scanTransactions?.[0];
    expect(restored).toMatchObject({
      packageStatus: "OPENED", qrQuantity: 1000,
      bigPackCount: 52, loosePackQuantity: 25, quantityChange: 52025,
    });
    saveLocalScanEntries("EMP-1", loadLocalScanEntries("EMP-1"));
    expect(loadLocalScanEntries("EMP-1")[0].scanTransactions?.[0]).toMatchObject({
      bigPackCount: 52, loosePackQuantity: 25,
    });
  });

  it("does not make up a pack split in historical OPENED scans", () => {
    const { bigPackCount, loosePackQuantity, ...legacy } = tx;
    saveLocalScanEntries("EMP-1", [entry({
      qrQuantity: 1000, quantity: 52025, scanTransactions: [legacy],
    })]);
    const restored = loadLocalScanEntries("EMP-1")[0].scanTransactions?.[0];
    expect(restored).not.toHaveProperty("bigPackCount");
    expect(restored).not.toHaveProperty("loosePackQuantity");
    expect(restored?.quantityChange).toBe(52025);
  });
});
