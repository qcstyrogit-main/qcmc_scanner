export type LocalScanMode = "in" | "out" | "pcount";

export type LocalBinLocation = {
  raw: string;
  stockroom: string;
  building: string;
  aisle: string;
  rack: string;
  bin: string;
};

export type LocalScanEntry = {
  raw: string;
  mode: LocalScanMode;
  reconciliationCode: string;
  bin: LocalBinLocation;
  itemCode: string;
  qrQuantity: number;
  multiplier: number;
  quantity: number;
  uom: string;
  lotNo: string;
  timestamp: string;
  deviceId: string;
};

const MAX_LOCAL_ENTRIES = 300;
const SCANNER_DEVICE_NAME_KEY = "qcmc.scanner.deviceName";

const storageKey = (employeeId: string) => `qcmc.scan.entries.${employeeId}`;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const readString = (value: unknown) => (typeof value === "string" ? value : "");
const readNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const parseEntry = (value: unknown): LocalScanEntry | null => {
  const entry = asRecord(value);
  const bin = asRecord(entry?.bin);
  if (!entry || !bin) return null;

  const mode = readString(entry.mode);
  if (mode !== "in" && mode !== "out" && mode !== "pcount") return null;

  const itemCode = readString(entry.itemCode);
  const reconciliationCode = readString(entry.reconciliationCode);
  if (!itemCode || !reconciliationCode) return null;

  return {
    raw: readString(entry.raw),
    mode,
    reconciliationCode,
    bin: {
      raw: readString(bin.raw),
      stockroom: readString(bin.stockroom),
      building: readString(bin.building),
      aisle: readString(bin.aisle),
      rack: readString(bin.rack),
      bin: readString(bin.bin),
    },
    itemCode,
    qrQuantity: readNumber(entry.qrQuantity),
    multiplier: readNumber(entry.multiplier),
    quantity: readNumber(entry.quantity),
    uom: readString(entry.uom),
    lotNo: readString(entry.lotNo),
    timestamp: readString(entry.timestamp),
    deviceId: readString(entry.deviceId),
  };
};

export const loadLocalScanEntries = (employeeId: string): LocalScanEntry[] => {
  try {
    const raw = localStorage.getItem(storageKey(employeeId));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map(parseEntry).filter((entry): entry is LocalScanEntry => Boolean(entry));
  } catch {
    return [];
  }
};

export const saveLocalScanEntries = (employeeId: string, entries: LocalScanEntry[]) => {
  try {
    localStorage.setItem(storageKey(employeeId), JSON.stringify(entries.slice(0, MAX_LOCAL_ENTRIES)));
  } catch {
    // Ignore local storage failures so scanning can continue.
  }
};

export const appendLocalScanEntry = (employeeId: string, entry: LocalScanEntry) => {
  const current = loadLocalScanEntries(employeeId);
  saveLocalScanEntries(employeeId, [entry, ...current]);
};

export const loadScannerDeviceName = () => {
  try {
    return localStorage.getItem(SCANNER_DEVICE_NAME_KEY)?.trim() || "";
  } catch {
    return "";
  }
};

export const saveScannerDeviceName = (deviceName: string) => {
  const cleaned = deviceName.trim();
  try {
    if (cleaned) {
      localStorage.setItem(SCANNER_DEVICE_NAME_KEY, cleaned);
    } else {
      localStorage.removeItem(SCANNER_DEVICE_NAME_KEY);
    }
  } catch {
    // Ignore local storage failures.
  }
};
