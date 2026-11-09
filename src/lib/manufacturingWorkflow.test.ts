import { describe, expect, it, vi } from "vitest";
import type { ManufactureReceiveContext, PutawayAllocation } from "@/lib/manufacturingService";
import {
  activeAllocationGroup,
  allocationTotal,
  buildAllocationSubmission,
  buildSubmittedContextSnapshot,
  confirmedAllocationGroup,
  getManufacturingStepState,
  matchDistributionLocation,
  matchesRequiredLocation,
  orderAllocationsByPriority,
  retainSubmissionIdentity,
} from "@/lib/manufacturingWorkflow";

const allocation = (rack: number): PutawayAllocation => ({
  allocationId: `allocation-${rack}`,
  rowId: "backend-row-id",
  itemCode: "EIEHB1BL50",
  itemName: "Finished item",
  quantity: 10000,
  stockQuantity: 10000,
  uom: "PC",
  targetWarehouse: "Stockroom - Sta Clara",
  inventoryLocation: `STA-RM-CLARA-AISLE-R${rack}`,
  inventoryLocationName: `Rack ${rack}`,
  parentLocationId: "STA-RM-CLARA-AISLE",
  putawayRule: `rule-${rack}`,
  priority: rack,
  requiresBatch: false,
  requiresSerial: false,
});

const context = (mode: "parent_location" | "exact_location"): ManufactureReceiveContext => ({
  stockEntryId: "QCQC-SC-WIP-2",
  stockEntryType: "Manufacture",
  purpose: "Manufacture",
  workOrderId: "MFG-WO-1",
  jobCardId: "",
  customReferenceDocument: "",
  finishedItemCode: "ITEM-1",
  finishedItemName: "Item 1",
  expectedManufactureQuantity: 0,
  actualWeightPerItem: 0,
  docstatus: 0,
  existingDraft: false,
  status: "Draft",
  finishedItems: [],
  allocationCount: 3,
  putawayAllocations: [allocation(1), allocation(2), allocation(3)],
  distributionMode: mode,
  distributionParent: mode === "parent_location" ? {
    locationId: "STA-RM-CLARA-AISLE",
    locationName: "AISLE STA CLARA",
    warehouse: "Stockroom - Sta Clara",
  } : null,
});

const progress = Object.fromEntries([1, 2, 3].map((rack) => [`allocation-${rack}`, {
  batchNo: "",
  serialNumbers: [],
  transactions: [],
}]));

