import type { LocalBinLocation, LocalPcountLocation, LocalPcountSession, LocalScanEntry } from "@/lib/scanStorage";

const normalizeLocationId = (value: string | undefined) =>
  (value || "").trim().toLocaleLowerCase();

/**
 * Complete previously counted locations left in_progress when an operator
 * switches into recount. Never complete empty locations or the active target.
 * This repairs legacy on-device sessions without dropping scan history.
 */
export const completeCountedInactiveRecountLocations = (
  session: LocalPcountSession,
  entries: LocalScanEntry[],
  activeLocationId: string,
  completedAt: string,
): LocalPcountSession => {
  const active = normalizeLocationId(activeLocationId);
  const counted = new Set(entries.filter((entry) =>
    entry.mode === "pcount" &&
    (entry.reconciliationCode || "").trim().toUpperCase() === session.reconciliationCode.trim().toUpperCase() &&
    (entry.scanTransactions || []).some((transaction) =>
      transaction.action === "ADD" || transaction.action === "DEDUCT"
    )
  ).map((entry) => normalizeLocationId(entry.bin.locationId)));
  let changed = false;
  const locations = session.locations.map((location) => {
    const id = normalizeLocationId(location.bin.locationId);
    if (!id || id === active || location.status === "completed" || !counted.has(id)) {
      return location;
    }
    changed = true;
    return { ...location, status: "completed" as const, completedAt };
  });
  return changed ? { ...session, locations, updatedAt: completedAt } : session;
};

