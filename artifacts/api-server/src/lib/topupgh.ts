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
import { db, settingsTable, ordersTable, bundlesTable, topupghBatchesTable, storeOrdersTable, storesTable } from "@workspace/db";
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
  const signatureString = timestamp + method + TOPUPGH_INTERNAL_PREFIX + endpoint + body;
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
    try { return JSON.parse(txt) as T; } catch { return {} as T; }
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

/**
 * Collect pending MTN orders and dispatch as a batch to TopUpGH.
 * forceDispatch=true bypasses the minBatch check (admin manual trigger).
 */
export async function dispatchPendingQueue(forceDispatch = false): Promise<DispatchResult> {
  const { enabled, minBatch, maxBatch, apiKey, apiSecret } = await getTopupghSettings();

  if (!enabled)              return { batchId: null, dispatched: false, reason: "disabled",        ordersCount: 0 };
  if (!apiKey || !apiSecret) return { batchId: null, dispatched: false, reason: "not_configured",  ordersCount: 0 };

  const GRACE_MS       = 30_000;
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

  // Release both tables from this batch (used on every abort path)
  const unlinkAll = async () => {
    await db.update(ordersTable).set({ topupghBatchId: null }).where(eq(ordersTable.topupghBatchId, batch.id));
    await db.update(storeOrdersTable).set({ topupghBatchId: null }).where(eq(storeOrdersTable.topupghBatchId, batch.id));
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

  // Pre-flight balance check
  try {
    const balanceData = await topupghGetBalance();
    const totalCost   = [...linked, ...linkedStore].reduce((s, o) => s + parseFloat(o.price), 0);
    if (balanceData.balance < totalCost) {
      await unlinkAll();
      await db.update(topupghBatchesTable)
        .set({ status: "failed", errorMessage: `Insufficient TopUpGH wallet balance (GH₵${balanceData.balance.toFixed(2)} available)` })
        .where(eq(topupghBatchesTable.id, batch.id));
      return { batchId: batch.id, dispatched: false, reason: "insufficient_balance", ordersCount: linkedCount };
    }
  } catch { /* balance check failed — proceed anyway */ }

  // Build payload (platform + store orders share one MTN batch)
  const orderItems: TopupghOrderItem[] = [...linked, ...linkedStore].map(o => ({
    _beneficiary_number: o.phone,
    network:             "mtn" as const,
    _data_size:          parseGb(o.bundleData),
  }));

  try {
    const result = await topupghCreateOrder(orderItems);

    if (!result.success) {
      await unlinkAll();
      await db.update(topupghBatchesTable)
        .set({ status: "failed", errorMessage: result.message ?? "TopUpGH rejected the order" })
        .where(eq(topupghBatchesTable.id, batch.id));
      return { batchId: batch.id, dispatched: false, reason: "api_error", ordersCount: linkedCount };
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
    await unlinkAll();
    await db.update(topupghBatchesTable)
      .set({ status: "failed", errorMessage: `Dispatch exception: ${msg}` })
      .where(eq(topupghBatchesTable.id, batch.id));
    return { batchId: batch.id, dispatched: false, reason: "exception", ordersCount: linkedCount };
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
    await fetchAndSettleBatchDelivery(batch);
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
): Promise<BatchDeliveryCheckResult> {
  const empty: BatchDeliveryCheckResult = { itemCount: 0, delivered: 0, failed: 0, pending: 0, unknown: 0 };
  if (!batch.topupghOrderId) return empty;
  if (_settleInFlight.has(batch.id)) return empty;
  _settleInFlight.add(batch.id);
  try {
    return await settleBatchFromLiveStatus(batch);
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
): Promise<BatchDeliveryCheckResult> {
  const empty: BatchDeliveryCheckResult = { itemCount: 0, delivered: 0, failed: 0, pending: 0, unknown: 0 };
  if (!batch.topupghOrderId) return empty;

  // Fetching live status must never hard-fail the caller. topupghRequest already swallows
  // non-2xx (returns {}), but a network error or the 20s timeout still throws — catch it
  // here so the manual admin button (and the poller) degrade gracefully to "no items" and
  // still run the reconciliation/close below instead of surfacing an opaque 502.
  let data: Awaited<ReturnType<typeof topupghGetDeliveryStatus>> | undefined;
  try {
    data = await topupghGetDeliveryStatus(batch.topupghOrderId);
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
    // delivery is left for an admin to handle manually.
    await db.update(ordersTable)
      .set({ status: delivered ? "completed" : "failed" })
      .where(eq(ordersTable.id, orderRow.id));

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

/**
 * Process a delivery_status_updated webhook from TopUpGH.
 * Marks individual platform and store orders completed or failed via
 * settleBatchDeliveries. No auto-refunds — failed deliveries are left to an admin.
 */
export async function handleTopupghWebhook(payload: TopupghWebhookPayload): Promise<void> {
  if (payload.event !== "delivery_status_updated") return;

  const { order } = payload;

  const [batch] = await db.select().from(topupghBatchesTable)
    .where(eq(topupghBatchesTable.topupghOrderId, order.order_id));

  if (!batch) {
    logger.warn({ topupghOrderId: order.order_id }, "TopUpGH webhook: batch not found");
    return;
  }

  // Store latest webhook payload on batch (powers the admin delivery columns)
  await db.update(topupghBatchesTable)
    .set({ deliveryData: payload as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(topupghBatchesTable.id, batch.id));

  await settleBatchDeliveries(
    batch,
    order.items.map(i => ({ phone: i.beneficiary_number, status: i.delivery_status })),
  );
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

      // Drain the pending queue — dispatch sequential sub-batches until empty or below minBatch
      let batchesDispatched = 0;
      while (true) {
        const result = await dispatchPendingQueue();
        if (result.dispatched) {
          batchesDispatched++;
          logger.info(
            { batchId: result.batchId, ordersCount: result.ordersCount, topupghOrderId: result.topupghOrderId, batchNumber: batchesDispatched },
            "TopUpGH batch dispatched",
          );
          // Continue loop — there may be more pending orders to drain
        } else {
          if (result.reason !== "empty_queue" && result.reason !== "below_minimum" && result.reason !== "disabled" && result.reason !== "not_configured") {
            logger.warn({ reason: result.reason, ordersCount: result.ordersCount }, "TopUpGH dispatch stopped");
          }
          break;
        }
      }

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
