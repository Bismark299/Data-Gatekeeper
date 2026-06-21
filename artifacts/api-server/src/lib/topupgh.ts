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
import { eq, and, isNull, isNotNull, lt, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, settingsTable, ordersTable, bundlesTable, topupghBatchesTable, walletsTable, walletLedgerTable } from "@workspace/db";
import { logger } from "./logger";

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
  return res.json() as Promise<T>;
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
  success: boolean; order_id: number; delivery_status: Record<string, unknown>;
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

  const count = pendingOrders.length;
  if (count === 0)                            return { batchId: null, dispatched: false, reason: "empty_queue",    ordersCount: 0 };
  if (!forceDispatch && count < minBatch)     return { batchId: null, dispatched: false, reason: "below_minimum", ordersCount: count };

  const valid = pendingOrders.filter(o => parseGb(o.bundleData) > 0 && o.network === "mtn");
  if (valid.length === 0)                     return { batchId: null, dispatched: false, reason: "no_valid_orders", ordersCount: 0 };

  // Create batch record (optimistic lock)
  const [batch] = await db.insert(topupghBatchesTable).values({
    status:    "pending",
    network:   "mtn",
    itemCount: valid.length,
  }).returning();

  // Atomically link orders to this batch
  const orderIds = valid.map(o => o.id);
  await db.update(ordersTable)
    .set({ topupghBatchId: batch.id })
    .where(and(
      inArray(ordersTable.id, orderIds),
      isNull(ordersTable.topupghBatchId),
    ));

  // Verify how many were actually linked
  const linked = await db
    .select({ id: ordersTable.id, phone: ordersTable.phoneNumber, bundleData: ordersTable.bundleData, price: ordersTable.price, userId: ordersTable.userId })
    .from(ordersTable)
    .where(eq(ordersTable.topupghBatchId, batch.id));

  if (linked.length === 0 || (!forceDispatch && linked.length < minBatch)) {
    await db.update(ordersTable).set({ topupghBatchId: null }).where(eq(ordersTable.topupghBatchId, batch.id));
    await db.delete(topupghBatchesTable).where(eq(topupghBatchesTable.id, batch.id));
    return { batchId: null, dispatched: false, reason: linked.length === 0 ? "race_condition" : "below_minimum", ordersCount: linked.length };
  }

  // Pre-flight balance check
  try {
    const balanceData = await topupghGetBalance();
    const totalCost   = linked.reduce((s, o) => s + parseFloat(o.price), 0);
    if (balanceData.balance < totalCost) {
      await db.update(ordersTable).set({ topupghBatchId: null }).where(eq(ordersTable.topupghBatchId, batch.id));
      await db.update(topupghBatchesTable)
        .set({ status: "failed", errorMessage: `Insufficient TopUpGH wallet balance (GH₵${balanceData.balance.toFixed(2)} available)` })
        .where(eq(topupghBatchesTable.id, batch.id));
      return { batchId: batch.id, dispatched: false, reason: "insufficient_balance", ordersCount: linked.length };
    }
  } catch { /* balance check failed — proceed anyway */ }

  // Build payload
  const orderItems: TopupghOrderItem[] = linked.map(o => ({
    _beneficiary_number: o.phone,
    network:             "mtn" as const,
    _data_size:          parseGb(o.bundleData),
  }));

  try {
    const result = await topupghCreateOrder(orderItems);

    if (!result.success) {
      await db.update(ordersTable).set({ topupghBatchId: null }).where(eq(ordersTable.topupghBatchId, batch.id));
      await db.update(topupghBatchesTable)
        .set({ status: "failed", errorMessage: result.message ?? "TopUpGH rejected the order" })
        .where(eq(topupghBatchesTable.id, batch.id));
      return { batchId: batch.id, dispatched: false, reason: "api_error", ordersCount: linked.length };
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

    // Mark orders as processing
    await db.update(ordersTable)
      .set({ status: "processing" })
      .where(eq(ordersTable.topupghBatchId, batch.id));

    return { batchId: batch.id, dispatched: true, ordersCount: linked.length, topupghOrderId: result.order_id };

  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await db.update(ordersTable).set({ topupghBatchId: null }).where(eq(ordersTable.topupghBatchId, batch.id));
    await db.update(topupghBatchesTable)
      .set({ status: "failed", errorMessage: `Dispatch exception: ${msg}` })
      .where(eq(topupghBatchesTable.id, batch.id));
    return { batchId: batch.id, dispatched: false, reason: "exception", ordersCount: linked.length };
  }
}

// ─── Backup status checker ────────────────────────────────────────────────────