export const addPcountGroupLocation = (
  locations: LocalPcountLocation[],
  bin: LocalBinLocation,
  groupId: string,
  scannedAt: string,
) => {
  const locationId = normalizeLocationId(bin.locationId);
  if (!locationId) return { locations, added: false, reason: "invalid_location" as const };

  const existing = locations.find((location) => normalizeLocationId(location.bin.locationId) === locationId);
  if (existing) {
    const alreadySelected = existing.groupId === groupId && existing.status === "in_progress";
    return {
      locations,
      added: false,
      reason: alreadySelected ? "already_selected" as const : "already_counted" as const,
    };
  }

  return {
    locations: [...locations, { bin, status: "in_progress" as const, groupId, lastScanTime: scannedAt }],
    added: true,
    reason: null,
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

/**
 * Removing the final unsent scan row for a completed location must also free
 * that location from the on-device session. Otherwise a later location QR is
 * rejected as already_counted even though no count remains.
 *
 * Only locations touched by this removal may be freed, only when *no* local
 * row remains for the same reconciliation/location, and only if completed.
 * This preserves current in-progress groups and ERP-submitted audit rows.
 */
const releaseCompletedLocationsWithoutSavedEntries = (
  session: LocalPcountSession,
  affectedLocationIds: Set<string>,
  remainingEntries: LocalScanEntry[],
  changedAt: string,
): { session: LocalPcountSession; releasedLocationIds: string[] } => {
  if (!affectedLocationIds.size) return { session, releasedLocationIds: [] };
  const reference = session.reconciliationCode.trim().toLocaleLowerCase();

  // Any retained row, including ERP-submitted history, keeps the location
  // protected. Never change a location still in an active scanning group.
  const retained = new Set(
    remainingEntries.filter((entry) =>
      entry.mode === "pcount" &&
      entry.reconciliationCode.trim().toLocaleLowerCase() === reference
    ).map((entry) => normalizeLocationId(entry.bin.locationId)).filter(Boolean),
  );
  const releasedLocationIds: string[] = [];
  const locations = session.locations.filter((location) => {
    const id = normalizeLocationId(location.bin.locationId);
    const canRelease = Boolean(id) && location.status === "completed" &&
      affectedLocationIds.has(id) && !retained.has(id);
    if (canRelease) releasedLocationIds.push(id);
    return !canRelease;
  });
  if (!releasedLocationIds.length) return { session, releasedLocationIds };

  const released = new Set(releasedLocationIds);
  const activeLocationId = released.has(normalizeLocationId(session.activeLocationId))
    ? ""
    : session.activeLocationId;
  const updated = { ...session, locations, activeLocationId, updatedAt: changedAt };
  return {
    session: !activeLocationId && session.activeLocationId &&
      getActivePcountGroupLocations(locations, session.activeGroupId).length === 0
      ? completePcountLocationMode(updated)
      : updated,
    releasedLocationIds,
  };
};

export const releaseEmptyPcountLocationsAfterScanRemoval = (
  session: LocalPcountSession,
  removedEntries: LocalScanEntry[],
  remainingEntries: LocalScanEntry[],
  changedAt: string,
): { session: LocalPcountSession; releasedLocationIds: string[] } => {
  const reference = session.reconciliationCode.trim().toLocaleLowerCase();
  const affected = new Set(
    removedEntries.filter((entry) =>
      entry.mode === "pcount" &&
      entry.reconciliationCode.trim().toLocaleLowerCase() === reference
    ).map((entry) => normalizeLocationId(entry.bin.locationId)).filter(Boolean),
  );
  return releaseCompletedLocationsWithoutSavedEntries(session, affected, remainingEntries, changedAt);
};

/**
 * Repair persisted stale completion markers left by older Delete/Remove
 * Selected builds. Called only when restoring a locally saved scanner session.
 * Completion is cleared only if there is no local count/audit row at all.
 */
export const restoreEmptyCompletedPcountLocations = (
  session: LocalPcountSession,
  localEntries: LocalScanEntry[],
  changedAt: string,
): { session: LocalPcountSession; releasedLocationIds: string[] } => {
  const candidates = new Set(
    session.locations.filter((location) => location.status === "completed")
      .map((location) => normalizeLocationId(location.bin.locationId)).filter(Boolean),
  );
  return releaseCompletedLocationsWithoutSavedEntries(session, candidates, localEntries, changedAt);
};

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

export const inferPcountLocationMode = (locationCount: number): "single" | "multi" =>
  locationCount <= 1 ? "single" : "multi";

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
  session: Pick<LocalPcountSession, "locationMode" | "activeLocationMode" | "activeGroupId" | "activeLocationId" | "locations">
) => {
  const activeLocation = session.locations.find((location) => location.bin.locationId === session.activeLocationId);
  if ((session.activeLocationMode || session.locationMode) === "multi") {
    const group = getActivePcountGroupLocations(session.locations, session.activeGroupId);
    // A Multi group can contain selected locations before item counting has
    // actually started. activeLocationId is the durable marker that the user
    // crossed from location selection into Scan Items.
    const scanAnchor = activeLocation && group.some((location) => location.bin.locationId === activeLocation.bin.locationId)
      ? activeLocation
      : undefined;
    const isScanning = Boolean(scanAnchor);
    return { step: isScanning ? "item" as const : "bin" as const, isScanSessionActive: isScanning, currentBin: scanAnchor?.bin || null };
  }
  return { step: activeLocation ? "item" as const : "bin" as const, isScanSessionActive: Boolean(activeLocation), currentBin: activeLocation?.bin || null };
};

export const getEffectivePcountLocationMode = (
  session: LocalPcountSession | null,
  preference: "single" | "multi",
) => session?.activeLocationMode || preference;

export const lockPcountLocationMode = (
  session: LocalPcountSession,
  mode: "single" | "multi",
): LocalPcountSession => ({ ...session, locationMode: mode, activeLocationMode: mode });

export const completePcountLocationMode = (session: LocalPcountSession): LocalPcountSession => {
  const { activeLocationMode: _activeLocationMode, ...completed } = session;
  return { ...completed, activeGroupId: "", activeLocationId: "" };
};

export const removePcountLocationFromSession = (
  session: LocalPcountSession,
  locationId: string,
): LocalPcountSession => {
  // The operator may explicitly undo a completed local group after scanning
  // the wrong location. Completion is NOT evidence of ERP submission. The
  // caller first discards pending counts, preserving ERP-acknowledged audit.
  const wanted = normalizeLocationId(locationId);
  const locations = session.locations.filter((location) =>
    normalizeLocationId(location.bin.locationId) !== wanted
  );
  const activeLocationId = normalizeLocationId(session.activeLocationId) === wanted
    ? ""
    : session.activeLocationId;
  const updated = { ...session, locations, activeLocationId, updatedAt: new Date().toISOString() };
  return getActivePcountGroupLocations(locations, session.activeGroupId).length === 0
    ? completePcountLocationMode(updated)
    : updated;
};

export const requirePcountLocationConversionFactor = (
  conversionFactor: number | null | undefined,
  itemCode: string,
  stockUom: string,
  barcodeUom: string,
) => {
  if (conversionFactor && Number.isFinite(conversionFactor) && conversionFactor > 0) {
    return conversionFactor;
  }

  // ERPNext may not return Stock UOM metadata for a Physical Count baseline.
  // If both sides are the same UOM (or ERP did not provide a Stock UOM),
  // no conversion is required, so use 1 instead of blocking the scan.
  const normalizedStockUom = (stockUom || "").trim().toLocaleUpperCase();
  const normalizedBarcodeUom = (barcodeUom || "").trim().toLocaleUpperCase();

  if (!normalizedStockUom) {
    throw new Error(`${itemCode}: ERPNext Item Stock UOM is required before scanning.`);
  }
  if (normalizedStockUom === normalizedBarcodeUom) {
    return 1;
  }

  throw new Error(
    `${itemCode} uses ${stockUom} in ERPNext; barcode contains ${barcodeUom}. No Item UOM conversion is available.`
  );
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
    reason: result.reason,
    session: {
      ...session,
      reconciliationWarehouse: session.reconciliationWarehouse || requiredWarehouse,
      locations: result.locations,
      updatedAt: scannedAt,
    },
  };
};
