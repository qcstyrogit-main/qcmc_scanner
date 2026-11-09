import { erpRequest } from "@/lib/erpApi";
import { createPcountSubmissionId } from "@/lib/erpService";

export const RECEIVE_FINISHED_GOODS_ONLINE_MESSAGE =
  "Internet connection is required for Receive Finished Goods. Please reconnect and try again.";

export class ReceiveFinishedGoodsOfflineError extends Error {
  code = "INTERNET_REQUIRED";

  constructor() {
    super(RECEIVE_FINISHED_GOODS_ONLINE_MESSAGE);
    this.name = "ReceiveFinishedGoodsOfflineError";
  }
}

export const requireReceiveFinishedGoodsNetwork = () => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ReceiveFinishedGoodsOfflineError();
  }
};

export const verifyReceiveFinishedGoodsConnection = async () => {
  requireReceiveFinishedGoodsNetwork();
  try {
    const response = await erpRequest("/api/method/ping", { method: "GET" });
    if (!response.ok) throw new ReceiveFinishedGoodsOfflineError();
  } catch {
    throw new ReceiveFinishedGoodsOfflineError();
  }
};

type IdField = "request_id" | "transaction_id";
type PendingRequest = { body: Record<string, unknown>; id: string };

// Receive Finished Goods is online-only. Keep an idempotency ID only in memory so
// an on-screen retry is safe, but never create a persistent offline mutation queue.
const pendingRequests = new Map<string, PendingRequest>();

export const prepareOnlineRequest = (
  key: string,
  body: Record<string, unknown>,
  idField: IdField,
  proposedId = ""
) => {
  const previous = pendingRequests.get(key);
  if (previous) return previous;
  const id = proposedId || createPcountSubmissionId();
  const request = { id, body: { ...body, [idField]: id } };
  pendingRequests.set(key, request);
  return request;
};

export const completeOnlineRequest = (key: string) => pendingRequests.delete(key);

export const clearOnlineRequestsForTests = () => pendingRequests.clear();
