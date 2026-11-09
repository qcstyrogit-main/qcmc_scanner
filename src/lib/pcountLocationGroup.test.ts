import { describe, expect, it } from "vitest";
import {
  addPcountGroupLocation,
  addPcountLocationToSession,
  expandPcountEntryForLocations,
  getActivePcountGroupLocations,
  getMultiLocationQuantitySummary,
  getPcountSessionRestoreState,
  inferPcountLocationMode,
  getEffectivePcountLocationMode,
  completePcountLocationMode,
  completeCountedInactiveRecountLocations,
  lockPcountLocationMode,
  requirePcountLocationConversionFactor,
  removePcountGroupLocation,
  removePcountLocationFromSession,
  releaseEmptyPcountLocationsAfterScanRemoval,
  restoreEmptyCompletedPcountLocations,
  validatePcountLocationGroup,
} from "@/lib/pcountLocationGroup";
import type { LocalBinLocation, LocalPcountLocation, LocalPcountSession, LocalScanEntry } from "@/lib/scanStorage";

const bin = (locationId: string): LocalBinLocation => ({
  raw: locationId,
  warehouse: "FG - MC2",
  stockroom: "",
  building: "",
  aisle: "",
  rack: "",
  bin: locationId,
  locationId,
  locationCode: locationId,
});

