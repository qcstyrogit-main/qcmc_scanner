import { describe, expect, it } from "vitest";
import {
  addPcountGroupLocation,
  expandPcountEntryForLocations,
  getActivePcountGroupLocations,
  getMultiLocationQuantitySummary,
  removePcountGroupLocation,
  validatePcountLocationGroup,
} from "@/lib/pcountLocationGroup";
import type { LocalBinLocation, LocalPcountLocation, LocalScanEntry } from "@/lib/scanStorage";

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
});
