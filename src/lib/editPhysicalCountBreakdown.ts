import type { LocalScanTransaction } from "@/lib/scanStorage";

/**
 * An old OPENED scan stored only its combined physical quantity.
 * Never invent its original full-pack count when editing; treat the
 * historical combined amount as loose until the operator supplies a split.
 */
export const readPhysicalCountBreakdown = (
  transaction: Pick<LocalScanTransaction, "quantityChange" | "qrQuantity" | "packageStatus" | "bigPackCount" | "loosePackQuantity">,
  fallbackQrQuantity: number
) => {
  const qrQuantity = transaction.qrQuantity && transaction.qrQuantity > 0
    ? transaction.qrQuantity
    : fallbackQrQuantity;
  const originalQuantity = Math.abs(transaction.quantityChange);
  const storedBig = transaction.bigPackCount;
  const storedLoose = transaction.loosePackQuantity;
  const hasBreakdown = storedBig !== undefined && storedLoose !== undefined;
  const legacyUnsplit = !hasBreakdown && transaction.packageStatus === "OPENED";

  return {
    bigPackCount: String(hasBreakdown ? storedBig : legacyUnsplit ? 0 : originalQuantity / (qrQuantity > 0 ? qrQuantity : 1)),
    loosePackQuantity: String(hasBreakdown ? storedLoose : legacyUnsplit ? originalQuantity : 0),
    legacyUnsplit,
  };
};

/** Work in ERP Stock UOM. Keep both parts independent across tab switches. */
export const calculateEditedPhysicalCount = (
  qrQuantity: number,
  bigPackCount: number,
  loosePackQuantity: number
) => {
  if (!Number.isFinite(qrQuantity) || qrQuantity <= 0 ||
      !Number.isFinite(bigPackCount) || bigPackCount < 0 ||
      !Number.isFinite(loosePackQuantity) || loosePackQuantity < 0) {
    throw new Error("Big Pack count and Loose Pack quantity must be valid non-negative numbers.");
  }
  const bigPackUnits = bigPackCount * qrQuantity;
  const total = bigPackUnits + loosePackQuantity;
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Big Pack and Loose Pack cannot both be zero.");
  }
  return { bigPackCount, bigPackUnits, loosePackQuantity, total };
};