describe("manufacture receiving distribution", () => {
  it("maps scanner stages to the operator workflow step", () => {
    expect(getManufacturingStepState("receive")).toEqual({ current: 1, title: "Pullout" });
    expect(getManufacturingStepState("checker")).toEqual({ current: 2, title: "Checker" });
    expect(getManufacturingStepState("allocation")).toEqual({ current: 3, title: "Warehouse Allocation" });
  });

  it("requires the exact allocated child even when ERP returns a distribution parent", () => {
    const value = context("parent_location");
    expect(matchesRequiredLocation(value, value.putawayAllocations[0], "STA-RM-CLARA-AISLE")).toBe(false);
    expect(matchesRequiredLocation(value, value.putawayAllocations[0], "STA-RM-CLARA-AISLE-R1")).toBe(true);
    expect(matchesRequiredLocation(value, value.putawayAllocations[0], "STA-RM-CLARA-OTHER")).toBe(false);
  });

  it("groups all same-item rack allocations after one parent scan", () => {
    expect(activeAllocationGroup(context("parent_location"), {})).toHaveLength(3);
    expect(allocationTotal(activeAllocationGroup(context("parent_location"), {}))).toBe(30000);
  });

  it("groups ERP allocations that use compatible piece aliases", () => {
    const value = context("parent_location");
    value.putawayAllocations[1] = { ...value.putawayAllocations[1], uom: "PCS" };
    value.putawayAllocations[2] = { ...value.putawayAllocations[2], uom: "PIECES" };
    expect(activeAllocationGroup(value, {})).toHaveLength(3);
  });

  it("requires one exact child rack at a time in exact mode", () => {
    const value = context("exact_location");
    expect(activeAllocationGroup(value, {})).toEqual([value.putawayAllocations[0]]);
    expect(matchesRequiredLocation(value, value.putawayAllocations[0], "STA-RM-CLARA-AISLE")).toBe(false);
    expect(matchesRequiredLocation(value, value.putawayAllocations[0], "STA-RM-CLARA-AISLE-R1")).toBe(true);
  });

  it("submits every backend child allocation unchanged with the parent ID", () => {
    const value = context("parent_location");
    const submission = buildAllocationSubmission(value, progress, "Scanner 1");
    expect(submission.distributionParentId).toBe("STA-RM-CLARA-AISLE");
    expect(submission.entries).toHaveLength(3);
    expect(submission.entries.map((row) => ({
      allocation_id: row.allocation_id,
      quantity: row.quantity,
      target_warehouse: row.target_warehouse,
      inventory_location_id: row.inventory_location_id,
    }))).toEqual(value.putawayAllocations.map((row) => ({
      allocation_id: row.allocationId,
      quantity: row.quantity,
      target_warehouse: row.targetWarehouse,
      inventory_location_id: row.inventoryLocation,
    })));
  });

  it("reuses one UUID for an identical retry and replaces it for changed data", () => {
    const createId = vi.fn().mockReturnValueOnce("uuid-1").mockReturnValueOnce("uuid-2");
    const first = retainSubmissionIdentity(null, "same-request", createId);
    const retry = retainSubmissionIdentity(first, "same-request", createId);
    const changed = retainSubmissionIdentity(retry, "changed-request", createId);
    expect(first.id).toBe("uuid-1");
    expect(retry.id).toBe("uuid-1");
    expect(changed.id).toBe("uuid-2");
    expect(createId).toHaveBeenCalledTimes(2);
  });

  it("does not depend on aisle, rack, or bin naming conventions", () => {
    const value = context("parent_location");
    value.distributionParent = {
      locationId: "CUSTOM-PARENT-X9",
      locationName: "Cold Storage Group",
      warehouse: "Finished Goods Warehouse",
    };
    value.putawayAllocations = value.putawayAllocations.map((row, index) => ({
      ...row,
      inventoryLocation: `CUSTOM-CHILD-${String.fromCharCode(65 + index)}`,
      inventoryLocationName: `Operator Location ${index + 1}`,
      parentLocationId: "CUSTOM-PARENT-X9",
    }));
    expect(matchesRequiredLocation(value, value.putawayAllocations[0], "CUSTOM-PARENT-X9")).toBe(false);
    expect(matchesRequiredLocation(value, value.putawayAllocations[0], "CUSTOM-CHILD-A")).toBe(true);
    const submission = buildAllocationSubmission(value, progress, "Scanner Custom");
    expect(submission.distributionParentId).toBe("CUSTOM-PARENT-X9");
    expect(submission.entries.map((row) => row.inventory_location_id)).toEqual([
      "CUSTOM-CHILD-A",
      "CUSTOM-CHILD-B",
      "CUSTOM-CHILD-C",
    ]);
  });

  it("does not require or accept the parent QR to confirm child allocations", () => {
    const value = context("parent_location");
    const match = matchDistributionLocation(value, {}, "STA-RM-CLARA-AISLE");
    expect(match.accepted).toBe(false);
    expect(match.allocationIds).toEqual([]);
    expect(match.acceptedLocationIds).toEqual([
      "STA-RM-CLARA-AISLE-R1",
      "STA-RM-CLARA-AISLE-R2",
      "STA-RM-CLARA-AISLE-R3",
    ]);
    expect(buildAllocationSubmission(value, progress, "Scanner 1").entries).toHaveLength(3);
  });

  it("exact child is accepted without parent and confirms no sibling", () => {
    const value = context("parent_location");
    const match = matchDistributionLocation(value, {}, "STA-RM-CLARA-AISLE-R2");
    expect(match).toMatchObject({ accepted: true, parent: false, allocationIds: ["allocation-2"] });
    const confirmed = confirmedAllocationGroup(value, {}, { "allocation-2": true });
    expect(confirmed.map((row) => row.allocationId)).toEqual(["allocation-2"]);
  });

  it("rejects unrelated locations and lists accepted choices", () => {
    const match = matchDistributionLocation(context("parent_location"), {}, "OTHER-PLACE");
    expect(match.accepted).toBe(false);
    expect(match.acceptedLocationIds).not.toContain("STA-RM-CLARA-AISLE");
    expect(match.acceptedLocationIds).toContain("STA-RM-CLARA-AISLE-R1");
  });

  it("rejects parent but accepts exact child in exact mode", () => {
    const value = context("exact_location");
    expect(matchDistributionLocation(value, {}, "STA-RM-CLARA-AISLE").accepted).toBe(false);
    expect(matchDistributionLocation(value, {}, "STA-RM-CLARA-AISLE-R1")).toMatchObject({ accepted: true, allocationIds: ["allocation-1"] });
  });

  it("orders allocation display by priority with natural location fallback", () => {
    const rows = [allocation(8), allocation(1), allocation(2)].map((row) => ({ ...row, priority: 0 }));
    rows[0].priority = 8;
    rows[1].priority = 1;
    rows[2].priority = 2;
    expect(orderAllocationsByPriority(rows).map((row) => row.inventoryLocation)).toEqual([
      "STA-RM-CLARA-AISLE-R1",
      "STA-RM-CLARA-AISLE-R2",
      "STA-RM-CLARA-AISLE-R8",
    ]);
    expect(orderAllocationsByPriority(rows.map((row) => ({ ...row, priority: 0 }))).map((row) => row.inventoryLocation)).toEqual([
      "STA-RM-CLARA-AISLE-R1",
      "STA-RM-CLARA-AISLE-R2",
      "STA-RM-CLARA-AISLE-R8",
    ]);
  });

  it("stores only the exact ERP allocation location and confirmed quantity", () => {
    const value = context("parent_location");
    const submission = buildAllocationSubmission(value, {
      "allocation-1": { quantity: 10000, batchNo: "", serialNumbers: [], transactions: [] },
    }, "Scanner 1");
    const snapshot = buildSubmittedContextSnapshot(value, submission.entries);
    expect(snapshot.putawayAllocations).toHaveLength(1);
    expect(snapshot.putawayAllocations[0]).toMatchObject({
      allocationId: "allocation-1",
      quantity: 10000,
      inventoryLocation: "STA-RM-CLARA-AISLE-R1",
      targetWarehouse: "Stockroom - Sta Clara",
    });
    expect(snapshot.expectedManufactureQuantity).toBe(10000);
  });
});
