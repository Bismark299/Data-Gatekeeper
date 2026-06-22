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
  verifyTopupghWebhookSignature,
  getTopupghSettings,
  extractDeliveryInfo,
  type TopupghWebhookPayload,
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
    const data = await topupghGetDeliveryStatus(batch.topupghOrderId);
    res.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch delivery status";
    res.status(502).json({ error: msg });
  }
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
      const delivery = await topupghGetDeliveryStatus(tgId);
      const localOrders = batch
        ? await db.select({
            id: ordersTable.id, phone: ordersTable.phoneNumber,
            bundleName: ordersTable.bundleName, status: ordersTable.status,
            createdAt: ordersTable.createdAt,
          }).from(ordersTable).where(eq(ordersTable.topupghBatchId, batch.id))
        : [];
      res.json({ mode: "order", topupghOrderId: tgId, batch: batch ?? null, delivery, localOrders });
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
    const byTgId = new Map<number, typeof rows>();
    for (const row of rows) {
      if (!row.topupghOrderId) continue;
      const arr = byTgId.get(row.topupghOrderId) ?? [];
      arr.push(row);
      byTgId.set(row.topupghOrderId, arr);
    }

    const uniqueIds = [...byTgId.keys()].slice(0, 5);
    const deliveryMap = new Map<number, Record<string, { status: string; date: string; time: string }>>();
    let apiCallsMade = 0;

    for (const tgId of uniqueIds) {
      try {
        const data = await topupghGetDeliveryStatus(tgId);
        const byPhone: Record<string, { status: string; date: string; time: string }> = {};
        const liveItems = data.order?.items;
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
        deliveryMap.set(tgId, byPhone);
        apiCallsMade++;
      } catch { /* skip — return partial results */ }
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
      message: truncated
        ? `Results span ${byTgId.size} batches; only first 5 fetched live (rate limit: 1 req/min).`
        : null,
    });
    return;
  }

  res.status(400).json({ error: "Provide topupghOrderId (number) or phones (string[])" });
});

// ─── Webhook (public — no auth) ───────────────────────────────────────────────

router.post("/topupgh/webhook", async (req, res): Promise<void> => {
  const sig = req.headers["x-webhook-signature"];
  const raw = req.rawBody;

  if (!sig || typeof sig !== "string" || !raw) {
    res.sendStatus(401);
    return;
  }

  let valid = false;
  try {
    valid = verifyTopupghWebhookSignature(sig, raw);
  } catch {
    res.sendStatus(401);
    return;
  }

  if (!valid) {
    logger.warn("TopUpGH webhook: invalid signature — request rejected");
    res.sendStatus(401);
    return;
  }

  res.sendStatus(200); // ack immediately before processing
  try {
    await handleTopupghWebhook(req.body as TopupghWebhookPayload);
  } catch (e) {
    logger.error({ err: e }, "TopUpGH webhook processing error");
  }
});

export { router as topupghRouter };
