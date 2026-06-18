import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db, mtnTransfersTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";
import { mtnConfigured, mtnTestConnection, mtnTransfer } from "../lib/mtn";

// Strict decimal — guarantees the amount can be safely cast to numeric in /stats.
const AMOUNT_RE = /^\d+(\.\d{1,4})?$/;

const router: IRouter = Router();

function serialize(t: typeof mtnTransfersTable.$inferSelect) {
  return {
    id: t.id,
    senderMsisdn: t.senderMsisdn,
    receiverMsisdn: t.receiverMsisdn,
    transferType: t.transferType,
    amount: t.amount,
    productCode: t.productCode,
    status: t.status,
    transactionId: t.transactionId,
    mtnTransactionId: t.mtnTransactionId,
    statusCode: t.statusCode,
    statusMessage: t.statusMessage,
    createdAt: t.createdAt.toISOString(),
  };
}

// ─── Connection test ──────────────────────────────────────────────────────────
router.get("/test", requireAdmin, async (_req, res): Promise<void> => {
  if (!mtnConfigured()) { res.status(400).json({ error: "MTN API credentials not configured" }); return; }
  try {
    const data = await mtnTestConnection();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Connection test failed" });
  }
});

// ─── Stats ────────────────────────────────────────────────────────────────────
router.get("/stats", requireAdmin, async (_req, res): Promise<void> => {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      success: sql<number>`count(*) filter (where ${mtnTransfersTable.status} = 'success')::int`,
      failed: sql<number>`count(*) filter (where ${mtnTransfersTable.status} = 'failed')::int`,
      pending: sql<number>`count(*) filter (where ${mtnTransfersTable.status} = 'pending')::int`,
      unknown: sql<number>`count(*) filter (where ${mtnTransfersTable.status} = 'unknown')::int`,
      dataSent: sql<number>`coalesce(sum(case when ${mtnTransfersTable.transferType} = 'data' and ${mtnTransfersTable.status} = 'success' then (${mtnTransfersTable.amount})::numeric else 0 end), 0)`,
      airtimeSent: sql<number>`coalesce(sum(case when ${mtnTransfersTable.transferType} = 'airtime' and ${mtnTransfersTable.status} = 'success' then (${mtnTransfersTable.amount})::numeric else 0 end), 0)`,
    })
    .from(mtnTransfersTable);

  res.json({
    total: row?.total ?? 0,
    success: row?.success ?? 0,
    failed: row?.failed ?? 0,
    pending: row?.pending ?? 0,
    unknown: row?.unknown ?? 0,
    dataSent: Number(row?.dataSent ?? 0),
    airtimeSent: Number(row?.airtimeSent ?? 0),
  });
});

// ─── History (filterable + paginated) ─────────────────────────────────────────
router.get("/transfers", requireAdmin, async (req, res): Promise<void> => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "20"))));
  const status = req.query.status as string | undefined;
  const phone = (req.query.phone as string | undefined)?.trim();
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const conditions: SQL[] = [];
  if (status && status !== "all") conditions.push(eq(mtnTransfersTable.status, status));
  if (phone) conditions.push(sql`(${mtnTransfersTable.receiverMsisdn} LIKE ${"%" + phone + "%"} OR ${mtnTransfersTable.senderMsisdn} LIKE ${"%" + phone + "%"})`);
  if (from) conditions.push(gte(mtnTransfersTable.createdAt, new Date(from)));
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(mtnTransfersTable.createdAt, toDate));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, count] = await Promise.all([
    db.select().from(mtnTransfersTable).where(where).orderBy(desc(mtnTransfersTable.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.$count(mtnTransfersTable, where),
  ]);

  res.json({ transfers: rows.map(serialize), total: count, page, pageSize });
});

// ─── Perform a transfer ───────────────────────────────────────────────────────
router.post("/transfer", requireAdmin, async (req, res): Promise<void> => {
  if (!mtnConfigured()) { res.status(400).json({ error: "MTN API credentials not configured" }); return; }

  const b = req.body as {
    senderMsisdn?: string;
    receiverMsisdn?: string;
    transferType?: string;
    amount?: string | number;
    pin?: string;
    productCode?: string;
  };

  const senderMsisdn = String(b.senderMsisdn ?? "").trim();
  const receiverMsisdn = String(b.receiverMsisdn ?? "").trim();
  const transferType = b.transferType === "airtime" ? "airtime" : "data";
  const amount = String(b.amount ?? "").trim();
  const pin = String(b.pin ?? "").trim();
  const productCode = String(b.productCode ?? "").trim();

  if (!/^\d{9,15}$/.test(senderMsisdn)) { res.status(400).json({ error: "Invalid sender number" }); return; }
  if (!/^\d{9,15}$/.test(receiverMsisdn)) { res.status(400).json({ error: "Invalid receiver number" }); return; }
  if (!AMOUNT_RE.test(amount) || !(Number(amount) > 0)) { res.status(400).json({ error: "Invalid amount" }); return; }
  if (!pin) { res.status(400).json({ error: "PIN is required" }); return; }

  // Generate the correlation id up-front and persist it on the pending row BEFORE
  // calling MTN, so every attempt is reconcilable even if the process dies mid-call.
  const transactionId = randomUUID();
  const [record] = await db.insert(mtnTransfersTable).values({
    senderMsisdn, receiverMsisdn, transferType, amount, productCode, transactionId, status: "pending",
  }).returning();

  try {
    const result = await mtnTransfer({ senderMsisdn, receiverMsisdn, transferType, amount, pin, productCode, transactionId });

    const [updated] = await db.update(mtnTransfersTable).set({
      status: result.outcome, // "success" | "failed" | "unknown"
      mtnTransactionId: result.mtnTransactionId,
      statusCode: result.statusCode,
      statusMessage: result.statusMessage,
    }).where(eq(mtnTransfersTable.id, record.id)).returning();

    req.log.info({ id: record.id, outcome: result.outcome, statusCode: result.statusCode, transactionId }, "MTN transfer attempted");

    if (result.outcome === "success") {
      res.json({ transfer: serialize(updated) });
      return;
    }
    // failed (clear rejection) or unknown (ambiguous — verify before retrying)
    const status = result.outcome === "unknown" ? 502 : 400;
    res.status(status).json({ error: result.statusMessage || "Transfer failed", outcome: result.outcome, transfer: serialize(updated) });
  } catch (e) {
    // Exception before/while obtaining a token → the transfer was never sent, so it
    // is safe to record as failed (retryable without double-spend risk).
    const msg = e instanceof Error ? e.message : "Transfer failed";
    const [updated] = await db.update(mtnTransfersTable).set({
      status: "failed", statusMessage: msg,
    }).where(eq(mtnTransfersTable.id, record.id)).returning();
    req.log.error({ err: e, id: record.id, transactionId }, "MTN transfer pre-flight error");
    res.status(502).json({ error: msg, outcome: "failed", transfer: serialize(updated) });
  }
});

export { router as mtnRouter };
