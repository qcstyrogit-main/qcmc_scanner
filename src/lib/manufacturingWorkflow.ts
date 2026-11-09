import type { ManufactureReceiveContext, ManufactureReceiveEntry, PutawayAllocation } from "@/lib/manufacturingService";
import { areCompatibleUoms } from "@/lib/uom";

export const getManufacturingStepState = (stage: string) => {
  if (["receive", "received"].includes(stage)) return { current: 1, title: "Pullout" };
  if (["batch", "checker-handover-scan", "checker", "checker-scan", "handover-qr"].includes(stage)) {
    return { current: 2, title: "Checker" };
  }
  if (["picker-scan", "picker-form"].includes(stage)) return { current: 3, title: "Picker" };
  if (stage === "allocation") return { current: 3, title: "Warehouse Allocation" };
  return { current: 0, title: "Receive Finished Goods" };
};

export type AllocationProgressValue = {
  quantity?: number;
  batchNo: string;
  serialNumbers: string[];
  transactions: Array<Record<string, unknown>>;
};

export type LocationMatch = {
  accepted: boolean;
  parent: boolean;
  allocationIds: string[];
  acceptedLocationIds: string[];
};

export const isParentDistribution = (context: ManufactureReceiveContext) =>
  context.distributionMode === "parent_location" && Boolean(context.distributionParent?.locationId);

export const requiredLocationId = (context: ManufactureReceiveContext, allocation: PutawayAllocation) =>
  allocation.inventoryLocation;

export const matchesRequiredLocation = (
  context: ManufactureReceiveContext,
  allocation: PutawayAllocation,
  scannedLocationId: string
) => scannedLocationId.trim() === requiredLocationId(context, allocation);

export const matchDistributionLocation = (
  context: ManufactureReceiveContext,
  progress: Record<string, AllocationProgressValue>,
  scannedLocationId: string
): LocationMatch => {
  const scanned = scannedLocationId.trim();
  const unconfirmed = context.putawayAllocations.filter((row) => !progress[row.allocationId]);
  const childIds = unconfirmed.map((row) => row.inventoryLocation);
  const child = unconfirmed.find((row) => row.inventoryLocation === scanned);
  return {
    accepted: Boolean(child),
    parent: false,
    allocationIds: child ? [child.allocationId] : [],
    acceptedLocationIds: childIds,
  };
};

export const confirmedAllocationGroup = (
  context: ManufactureReceiveContext,
  progress: Record<string, AllocationProgressValue>,
  locationConfirmations: Record<string, boolean>
) => {
  const active = context.putawayAllocations.find((row) => !progress[row.allocationId] && locationConfirmations[row.allocationId]);
  if (!active) return [];
  return context.putawayAllocations.filter((row) =>
    !progress[row.allocationId]
    && locationConfirmations[row.allocationId]
    && row.itemCode.trim().toLocaleUpperCase() === active.itemCode.trim().toLocaleUpperCase()
    && areCompatibleUoms(row.uom, active.uom)
  );
};

export type SubmissionIdentity = { fingerprint: string; id: string };

export const retainSubmissionIdentity = (
  current: SubmissionIdentity | null,
  fingerprint: string,
  createId: () => string
): SubmissionIdentity => current?.fingerprint === fingerprint ? current : { fingerprint, id: createId() };

export const activeAllocationGroup = (
  context: ManufactureReceiveContext,
  progress: Record<string, AllocationProgressValue>
) => {
  const active = context.putawayAllocations.find((row) => !progress[row.allocationId]);
  if (!active) return [];
  if (!isParentDistribution(context)) return [active];
  return context.putawayAllocations.filter((row) =>
    !progress[row.allocationId]
    && row.itemCode.trim().toLocaleUpperCase() === active.itemCode.trim().toLocaleUpperCase()
    && areCompatibleUoms(row.uom, active.uom)
  );
};

export const allocationTotal = (allocations: PutawayAllocation[]) =>
  allocations.reduce((sum, row) => sum + row.quantity, 0);

export const orderAllocationsByPriority = (allocations: PutawayAllocation[]) =>
  allocations
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftPriority = left.row.priority > 0 ? left.row.priority : Number.MAX_SAFE_INTEGER;
      const rightPriority = right.row.priority > 0 ? right.row.priority : Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      const locationOrder = left.row.inventoryLocation.localeCompare(right.row.inventoryLocation, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return locationOrder || left.index - right.index;
    })
    .map(({ row }) => row);

export const buildSubmittedContextSnapshot = (
  context: ManufactureReceiveContext,
  entries: ManufactureReceiveEntry[]
): ManufactureReceiveContext => {
  const allocationEntries = new Map(entries.filter((entry) => entry.allocation_id).map((entry) => [entry.allocation_id!, entry]));
  if (allocationEntries.size) {
    const putawayAllocations = context.putawayAllocations
      .filter((row) => allocationEntries.has(row.allocationId))
      .map((row) => {
        const entry = allocationEntries.get(row.allocationId)!;
        return {
          ...row,
          quantity: entry.quantity,
          stockQuantity: entry.quantity,
          targetWarehouse: entry.target_warehouse,
          inventoryLocation: entry.inventory_location_id,
          inventoryLocationName: entry.inventory_location_id,
        };
      });
    return {
      ...context,
      expectedManufactureQuantity: entries.reduce((sum, entry) => sum + entry.quantity, 0),
      allocationCount: putawayAllocations.length,
      putawayAllocations,
    };
  }
  const entryByRow = new Map(entries.map((entry) => [entry.stock_entry_row, entry]));
  const finishedItems = context.finishedItems
    .filter((row) => entryByRow.has(row.rowId))
    .map((row) => {
      const entry = entryByRow.get(row.rowId)!;
      return {
        ...row,
        expectedQuantity: entry.quantity,
        targetWarehouse: entry.target_warehouse,
        inventoryLocation: entry.inventory_location_id,
        inventoryLocationCode: entry.inventory_location_id,
      };
    });
  return {
    ...context,
    expectedManufactureQuantity: entries.reduce((sum, entry) => sum + entry.quantity, 0),
    finishedItems,
  };
};

export const buildAllocationSubmission = (
  context: ManufactureReceiveContext,
  progress: Record<string, AllocationProgressValue>,
  deviceId: string
): { distributionParentId?: string; entries: ManufactureReceiveEntry[] } => ({
  ...(isParentDistribution(context)
    ? { distributionParentId: context.distributionParent!.locationId }
    : {}),
  entries: context.putawayAllocations.filter((row) => Boolean(progress[row.allocationId])).map((row) => ({
    allocation_id: row.allocationId,
    stock_entry_row: row.rowId,
    item_code: row.itemCode,
    quantity: progress[row.allocationId].quantity ?? row.quantity,
    uom: row.uom,
    target_warehouse: row.targetWarehouse,
    inventory_location_id: row.inventoryLocation,
    ...(row.parentLocationId ? { parent_location_id: row.parentLocationId } : {}),
    batch_no: progress[row.allocationId].batchNo,
    serial_numbers: progress[row.allocationId].serialNumbers,
    device_id: deviceId,
    transactions: progress[row.allocationId].transactions,
  })),
});
