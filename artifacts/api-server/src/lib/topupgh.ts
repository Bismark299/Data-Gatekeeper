/**
 * TopUpGH Reseller API client.
 * Docs: https://reseller.etopupgh.com/api/v1
 *
 * Flow:
 *  - topupgh_enabled = "true" AND mcbis_enabled = "false" → pending MTN orders queue
 *  - Poller runs every 2 min; dispatches when count >= topupgh_min_batch
 *  - Webhook fires delivery updates per-item; poller polls as fallback
 *
 * Settings keys in DB:
 *   topupgh_enabled   — "true" | "false"
 *   topupgh_min_batch — integer string (min 5, API minimum)
 *   topupgh_max_batch — integer string (max 100, API limit)
 *
 * Env vars:
 *   TOPUPGH_API_KEY    — API key from My Account > API Management
 *   TOPUPGH_API_SECRET — API secret for HMAC-SHA256 signing
 *
 * ⚠️ Domain/IP whitelist required in TopUpGH dashboard before any call works.
 */

import crypto from "crypto";
import { eq, and, isNull, isNotNull, lt, inArray, sql } from "drizzle-orm";
import { db, pool, settingsTable, ordersTable, bundlesTable, topupghBatchesTable, storeOrdersTable, storesTable } from "@workspace/db";
import { logger } from "./logger";
import { recoverStuckTopupghBatches } from "./ensureSchema";

const TOPUPGH_BASE_URL = "https://reseller.etopupgh.com/api/v1";
const TOPUPGH_INTERNAL_PREFIX = "/topupgh-api/v1";
const REQUEST_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getCredentials() {
  return {
    apiKey: process.env.TOPUPGH_API_KEY ?? "",
    apiSecret: process.env.TOPUPGH_API_SECRET ?? "",
  };
}

function buildHeaders(method: string, endpoint: string, body = ""): Record<string, string> {
  const { apiKey, apiSecret } = getCredentials();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // TopUpGH signs the INTERNAL route PATH ONLY — excluding the query string. Their Swagger
  // code samples sign endpoint="/topupgh-api/v1/products" while fetching "/products?network=mtn",
  // so query params (e.g. /products?network=, /orders?page=) must be stripped from the signed
  // string or the signature won't match and the request 401s. Path-only endpoints are unaffected.
  const pathForSig = endpoint.split("?")[0];
  const signatureString = timestamp + method + TOPUPGH_INTERNAL_PREFIX + pathForSig + body;
  const signature = crypto.createHmac("sha256", apiSecret).update(signatureString).digest("hex");
  return {
    "Accept":          "application/json",
    "Content-Type":    "application/json",
    "X-API-Key":       apiKey,
    "X-Timestamp":     timestamp,
    "X-API-Signature": signature,
  };
}

async function topupghRequest<T>(method: string, endpoint: string, body?: object): Promise<T> {
  const bodyStr = body ? JSON.stringify(body) : "";
  const headers = buildHeaders(method, endpoint, bodyStr);
  const res = await fetch(TOPUPGH_BASE_URL + endpoint, {
    method,
    headers,
    body: bodyStr || undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // Observability: a non-2xx response (e.g. 429 rate limit) was previously parsed
  // and returned silently, so callers like the poller no-op'd with no trace. Log it
  // so prod logs reveal WHY settlement isn't happening (rate-limited vs. error vs. ok).
  const txt = await res.text();
  if (!res.ok) {
    logger.warn({ method, endpoint, status: res.status, body: txt.slice(0, 300) }, "TopUpGH API non-OK response");
    // Surface the HTTP status so callers can reliably detect a rate limit (429)
    // even when the body is empty or non-JSON (no "rate limit" text to match on).
    let parsed: unknown;
    try { parsed = JSON.parse(txt); } catch { parsed = {}; }
    if (parsed && typeof parsed === "object") {
      (parsed as Record<string, unknown>).__httpStatus = res.status;
    }
    return parsed as T;
  }
  // A 2xx with an EMPTY or non-JSON body must NOT throw. The delivery-status endpoint can
  // return no payload when there is nothing to report; res.json() would throw "Unexpected
  // end of JSON input" and surface to callers (e.g. the admin check button) as an opaque
  // 502. Parse defensively and treat an unparseable 2xx body as {} (i.e. "no data yet").
  try {
    return JSON.parse(txt) as T;
  } catch {
    logger.warn({ method, endpoint, status: res.status, body: txt.slice(0, 120) }, "TopUpGH 2xx with non-JSON body — treating as empty");
    return {} as T;
  }
}

// ─── API wrappers ─────────────────────────────────────────────────────────────

export async function topupghTestConnection(): Promise<{
  success: boolean; message: string; timestamp?: string; user_id?: number;
}> {
  return topupghRequest("GET", "/test");
}

export interface TopupghProduct {
  id: number;
  name: string;
  price: string;
  data_size: string;
  network: "mtn" | "at" | "telecel";
  in_stock: boolean;
}

export async function topupghGetProducts(network?: "mtn" | "at" | "telecel", dataSize?: number): Promise<{
  success: boolean; products: TopupghProduct[]; total: number;
}> {
  const p = new URLSearchParams();
  if (network)   p.set("network", network);
  if (dataSize)  p.set("data_size", String(dataSize));
  const q = p.toString() ? `?${p.toString()}` : "";
  return topupghRequest("GET", `/products${q}`);
}

export async function topupghGetBalance(): Promise<{
  success: boolean; balance: number; currency: string; today: { credit: number; debit: number };
}> {
  return topupghRequest("GET", "/wallet/balance");
}

export interface TopupghOrderItem {
  _beneficiary_number: string;
  network: "mtn" | "at" | "telecel";
  _data_size: number;
}

export interface TopupghCreateOrderResponse {
  success: boolean;
  message: string;
  order_id: number;
  total_amount: number;
  items_added: number;
  items_skipped: number;
  wallet_deducted: number;
  previous_balance: number;
  new_balance: number;
}

export async function topupghCreateOrder(orders: TopupghOrderItem[]): Promise<TopupghCreateOrderResponse> {
  return topupghRequest("POST", "/orders/create", { orders });
}

export async function topupghGetOrderStatus(orderId: number): Promise<{
  success: boolean; order: { id: number; status: string; total: number; date_created: string };
}> {
  return topupghRequest("GET", `/orders/${orderId}`);
}

export async function topupghGetDeliveryStatus(orderId: number): Promise<{
  success: boolean;
  order?: {
    id: number;
    delivery_info?: string;
    date_created?: string;
    payment_status?: string;
    items?: Array<{
      name?:               string;
      beneficiary_number?: string;
      data_size?:          string;
      delivery_status?:    string;
      processed_date?:     string;
    }>;
  };
}> {
  return topupghRequest("GET", `/orders/${orderId}/delivery-status`);
}

export async function topupghGetAllOrders(page = 1, perPage = 20, status?: string): Promise<{
  success: boolean;
  pagination: { total: number; per_page: number; current_page: number; total_pages: number };
  orders?: Array<{ id: number; status: string; total: number; date_created: string }>;
}> {
  const p = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (status) p.set("status", status);
  return topupghRequest("GET", `/orders?${p.toString()}`);
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

export async function getTopupghSettings(): Promise<{
  enabled: boolean; minBatch: number; maxBatch: number; apiKey: string; apiSecret: string;
}> {
  const [enabledRow, minRow, maxRow] = await Promise.all([
    db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "topupgh_enabled")).then(r => r[0]),
    db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "topupgh_min_batch")).then(r => r[0]),
    db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "topupgh_max_batch")).then(r => r[0]),
  ]);
  const enabled  = enabledRow?.value === "true";
  const minBatch = Math.max(5, parseInt(minRow?.value ?? "5", 10) || 5);
  const maxBatch = Math.min(100, parseInt(maxRow?.value ?? "50", 10) || 50);
  const { apiKey, apiSecret } = getCredentials();
  return { enabled, minBatch, maxBatch, apiKey, apiSecret };
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

export function parseGb(dataAmount: string): number {
  const m = dataAmount.match(/^(\d+(?:\.\d+)?)\s*GB$/i);
  return m ? parseFloat(m[1]) : 0;
}

// ─── Queue dispatch ───────────────────────────────────────────────────────────

export interface DispatchResult {
  batchId: number | null;
  dispatched: boolean;
  reason?: string;
  ordersCount: number;
  topupghOrderId?: number;
}

// ─── Instant dispatch runner ────────────────────────────────────────────────
// TopUpGH rate-limits rapid create-order calls, so we must never fire two within
// the provider's window. Every dispatch trigger — an MTN order placement
// (instant) and the backup poller — funnels through this single in-process
// runner:
//   • at most one dispatch in flight at a time (coalesces bursts of triggers);
//   • a self-tuning minimum gap between consecutive create-order calls — the
//     first is instant, the gap widens on a rate-limit and relaxes after clean
//     successes;
//   • a rate-limited batch is retried after the gap, never marked failed.
// Single process (WEB_CONCURRENCY=1). dispatchPendingQueue()'s order-level
// optimistic linking prevents any double-charge if a second pod briefly overlaps
// during a Render rolling deploy.
const DISPATCH_GAP_MIN_MS = 8_000;
const DISPATCH_GAP_MAX_MS = 90_000;
// Postgres advisory-lock key that serializes the create-order critical section across
// ALL processes (in-process runner, admin force-dispatch, multi-pod deploys), so the
// ambiguous-outcome balance delta can only ever reflect the current batch.
const DISPATCH_LOCK_KEY = 728_411_001;
// Give the TopUpGH wallet a moment to reflect a just-landed deduction before reading it
// to decide whether an unconfirmed create-order actually charged. The dispatch lock is
// held across this wait, so no other deduction can occur in the window.
const BALANCE_SETTLE_MS = 2_500;
let dispatchGapMs   = DISPATCH_GAP_MIN_MS;
let lastDispatchAt  = 0;
let dispatchRunning = false;
let rerunRequested  = false;

