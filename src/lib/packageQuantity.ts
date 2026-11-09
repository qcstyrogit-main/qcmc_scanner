export type PackageStatus = "COMPLETE" | "OPENED";
export type PulloutPackageMode = "FULL" | "PARTIAL";

export class PackageQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageQuantityError";
  }
}

const parseQuantity = (value: string, label: string, allowZero: boolean) => {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) throw new PackageQuantityError(`${label} is required.`);
  const quantity = Number(normalized);
  if (!Number.isFinite(quantity) || quantity < 0 || (!allowZero && quantity === 0)) {
    throw new PackageQuantityError(`${label} must be ${allowZero ? "zero or greater" : "greater than zero"}.`);
  }
  return quantity;
};

const requireQrQuantity = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new PackageQuantityError("QR quantity must be greater than zero.");
  }
};

export const calculatePhysicalPackage = ({
  qrQuantity,
  status,
  input,
}: {
  qrQuantity: number;
  status: PackageStatus;
  input: string;
}) => {
  requireQrQuantity(qrQuantity);
  if (status === "COMPLETE") {
    const packageCount = input.trim() ? parseQuantity(input, "Package count", false) : 1;
    const quantity = qrQuantity * packageCount;
    return { qrQuantity, packageStatus: status, packageCount, actualQuantity: quantity, difference: 0, quantity } as const;
  }

  const actualQuantity = parseQuantity(input, "Total counted quantity", true);
  return {
    qrQuantity,
    packageStatus: status,
    actualQuantity,
    difference: 0,
    quantity: actualQuantity,
  } as const;
};

export const calculatePulloutPackage = ({
  qrQuantity,
  mode,
  input,
  availableQuantity = qrQuantity,
}: {
  qrQuantity: number;
  mode: PulloutPackageMode;
  input: string;
  availableQuantity?: number;
}) => {
  requireQrQuantity(qrQuantity);
  if (!Number.isFinite(availableQuantity) || availableQuantity < 0) {
    throw new PackageQuantityError("Available package quantity is invalid.");
  }
  if (mode === "FULL") {
    const packageCount = parseQuantity(input, "Big Pack count", false);
    const quantity = qrQuantity * packageCount;
    return {
      qrQuantity,
      packageStatus: "COMPLETE" as const,
      packageCount,
      pulloutQuantity: quantity,
      remainingQuantity: 0,
      quantity,
    };
  }

  const pulloutQuantity = parseQuantity(input, "Pullout quantity", false);
  if (pulloutQuantity > availableQuantity) {
    throw new PackageQuantityError("Pullout quantity cannot exceed the available package quantity.");
  }
  const remainingQuantity = availableQuantity - pulloutQuantity;
  return {
    qrQuantity,
    packageStatus: remainingQuantity > 0 ? "OPENED" as const : "COMPLETE" as const,
    pulloutQuantity,
    remainingQuantity,
    quantity: pulloutQuantity,
  };
};

export const getSignedPhysicalQuantity = (quantity: number, action: "ADD" | "DEDUCT") =>
  action === "DEDUCT" ? -Math.abs(quantity) : Math.abs(quantity);

export const getPackageModeDefaultInput = (mode: PulloutPackageMode) => mode === "FULL" ? "1" : "";

export const createPulloutRequestSignature = (value: {
  itemCode: string;
  jobCardId: string;
  mode: PulloutPackageMode;
  qrQuantity: number;
  quantity: number;
  remainingQuantity: number;
}) => JSON.stringify(value);
