import type { LocalBinLocation, LocalPcountLocation, LocalPcountSession, LocalScanEntry } from "@/lib/scanStorage";

const normalizeLocationId = (value: string | undefined) =>
  (value || "").trim().toLocaleLowerCase();

export const addPcountGroupLocation = (
  locations: LocalPcountLocation[],
  bin: LocalBinLocation,
  groupId: string,
  scannedAt: string,
) => {
  const locationId = normalizeLocationId(bin.locationId);
  if (!locationId || locations.some((location) => normalizeLocationId(location.bin.locationId) === locationId)) {
    return { locations, added: false };
  }
  return {
    locations: [...locations, { bin, status: "in_progress" as const, groupId, lastScanTime: scannedAt }],
    added: true,
  };
};

export const removePcountGroupLocation = (
  locations: LocalPcountLocation[],
  locationId: string,
  groupId: string,
) => {
  const normalizedId = normalizeLocationId(locationId);
  const canRemove = locations.some((location) =>
    normalizeLocationId(location.bin.locationId) === normalizedId &&
    location.groupId === groupId &&
    location.status === "in_progress"
  );
  return canRemove
    ? locations.filter((location) => !(
        normalizeLocationId(location.bin.locationId) === normalizedId &&
        location.groupId === groupId &&
        location.status === "in_progress"
      ))
    : locations;
};

export const getActivePcountGroupLocations = (
  locations: LocalPcountLocation[],
  groupId: string,
) => locations.filter((location) =>
  Boolean(groupId) && location.groupId === groupId && location.status === "in_progress"
);

export const expandPcountEntryForLocations = (
  entry: LocalScanEntry,
  locations: LocalPcountLocation[],
  transactionId: (locationId: string) => string,
): LocalScanEntry[] => locations.map((location) => {
  const locationId = location.bin.locationId || "";
  const locationLabel = location.bin.locationCode || location.bin.locationName || location.bin.locationPath || location.bin.bin;
  return {
    ...entry,
    bin: { ...location.bin },
    scanTransactions: (entry.scanTransactions || []).map((transaction) => ({
      ...transaction,
      id: transactionId(locationId),
      locationId,
      locationLabel,
    })),
  };
});

export const getMultiLocationQuantitySummary = (
  quantityPerLocation: number,
  locationCount: number,
) => ({
  quantityPerLocation,
  locationCount,
  totalQuantity: quantityPerLocation * locationCount,
});

export const validatePcountLocationGroup = async <T>(
  locations: LocalPcountLocation[],
  validate: (location: LocalPcountLocation) => Promise<T>,
): Promise<T[]> => {
  const results: T[] = [];
  for (const location of locations) results.push(await validate(location));
  return results;
};

export const getPcountSessionRestoreState = (
  session: Pick<LocalPcountSession, "locationMode" | "activeGroupId" | "activeLocationId" | "locations">
) => {
  const activeLocation = session.locations.find((location) => location.bin.locationId === session.activeLocationId);
  if (session.locationMode === "multi") {
    const group = getActivePcountGroupLocations(session.locations, session.activeGroupId);
    const isScanning = Boolean(session.activeLocationId && activeLocation && group.some((location) => location.bin.locationId === activeLocation.bin.locationId));
    return { step: isScanning ? "item" as const : "bin" as const, isScanSessionActive: isScanning, currentBin: isScanning ? activeLocation!.bin : null };
  }
  return { step: activeLocation ? "item" as const : "bin" as const, isScanSessionActive: Boolean(activeLocation), currentBin: activeLocation?.bin || null };
};

export const requirePcountLocationConversionFactor = (
  conversionFactor: number | null | undefined,
  itemCode: string,
  stockUom: string,
  barcodeUom: string,
) => {
  if (!conversionFactor) throw new Error(`${itemCode} uses ${stockUom} in ERPNext; barcode contains ${barcodeUom}. No Item UOM conversion is available.`);
  return conversionFactor;
};

export const addPcountLocationToSession = (
  session: LocalPcountSession,
  bin: LocalBinLocation,
  requiredWarehouse: string,
  scannedAt: string,
) => {
  const result = addPcountGroupLocation(session.locations, bin, session.activeGroupId, scannedAt);
  return {
    added: result.added,
    session: {
      ...session,
      reconciliationWarehouse: session.reconciliationWarehouse || requiredWarehouse,
      locations: result.locations,
      updatedAt: scannedAt,
    },
  };
};