/**
 * Fire-and-forget nudge to dispatch pending TopUpGH orders as soon as possible.
 * Safe to call on every MTN order placement — it self-gates on topupgh_enabled
 * and min_batch, and coalesces concurrent calls into a single serialized runner.
 */
export function triggerTopupghDispatch(): void {
  if (dispatchRunning) { rerunRequested = true; return; }
  void runDispatchRunner();
}

async function runDispatchRunner(): Promise<void> {
  dispatchRunning = true;
  try {
    let keepGoing = true;
    while (keepGoing) {
      rerunRequested = false; // capture triggers that arrive from here on

      // Respect the minimum gap since the last create-order call (first is instant).
      const wait = lastDispatchAt === 0 ? 0 : lastDispatchAt + dispatchGapMs - Date.now();
      if (wait > 0) await sleep(wait);

      const result = await dispatchPendingQueue();

      let internalContinue = false;
      if (result.dispatched) {
        lastDispatchAt = Date.now();
        dispatchGapMs  = Math.max(DISPATCH_GAP_MIN_MS, Math.round(dispatchGapMs * 0.8));
        logger.info(
          { batchId: result.batchId, ordersCount: result.ordersCount, topupghOrderId: result.topupghOrderId },
          "TopUpGH batch dispatched",
        );
        internalContinue = true; // more orders may remain — drain, spaced by the gap
      } else if (result.reason === "rate_limited") {
        lastDispatchAt = Date.now();
        dispatchGapMs  = Math.min(DISPATCH_GAP_MAX_MS, Math.round(dispatchGapMs * 2));
        logger.warn({ gapMs: dispatchGapMs }, "TopUpGH dispatch rate-limited — backing off, will retry");
        internalContinue = true; // retry the requeued orders after the wider gap
      } else if (result.reason === "retry_safe") {
        // Ambiguous error, but the TopUpGH balance was UNCHANGED — nothing was
        // charged, so the orders were safely re-queued. Retry after the normal gap.
        lastDispatchAt   = Date.now();
        internalContinue = true;
        logger.info("TopUpGH dispatch hit an unconfirmed error but balance was unchanged — re-queued for retry");
      } else if (
        result.reason !== "empty_queue" &&
        result.reason !== "below_minimum" &&
        result.reason !== "disabled" &&
        result.reason !== "not_configured" &&
        result.reason !== "busy"
      ) {
        logger.warn({ reason: result.reason, ordersCount: result.ordersCount }, "TopUpGH dispatch stopped");
      }

      keepGoing = internalContinue || rerunRequested;
    }
  } catch (e) {
    logger.error({ err: e }, "TopUpGH dispatch runner error");
  } finally {
    dispatchRunning = false;
    // A trigger that landed in the tiny exit window must not be dropped.
    if (rerunRequested) setTimeout(() => triggerTopupghDispatch(), 100);
  }
}

/**
 * Public dispatch entrypoint. Wraps the dispatch body in a Postgres advisory lock so
 * the balance-read → create-order → balance-read window is serialized GLOBALLY — not
 * just within one process. This is what makes resolveAmbiguous()'s balance-delta
 * attribution sound even when admin force-dispatch or a second pod is active. If
 * another dispatcher holds the lock, returns "busy" and backs off (the pending queue
 * is global, so the lock holder drains the same orders).
 */
export async function dispatchPendingQueue(forceDispatch = false): Promise<DispatchResult> {
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked", [DISPATCH_LOCK_KEY],
    );
    if (rows[0]?.locked !== true) {
      return { batchId: null, dispatched: false, reason: "busy", ordersCount: 0 };
    }
    try {
      return await dispatchPendingQueueLocked(forceDispatch);
    } finally {
      try { await lockClient.query("SELECT pg_advisory_unlock($1)", [DISPATCH_LOCK_KEY]); }
      catch { /* lock auto-released when the session ends */ }
    }
  } finally {
    lockClient.release();
  }
}

/**
 * Collect pending MTN orders and dispatch as a batch to TopUpGH. Runs under the
 * advisory lock acquired by dispatchPendingQueue().
 * forceDispatch=true bypasses the minBatch check (admin manual trigger).
 */