/**
 * Poll TopUpGH delivery status for ONE processing batch per cycle.
 * Rate limit: delivery-status endpoint is capped at 1 req/min.
 * Poller runs every 2 min, so one check per cycle stays safely within limits.
 * Picks the stalest batch first (oldest dispatchedAt) to ensure forward progress.
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
    .orderBy(topupghBatchesTable.dispatchedAt)
    .limit(1);

  if (!batch?.topupghOrderId) return;

  try {
    // Poll PER-ITEM delivery status — NOT order-level status. TopUpGH's order-level
    // status flips to "completed" on acceptance, long before bundles actually reach
    // customers, so trusting it marked orders delivered prematurely. Real delivery is
    // reported per recipient via the delivery-status endpoint, mirroring the webhook.
    const data = await topupghGetDeliveryStatus(batch.topupghOrderId);
    if (!data.delivery_status || typeof data.delivery_status !== "object") return;

    const items: TopupghWebhookItem[] = Object.entries(data.delivery_status).map(([phone, info]) => {
      const i = info as { delivery_status?: string; delivery_date?: string; delivery_time?: string };
      return {
        item_id:            "",
        beneficiary_number: phone,
        network:            "",
        data_size:          0,
        delivery_status:    i.delivery_status ?? "",
        delivery_date:      i.delivery_date ?? "",
        delivery_time:      i.delivery_time ?? "",
      };
    });

    // Persist in the webhook payload shape so the admin delivery columns populate
    // even when the live webhook was missed.
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

    await settleBatchDeliveries(
      batch,
      items.map(i => ({ phone: i.beneficiary_number, status: i.delivery_status })),
    );
  } catch { /* transient — retry next cycle */ }
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
 * Signature = HMAC-SHA256(rawBody, apiSecret), hex-encoded.
 * Returns false if credentials are missing or signature doesn't match.
 */
export function verifyTopupghWebhookSignature(signature: string, rawBody: Buffer): boolean {
  const { apiSecret } = getCredentials();
  if (!apiSecret) return false;
  const expected = crypto.createHmac("sha256", apiSecret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Apply per-recipient delivery outcomes to a batch's orders, then finalize the batch.
 * delivered → order completed; failed/not-delivered → order failed + wallet refund.
 * Pending/unknown items are left untouched so the order stays "processing" until
 * TopUpGH actually delivers.
 *
 * This is the ONLY place an order is marked delivered. Both the live webhook and the
 * fallback poller funnel through here, so completion always reflects real per-recipient
 * delivery — never TopUpGH's order-level "accepted" status. The status guard makes it
 * idempotent: an order already completed/failed is never re-processed or double-refunded.
 */
async function settleBatchDeliveries(
  batch: typeof topupghBatchesTable.$inferSelect,
  items: Array<{ phone: string; status: string }>,
): Promise<void> {
  for (const item of items) {
    const status    = (item.status ?? "").toLowerCase();
    const delivered = status === "delivered";
    const failed    = status === "failed" || status === "not delivered" || status === "unsuccessful";

    if (!delivered && !failed) continue;

    // Lock the order row and re-check terminal status INSIDE the transaction.
    // The webhook and the poller can both settle the same item concurrently; the
    // FOR UPDATE lock + in-tx recheck serialize them so an order is marked + refunded
    // exactly once (wallet_ledger.reference is not unique, so this lock is the guard).
    const refunded = await db.transaction(async (tx) => {
      const [orderRow] = await tx.select()
        .from(ordersTable)
        .where(and(
          eq(ordersTable.topupghBatchId, batch.id),
          eq(ordersTable.phoneNumber, item.phone),
        ))
        .for("update")
        .limit(1);

      if (!orderRow || orderRow.status === "completed" || orderRow.status === "failed") return null;

      if (delivered) {
        await tx.update(ordersTable)
          .set({ status: "completed" })
          .where(eq(ordersTable.id, orderRow.id));
        return null;
      }

      // failed → mark failed + refund the wallet
      await tx.update(ordersTable)
        .set({ status: "failed" })
        .where(eq(ordersTable.id, orderRow.id));

      const price = parseFloat(orderRow.price);

      await tx.insert(walletsTable)
        .values({ userId: orderRow.userId, balance: price.toFixed(2) })
        .onConflictDoNothing();

      await tx.update(walletsTable)
        .set({ balance: sql`balance + ${price.toFixed(2)}::numeric` })
        .where(eq(walletsTable.userId, orderRow.userId));

      await tx.insert(walletLedgerTable).values({
        userId:    orderRow.userId,
        amount:    price.toFixed(2),
        type:      "credit",
        source:    "refund",
        reference: `topupgh-refund-${orderRow.id}`,
        note:      `Auto-refund: TopUpGH delivery failed — ${orderRow.bundleName} → ${orderRow.phoneNumber}`,
      });

      return { orderId: orderRow.id };
    });

    if (refunded) {
      logger.info({ orderId: refunded.orderId, phone: item.phone }, "TopUpGH delivery failed — wallet refunded");
    }
  }

  // Auto-close batch when all orders are settled
  const batchOrders = await db.select({ status: ordersTable.status })
    .from(ordersTable)
    .where(eq(ordersTable.topupghBatchId, batch.id));

  const allSettled = batchOrders.every(o => o.status === "completed" || o.status === "failed");
  if (allSettled && batch.status === "processing") {
    const allFailed = batchOrders.every(o => o.status === "failed");
    const anyFailed = batchOrders.some(o => o.status === "failed");
    const finalStatus = allFailed ? "failed" : anyFailed ? "partial" : "completed";
    await db.update(topupghBatchesTable)
      .set({ status: finalStatus })
      .where(eq(topupghBatchesTable.id, batch.id));
  }
}

/**
 * Process a delivery_status_updated webhook from TopUpGH.
 * Marks individual orders as completed or failed (auto-refunds failed deliveries).
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
