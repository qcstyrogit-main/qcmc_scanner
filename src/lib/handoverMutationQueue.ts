import { createPcountSubmissionId } from "@/lib/erpService";

export type HandoverMutation = {
  key: string;
  endpoint: string;
  body: Record<string, unknown>;
  idField: "request_id" | "transaction_id";
  id: string;
  createdAt: string;
};

const STORAGE_KEY = "qcmc.warehouseHandover.mutations.v1";

export const loadHandoverMutations = (): HandoverMutation[] => {
  try {
    const rows = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(rows) ? rows.filter((row) => row?.key && row?.endpoint && row?.id) : [];
  } catch {
    return [];
  }
};

const save = (rows: HandoverMutation[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));

export const prepareHandoverMutation = (
  key: string,
  endpoint: string,
  body: Record<string, unknown>,
  idField: HandoverMutation["idField"],
  proposedId = ""
) => {
  const rows = loadHandoverMutations();
  const existing = rows.find((row) => row.key === key);
  if (existing) return existing;
  const id = proposedId || createPcountSubmissionId();
  const mutation: HandoverMutation = {
    key,
    endpoint,
    body: { ...body, [idField]: id },
    idField,
    id,
    createdAt: new Date().toISOString(),
  };
  save([...rows, mutation]);
  return mutation;
};

export const completeHandoverMutation = (key: string) => {
  save(loadHandoverMutations().filter((row) => row.key !== key));
};

const containsReference = (value: unknown, references: Set<string>): boolean => {
  if (typeof value === "string") return references.has(value);
  if (Array.isArray(value)) return value.some((item) => containsReference(item, references));
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some((item) => containsReference(item, references));
  return false;
};

export const clearHandoverMutationsForReferences = (values: string[]) => {
  const references = new Set(values.map((value) => value.trim()).filter(Boolean));
  if (!references.size) return loadHandoverMutations();
  const remaining = loadHandoverMutations().filter((mutation) =>
    !references.has(mutation.key) && !containsReference(mutation.body, references)
  );
  save(remaining);
  return remaining;
};

export const clearHandoverMutationQueueForTests = () => localStorage.removeItem(STORAGE_KEY);