async function dispatchPendingQueueLocked(forceDispatch = false): Promise<DispatchResult> {
  const { enabled, minBatch, maxBatch, apiKey, apiSecret } = await getTopupghSettings();

  if (!enabled)              return { batchId: null, dispatched: false, reason: "disabled",        ordersCount: 0 };
  if (!apiKey || !apiSecret) return { batchId: null, dispatched: false, reason: "not_configured",  ordersCount: 0 };

  // No grace delay — dispatch is instant. McBIS is mutually exclusive with
  // TopUpGH (no McBIS-claim race to wait out) and orders are already confirmed
  // paid by status (platform "pending" = wallet charged, store "paid"), so an
  // eligible order can go out the moment the batch quantity is reached.
  const GRACE_MS       = 0;
  const graceThreshold = new Date(Date.now() - GRACE_MS);

  const pendingOrders = await db
    .select({
      id:         ordersTable.id,
      phone:      ordersTable.phoneNumber,
      bundleData: ordersTable.bundleData,
      network:    bundlesTable.network,
      price:      ordersTable.price,
      userId:     ordersTable.userId,
    })
    .from(ordersTable)
    .leftJoin(bundlesTable, eq(bundlesTable.id, ordersTable.bundleId))
    .where(and(
      eq(ordersTable.status, "pending"),
      isNull(ordersTable.topupghBatchId),
      isNull(ordersTable.mcbisReference),
      eq(bundlesTable.network, "mtn"),
      lt(ordersTable.createdAt, graceThreshold),
    ))
    .orderBy(ordersTable.createdAt)
    .limit(maxBatch);

  // Also pull eligible MTN store orders that McBIS did not claim. These are paid
  // store orders past the grace period with no provider reference yet — same
  // fallback semantics as platform orders. Fill remaining batch capacity only.
  const storeCap = maxBatch - pendingOrders.length;
  const pendingStoreOrders = storeCap > 0 ? await db
    .select({
      id:         storeOrdersTable.id,
      phone:      storeOrdersTable.customerPhone,
      bundleData: storeOrdersTable.bundleData,
      price:      storeOrdersTable.basePrice,
    })
    .from(storeOrdersTable)
    .where(and(
      eq(storeOrdersTable.status, "paid"),
      eq(storeOrdersTable.bundleNetwork, "mtn"),
      isNull(storeOrdersTable.topupghBatchId),
      isNull(storeOrdersTable.mcbisReference),
      isNull(storeOrdersTable.ckgodswayReference),
      lt(storeOrdersTable.createdAt, graceThreshold),
    ))
    .orderBy(storeOrdersTable.createdAt)
    .limit(storeCap) : [];

  const count = pendingOrders.length + pendingStoreOrders.length;
  if (count === 0)                            return { batchId: null, dispatched: false, reason: "empty_queue",    ordersCount: 0 };
  if (!forceDispatch && count < minBatch)     return { batchId: null, dispatched: false, reason: "below_minimum", ordersCount: count };

  const valid      = pendingOrders.filter(o => parseGb(o.bundleData) > 0 && o.network === "mtn");
  const validStore = pendingStoreOrders.filter(o => parseGb(o.bundleData) > 0);
  if (valid.length + validStore.length === 0) return { batchId: null, dispatched: false, reason: "no_valid_orders", ordersCount: 0 };

  // Create batch record (optimistic lock)
  const [batch] = await db.insert(topupghBatchesTable).values({
    status:    "pending",
    network:   "mtn",
    itemCount: valid.length + validStore.length,
  }).returning();

  // Release both tables from this batch. ONLY for abort paths proven to have
  // created nothing at TopUpGH (rate limit, hard 4xx rejection, pre-send abort).
  const unlinkAll = async () => {
    await db.update(ordersTable).set({ topupghBatchId: null }).where(eq(ordersTable.topupghBatchId, batch.id));
    await db.update(storeOrdersTable).set({ topupghBatchId: null }).where(eq(storeOrdersTable.topupghBatchId, batch.id));
  };

  // Park orders whose delivery outcome is UNCONFIRMED (create-order timed out,
  // network error, or a 5xx/408 — TopUpGH may have created + charged the order but
  // we never got a clean response). NEVER unlink these: returning them to the
  // pending pool would re-dispatch and double-charge. Advancing them to
  // "processing" excludes them from re-dispatch (dispatchPendingQueue picks only
  // pending/paid) AND from the failed-batch safety-net in recoverStuckTopupghBatches
  // (which frees only pending/paid). The batch is marked failed for manual review.
  const parkAmbiguous = async (errorMessage: string) => {
    await db.update(ordersTable).set({ status: "processing" }).where(eq(ordersTable.topupghBatchId, batch.id));
    await db.update(storeOrdersTable).set({ status: "processing" }).where(eq(storeOrdersTable.topupghBatchId, batch.id));
    await db.update(topupghBatchesTable).set({ status: "failed", errorMessage }).where(eq(topupghBatchesTable.id, batch.id));
  };

  // Atomically link orders to this batch (both tables)
  if (valid.length > 0) {
    await db.update(ordersTable)
      .set({ topupghBatchId: batch.id })
      .where(and(
        inArray(ordersTable.id, valid.map(o => o.id)),
        isNull(ordersTable.topupghBatchId),
        isNull(ordersTable.mcbisReference),
        eq(ordersTable.status, "pending"),
      ));
  }
  if (validStore.length > 0) {
    await db.update(storeOrdersTable)
      .set({ topupghBatchId: batch.id })
      .where(and(
        inArray(storeOrdersTable.id, validStore.map(o => o.id)),
        isNull(storeOrdersTable.topupghBatchId),
        isNull(storeOrdersTable.mcbisReference),
        isNull(storeOrdersTable.ckgodswayReference),
        eq(storeOrdersTable.status, "paid"),
      ));
  }

  // Verify how many were actually linked (both tables)
  const linked = await db
    .select({ id: ordersTable.id, phone: ordersTable.phoneNumber, bundleData: ordersTable.bundleData, price: ordersTable.price, userId: ordersTable.userId })
    .from(ordersTable)
    .where(eq(ordersTable.topupghBatchId, batch.id));
  const linkedStore = await db
    .select({ id: storeOrdersTable.id, phone: storeOrdersTable.customerPhone, bundleData: storeOrdersTable.bundleData, price: storeOrdersTable.basePrice })
    .from(storeOrdersTable)
    .where(eq(storeOrdersTable.topupghBatchId, batch.id));
  const linkedCount = linked.length + linkedStore.length;

  if (linkedCount === 0 || (!forceDispatch && linkedCount < minBatch)) {
    await unlinkAll();
    await db.delete(topupghBatchesTable).where(eq(topupghBatchesTable.id, batch.id));
    return { batchId: null, dispatched: false, reason: linkedCount === 0 ? "race_condition" : "below_minimum", ordersCount: linkedCount };
  }

  // Pre-flight balance check. Also capture the balance so the ambiguous-outcome
  // resolver below can detect — via a balance drop — whether an UNCONFIRMED
  // create-order actually landed (a success deducts the merchant TopUpGH wallet).
  let preBalance: number | null = null;
  try {
    const balanceData = await topupghGetBalance();
    preBalance        = balanceData.balance;
    const totalCost   = [...linked, ...linkedStore].reduce((s, o) => s + parseFloat(o.price), 0);
    if (balanceData.balance < totalCost) {
      await unlinkAll();
      await db.update(topupghBatchesTable)
        .set({ status: "failed", errorMessage: `Insufficient TopUpGH wallet balance (GH₵${balanceData.balance.toFixed(2)} available)` })
        .where(eq(topupghBatchesTable.id, batch.id));
      return { batchId: batch.id, dispatched: false, reason: "insufficient_balance", ordersCount: linkedCount };
    }
  } catch { /* balance check failed — preBalance stays null; resolver will park safe */ }

  // Resolve an UNCONFIRMED create-order outcome (timeout / 5xx / malformed body)
  // using the merchant's TopUpGH wallet balance as a hard financial signal. The
  // dispatch runner is serialized (one create-order at a time), so any balance drop
  // in this window can only be THIS batch:
  //   • balance dropped   → order LANDED        → park, never resend (it will deliver)
  //   • balance unchanged → nothing was charged → unlink + re-queue (self-heals)
  //   • balance unknown   → cannot prove either → park (safe default, never resend)
  const resolveAmbiguous = async (context: string): Promise<string> => {
    let postBalance: number | null = null;
    // Let the wallet settle so a just-landed deduction is reflected before we read it.
    await sleep(BALANCE_SETTLE_MS);
    try { postBalance = (await topupghGetBalance()).balance; } catch { /* undeterminable */ }

    if (preBalance !== null && postBalance !== null) {
      const drop = preBalance - postBalance;
      if (drop > 0.01) {
        logger.warn({ batchId: batch.id, preBalance, postBalance, delta: drop, outcome: "ambiguous_landed" },
          `TopUpGH ambiguous resolved: balance dropped → order LANDED, parked for manual completion — ${context}`);
        await parkAmbiguous(`${context} — TopUpGH balance dropped GH₵${drop.toFixed(2)}, order LANDED; will deliver, complete manually`);
        return "ambiguous_landed";
      }
      logger.warn({ batchId: batch.id, preBalance, postBalance, delta: drop, outcome: "retry_safe" },
        `TopUpGH ambiguous resolved: balance unchanged → nothing charged, re-queuing for retry — ${context}`);
      await unlinkAll();
      await db.delete(topupghBatchesTable).where(eq(topupghBatchesTable.id, batch.id));
      return "retry_safe";
    }

    logger.warn({ batchId: batch.id, preBalance, postBalance, outcome: "ambiguous" },
      `TopUpGH ambiguous resolved: balance undeterminable → parked for manual review — ${context}`);
    await parkAmbiguous(`${context} — TopUpGH balance undeterminable, parked for manual review`);
    return "ambiguous";
  };

  // Build payload (platform + store orders share one MTN batch)
  const orderItems: TopupghOrderItem[] = [...linked, ...linkedStore].map(o => ({
    _beneficiary_number: o.phone,
    network:             "mtn" as const,
    _data_size:          parseGb(o.bundleData),
  }));

  try {
    // Durable "send started" marker. If the process crashes after TopUpGH accepts
    // this create-order but before we record the result below, the batch is left
    // in 'dispatching' (not 'pending'), so recoverStuckTopupghBatches() parks it
    // for manual review instead of requeuing it. Closes the crash-between-send-
    // and-write double-delivery window.
    await db.update(topupghBatchesTable)
      .set({ status: "dispatching" })
      .where(eq(topupghBatchesTable.id, batch.id));

    const result = await topupghCreateOrder(orderItems);

    if (!result.success) {
      const failMsg = result.message ?? "TopUpGH rejected the order";
      const httpStatus = (result as { __httpStatus?: number }).__httpStatus;

      // 429 → transient rate limit. TopUpGH throttled this call and created
      // nothing, so it's safe to retry: drop the empty batch row and let the same
      // orders re-queue on the next cycle. Detect by HTTP 429 OR the message text.
      if (httpStatus === 429 || /rate.?limit/i.test(failMsg)) {
        await unlinkAll();
        await db.delete(topupghBatchesTable).where(eq(topupghBatchesTable.id, batch.id));
        return { batchId: batch.id, dispatched: false, reason: "rate_limited", ordersCount: linkedCount };
      }

      // 5xx / 408 → AMBIGUOUS server-side error: TopUpGH may have accepted +
      // charged the order but returned an error. Treat exactly like a timeout —
      // never unlink; park for manual review.
      if (httpStatus !== undefined && (httpStatus >= 500 || httpStatus === 408)) {
        const reason = await resolveAmbiguous(`Create-order server error (HTTP ${httpStatus}) — UNCONFIRMED: ${failMsg}`);
        return { batchId: batch.id, dispatched: false, reason, ordersCount: linkedCount };
      }

      // Hard 4xx (validation/auth/not-found), or an EXPLICIT success === false →
      // the provider rejected the request and created nothing. Safe to unlink and
      // mark the batch failed.
      const hard4xx = httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500;
      if (hard4xx || result.success === false) {
        await unlinkAll();
        await db.update(topupghBatchesTable)
          .set({ status: "failed", errorMessage: failMsg })
          .where(eq(topupghBatchesTable.id, batch.id));
        return { batchId: batch.id, dispatched: false, reason: "api_error", ordersCount: linkedCount };
      }

      // Otherwise the success flag is MISSING on an otherwise-OK (2xx) response —
      // an empty or malformed body that does NOT prove rejection. /orders/create
      // may have accepted + charged the order but returned an unusable response.
      // AMBIGUOUS → park for manual review; never resend.
      const reason = await resolveAmbiguous(`Create-order returned no/invalid success flag (HTTP ${httpStatus ?? "2xx"}) — UNCONFIRMED: ${failMsg}`);
      return { batchId: batch.id, dispatched: false, reason, ordersCount: linkedCount };
    }

    // Success — update batch
    await db.update(topupghBatchesTable).set({
      topupghOrderId:  result.order_id,
      status:          "processing",
      itemsAdded:      result.items_added,
      itemsSkipped:    result.items_skipped,
      walletDeducted:  String(result.wallet_deducted),
      previousBalance: String(result.previous_balance),
      newBalance:      String(result.new_balance),
      dispatchedAt:    new Date(),
    }).where(eq(topupghBatchesTable.id, batch.id));

    // Mark orders as processing (both tables)
    await db.update(ordersTable)
      .set({ status: "processing" })
      .where(eq(ordersTable.topupghBatchId, batch.id));
    await db.update(storeOrdersTable)
      .set({ status: "processing" })
      .where(eq(storeOrdersTable.topupghBatchId, batch.id));

    return { batchId: batch.id, dispatched: true, ordersCount: linkedCount, topupghOrderId: result.order_id };

  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    // AMBIGUOUS FAILURE (network error / create-order timeout via AbortSignal):
    // the request may have reached TopUpGH and actually created + charged the
    // order — we never got the response. Park for manual review; never resend.
    const reason = await resolveAmbiguous(`Create-order timed out / network error — UNCONFIRMED (no order_id): ${msg}`);
    return { batchId: batch.id, dispatched: false, reason, ordersCount: linkedCount };
  }
}

