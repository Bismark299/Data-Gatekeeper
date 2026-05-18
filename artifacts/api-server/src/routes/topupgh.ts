import { Router } from "express";
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm";
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
  getTopupghSettings,
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

  const conditions = status ? [eq(topupghBatchesTable.status, status)] : [];

  const [batches, countRow] = await Promise.all([
    db.select()
      .from(topupghBatchesTable)
      .where(conditions.length ? conditions[0] : undefined)
      .orderBy(desc(topupghBatchesTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.$count(topupghBatchesTable, conditions.length ? conditions[0] : undefined),
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

  res.json({
    batch: {
      ...batch,
      totalAmount:     batch.totalAmount     ? parseFloat(batch.totalAmount)     : null,
      walletDeducted:  batch.walletDeducted  ? parseFloat(batch.walletDeducted)  : null,
      previousBalance: batch.previousBalance ? parseFloat(batch.previousBalance) : null,
      newBalance:      batch.newBalance      ? parseFloat(batch.newBalance)      : null,
    },
    orders: orders.map(o => ({ ...o, price: parseFloat(o.price) })),
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

// ─── Webhook (public — no auth) ───────────────────────────────────────────────

router.post("/topupgh/webhook", async (req, res): Promise<void> => {
  res.sendStatus(200); // ack immediately
  try {
    await handleTopupghWebhook(req.body as TopupghWebhookPayload);
  } catch (e) {
    logger.error({ err: e }, "TopUpGH webhook processing error");
  }
});

export { router as topupghRouter };
