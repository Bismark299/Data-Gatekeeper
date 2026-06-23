import { Router } from "express";
import { eq, and, isNull, isNotNull, desc, inArray, gte, lte, sql } from "drizzle-orm";
import { db, ordersTable, bundlesTable, topupghBatchesTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";
import { logger } from "../lib/logger";
import {
  topupghGetBalance,
  topupghGetProducts,
  topupghGetAllOrders,
  topupghGetOrderStatus,
  topupghGetDeliveryStatus,
  topupghTestConnection,
  dispatchPendingQueue,
  handleTopupghWebhook,
  diagnoseTopupghWebhookSignature,
  getTopupghSettings,
  extractDeliveryInfo,
  fetchAndSettleBatchDelivery,
  runDeliveryStatusCall,
  reconcileBatchOrderLevel,
  type BatchOrderLevelReconcileResult,
} from "../lib/topupgh";

const router = Router();

// ─── Queue ────────────────────────────────────────────────────────────────────

router.get("/admin/topupgh/queue", requireAdmin, async (_req, res): Promise<void> => {
  const { enabled, minBatch, maxBatch } = await getTopupghSettings();

  const rows = await db
    .select({
      id:         ordersTable.id,
      phone:      ordersTable.phoneNumber,
      bundleName: ordersTable.bundleName,
      bundleData: ordersTable.bundleData,
      price:      ordersTable.price,
      network:    bundlesTable.network,
      createdAt:  ordersTable.createdAt,
    })
    .from(ordersTable)
    .leftJoin(bundlesTable, eq(bundlesTable.id, ordersTable.bundleId))
    .where(and(
      eq(ordersTable.status, "pending"),
      isNull(ordersTable.topupghBatchId),
      isNull(ordersTable.mcbisReference),
      eq(bundlesTable.network, "mtn"),
    ))
    .orderBy(ordersTable.createdAt)
    .limit(200);

  const oldest = rows.length > 0 ? rows[0].createdAt : null;
  const oldestMinutes = oldest
    ? Math.floor((Date.now() - new Date(oldest).getTime()) / 60_000)
    : null;

  res.json({
    enabled,
    minBatch,
    maxBatch,
    count: rows.length,
    oldestMinutes,
    orders: rows.map(r => ({
      id:         r.id,
      phone:      r.phone,
      bundleName: r.bundleName,
      bundleData: r.bundleData,
      price:      parseFloat(r.price),
      network:    r.network,
      createdAt:  r.createdAt,
    })),
  });
});

// ─── Balance ──────────────────────────────────────────────────────────────────

router.get("/admin/topupgh/balance", requireAdmin, async (_req, res): Promise<void> => {
  const { apiKey, apiSecret } = await getTopupghSettings();
  if (!apiKey || !apiSecret) {
    res.status(400).json({ error: "TopUpGH API credentials not configured" });
    return;
  }
  try {
    const data = await topupghGetBalance();
    res.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch balance";
    logger.error({ err: e }, `topupgh balance error: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

// ─── Test connection ──────────────────────────────────────────────────────────

router.get("/admin/topupgh/test", requireAdmin, async (_req, res): Promise<void> => {
  const { apiKey, apiSecret } = await getTopupghSettings();
  if (!apiKey || !apiSecret) {
    res.status(400).json({ error: "TopUpGH API credentials not configured" });
    return;
  }
  try {
    const data = await topupghTestConnection();
    res.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Connection test failed";
    res.status(502).json({ error: msg });
  }
});

// ─── Products ─────────────────────────────────────────────────────────────────

router.get("/admin/topupgh/products", requireAdmin, async (req, res): Promise<void> => {
  const { apiKey, apiSecret } = await getTopupghSettings();
  if (!apiKey || !apiSecret) {
    res.status(400).json({ error: "TopUpGH API credentials not configured" });
    return;
  }
  try {
    const network = req.query.network as "mtn" | "at" | "telecel" | undefined;
    const data = await topupghGetProducts(network);
    res.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch products";
    res.status(502).json({ error: msg });
  }
});

// ─── Batches ──────────────────────────────────────────────────────────────────

router.get("/admin/topupgh/batches", requireAdmin, async (req, res): Promise<void> => {
  const page     = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "20"))));
  const status   = req.query.status as string | undefined;
  const from     = req.query.from   as string | undefined;
  const to       = req.query.to     as string | undefined;
  const phone    = (req.query.phone as string | undefined)?.trim();

  const conditions = [];
  if (status) conditions.push(eq(topupghBatchesTable.status, status));
  if (from)   conditions.push(gte(topupghBatchesTable.createdAt, new Date(from)));
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(topupghBatchesTable.createdAt, toDate));
  }
  if (phone) {
    conditions.push(
      sql`${topupghBatchesTable.id} IN (
        SELECT topupgh_batch_id FROM orders
        WHERE phone_number = ${phone} AND topupgh_batch_id IS NOT NULL
      )`
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const [batches, countRow] = await Promise.all([
    db.select()
      .from(topupghBatchesTable)
      .where(where)
      .orderBy(desc(topupghBatchesTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.$count(topupghBatchesTable, where),
  ]);

  res.json({
    batches: batches.map(b => ({
      ...b,
      totalAmount:     b.totalAmount     ? parseFloat(b.totalAmount)     : null,
      walletDeducted:  b.walletDeducted  ? parseFloat(b.walletDeducted)  : null,
      previousBalance: b.previousBalance ? parseFloat(b.previousBalance) : null,
      newBalance:      b.newBalance      ? parseFloat(b.newBalance)      : null,
    })),
    total:    countRow,
    page,
    pageSize,
  });
});

router.get("/admin/topupgh/batches/:id", requireAdmin, async (req, res): Promise<void> => {
  const batchId = parseInt(String(req.params.id));
  if (isNaN(batchId)) { res.status(400).json({ error: "Invalid batch ID" }); return; }

  const [batch] = await db.select().from(topupghBatchesTable).where(eq(topupghBatchesTable.id, batchId));
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }

  const orders = await db
    .select({
      id:         ordersTable.id,
      phone:      ordersTable.phoneNumber,
      bundleName: ordersTable.bundleName,
      bundleData: ordersTable.bundleData,
      price:      ordersTable.price,
      status:     ordersTable.status,
      createdAt:  ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(eq(ordersTable.topupghBatchId, batchId))
    .orderBy(ordersTable.createdAt);

  const deliveryMap = extractDeliveryInfo(batch.deliveryData);

  res.json({
    batch: {
      ...batch,
      totalAmount:     batch.totalAmount     ? parseFloat(batch.totalAmount)     : null,
      walletDeducted:  batch.walletDeducted  ? parseFloat(batch.walletDeducted)  : null,
      previousBalance: batch.previousBalance ? parseFloat(batch.previousBalance) : null,
      newBalance:      batch.newBalance      ? parseFloat(batch.newBalance)      : null,
    },
    orders: orders.map(o => ({
      ...o,
      price: parseFloat(o.price),
      delivery: deliveryMap.get(o.phone) ?? null,
    })),
  });
});

// ─── Delivery status (live fetch from TopUpGH) ────────────────────────────────

router.get("/admin/topupgh/batches/:id/delivery", requireAdmin, async (req, res): Promise<void> => {
  const batchId = parseInt(String(req.params.id));
  if (isNaN(batchId)) { res.status(400).json({ error: "Invalid batch ID" }); return; }

  const [batch] = await db.select().from(topupghBatchesTable).where(eq(topupghBatchesTable.id, batchId));
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  if (!batch.topupghOrderId) { res.status(400).json({ error: "Batch not yet dispatched" }); return; }

  const { apiKey, apiSecret } = await getTopupghSettings();
  if (!apiKey || !apiSecret) { res.status(400).json({ error: "TopUpGH credentials not configured" }); return; }

  try {
    // Through the shared 1-req/min gate ("skip"): if no slot is free, return the batch's
    // last stored delivery payload instead of bursting the limit or starving the poller.
    const slot = await runDeliveryStatusCall(() => topupghGetDeliveryStatus(batch.topupghOrderId as number), "skip");
    if (slot.ran) {
      res.json({ ...slot.value, liveSkipped: false });
    } else {
      res.json({ success: true, order: (batch.deliveryData as { order?: unknown })?.order ?? undefined, liveSkipped: true });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch delivery status";
    res.status(502).json({ error: msg });
  }
});

// ─── Check delivery status + settle (admin manual trigger) ────────────────────
// POST /admin/topupgh/batches/:id/check-delivery
// Fetches the LIVE per-recipient status from TopUpGH for this batch, persists it, and
// auto-completes/fails the orders TopUpGH confirms — the SAME path as the background
// poller. TopUpGH limits delivery-status to 1 req/min/key (shared with the poller), so an
// empty result (summary.itemCount 0) means "no update yet OR rate-limited — retry shortly".

router.post("/admin/topupgh/batches/:id/check-delivery", requireAdmin, async (req, res): Promise<void> => {
  const batchId = parseInt(String(req.params.id));
  if (isNaN(batchId)) { res.status(400).json({ error: "Invalid batch ID" }); return; }

  const [batch] = await db.select().from(topupghBatchesTable).where(eq(topupghBatchesTable.id, batchId));
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  if (!batch.topupghOrderId) { res.status(400).json({ error: "Batch not yet dispatched to TopUpGH" }); return; }

  const { apiKey, apiSecret } = await getTopupghSettings();
  if (!apiKey || !apiSecret) { res.status(400).json({ error: "TopUpGH credentials not configured" }); return; }

  try {
    // Interactive admin trigger: "skip" gate so it never hangs up to a minute waiting on
    // the shared 1-req/min budget. itemCount 0 already means "no update yet / rate-limited".
    const summary = await fetchAndSettleBatchDelivery(batch, { gateMode: "skip" });
    const [updated] = await db.select({ status: topupghBatchesTable.status })
      .from(topupghBatchesTable).where(eq(topupghBatchesTable.id, batchId));
    res.json({ success: true, summary, batchStatus: updated?.status ?? batch.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to check delivery status";
    logger.warn({ err: e, batchId }, `topupgh manual delivery check failed: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

// ─── Bulk reconcile a stuck range via order-LEVEL status ──────────────────────
// POST /admin/topupgh/reconcile-range
// Body: { minOrderId: number; maxOrderId: number; force?: boolean; limit?: number }
// For each "processing" batch whose TopUpGH order id falls in [min,max], confirms delivery
// via TopUpGH's ORDER-LEVEL status and completes the still-open orders through the canonical
// settle path (credits store profit, idempotent). `force` skips the TopUpGH call and settles
// on admin attestation. Use for orders TopUpGH's per-item delivery-status never reports.

router.post("/admin/topupgh/reconcile-range", requireAdmin, async (req, res): Promise<void> => {
  const { apiKey, apiSecret } = await getTopupghSettings();
  if (!apiKey || !apiSecret) { res.status(400).json({ error: "TopUpGH credentials not configured" }); return; }

  const body = (req.body ?? {}) as { minOrderId?: number; maxOrderId?: number; force?: boolean; limit?: number };
  const min  = Number(body.minOrderId);
  const max  = Number(body.maxOrderId);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
    res.status(400).json({ error: "Provide a valid minOrderId/maxOrderId range" });
    return;
  }
  const force = body.force === true;
  const limit = Math.min(50, Math.max(1, Number(body.limit) || 30));

  const batches = await db.select().from(topupghBatchesTable)
    .where(and(
      eq(topupghBatchesTable.status, "processing"),
      isNotNull(topupghBatchesTable.topupghOrderId),
      gte(topupghBatchesTable.topupghOrderId, min),
      lte(topupghBatchesTable.topupghOrderId, max),
    ))
    .orderBy(topupghBatchesTable.topupghOrderId)
    .limit(limit);

  const results: BatchOrderLevelReconcileResult[] = [];
  for (let i = 0; i < batches.length; i++) {
    try {
      results.push(await reconcileBatchOrderLevel(batches[i], { force }));
    } catch (e) {
      logger.warn({ err: e, batchId: batches[i].id }, "reconcile-range: batch failed");
      results.push({
        batchId: batches[i].id, topupghOrderId: batches[i].topupghOrderId,
        orderLevelStatus: "", httpStatus: null, confirmed: false, completed: 0,
        batchStatus: batches[i].status, note: "Error during reconcile.",
      });
    }
    // Gentle pacing between order-level calls to respect TopUpGH rate limits.
    // No API calls are made when forced, so pacing is unnecessary then.
    if (!force && i < batches.length - 1) await new Promise((r) => setTimeout(r, 1300));
  }

  const batchesCompleted = results.filter((r) => r.batchStatus !== "processing").length;
  const ordersCompleted  = results.reduce((n, r) => n + r.completed, 0);
  logger.info(
    { minOrderId: min, maxOrderId: max, force, batchesScanned: batches.length, batchesCompleted, ordersCompleted },
    "Admin ran TopUpGH reconcile-range",
  );
  res.json({
    success: true,
    range: { minOrderId: min, maxOrderId: max },
    force,
    batchesScanned: batches.length,
    batchesCompleted,
    ordersCompleted,
    results,
  });
});

// ─── Force dispatch ───────────────────────────────────────────────────────────

router.post("/admin/topupgh/dispatch", requireAdmin, async (_req, res): Promise<void> => {
  const { apiKey, apiSecret } = await getTopupghSettings();
  if (!apiKey || !apiSecret) {
    res.status(400).json({ error: "TopUpGH API credentials not configured" });
    return;
  }
  try {
    const result = await dispatchPendingQueue(true); // forceDispatch = true
    if (result.dispatched) {
      logger.info({ batchId: result.batchId, count: result.ordersCount }, "Admin force-dispatched TopUpGH batch");
    }
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Dispatch failed";
    logger.error({ err: e }, `topupgh force dispatch error: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// ─── All orders (reconciliation) ──────────────────────────────────────────────

router.get("/admin/topupgh/orders", requireAdmin, async (req, res): Promise<void> => {
  const { apiKey, apiSecret } = await getTopupghSettings();
  if (!apiKey || !apiSecret) {
    res.status(400).json({ error: "TopUpGH API credentials not configured" });
    return;
  }
  try {
    const page    = parseInt(String(req.query.page ?? "1"));
    const perPage = parseInt(String(req.query.per_page ?? "20"));
    const status  = req.query.status as string | undefined;
    const data = await topupghGetAllOrders(page, perPage, status);
    res.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch orders";
    res.status(502).json({ error: msg });
  }
});

// ─── Order status (single) ────────────────────────────────────────────────────

router.get("/admin/topupgh/order-status/:orderId", requireAdmin, async (req, res): Promise<void> => {
  const orderId = parseInt(String(req.params.orderId));
  if (isNaN(orderId)) { res.status(400).json({ error: "Invalid order ID" }); return; }

  const { apiKey, apiSecret } = await getTopupghSettings();
  if (!apiKey || !apiSecret) { res.status(400).json({ error: "TopUpGH credentials not configured" }); return; }

  try {
    const data = await topupghGetOrderStatus(orderId);
    res.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch order status";
    res.status(502).json({ error: msg });
  }
});

// ─── Delivery search ──────────────────────────────────────────────────────────
// POST /admin/topupgh/search
// Body: { topupghOrderId?: number } | { phones?: string[] }
// Looks up our DB then fetches live delivery-status from TopUpGH.
// Max 5 unique TopUpGH batches per bulk request (rate limit: 1 req/min).

router.post("/admin/topupgh/search", requireAdmin, async (req, res): Promise<void> => {
  const { apiKey, apiSecret } = await getTopupghSettings();
  if (!apiKey || !apiSecret) { res.status(400).json({ error: "TopUpGH credentials not configured" }); return; }

  const body = req.body as { topupghOrderId?: number; phones?: string[] };

  // ── Mode 1: by TopUpGH order ID ───────────────────────────────────────────
  if (body.topupghOrderId != null) {
    const tgId = Number(body.topupghOrderId);
    if (isNaN(tgId)) { res.status(400).json({ error: "Invalid topupghOrderId" }); return; }

    const [batch] = await db.select().from(topupghBatchesTable)
      .where(eq(topupghBatchesTable.topupghOrderId, tgId));

    try {
      // Through the shared 1-req/min gate ("skip"): if no slot is free we return the last
      // stored delivery payload instead of bursting the limit (or starving the poller).
      const slot = await runDeliveryStatusCall(() => topupghGetDeliveryStatus(tgId), "skip");
      const liveSkipped = !slot.ran;
      const delivery = slot.ran ? slot.value : (batch?.deliveryData ?? null);
      const localOrders = batch
        ? await db.select({
            id: ordersTable.id, phone: ordersTable.phoneNumber,
            bundleName: ordersTable.bundleName, status: ordersTable.status,
            createdAt: ordersTable.createdAt,
          }).from(ordersTable).where(eq(ordersTable.topupghBatchId, batch.id))
        : [];
      res.json({
        mode: "order", topupghOrderId: tgId, batch: batch ?? null, delivery, localOrders, liveSkipped,
        message: liveSkipped
          ? "Showing last saved status — a live check was skipped to respect TopUpGH's 1 req/min limit (shared with the poller). Retry shortly for live."
          : null,
      });
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : "Failed to fetch delivery status" });
    }
    return;
  }

  // ── Mode 2: by phone number(s) ────────────────────────────────────────────
  if (Array.isArray(body.phones) && body.phones.length > 0) {
    const phones = body.phones.map((p: string) => p.trim()).filter(Boolean).slice(0, 100);

    const rows = await db
      .select({
        orderId:        ordersTable.id,
        phone:          ordersTable.phoneNumber,
        bundleName:     ordersTable.bundleName,
        bundleData:     ordersTable.bundleData,
        price:          ordersTable.price,
        status:         ordersTable.status,
        createdAt:      ordersTable.createdAt,
        batchId:        topupghBatchesTable.id,
        topupghOrderId: topupghBatchesTable.topupghOrderId,
        batchStatus:    topupghBatchesTable.status,
        dispatchedAt:   topupghBatchesTable.dispatchedAt,
        deliveryData:   topupghBatchesTable.deliveryData,
      })
      .from(ordersTable)
      .innerJoin(topupghBatchesTable, eq(topupghBatchesTable.id, ordersTable.topupghBatchId))
      .where(and(isNotNull(ordersTable.topupghBatchId), inArray(ordersTable.phoneNumber, phones)))
      .orderBy(desc(ordersTable.createdAt))
      .limit(200);

    if (rows.length === 0) {
      res.json({ mode: "phones", phones, results: [], notFound: phones, apiCallsMade: 0,
        message: "No TopUpGH-processed orders found for these phone numbers." });
      return;
    }

    // Group by unique topupghOrderId then fetch live delivery-status (1 call per batch)
    // Keep each batch's last stored delivery payload alongside its rows so we can fall back
    // to it when the shared 1-req/min gate has no free slot for a live call (see below).
    const byTgId = new Map<number, typeof rows>();
    const storedByTgId = new Map<number, unknown>();
    for (const row of rows) {
      if (!row.topupghOrderId) continue;
      const arr = byTgId.get(row.topupghOrderId) ?? [];
      arr.push(row);
      byTgId.set(row.topupghOrderId, arr);
      if (!storedByTgId.has(row.topupghOrderId)) storedByTgId.set(row.topupghOrderId, row.deliveryData);
    }

    const uniqueIds = [...byTgId.keys()].slice(0, 5);
    const deliveryMap = new Map<number, Record<string, { status: string; date: string; time: string }>>();
    let apiCallsMade = 0;
    let liveSkipped = false;

    for (const tgId of uniqueIds) {
      const byPhone: Record<string, { status: string; date: string; time: string }> = {};
      try {
        // Live call funnels through the shared delivery-status gate in "skip" mode: it runs
        // only if a slot is free right now, so this admin search can never burst past the
        // 1-req/min limit or starve the poller. When skipped we serve the last stored
        // delivery payload for that batch instead of making a call.
        const slot = await runDeliveryStatusCall(() => topupghGetDeliveryStatus(tgId), "skip");
        if (slot.ran) {
          const liveItems = slot.value.order?.items;
          if (Array.isArray(liveItems)) {
            for (const it of liveItems) {
              const phone = it.beneficiary_number;
              if (!phone) continue;
              const processed = typeof it.processed_date === "string" ? it.processed_date : "";
              const commaIdx  = processed.indexOf(", ");
              byPhone[phone] = {
                status: it.delivery_status ?? "unknown",
                date:   commaIdx >= 0 ? processed.slice(0, commaIdx) : processed,
                time:   commaIdx >= 0 ? processed.slice(commaIdx + 2) : "",
              };
            }
          }
          apiCallsMade++;
        } else {
          liveSkipped = true;
          for (const [phone, info] of extractDeliveryInfo(storedByTgId.get(tgId))) {
            byPhone[phone] = { status: info.status, date: info.date, time: info.time };
          }
        }
      } catch { /* skip — return partial results */ }
      deliveryMap.set(tgId, byPhone);
    }

    const notFound = phones.filter(p => !rows.some(r => r.phone === p));
    const truncated = byTgId.size > 5;

    res.json({
      mode: "phones",
      phones,
      results: rows.map(row => ({
        orderId:        row.orderId,
        phone:          row.phone,
        bundleName:     row.bundleName,
        bundleData:     row.bundleData,
        price:          parseFloat(row.price),
        localStatus:    row.status,
        batchId:        row.batchId,
        topupghOrderId: row.topupghOrderId,
        batchStatus:    row.batchStatus,
        dispatchedAt:   row.dispatchedAt,
        createdAt:      row.createdAt,
        liveDelivery:   row.topupghOrderId ? (deliveryMap.get(row.topupghOrderId)?.[row.phone] ?? null) : null,
      })),
      notFound,
      apiCallsMade,
      truncated,
      liveSkipped,
      message: [
        truncated ? `Results span ${byTgId.size} batches; only first 5 shown.` : null,
        liveSkipped
          ? "Some batches show the last saved status — a live check was skipped to respect TopUpGH's 1 req/min limit (shared with the poller). Retry shortly for live."
          : null,
      ].filter(Boolean).join(" ") || null,
    });
    return;
  }

  res.status(400).json({ error: "Provide topupghOrderId (number) or phones (string[])" });
});

// ─── Webhook (public — unauthenticated TRIGGER, never trusted for settlement) ────
//
// TopUpGH's webhook carries no usable signature (their integration docs POST the bare
// payload), so requiring one rejected every callback with 401 — that is the "Failed"
// count on the TopUpGH dashboard, and a non-200 makes them stop retrying. We therefore
// ALWAYS ack 200. Security does NOT come from trusting this request: handleTopupghWebhook
// uses it only as a TRIGGER to re-fetch the AUTHENTICATED, HMAC-signed delivery-status for
// the order and settle from that verified response. A forged webhook can at most cause an
// idempotent, rate-limited re-check of our own data — it can never mark an order delivered
// or credit an agent's profit.
router.post("/topupgh/webhook", async (req, res): Promise<void> => {
  // Best-effort only: if a signature happens to be present, log whether any known scheme
  // matches so TopUpGH's scheme can be learned over time. Never used to accept/reject.
  const sig = req.headers["x-webhook-signature"];
  const raw = req.rawBody;
  const ts  = typeof req.headers["x-timestamp"] === "string" ? req.headers["x-timestamp"] : undefined;
  if (typeof sig === "string" && raw) {
    try {
      logger.info({ diag: diagnoseTopupghWebhookSignature(sig, raw, ts) }, "TopUpGH webhook signature diagnostic");
    } catch { /* diagnostic only */ }
  }

  res.sendStatus(200); // ack immediately — any non-200 shows as "Failed" on TopUpGH and halts callbacks

  try {
    await handleTopupghWebhook(req.body);
  } catch (e) {
    logger.error({ err: e }, "TopUpGH webhook processing error");
  }
});

export { router as topupghRouter };
