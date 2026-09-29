import type { LocalBinLocation, LocalPcountLocation, LocalScanEntry } from "@/lib/scanStorage";

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