// ─── Backup status checker ────────────────────────────────────────────────────

/**
 * Poll TopUpGH delivery status for ONE processing batch per cycle.
 * Rate limit: delivery-status endpoint is capped at 1 req/min.
 * Poller runs every 2 min, so one check per cycle stays safely within limits.
 * Round-robins by updatedAt (least-recently-checked first) and bumps updatedAt on
 * EVERY check — even when there's nothing to settle or the check errors. This prevents
 * head-of-line blocking: a single un-settleable order (e.g. delivery-status returns no
 * items, or a transient 429) must not be re-queried forever while the rest of the
 * backlog starves. Each batch rotates to the back of the queue after it is checked.
 * Checks any batch dispatched more than 2 min ago — catches missed webhooks
 * within a single poll cycle rather than waiting 10 min.
 */
async function checkProcessingBatches(): Promise<void> {
  const TWO_MIN_AGO = new Date(Date.now() - 2 * 60 * 1000);

  const [batch] = await db
    .select()
    .from(topupghBatchesTable)
    .where(and(
      eq(topupghBatchesTable.status, "processing"),
      isNotNull(topupghBatchesTable.topupghOrderId),
      lt(topupghBatchesTable.dispatchedAt, TWO_MIN_AGO),
    ))
    .orderBy(topupghBatchesTable.updatedAt)
    .limit(1);

  if (!batch?.topupghOrderId) return;

  // Bump updatedAt immediately so this batch moves to the back of the round-robin
  // queue regardless of the outcome below. Without this, a batch whose delivery-status
  // never yields settleable items stays the "least-recently-checked" forever and blocks
  // every other processing batch from ever being polled.
  await db.update(topupghBatchesTable)
    .set({ updatedAt: new Date() })
    .where(eq(topupghBatchesTable.id, batch.id));

  try {
    await fetchAndSettleBatchDelivery(batch, { gateMode: "queue" });
  } catch { /* transient — retry next cycle */ }
}

/** Summary of a single batch delivery-status check. */
export interface BatchDeliveryCheckResult {
  /** Per-recipient delivery items TopUpGH returned for the batch (0 = none yet / rate-limited). */
  itemCount: number;
  delivered: number;
  failed:    number;
  pending:   number;
  unknown:   number;
}

/** Batch IDs currently being settled — serializes the poller vs. the manual admin check. */
const _settleInFlight = new Set<number>();

// ─── Shared delivery-status rate gate ──────────────────────────────────────────
// TopUpGH caps GET /orders/{id}/delivery-status at 1 req/min/key. The background
// poller, the webhook-triggered re-fetch, the manual "check delivery" button and the
// admin phone search ALL hit this one endpoint and share that single budget. Without
// a shared gate, a webhook burst across different batches or a multi-batch search
// fires several calls within seconds — TopUpGH then drops the connections (surfacing
// as aborted-timeout warnings) AND the poller's own legitimate check gets starved.
// This gate guarantees >= DELIVERY_STATUS_MIN_INTERVAL_MS between the START of any two
// delivery-status calls, across every caller.
//   - "queue": wait in line until a slot frees. For background callers (poller,
//     webhook) where latency does not matter.
//   - "skip":  run only if a slot is free right now; otherwise return { ran: false }
//     WITHOUT calling, so interactive callers (admin button / search) fall back to
//     stored data instead of hanging for up to a minute or busting the rate limit.
export type DeliveryGateMode = "queue" | "skip";
const DELIVERY_STATUS_MIN_INTERVAL_MS = 60_000;
// Hard cap on queued "queue"-mode waiters. Calls drain at 1/min, so a webhook storm across
// many distinct batches could otherwise retain one long-lived closure per batch for the
// whole drain. Beyond this depth we refuse new queue-mode calls (ran:false) rather than
// grow unbounded — the round-robin poller still settles those batches on a later cycle, so
// no order is stranded. Same-batch storms never reach here: _settleInFlight coalesces them
// before the gate, and unknown order_ids are rejected before any settle is attempted.
const MAX_DELIVERY_GATE_QUEUE = 50;
let _deliveryGateChain: Promise<void> = Promise.resolve();
let _deliveryGateLastStart = 0;
let _deliveryGateActive = 0;

export async function runDeliveryStatusCall<T>(
  fn: () => Promise<T>,
  mode: DeliveryGateMode = "queue",
): Promise<{ ran: true; value: T } | { ran: false }> {
  if (mode === "skip") {
    // Best-effort: never call while a queued caller holds/awaits the slot, nor within
    // the interval since the last call started. There is no await between the read and
    // the timestamp write, so two skip callers in the same tick cannot both pass.
    if (_deliveryGateActive > 0) return { ran: false };
    if (Date.now() - _deliveryGateLastStart < DELIVERY_STATUS_MIN_INTERVAL_MS) return { ran: false };
    _deliveryGateLastStart = Date.now();
    return { ran: true, value: await fn() };
  }
  if (_deliveryGateActive >= MAX_DELIVERY_GATE_QUEUE) return { ran: false };
  _deliveryGateActive++;
  const wait = _deliveryGateChain.then(async () => {
    const remaining = DELIVERY_STATUS_MIN_INTERVAL_MS - (Date.now() - _deliveryGateLastStart);
    if (remaining > 0) await sleep(remaining);
    _deliveryGateLastStart = Date.now();
  });
  _deliveryGateChain = wait.catch(() => {}); // keep the chain alive across errors
  try {
    await wait;
    return { ran: true, value: await fn() };
  } finally {
    _deliveryGateActive--;
  }
}

/**
 * Public entry point for settling a single batch from TopUpGH's LIVE delivery status.
 * Serializes per batch so the admin "Check delivery status" button and the background
 * poller (or a rapid double-click) never settle the SAME batch concurrently — settlement
 * matches delivery items to orders by phone + "next unsettled row", so a concurrent replay
 * of one delivered item could complete a second same-phone order. Concurrent callers for an
 * already in-flight batch get an empty (no-op) result; the next poll/click picks it up.
 */
export async function fetchAndSettleBatchDelivery(
  batch: typeof topupghBatchesTable.$inferSelect,
  opts: { gateMode?: DeliveryGateMode } = {},
): Promise<BatchDeliveryCheckResult> {
  const empty: BatchDeliveryCheckResult = { itemCount: 0, delivered: 0, failed: 0, pending: 0, unknown: 0 };
  if (!batch.topupghOrderId) return empty;
  if (_settleInFlight.has(batch.id)) return empty;
  _settleInFlight.add(batch.id);
  try {
    return await settleBatchFromLiveStatus(batch, opts.gateMode ?? "queue");
  } finally {
    _settleInFlight.delete(batch.id);
  }
}

/**
 * Fetch the LIVE per-recipient delivery status for a single dispatched batch, persist it
 * (in the webhook payload shape so the admin delivery columns populate even when a live
 * webhook was missed) and settle the batch's orders. Shared by the background round-robin
 * poller and the admin "Check delivery status" button so both behave identically —
 * settlement always funnels through settleBatchDeliveries. Always invoked through
 * fetchAndSettleBatchDelivery so the per-batch in-flight guard applies.
 *
 * Polls PER-ITEM delivery status — NOT order-level status. TopUpGH's order-level status
 * flips to "completed" on acceptance, long before bundles actually reach customers, so
 * trusting it marked orders delivered prematurely. Real delivery is reported per recipient
 * via GET /orders/{id}/delivery-status, which returns the SAME shape as the webhook:
 *   { success, order: { items: [{ beneficiary_number, delivery_status, processed_date }] } }
 * The per-item word here is "Sent" (the webhook uses "Delivered") — both map to "delivered"
 * via classifyDeliveryStatus. processed_date is a single combined string like
 * "22/Jun/2026, 4:24:29 AM"; split into date + time.
 *
 * Returns itemCount 0 when TopUpGH has no delivery items yet OR the request was rate-limited
 * (1 req/min/key, shared with the poller) — topupghRequest deliberately does not throw on
 * non-2xx, so callers cannot distinguish the two; treat 0 as "nothing to apply yet".
 */
