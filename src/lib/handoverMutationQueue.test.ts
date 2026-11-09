import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeHandoverMutation, loadHandoverMutations, prepareHandoverMutation } from "@/lib/handoverMutationQueue";

const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

describe("handover mutation retry identity", () => {
  it("reuses the identical request ID and immutable body for a retry", () => {
    const first = prepareHandoverMutation("add:batch:entry", "/endpoint", { stock_entry_id: "STE-1" }, "request_id", "uuid-1");
    const retry = prepareHandoverMutation("add:batch:entry", "/endpoint", { stock_entry_id: "CHANGED" }, "request_id", "uuid-2");
    expect(retry.id).toBe("uuid-1");
    expect(retry.body).toEqual(first.body);
    expect(loadHandoverMutations()).toHaveLength(1);
  });

  it("clears an operation only after it is confirmed successful", () => {
    prepareHandoverMutation("verify:1", "/endpoint", { allocation_id: "1" }, "transaction_id", "tx-1");
    completeHandoverMutation("verify:1");
    expect(loadHandoverMutations()).toEqual([]);
  });
});
