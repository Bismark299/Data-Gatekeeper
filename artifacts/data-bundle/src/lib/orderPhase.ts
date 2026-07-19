// Shared display-phase derivation for the status/delivered split.
// status  = payment state:    pending | paid | failed | refunded (+ cancelled for store orders)
// delivered = fulfillment:    null | "processing" | "delivered" | "failed"

export type OrderLike = { status: string; delivered?: string | null };

export type PlatformPhase = "pending" | "processing" | "completed" | "failed" | "refunded";
export type StorePhase = PlatformPhase | "paid" | "cancelled";

/** Platform (wallet-paid) orders: paid + not dispatched reads as "pending" (awaiting processing). */
export function platformPhase(o: OrderLike): PlatformPhase {
  if (o.status === "refunded") return o.delivered === "failed" ? "failed" : "refunded";
  if (o.status === "failed" || o.delivered === "failed") return "failed";
  if (o.delivered === "delivered") return "completed";
  if (o.delivered === "processing") return "processing";
  return "pending";
}

/** Store orders: unpaid stays "pending"; paid-but-not-dispatched reads as "paid". */
export function storePhase(o: OrderLike): StorePhase {
  if (o.status === "cancelled") return "cancelled";
  if (o.status === "refunded") return "refunded";
  if (o.status === "failed" || o.delivered === "failed") return "failed";
  if (o.delivered === "delivered") return "completed";
  if (o.delivered === "processing") return "processing";
  if (o.status === "pending") return "pending";
  return "paid";
}

/** Paid but not yet dispatched to any provider — eligible for manual network copy/dispatch. */
export function awaitingDispatch(o: OrderLike): boolean {
  return o.status === "paid" && !o.delivered;
}