async function settleBatchFromLiveStatus(
  batch: typeof topupghBatchesTable.$inferSelect,
  gateMode: DeliveryGateMode = "queue",
): Promise<BatchDeliveryCheckResult> {
  const empty: BatchDeliveryCheckResult = { itemCount: 0, delivered: 0, failed: 0, pending: 0, unknown: 0 };
  if (!batch.topupghOrderId) return empty;
  const tgOrderId = batch.topupghOrderId;

  // Fetching live status must never hard-fail the caller. topupghRequest already swallows
  // non-2xx (returns {}), but a network error or the 20s timeout still throws — catch it
  // here so the manual admin button (and the poller) degrade gracefully to "no items" and
  // still run the reconciliation/close below instead of surfacing an opaque 502.
  //
  // The call goes through the shared 1-req/min delivery-status gate. In "skip" mode an
  // interactive caller that can't get a slot returns ran:false — we treat that exactly like
  // a rate-limited/empty response: no items to apply, but the reconcile/close below still runs.
  let data: Awaited<ReturnType<typeof topupghGetDeliveryStatus>> | undefined;
  try {
    const slot = await runDeliveryStatusCall(() => topupghGetDeliveryStatus(tgOrderId), gateMode);
    data = slot.ran ? slot.value : undefined;
  } catch (e) {
    logger.warn({ err: e, batchId: batch.id }, "TopUpGH delivery fetch failed — reconciling batch from current order states");
    data = undefined;
  }

  const rawItems = data?.order?.items;
  const items: TopupghWebhookItem[] = Array.isArray(rawItems)
    ? rawItems.map((it) => {
        const processed = typeof it.processed_date === "string" ? it.processed_date : "";
        const commaIdx  = processed.indexOf(", ");
        return {
          item_id:            "",
          beneficiary_number: it.beneficiary_number ?? "",
          network:            "",
          data_size:          0,
          delivery_status:    it.delivery_status ?? "",
          delivery_date:      commaIdx >= 0 ? processed.slice(0, commaIdx) : processed,
          delivery_time:      commaIdx >= 0 ? processed.slice(commaIdx + 2) : "",
        };
      })
    : [];

  if (items.length > 0) {
    // Persist live status (webhook payload shape so the admin delivery columns populate)
    // ONLY when TopUpGH actually returned items — never overwrite recorded delivery data
    // with an empty or failed response.
    const syntheticPayload: TopupghWebhookPayload = {
      event:     "delivery_status_updated",
      timestamp: new Date().toISOString(),
      order: {
        order_id:                batch.topupghOrderId,
        order_number:            "",
        delivery_info:           "",
        delivery_date:           "",
        delivery_time:           "",
        formatted_delivery_info: "",
        items,
      },
    };
    await db.update(topupghBatchesTable)
      .set({ deliveryData: syntheticPayload as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(topupghBatchesTable.id, batch.id));
  }

  // Always settle/reconcile. With items it completes/fails each delivered/failed order; with
  // an empty list it is a no-op per order but still auto-closes the batch when every linked
  // order is already terminal — clearing batches stranded in "processing" after a missed
  // webhook/poll. No profit is credited on an empty list, so this is financially safe.
  await settleBatchDeliveries(
    batch,
    items.map(i => ({ phone: i.beneficiary_number, status: i.delivery_status })),
  );

  const result: BatchDeliveryCheckResult = { ...empty, itemCount: items.length };
  for (const i of items) {
    const o = classifyDeliveryStatus(i.delivery_status);
    if (o === "delivered")      result.delivered++;
    else if (o === "failed")    result.failed++;
    else if (o === "pending")   result.pending++;
    else                        result.unknown++;
  }
  return result;
}

// ─── Admin order-LEVEL reconcile (fallback when per-item delivery-status is empty) ─

/** Result of an order-level reconcile for one batch. */
export interface BatchOrderLevelReconcileResult {
  batchId:        number;
  topupghOrderId: number | null;
  /** TopUpGH order-LEVEL status string (empty when not called / call failed). */
  orderLevelStatus: string;
  /** HTTP status of the order-level call (429 = rate-limited); null when forced (no call). */
  httpStatus:     number | null;
  /** TopUpGH confirmed the order delivered/completed, OR force was used. */
  confirmed:      boolean;
  /** Orders settled by this reconcile (platform + store rows passed to the canonical path). */
  completed:      number;
  /** Final batch status after settling. */
  batchStatus:    string;
  note:           string;
}

/**
 * Admin-gated fallback for batches that TopUpGH's PER-ITEM delivery-status never reports,
 * even though the TopUpGH dashboard shows the order delivered. The poller settles ONLY from
 * per-recipient "Sent/Delivered" items; when that endpoint returns no items, those orders
 * stay "processing" forever.
 *
 * This confirms delivery via TopUpGH's ORDER-LEVEL status (GET /orders/{id}, distinct from
 * the per-item delivery-status endpoint), then completes every still-unsettled order in the
 * batch through the canonical settleBatchDeliveries path — so agent store profit is credited
 * exactly once and the batch auto-closes. settleBatchDeliveries is status-guarded + row-locked,
 * so this is idempotent: already-terminal orders are never re-completed or double-credited.
 *
 * `force` skips the TopUpGH call entirely and settles on the admin's own attestation (used
 * when even order-level status doesn't report, but the admin has verified delivery manually).
 * Order-level status is NOT trusted by the automatic poller — it can flip to "completed" on
 * acceptance before per-recipient delivery — which is why this lives behind an explicit admin
 * action, never the background loop.
 */
export async function reconcileBatchOrderLevel(
  batch: typeof topupghBatchesTable.$inferSelect,
  opts: { force?: boolean } = {},
): Promise<BatchOrderLevelReconcileResult> {
  const force = opts.force ?? false;
  const out: BatchOrderLevelReconcileResult = {
    batchId:          batch.id,
    topupghOrderId:   batch.topupghOrderId,
    orderLevelStatus: "",
    httpStatus:       null,
    confirmed:        false,
    completed:        0,
    batchStatus:      batch.status,
    note:             "",
  };

  if (!batch.topupghOrderId) {
    out.note = "Not dispatched to TopUpGH (no order id) — skipped.";
    return out;
  }

  let confirmed = force;
  if (!force) {
    // Guard the documented premature-acceptance window: TopUpGH order-level status can flip
    // to "completed" on acceptance, before recipients actually receive data. Refuse to trust
    // it for very recently dispatched batches so a transient "completed" can't complete an
    // order whose delivery hasn't really happened yet. Stuck batches needing reconcile are
    // hours old, so this never blocks the real use case.
    const PREMATURE_MS = 10 * 60 * 1000;
    if (batch.dispatchedAt && Date.now() - batch.dispatchedAt.getTime() < PREMATURE_MS) {
      out.note = "Dispatched <10 min ago — order-level status may be premature; retry later or use force.";
      return out;
    }
    try {
      const data = await topupghGetOrderStatus(batch.topupghOrderId);
      const httpStatus = (data as { __httpStatus?: number }).__httpStatus ?? 200;
      out.httpStatus = httpStatus;
      out.orderLevelStatus = data?.order?.status ?? "";
      if (httpStatus === 429) { out.note = "Rate-limited by TopUpGH — retry shortly."; return out; }
      confirmed = classifyDeliveryStatus(out.orderLevelStatus) === "delivered";
    } catch (e) {
      logger.warn({ err: e, batchId: batch.id }, "reconcileBatchOrderLevel: order-status fetch failed");
      out.note = "Order-level status fetch failed — left processing.";
      return out;
    }
  }

  out.confirmed = confirmed;
  if (!confirmed) {
    out.note = out.orderLevelStatus
      ? `TopUpGH order-level status "${out.orderLevelStatus}" is not a delivered state — left processing.`
      : "Not confirmed delivered — left processing.";
    return out;
  }

  // Serialize with the poller / manual "check delivery" via the same per-batch in-flight
  // guard, so reconcile and a concurrent live settle can never apply to the same batch at
  // once (settlement matches items to "next unsettled row" by phone — concurrent runs could
  // otherwise race). Concurrent caller backs off; the admin can re-run.
  if (_settleInFlight.has(batch.id)) {
    out.confirmed = false;
    out.note = "Batch settle already in progress — retry shortly.";
    return out;
  }
  _settleInFlight.add(batch.id);
  try {
    // Confirmed (or forced): settle every still-unsettled order in the batch through the
    // canonical path. One synthesized "delivered" item per still-open order (by phone) so
    // settleBatchDeliveries settles each next-unsettled row and credits store profit once.
    const [pOrders, sOrders] = await Promise.all([
      db.select({ phone: ordersTable.phoneNumber }).from(ordersTable)
        .where(and(
          eq(ordersTable.topupghBatchId, batch.id),
          inArray(ordersTable.status, ["pending", "processing"]),
        )),
      db.select({ phone: storeOrdersTable.customerPhone }).from(storeOrdersTable)
        .where(and(
          eq(storeOrdersTable.topupghBatchId, batch.id),
          inArray(storeOrdersTable.status, ["paid", "processing"]),
        )),
    ]);

    const items = [...pOrders, ...sOrders].map((o) => ({ phone: o.phone, status: "delivered" }));
    await settleBatchDeliveries(batch, items);
    out.completed = items.length;
  } finally {
    _settleInFlight.delete(batch.id);
  }

  const [fresh] = await db.select({ status: topupghBatchesTable.status })
    .from(topupghBatchesTable).where(eq(topupghBatchesTable.id, batch.id));
  out.batchStatus = fresh?.status ?? batch.status;
  out.note = force
    ? "Force-completed on admin attestation."
    : `Completed — TopUpGH order-level status "${out.orderLevelStatus}".`;
  return out;
}

// ─── Webhook payload types ────────────────────────────────────────────────────

export interface TopupghWebhookItem {
  item_id:           string;
  beneficiary_number: string;
  network:           string;
  data_size:         number;
  delivery_status:   string;
  delivery_date:     string;
  delivery_time:     string;
}

export interface TopupghWebhookPayload {
  event:     string;
  timestamp: string;
  order: {
    order_id:                number;
    order_number:            string;
    delivery_info:           string;
    delivery_date:           string;
    delivery_time:           string;
    formatted_delivery_info: string;
    items:                   TopupghWebhookItem[];
  };
}

export interface OrderDeliveryInfo {
  status: string;
  date:   string;
  time:   string;
  /** True when the same phone has multiple, conflicting delivery items in one batch. */
  ambiguous?: boolean;
}

/**
 * Build a phone-number → delivery-info map from a stored TopUpGH webhook payload
 * (the `delivery_data` jsonb on a batch). Beneficiary numbers are stored exactly
 * as TopUpGH sends them, which matches `orders.phone_number`, so callers can look
 * up by the order's phone directly. Returns an empty map for missing/malformed data.
 *
 * A single batch can contain more than one item for the same phone (e.g. a customer
 * buys two bundles to the same number). We have no per-order TopUpGH item id to
 * correlate them, so when same-phone items carry CONFLICTING delivery outcomes we
 * mark the entry `ambiguous` instead of silently picking one (which could attach the
 * wrong date/time/status to an order). Identical duplicates collapse harmlessly.
 */
export function extractDeliveryInfo(deliveryData: unknown): Map<string, OrderDeliveryInfo> {
  const map = new Map<string, OrderDeliveryInfo>();
  if (!deliveryData || typeof deliveryData !== "object") return map;
  const items = (deliveryData as Partial<TopupghWebhookPayload>).order?.items;
  if (!Array.isArray(items)) return map;
  for (const item of items) {
    if (!item?.beneficiary_number) continue;
    const phone = item.beneficiary_number;
    const info: OrderDeliveryInfo = {
      status: item.delivery_status ?? "",
      date:   item.delivery_date ?? "",
      time:   item.delivery_time ?? "",
    };
    const existing = map.get(phone);
    if (!existing) {
      map.set(phone, info);
    } else if (
      !existing.ambiguous &&
      (existing.status !== info.status || existing.date !== info.date || existing.time !== info.time)
    ) {
      map.set(phone, { status: "multiple", date: "", time: "", ambiguous: true });
    }
  }
  return map;
}

// ─── Per-order live delivery check (powers the "Check delivery status" buttons) ─

/** Throttle map: batchId → last live-check epoch ms. Guards the shared TopUpGH budget. */
const _orderCheckCooldown = new Map<number, number>();

export interface OrderDeliveryCheckResult {
  /** "not_dispatched": no batch yet. "cooldown": served cache, no live call. "checked": live call ran. */
  state: "not_dispatched" | "cooldown" | "checked";
  summary: BatchDeliveryCheckResult | null;
  delivery: OrderDeliveryInfo | null;
  orderStatus: string;
}

/**
 * Live "check delivery status" for a SINGLE order. Resolves the order's batch, runs the
 * SAME authenticated re-fetch + settle path as the poller (fetchAndSettleBatchDelivery —
 * never trusts client input), then returns the per-recipient delivery info for this order's
 * phone plus its freshest status.
 *
 * Safe to expose to end users: settlement is idempotent + status-guarded (can never
 * double-credit or prematurely complete), and `cooldownMs` makes repeat clicks within the
 * window serve the cached delivery_data WITHOUT spending the shared TopUpGH 1-req/min budget
 * (which the background poller also depends on). Pass cooldownMs:0 for trusted admins.
 */
export async function checkOrderDeliveryLive(
  order: { id: number; phoneNumber: string; status: string; topupghBatchId: number | null },
  opts: { cooldownMs?: number } = {},
): Promise<OrderDeliveryCheckResult> {
  const cooldownMs = opts.cooldownMs ?? 0;

  if (!order.topupghBatchId) {
    return { state: "not_dispatched", summary: null, delivery: null, orderStatus: order.status };
  }

  const [batch] = await db.select().from(topupghBatchesTable)
    .where(eq(topupghBatchesTable.id, order.topupghBatchId));
  if (!batch || !batch.topupghOrderId) {
    return { state: "not_dispatched", summary: null, delivery: null, orderStatus: order.status };
  }

  let summary: BatchDeliveryCheckResult | null = null;
  let state: OrderDeliveryCheckResult["state"] = "checked";

  const now = Date.now();
  const last = _orderCheckCooldown.get(batch.id) ?? 0;
  if (cooldownMs > 0 && now - last < cooldownMs) {
    state = "cooldown"; // serve cached delivery_data; do not spend the shared TopUpGH budget
  } else {
    _orderCheckCooldown.set(batch.id, now);
    // Interactive caller: use the "skip" gate so a busy 1-req/min budget never makes the
    // button hang for up to a minute. On skip it returns no items and we serve the freshest
    // stored delivery_data below; the background poller settles it within the next cycle.
    summary = await fetchAndSettleBatchDelivery(batch, { gateMode: "skip" }); // idempotent, status-guarded, in-flight guarded
  }

  // Re-read the freshest persisted delivery payload + order status after any settle.
  const [freshBatch] = await db.select({ deliveryData: topupghBatchesTable.deliveryData })
    .from(topupghBatchesTable).where(eq(topupghBatchesTable.id, batch.id));
  const [freshOrder] = await db.select({ status: ordersTable.status })
    .from(ordersTable).where(eq(ordersTable.id, order.id));

  const delivery = extractDeliveryInfo(freshBatch?.deliveryData).get(order.phoneNumber) ?? null;
  return { state, summary, delivery, orderStatus: freshOrder?.status ?? order.status };
}

/**
 * Verify the X-Webhook-Signature header from TopUpGH.
 * The exact signing scheme is unconfirmed, so we accept several HMAC-SHA256 encodings
 * (hex, sha256=-prefixed hex, base64, and x-timestamp variants), all derived from the
 * shared secret. Uses TOPUPGH_WEBHOOK_SECRET if set, else the API secret.
 */
function getWebhookSecret(): string {
  // TopUpGH may sign webhooks with a dedicated secret shown on the webhook config
  // page rather than the API secret. Prefer it if provided, else fall back to apiSecret.
  return process.env.TOPUPGH_WEBHOOK_SECRET || getCredentials().apiSecret || "";
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// Common HMAC-SHA256 encodings/wrappings a provider might use for a webhook signature.
// All are derived from the secret, so accepting several encodings does not weaken
// verification — a forger without the secret can produce none of them.
function webhookSignatureCandidates(secret: string, rawBody: Buffer, timestamp?: string): Record<string, string> {
  const hex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const b64 = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const out: Record<string, string> = { hex, hexPrefixed: `sha256=${hex}`, base64: b64 };
  if (timestamp) {
    out.tsDotHex = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString()}`).digest("hex");
    out.tsCatHex = crypto.createHmac("sha256", secret).update(`${timestamp}${rawBody.toString()}`).digest("hex");
  }
  return out;
}

export function verifyTopupghWebhookSignature(signature: string, rawBody: Buffer, timestamp?: string): boolean {
  const secret = getWebhookSecret();
  if (!secret) return false;
  const candidates = webhookSignatureCandidates(secret, rawBody, timestamp);
  return Object.values(candidates).some((c) => safeEqual(signature, c));
}

/**
 * TEMPORARY DIAGNOSTIC: returns which candidate scheme (if any) matches the received
 * signature, so a single real webhook log reveals TopUpGH's exact signing scheme.
 * Never logs the secret. Remove once the scheme is confirmed.
 */
export function diagnoseTopupghWebhookSignature(
  signature: string,
  rawBody: Buffer,
  timestamp?: string,
): Record<string, unknown> {
  const secret = getWebhookSecret();
  if (!secret) return { hasSecret: false };
  const usingDedicated = !!process.env.TOPUPGH_WEBHOOK_SECRET;
  const candidates = webhookSignatureCandidates(secret, rawBody, timestamp);
  const matches: Record<string, boolean> = {};
  for (const [name, c] of Object.entries(candidates)) matches[name] = safeEqual(signature, c);
  return {
    hasSecret: true,
    usingDedicatedWebhookSecret: usingDedicated,
    hasTimestamp: !!timestamp,
    receivedLen: signature.length,
    receivedSample: signature.slice(0, 14),
    rawBodyLen: rawBody.length,
    matches,
    anyMatch: Object.values(matches).some(Boolean),
  };
}

export type DeliveryOutcome = "delivered" | "failed" | "pending" | "unknown";

/**
 * Classify a raw TopUpGH per-recipient delivery_status string into a settlement
 * outcome. TopUpGH reports the SAME outcome with different wordings/casings across
 * its dashboard, webhook, and delivery-status endpoint — e.g. a successful delivery
 * may arrive as "Delivered", "Sent", "Completed", or "Success". Matching only the
 * literal "delivered" left those orders stuck at "processing". We match a known set
 * of terms instead; anything non-terminal stays "pending" (order kept processing),
 * and any unrecognized non-empty value is "unknown" so the caller can log it.
 */
export function classifyDeliveryStatus(raw: string): DeliveryOutcome {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "pending";

  const DELIVERED = new Set([
    "delivered", "sent", "completed", "complete", "success",
    "successful", "delivery successful", "delivered successfully",
  ]);
  const FAILED = new Set([
    "failed", "failure", "not delivered", "undelivered", "unsuccessful",
    "rejected", "reversed", "refunded", "cancelled", "canceled", "delivery failed",
  ]);
  const PENDING = new Set([
    "pending", "processing", "in progress", "in-progress",
    "queued", "submitted", "accepted", "received",
  ]);

  if (DELIVERED.has(s)) return "delivered";
  if (FAILED.has(s))    return "failed";
  if (PENDING.has(s))   return "pending";
  return "unknown";
}

/**
 * Apply per-recipient delivery outcomes to a batch's orders, then finalize the batch.
 * Handles both platform orders and agent store orders linked to the same batch:
 *   - delivered → order completed. For store orders this also credits the agent's
 *     profit to their store balance (mirrors the admin "complete" action).
 *   - failed/not-delivered → order failed. No wallet refund and no customer refund —
 *     a failed delivery is left for an admin to handle manually.
 * Pending/unknown items are left untouched so the order stays "processing" until
 * TopUpGH actually delivers.
 *
 * This is the ONLY place an order is marked delivered. Both the live webhook and the
 * fallback poller funnel through here, so completion always reflects real per-recipient
 * delivery — never TopUpGH's order-level "accepted" status. The status guard makes it
 * idempotent: an order already in a terminal state is never re-processed or double-credited.
 */
async function settleBatchDeliveries(
  batch: typeof topupghBatchesTable.$inferSelect,
  items: Array<{ phone: string; status: string }>,
): Promise<void> {
  for (const item of items) {
    const outcome   = classifyDeliveryStatus(item.status);
    const delivered = outcome === "delivered";
    const failed    = outcome === "failed";

    if (outcome === "unknown") {
      logger.warn(
        { batchId: batch.id, phone: item.phone, status: item.status },
        "TopUpGH: unrecognized delivery status — order left processing",
      );
    }
    if (!delivered && !failed) continue;

    // Filter to non-terminal rows only. A batch can hold several platform orders to
    // the SAME phone (one delivery item each); selecting without this filter would keep
    // re-picking the first already-settled row and strand its siblings in "processing".
    // Each delivered/failed item settles the next unsettled order for that phone.
    const [orderRow] = await db.select()
      .from(ordersTable)
      .where(and(
        eq(ordersTable.topupghBatchId, batch.id),
        eq(ordersTable.phoneNumber, item.phone),
        inArray(ordersTable.status, ["pending", "processing"]),
      ))
      .limit(1);

    if (!orderRow) continue;

    // Mark the order completed or failed. No wallet refund on failure — a failed
    // delivery is left for an admin to handle manually. The status guard makes the
    // write authoritative for terminal states: if an admin bulk-refund committed
    // between the SELECT above and here (flipping the row to failed+refunded), this
    // UPDATE matches nothing and cannot resurrect it to completed — no refund+delivery.
    await db.update(ordersTable)
      .set({ status: delivered ? "completed" : "failed" })
      .where(and(
        eq(ordersTable.id, orderRow.id),
        inArray(ordersTable.status, ["pending", "processing"]),
      ));

    if (failed) {
      logger.info({ orderId: orderRow.id, phone: item.phone }, "TopUpGH delivery failed — order marked failed (no auto-refund)");
    }
  }

  // Settle agent store orders linked to this batch. On delivery, completing a store
  // order also credits the agent's profit — done in a row-locked transaction so the
  // status guard keeps it idempotent (never double-credits). Failed → marked failed,
  // no refund (admin handles), mirroring platform orders.
  for (const item of items) {
    const outcome   = classifyDeliveryStatus(item.status);
    const delivered = outcome === "delivered";
    const failed    = outcome === "failed";

    if (!delivered && !failed) continue;

    await db.transaction(async (tx) => {
      const [storeOrder] = await tx.select()
        .from(storeOrdersTable)
        .where(and(
          eq(storeOrdersTable.topupghBatchId, batch.id),
          eq(storeOrdersTable.customerPhone, item.phone),
          inArray(storeOrdersTable.status, ["paid", "processing"]),
        ))
        .for("update");

      if (!storeOrder) return;

      if (delivered) {
        await tx.update(storeOrdersTable)
          .set({ status: "completed" })
          .where(eq(storeOrdersTable.id, storeOrder.id));
        const profit = parseFloat(storeOrder.profit);
        await tx.update(storesTable)
          .set({ profitBalance: sql`profit_balance + ${profit.toFixed(2)}::numeric` })
          .where(eq(storesTable.id, storeOrder.storeId));
      } else {
        await tx.update(storeOrdersTable)
          .set({ status: "failed" })
          .where(eq(storeOrdersTable.id, storeOrder.id));
        logger.info({ storeOrderId: storeOrder.id, phone: item.phone }, "TopUpGH delivery failed — store order marked failed (no auto-refund)");
      }
    });
  }

  // Auto-close batch when all orders (platform + store) are settled
  const batchOrders = await db.select({ status: ordersTable.status })
    .from(ordersTable)
    .where(eq(ordersTable.topupghBatchId, batch.id));
  const batchStoreOrders = await db.select({ status: storeOrdersTable.status })
    .from(storeOrdersTable)
    .where(eq(storeOrdersTable.topupghBatchId, batch.id));
  const allStatuses = [...batchOrders.map(o => o.status), ...batchStoreOrders.map(o => o.status)];

  const isSettled  = (s: string) => s === "completed" || s === "failed" || s === "cancelled";
  const allSettled = allStatuses.every(isSettled);
  if (allSettled && batch.status === "processing") {
    const allFailed = allStatuses.every(s => s === "failed");
    const anyFailed = allStatuses.some(s => s === "failed");
    const finalStatus = allFailed ? "failed" : anyFailed ? "partial" : "completed";
    await db.update(topupghBatchesTable)
      .set({ status: finalStatus })
      .where(eq(topupghBatchesTable.id, batch.id));
  }
}

interface NormalizedWebhookItem { phone: string; status: string; date: string; time: string; }

/** Pull date + time out of either a combined `processed_date` ("22/Jun/2026, 4:24:29 AM")
 *  or split `delivery_date`/`delivery_time` fields on a webhook item. */
function splitWebhookProcessed(o: Record<string, unknown>): { date: string; time: string } {
  const d = typeof o.delivery_date === "string" ? o.delivery_date : "";
  const t = typeof o.delivery_time === "string" ? o.delivery_time : "";
  if (d || t) return { date: d, time: t };
  const processed = typeof o.processed_date === "string" ? o.processed_date : "";
  const comma = processed.indexOf(", ");
  return comma >= 0
    ? { date: processed.slice(0, comma), time: processed.slice(comma + 2) }
    : { date: processed, time: "" };
}

/** Normalize a webhook body into per-recipient {phone,status,date,time} items, tolerating
 *  both the nested ({order:{items:[...]}}) and flat (single recipient) callback shapes. */
function normalizeWebhookItems(p: Record<string, unknown>): NormalizedWebhookItem[] {
  const nestedOrder = p.order && typeof p.order === "object" ? (p.order as Record<string, unknown>) : undefined;
  const rawItems = nestedOrder?.items;
  if (Array.isArray(rawItems)) {
    const out: NormalizedWebhookItem[] = [];
    for (const it of rawItems) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      const phone =
        typeof o.beneficiary_number === "string" ? o.beneficiary_number
        : typeof o.recipient === "string" ? o.recipient : "";
      const status =
        typeof o.delivery_status === "string" ? o.delivery_status
        : typeof o.status === "string" ? o.status : "";
      if (!phone || !status) continue;
      out.push({ phone, status, ...splitWebhookProcessed(o) });
    }
    return out;
  }
  // Flat single-recipient shape.
  const phone =
    typeof p.recipient === "string" ? p.recipient
    : typeof p.beneficiary_number === "string" ? p.beneficiary_number : "";
  const status =
    typeof p.status === "string" ? p.status
    : typeof p.delivery_status === "string" ? p.delivery_status : "";
  if (phone && status) return [{ phone, status, ...splitWebhookProcessed(p) }];
  return [];
}

interface VerifiedSettleResult {
  /** true → the webhook is fully handled; caller must NOT fall back to a re-fetch. */
  handled: boolean;
  settled: boolean;
  itemCount: number;
  mode: "full" | "partial" | "busy" | "ambiguous" | "empty";
}

/**
 * Settle a batch DIRECTLY from a signature-verified webhook body — no outbound re-fetch.
 * Only called after verifyTopupghWebhookSignature passed, so the body's integrity is trusted.
 *
 * Even with a trusted body we refuse to settle an AMBIGUOUS payload, because
 * settleBatchDeliveries settles "the next unsettled order for this phone": a partial
 * callback naming a phone that holds 2+ orders in the batch could prematurely complete a
 * sibling. We therefore direct-settle only when:
 *   • full snapshot  — items.length === total linked orders (platform + store) in the batch
 *                      (status guards keep a replay or mixed pending/delivered safe), OR
 *   • partial unique — every item's phone maps to exactly ONE linked order and no phone is
 *                      repeated in the payload, so each item resolves to a unique order.
 * Anything else returns handled:false so the caller falls back to the re-fetch trigger.
 *
 * deliveryData is persisted only for a full snapshot, so a partial body never overwrites
 * richer recorded delivery data. settleBatchDeliveries is idempotent + status-guarded and
 * runs here under the shared _settleInFlight guard to avoid racing the poller/reconcile.
 */
async function settleBatchFromVerifiedWebhookPayload(
  batch: typeof topupghBatchesTable.$inferSelect,
  p: Record<string, unknown>,
): Promise<VerifiedSettleResult> {
  const items = normalizeWebhookItems(p);
  if (items.length === 0) return { handled: false, settled: false, itemCount: 0, mode: "empty" };

  // Refuse to settle when a phone appears with CONFLICTING outcomes. settleBatchDeliveries
  // settles "the next unsettled order for this phone", so two siblings to the same phone that
  // ended differently (e.g. one delivered + one failed) could be mapped to the wrong order —
  // completing/crediting the order that actually failed and failing the one that delivered.
  // There is no per-order id to disambiguate, so we hand these to a human (fallback re-fetch
  // / admin reconcile) instead of guessing. Same-phone siblings that share ONE outcome (all
  // delivered, or all failed) are symmetric and safe.
  const outcomesByPhone = new Map<string, Set<DeliveryOutcome>>();
  for (const it of items) {
    const set = outcomesByPhone.get(it.phone) ?? new Set<DeliveryOutcome>();
    set.add(classifyDeliveryStatus(it.status));
    outcomesByPhone.set(it.phone, set);
  }
  for (const [, set] of outcomesByPhone) {
    if (set.size > 1) return { handled: false, settled: false, itemCount: items.length, mode: "ambiguous" };
  }

  // Count every order linked to this batch (any status), per phone — platform + store.
  const [pRows, sRows] = await Promise.all([
    db.select({ phone: ordersTable.phoneNumber }).from(ordersTable)
      .where(eq(ordersTable.topupghBatchId, batch.id)),
    db.select({ phone: storeOrdersTable.customerPhone }).from(storeOrdersTable)
      .where(eq(storeOrdersTable.topupghBatchId, batch.id)),
  ]);
  const totalLinked = pRows.length + sRows.length;
  const phoneCounts = new Map<string, number>();
  for (const r of [...pRows, ...sRows]) phoneCounts.set(r.phone, (phoneCounts.get(r.phone) ?? 0) + 1);

  // Per-phone webhook tally, used to require an EXACT multiset match in full mode (below).
  const webhookCounts = new Map<string, number>();
  for (const it of items) webhookCounts.set(it.phone, (webhookCounts.get(it.phone) ?? 0) + 1);

  // Full mode demands the webhook's phone multiset equal the linked-orders' phone multiset
  // EXACTLY (same phones, same per-phone counts). settleBatchDeliveries settles "next
  // unsettled order for phone" independently in the platform and store loops, so a merely
  // count-equal but phone-skewed snapshot (e.g. one delivered item for a phone that has both
  // a platform and a store order, padded by an unrelated phone) would let that single item
  // settle BOTH the platform and store order off ONE real delivery. Requiring an exact
  // per-phone match makes each loop consume exactly as many orders as there are deliveries.
  const phonesMatchExactly =
    webhookCounts.size === phoneCounts.size &&
    [...phoneCounts].every(([phone, c]) => webhookCounts.get(phone) === c);

  let mode: "full" | "partial";
  if (totalLinked > 0 && items.length === totalLinked && phonesMatchExactly) {
    mode = "full";
  } else {
    const seen = new Set<string>();
    for (const it of items) {
      if ((phoneCounts.get(it.phone) ?? 0) !== 1 || seen.has(it.phone)) {
        return { handled: false, settled: false, itemCount: items.length, mode: "ambiguous" };
      }
      seen.add(it.phone);
    }
    mode = "partial";
  }

  // Someone (poller / reconcile / another callback) is already settling this batch — skip
  // rather than race. Report handled so we don't stack a redundant re-fetch on top.
  if (_settleInFlight.has(batch.id)) {
    return { handled: true, settled: false, itemCount: items.length, mode: "busy" };
  }
  _settleInFlight.add(batch.id);
  try {
    if (mode === "full") {
      // Persist the trusted snapshot in the webhook payload shape so the admin delivery
      // columns populate (mirrors settleBatchFromLiveStatus).
      const syntheticPayload: TopupghWebhookPayload = {
        event:     "delivery_status_updated",
        timestamp: new Date().toISOString(),
        order: {
          order_id:                batch.topupghOrderId ?? 0,
          order_number:            "",
          delivery_info:           "",
          delivery_date:           "",
          delivery_time:           "",
          formatted_delivery_info: "",
          items: items.map(i => ({
            item_id:            "",
            beneficiary_number: i.phone,
            network:            "",
            data_size:          0,
            delivery_status:    i.status,
            delivery_date:      i.date,
            delivery_time:      i.time,
          })),
        },
      };
      await db.update(topupghBatchesTable)
        .set({ deliveryData: syntheticPayload as unknown as Record<string, unknown>, updatedAt: new Date() })
        .where(eq(topupghBatchesTable.id, batch.id));
    }
    await settleBatchDeliveries(batch, items.map(i => ({ phone: i.phone, status: i.status })));
    return { handled: true, settled: true, itemCount: items.length, mode };
  } finally {
    _settleInFlight.delete(batch.id);
  }
}

/**
 * Handle a delivery_status_updated webhook from TopUpGH.
 *
 * Two paths, chosen by the route's HMAC check (passed in as opts.verified):
 *   • verified  → settle DIRECTLY from the trusted body via
 *     settleBatchFromVerifiedWebhookPayload (no outbound call). This is the only settle
 *     path that works while our egress to TopUpGH is blocked, because the re-fetch below
 *     hits the same unreachable delivery-status endpoint. Only a full/unambiguous snapshot
 *     is trusted; settlement is idempotent + status-guarded so a replay can't double-credit.
 *   • unverified or ambiguous → use the body purely as a TRIGGER: look up the batch by the
 *     reported order_id and re-fetch the AUTHENTICATED delivery-status, settling from that
 *     verified response. A forged webhook fails the HMAC check and can at most cause an
 *     idempotent, rate-limited re-check of our own data.
 */
// Pull a positive-integer order_id out of either documented webhook shape, tolerating a
// numeric string. Returns undefined for anything that can't be a real order_id.
function coerceWebhookOrderId(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

export async function handleTopupghWebhook(
  payload: unknown,
  opts: { verified?: boolean } = {},
): Promise<void> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;

  // Accept BOTH documented callback shapes:
  //   • nested: { event:"delivery_status_updated", order:{ order_id, items:[...] } }
  //   • flat:   { order_id, status, network, recipient, data_size, updated_at }
  // The nested shape carries an `event`; when one is present, only act on delivery-status
  // events so other event types don't burn rate-gate slots. The flat shape has no `event`
  // and is itself a delivery callback, so it is allowed through.
  const event = typeof p.event === "string" ? p.event : undefined;
  if (event !== undefined && event !== "delivery_status_updated") return;

  // order_id may live under `order` (nested) or at the top level (flat).
  const nestedOrder = p.order && typeof p.order === "object" ? (p.order as Record<string, unknown>) : undefined;
  const orderId = coerceWebhookOrderId(nestedOrder?.order_id) ?? coerceWebhookOrderId(p.order_id);
  if (orderId === undefined) {
    logger.warn({ payloadKeys: Object.keys(p).slice(0, 12) }, "TopUpGH webhook: no usable order_id in payload — ignoring");
    return;
  }

  const [batch] = await db.select().from(topupghBatchesTable)
    .where(eq(topupghBatchesTable.topupghOrderId, orderId));

  if (!batch) {
    logger.warn({ topupghOrderId: orderId }, "TopUpGH webhook: no batch for order_id — ignoring");
    return;
  }

  // When the signature is verified we trust the body and settle from it directly — the ONLY
  // settle path that works while our egress to TopUpGH is blocked, since the re-fetch below
  // hits the same unreachable delivery-status endpoint. Only a full/unambiguous snapshot is
  // trusted; anything else falls through to the re-fetch trigger.
  if (opts.verified) {
    const r = await settleBatchFromVerifiedWebhookPayload(batch, p);
    if (r.handled) {
      logger.info(
        { batchId: batch.id, topupghOrderId: orderId, settled: r.settled, items: r.itemCount, mode: r.mode },
        "TopUpGH webhook: handled from verified payload",
      );
      return;
    }
    logger.info(
      { batchId: batch.id, topupghOrderId: orderId, mode: r.mode },
      "TopUpGH webhook: verified but payload not safely settleable — falling back to re-fetch",
    );
  }

  // Unverified or ambiguous: use the body only as a TRIGGER and settle from the
  // AUTHENTICATED delivery-status re-fetch. The route has already acked 200, so this drains
  // through the shared rate gate ("queue"): a webhook burst across many batches drains at
  // 1/min instead of firing every re-fetch at once and tripping TopUpGH's limit.
  await fetchAndSettleBatchDelivery(batch, { gateMode: "queue" });
}

// ─── Background poller ────────────────────────────────────────────────────────

let _pollerStarted = false;
let _pollRunning   = false;
const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

export function startTopupghPoller(): void {
  if (_pollerStarted) return;
  _pollerStarted = true;

  const poll = async () => {
    if (_pollRunning) return;
    _pollRunning = true;
    try {
      // Requeue any orders pinned to a stuck/failed batch before dispatching, so
      // stranded orders recover within minutes instead of waiting for a restart.
      await recoverStuckTopupghBatches();

      const { enabled, apiKey, apiSecret } = await getTopupghSettings();

      // Always check in-flight batches even when disabled — protects orders already
      // sent to TopUpGH before the switch, in case a webhook was missed.
      if (apiKey && apiSecret) {
        await checkProcessingBatches();
      }

      if (!enabled || !apiKey || !apiSecret) return;

      // Backup nudge only. Normal dispatch is instant — fired the moment an MTN
      // order is placed (triggerTopupghDispatch wired into dispatchOrder). This
      // catches anything that accumulated below min_batch or was missed, and
      // shares the same serialized, rate-limit-aware runner so it can never fire
      // a create-order call back-to-back with an instant dispatch.
      triggerTopupghDispatch();

    } catch (e) {
      logger.error({ err: e }, "TopUpGH poller error");
    } finally {
      _pollRunning = false;
    }
  };

  // Start after 15 s (let server warm up), then every 2 min
  setTimeout(() => {
    poll();
    setInterval(poll, POLL_INTERVAL_MS);
  }, 15_000);
}