describe("Physical Count location groups", () => {
  it("completes a previously counted inactive location when switching to recount, retaining the active target", () => {
    const original: LocalPcountSession = {
      reconciliationCode: "MAT-RECO-2026-00038",
      reconciliationWarehouse: "FG - MC2",
      locationMode: "single",
      activeLocationMode: "single",
      activeGroupId: "recount-123",
      activeLocationId: "B3GFAR4L1C10",
      updatedAt: "old",
      locations: [
        { bin: bin("B3GFAR4L1C9"), status: "in_progress", lastScanTime: "old" },
        { bin: bin("B3GFAR4L1C10"), status: "in_progress", lastScanTime: "old" },
        { bin: bin("EMPTY"), status: "in_progress", lastScanTime: "old" },
      ],
    };
    const counted = [{
      mode: "pcount",
      reconciliationCode: original.reconciliationCode,
      bin: bin("B3GFAR4L1C9"),
      scanTransactions: [{ action: "ADD", quantityChange: 20 }],
    }] as unknown as LocalScanEntry[];
    const fixed = completeCountedInactiveRecountLocations(
      original, counted, "B3GFAR4L1C10", "2026-11-05T16:50:00Z"
    );
    expect(fixed.locations.map((location) => location.status)).toEqual([
      "completed", "in_progress", "in_progress",
    ]);
    expect(fixed.locations[0].completedAt).toBe("2026-11-05T16:50:00Z");
    expect(original.locations[0].status).toBe("in_progress");
    expect(completeCountedInactiveRecountLocations(fixed, counted, "B3GFAR4L1C10", "later")).toBe(fixed);
  });

  it("does not complete another reconciliation's count or a zero-transaction placeholder", () => {
    const original: LocalPcountSession = {
      reconciliationCode: "MAT-RECO-A", reconciliationWarehouse: "FG - MC2",
      locationMode: "single", activeGroupId: "recount-123", activeLocationId: "L2",
      updatedAt: "old",
      locations: [{ bin: bin("L1"), status: "in_progress", lastScanTime: "old" }, { bin: bin("L2"), status: "in_progress", lastScanTime: "old" }],
    };
    const otherReconciliation = [{
      mode: "pcount", reconciliationCode: "MAT-RECO-B", bin: bin("L1"),
      scanTransactions: [{ action: "ADD" }],
    }] as unknown as LocalScanEntry[];
    expect(completeCountedInactiveRecountLocations(original, otherReconciliation, "L2", "now")).toBe(original);
    const empty = [{ ...otherReconciliation[0], reconciliationCode: "MAT-RECO-A", scanTransactions: [] }];
    expect(completeCountedInactiveRecountLocations(original, empty, "L2", "now")).toBe(original);
  });

  it("adds the first location without mutating the source list", () => {
    const source: LocalPcountLocation[] = [];
    const result = addPcountGroupLocation(source, bin("A"), "GROUP-1", "2026-09-29T01:00:00Z");

    expect(result.added).toBe(true);
    expect(result.locations).toEqual([{
      bin: bin("A"),
      status: "in_progress",
      groupId: "GROUP-1",
      lastScanTime: "2026-09-29T01:00:00Z",
    }]);
    expect(source).toEqual([]);
  });

  it("does not add the same normalized location twice", () => {
    const first = addPcountGroupLocation([], bin(" Location-A "), "GROUP-1", "first");
    const repeated = addPcountGroupLocation(first.locations, bin("location-a"), "GROUP-1", "second");

    expect(repeated.added).toBe(false);
    expect(repeated.locations).toEqual(first.locations);
  });

  it("blocks a completed location from being added again in a new group", () => {
    const previous: LocalPcountLocation[] = [
      { bin: bin("R1"), status: "completed", groupId: "GROUP-1", lastScanTime: "first", completedAt: "done" },
    ];

    const result = addPcountGroupLocation(previous, bin("R1"), "GROUP-2", "second");

    expect(result.added).toBe(false);
    expect(result.reason).toBe("already_counted");
    expect(result.locations).toEqual(previous);
  });

  it("distinguishes a duplicate in the current Multi group from a previously counted location", () => {
    const first = addPcountGroupLocation([], bin("R1"), "GROUP-1", "first");
    const repeated = addPcountGroupLocation(first.locations, bin("R1"), "GROUP-1", "second");

    expect(repeated.added).toBe(false);
    expect(repeated.reason).toBe("already_selected");
  });

  it("removes only an in-progress member of the requested group", () => {
    const locations: LocalPcountLocation[] = [
      { bin: bin("A"), status: "in_progress", groupId: "GROUP-1", lastScanTime: "now" },
      { bin: bin("B"), status: "in_progress", groupId: "GROUP-2", lastScanTime: "now" },
      { bin: bin("C"), status: "completed", groupId: "GROUP-1", lastScanTime: "now" },
    ];

    expect(removePcountGroupLocation(locations, "A", "GROUP-1").map((row) => row.bin.locationId)).toEqual(["B", "C"]);
    expect(removePcountGroupLocation(locations, "B", "GROUP-1")).toEqual(locations);
    expect(removePcountGroupLocation(locations, "C", "GROUP-1")).toEqual(locations);
  });

  it("selects only in-progress locations from the active group", () => {
    const locations: LocalPcountLocation[] = [
      { bin: bin("A"), status: "in_progress", groupId: "GROUP-1", lastScanTime: "now" },
      { bin: bin("B"), status: "completed", groupId: "GROUP-1", lastScanTime: "now" },
      { bin: bin("C"), status: "in_progress", groupId: "GROUP-2", lastScanTime: "now" },
    ];

    expect(getActivePcountGroupLocations(locations, "GROUP-1").map((row) => row.bin.locationId)).toEqual(["A"]);
  });

  it("copies the full entry quantity and location audit to every selected location", () => {
    const source: LocalScanEntry = {
      raw: "ITEM;1000;PCS",
      mode: "pcount",
      reconciliationCode: "MAT-RECO-1",
      bin: bin("SOURCE"),
      itemCode: "ITEM",
      qrQuantity: 1000,
      multiplier: 1,
      quantity: 1000,
      uom: "PCS",
      barcodeUom: "PCS",
      lotNo: "",
      timestamp: "now",
      deviceId: "S1",
      scanTransactions: [{
        id: "source-id",
        action: "ADD",
        quantityChange: 1000,
        runningQuantity: 1000,
        timestamp: "now",
        locationId: "SOURCE",
        locationLabel: "SOURCE",
        employeeId: "EMP-1",
        employeeName: "Warehouse Man",
        deviceId: "S1",
      }],
    };
    const locations = ["A", "B", "C"].map((id): LocalPcountLocation => ({
      bin: bin(id), status: "in_progress", groupId: "GROUP-1", lastScanTime: "now",
    }));

    const expanded = expandPcountEntryForLocations(source, locations, (id) => `tx-${id}`);

    expect(expanded.map((entry) => ({
      locationId: entry.bin.locationId,
      quantity: entry.quantity,
      transactionId: entry.scanTransactions?.[0].id,
      transactionLocation: entry.scanTransactions?.[0].locationId,
    }))).toEqual([
      { locationId: "A", quantity: 1000, transactionId: "tx-A", transactionLocation: "A" },
      { locationId: "B", quantity: 1000, transactionId: "tx-B", transactionLocation: "B" },
      { locationId: "C", quantity: 1000, transactionId: "tx-C", transactionLocation: "C" },
    ]);
    expect(getMultiLocationQuantitySummary(1000, 3)).toEqual({ quantityPerLocation: 1000, locationCount: 3, totalQuantity: 3000 });
    expect(source.bin.locationId).toBe("SOURCE");
    expect(source.scanTransactions?.[0].id).toBe("source-id");
  });

  it("preserves decimal quantity and empty barcode UOM for each location", () => {
    const source: LocalScanEntry = {
      raw: "ITEM;1000.25;",
      mode: "pcount",
      reconciliationCode: "MAT-RECO-1",
      bin: bin("SOURCE"),
      itemCode: "ITEM",
      qrQuantity: 1000.25,
      multiplier: 1,
      quantity: 1000.25,
      uom: "PCS",
      barcodeUom: "",
      lotNo: "",
      timestamp: "now",
      deviceId: "S1",
      scanTransactions: [],
    };
    const locations = ["A", "B"].map((id): LocalPcountLocation => ({
      bin: bin(id), status: "in_progress", groupId: "GROUP-1", lastScanTime: "now",
    }));

    const expanded = expandPcountEntryForLocations(source, locations, (id) => id);
    expect(expanded.map(({ quantity, barcodeUom }) => ({ quantity, barcodeUom }))).toEqual([
      { quantity: 1000.25, barcodeUom: "" },
      { quantity: 1000.25, barcodeUom: "" },
    ]);
    expect(getMultiLocationQuantitySummary(1000.25, 2).totalQuantity).toBe(2000.5);
    expect(expandPcountEntryForLocations(source, [], (id) => id)).toEqual([]);
  });

  it("validates every location in input order before the caller persists anything", async () => {
    const locations = ["A", "B", "C"].map((id): LocalPcountLocation => ({
      bin: bin(id), status: "in_progress", groupId: "GROUP-1", lastScanTime: "now",
    }));
    const visited: string[] = [];
    let persisted = false;

    await expect(validatePcountLocationGroup(locations, async (location) => {
      const id = location.bin.locationId || "";
      visited.push(id);
      if (id === "C") throw new Error("C cannot accept this item");
      return id;
    }).then(() => { persisted = true; })).rejects.toThrow("C cannot accept this item");

    expect(visited).toEqual(["A", "B", "C"]);
    expect(persisted).toBe(false);
  });

  it("restores an active multi-location group directly to Scan Items", () => {
    const selected = [{ bin: bin("A"), status: "in_progress" as const, groupId: "GROUP-1", lastScanTime: "now" }];
    expect(getPcountSessionRestoreState({ locationMode: "multi", activeGroupId: "GROUP-1", activeLocationId: "", locations: selected })).toEqual({
      step: "bin",
      isScanSessionActive: false,
      currentBin: null,
    });
    expect(getPcountSessionRestoreState({ locationMode: "multi", activeGroupId: "GROUP-1", activeLocationId: "A", locations: selected })).toMatchObject({
      step: "item",
      isScanSessionActive: true,
      currentBin: bin("A"),
    });
  });

  it("infers Single for one selected location and Multi for two or more", () => {
    expect(inferPcountLocationMode(1)).toBe("single");
    expect(inferPcountLocationMode(2)).toBe("multi");
    expect(inferPcountLocationMode(5)).toBe("multi");
  });

  it("rejects a missing ERP Stock UOM before scanning", () => {
    expect(() => requirePcountLocationConversionFactor(null, "ITEM", "", "KG")).toThrow(/ERPNext Item Stock UOM is required/i);
    expect(requirePcountLocationConversionFactor(2, "ITEM", "PCS", "BOX")).toBe(2);
  });

  it("persists the inferred warehouse when adding the first offline group location", () => {
    const result = addPcountLocationToSession({
      reconciliationCode: "MAT-RECO-1", reconciliationWarehouse: "", locationMode: "multi",
      activeGroupId: "GROUP-1", activeLocationId: "", locations: [], updatedAt: "before", validationStatus: "pending",
    }, bin("A"), "FG - MC2", "now");

    expect(result.session.reconciliationWarehouse).toBe("FG - MC2");
    expect(result.added).toBe(true);
  });

  it("surfaces already_counted when a completed location is scanned again", () => {
    const session = {
      reconciliationCode: "MAT-RECO-1", reconciliationWarehouse: "FG - MC2", locationMode: "multi" as const,
      activeLocationMode: "multi" as const, activeGroupId: "GROUP-2", activeLocationId: "",
      locations: [{ bin: bin("A"), status: "completed" as const, groupId: "GROUP-1", lastScanTime: "before", completedAt: "before" }],
      updatedAt: "before", validationStatus: "validated" as const,
    };

    const result = addPcountLocationToSession(session, bin("A"), "FG - MC2", "now");
    expect(result.added).toBe(false);
    expect(result.reason).toBe("already_counted");
    expect(result.session.locations).toEqual(session.locations);
  });

  it("switches mode after completion without changing the reconciliation or completed locations", () => {
    const session = {
      reconciliationCode: "MAT-RECO-1", reconciliationWarehouse: "FG - MC2", locationMode: "multi" as const,
      activeLocationMode: "multi" as const, activeGroupId: "GROUP-1", activeLocationId: "A",
      locations: [{ bin: bin("A"), status: "in_progress" as const, groupId: "GROUP-1", lastScanTime: "now" }],
      updatedAt: "now", validationStatus: "validated" as const,
    };

    expect(getEffectivePcountLocationMode(session, "single")).toBe("multi");
    const completed = completePcountLocationMode(session);
    expect(completed.reconciliationCode).toBe("MAT-RECO-1");
    expect(completed.locations).toEqual(session.locations);
    expect(completed.activeLocationMode).toBeUndefined();
    expect(getEffectivePcountLocationMode(completed, "single")).toBe("single");
    expect(lockPcountLocationMode(completed, "single").activeLocationMode).toBe("single");
  });

  it("removes an explicitly selected completed local location without touching another active location", () => {
    const session: LocalPcountSession = {
      reconciliationCode: "MAT-RECO-1",
      reconciliationWarehouse: "FG - MC2",
      locationMode: "single",
      activeLocationMode: "single",
      activeGroupId: "GROUP-2",
      activeLocationId: "B",
      locations: [
        { bin: bin("A"), status: "completed", groupId: "GROUP-1", lastScanTime: "prior" },
        { bin: bin("B"), status: "in_progress", groupId: "GROUP-2", lastScanTime: "now" },
      ],
      updatedAt: "now",
      validationStatus: "validated",
    };
    const result = removePcountLocationFromSession(session, "A");
    expect(result.locations.map((location) => location.bin.locationId)).toEqual(["B"]);
    expect(result.activeLocationId).toBe("B");
    expect(result.activeGroupId).toBe("GROUP-2");
    expect(session.locations).toHaveLength(2);
  });

  it("unlocks Multi mode when the final selected location is removed", () => {
    const session = {
      reconciliationCode: "MAT-RECO-1", reconciliationWarehouse: "FG - MC2", locationMode: "multi" as const,
      activeLocationMode: "multi" as const, activeGroupId: "GROUP-1", activeLocationId: "",
      locations: [{ bin: bin("A"), status: "in_progress" as const, groupId: "GROUP-1", lastScanTime: "now" }],
      updatedAt: "now", validationStatus: "validated" as const,
    };

    const removed = removePcountLocationFromSession(session, "A");
    expect(removed.locations).toEqual([]);
    expect(removed.activeLocationMode).toBeUndefined();
    expect(removed.activeGroupId).toBe("");
    expect(getEffectivePcountLocationMode(removed, "single")).toBe("single");
  });

  describe("Delete scans and re-scan released locations", () => {
    const finished = (locationId: string): LocalPcountLocation => ({
      bin: bin(locationId), groupId: "G-1", status: "completed",
      lastScanTime: "prior", completedAt: "prior",
    });
    const session = (locations: LocalPcountLocation[]): LocalPcountSession => ({
      reconciliationCode: "MAT-RECO-1",
      reconciliationWarehouse: "FG - MC2",
      locationMode: "multi",
      activeGroupId: "",
      activeLocationId: "",
      locations,
      updatedAt: "prior",
      validationStatus: "validated",
    });
    const row = (locationId: string, itemCode: string, reference = "MAT-RECO-1"): LocalScanEntry => ({
      raw: itemCode, mode: "pcount", reconciliationCode: reference,
      bin: bin(locationId), itemCode, qrQuantity: 10,
      multiplier: 1, quantity: 10, uom: "PCS",
      lotNo: "", timestamp: "prior", deviceId: "D1",
      scanTransactions: [],
    });

    it("releases a completed location when its last pending scan is deleted, allowing it to be added again", () => {
      const original = session([finished("R1")]);
      const released = releaseEmptyPcountLocationsAfterScanRemoval(
        original, [row("R1", "ITEM-A")], [], "after",
      );
      expect(released.releasedLocationIds).toEqual(["r1"]);
      expect(released.session.locations).toEqual([]);
      expect(original.locations).toHaveLength(1);
      expect(released.session.reconciliationCode).toBe(original.reconciliationCode);
      const scannedAgain = addPcountLocationToSession(
        { ...released.session, activeGroupId: "G-2" }, bin("R1"), "FG - MC2", "new-scan",
      );
      expect(scannedAgain.added).toBe(true);
      expect(scannedAgain.session.locations).toHaveLength(1);
    });

    it("keeps a completed location blocked when another item remains there", () => {
      const original = session([finished("R1")]);
      const kept = releaseEmptyPcountLocationsAfterScanRemoval(
        original, [row("R1", "ITEM-A")], [row("R1", "ITEM-B")], "after",
      );
      expect(kept.releasedLocationIds).toEqual([]);
      expect(kept.session).toBe(original);
      const stillCounted = addPcountLocationToSession(
        { ...kept.session, activeGroupId: "G-2" }, bin("R1"), "FG - MC2", "new-scan",
      );
      expect(stillCounted.added).toBe(false);
      expect(stillCounted.reason).toBe("already_counted");
    });

    it("retains completed locations with ERP-submitted audit history", () => {
      const submitted = {
        ...row("R1", "SUBMITTED"),
        submittedPhysicalCount: 10,
        submittedTransactionIds: ["tx-server-1"],
      };
      const result = releaseEmptyPcountLocationsAfterScanRemoval(
        session([finished("R1")]), [row("R1", "PENDING")], [submitted], "after",
      );
      expect(result.releasedLocationIds).toEqual([]);
      expect(result.session.locations.map((loc) => loc.bin.locationId)).toEqual(["R1"]);
    });

    it("releases only locations made empty, preserving other completed locations and the active group", () => {
      const current = session([
        finished("R1"),
        finished("R2"),
        { bin: bin("R3"), status: "in_progress", groupId: "G-ACTIVE", lastScanTime: "prior" },
        finished("R4"),
      ]);
      current.activeGroupId = "G-ACTIVE";
      current.activeLocationId = "R3";
      current.activeLocationMode = "multi";
      const result = releaseEmptyPcountLocationsAfterScanRemoval(
        current,
        [row(" R1 ", "A"), row("R2", "B")],
        [row("r2", "C")],
        "after",
      );
      expect(result.releasedLocationIds).toEqual(["r1"]);
      expect(result.session.locations.map((loc) => loc.bin.locationId)).toEqual(["R2", "R3", "R4"]);
      expect(result.session.activeGroupId).toBe("G-ACTIVE");
      expect(result.session.activeLocationId).toBe("R3");
      expect(result.session.activeLocationMode).toBe("multi");
    });

    it("does not free in-progress locations just because their pending scan was deleted", () => {
      const current = session([{ bin: bin("R1"), status: "in_progress", groupId: "G-ACTIVE", lastScanTime: "prior" }]);
      current.activeGroupId = "G-ACTIVE";
      current.activeLocationId = "R1";
      const result = releaseEmptyPcountLocationsAfterScanRemoval(current, [row("R1", "A")], [], "after");
      expect(result.session).toBe(current);
      expect(result.releasedLocationIds).toEqual([]);
    });

    it("repairs an old completed location after Remove Selected already deleted every local row", () => {
      const stored = session([finished("R1"), finished("R2")]);
      const repaired = restoreEmptyCompletedPcountLocations(stored, [row("R2", "STILL-COUNTED")], "startup");
      expect(repaired.releasedLocationIds).toEqual(["r1"]);
      expect(repaired.session.locations.map((location) => location.bin.locationId)).toEqual(["R2"]);
      expect(addPcountLocationToSession(
        { ...repaired.session, activeGroupId: "G-NEW" }, bin("R1"), "FG - MC2", "new-scan",
      ).added).toBe(true);
    });

    it("preserves submitted and in-progress location records during session repair", () => {
      const active = { bin: bin("R3"), status: "in_progress" as const, groupId: "G-ACTIVE", lastScanTime: "prior" };
      const saved = session([finished("R1"), finished("R2"), active]);
      saved.activeGroupId = "G-ACTIVE";
      saved.activeLocationId = "R3";
      const repaired = restoreEmptyCompletedPcountLocations(
        saved,
        [{ ...row("R1", "ERP-HISTORY"), submittedTransactionIds: ["tx-confirmed"], submittedPhysicalCount: 10 }],
        "startup",
      );
      expect(repaired.releasedLocationIds).toEqual(["r2"]);
      expect(repaired.session.locations.map((location) => location.bin.locationId)).toEqual(["R1", "R3"]);
      expect(repaired.session.activeLocationId).toBe("R3");
      expect(repaired.session.activeGroupId).toBe("G-ACTIVE");
    });

    it("ignores unrelated reconciliations and unrelated deletion locations", () => {
      const current = session([finished("R1"), finished("R2")]);
      const result = releaseEmptyPcountLocationsAfterScanRemoval(
        current,
        [row("R1", "A", "MAT-RECO-OTHER"), row("R3", "B")],
        [],
        "after",
      );
      expect(result.session).toBe(current);
      expect(result.releasedLocationIds).toEqual([]);
    });
  });

});