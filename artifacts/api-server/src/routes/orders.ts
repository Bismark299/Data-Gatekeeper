import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, ordersTable, bundlesTable, walletsTable, walletLedgerTable, usersTable } from "@workspace/db";
import {
  CreateOrderBody,
  GetOrderParams,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { getOrCreateWallet, insertLedgerEntry } from "./wallet";
import { dispatchToMcbis } from "../lib/mcbis";

const router: IRouter = Router();

function formatOrder(o: typeof ordersTable.$inferSelect, network?: string | null) {
  return {
    id: o.id,
    userId: o.userId,
    bundleId: o.bundleId,
    bundleName: o.bundleName,
    bundleData: o.bundleData,
    network: network ?? null,
    price: Number(o.price),
    status: o.status,
    phoneNumber: o.phoneNumber,
    createdAt: o.createdAt.toISOString(),
  };
}

router.get("/orders", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const rows = await db
    .select({ order: ordersTable, network: bundlesTable.network })
    .from(ordersTable)
    .leftJoin(bundlesTable, eq(bundlesTable.id, ordersTable.bundleId))
    .where(eq(ordersTable.userId, userId))
    .orderBy(desc(ordersTable.createdAt));

  res.json(rows.map(r => formatOrder(r.order, r.network)));
});

router.post("/orders", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { bundleId, phoneNumber } = parsed.data;
  const userId = req.session.userId!;

  const [bundle] = await db
    .select()
    .from(bundlesTable)
    .where(and(eq(bundlesTable.id, bundleId), eq(bundlesTable.isActive, true)));

  if (!bundle) {
    res.status(400).json({ error: "Bundle not found or inactive" });
    return;
  }

  if (!phoneNumber || phoneNumber.trim().length < 7) {
    res.status(400).json({ error: "Invalid phone number" });
    return;
  }

  const [currentUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  const userRole = currentUser?.role ?? "user";
  const effectivePrice =
    userRole === "dealer" ? bundle.dealerPrice :
    userRole === "agent"  ? bundle.agentPrice  :
    bundle.price;

  if (effectivePrice == null) {
    res.status(400).json({ error: `This bundle is not priced for ${userRole} accounts. Contact admin.` });
    return;
  }

  const [order] = await db
    .insert(ordersTable)
    .values({
      userId,
      bundleId: bundle.id,
      bundleName: bundle.name,
      bundleData: bundle.dataAmount,
      price: effectivePrice,
      buyingCost: bundle.price,
      status: "pending",
      phoneNumber: phoneNumber.trim(),
    })
    .returning();

  // Fire-and-forget McBIS dispatch
  dispatchToMcbis({
    orderId:    order.id,
    network:    bundle.network,
    phone:      order.phoneNumber,
    bundleData: order.bundleData,
  }).then(async (outcome) => {
    if (outcome.dispatched) {
      await db.update(ordersTable)
        .set({ status: "processing", mcbisReference: outcome.reference })
        .where(eq(ordersTable.id, order.id));
    }
  }).catch(() => {});

  res.status(201).json(formatOrder(order));
});

// Direct purchase: atomically checks balance, debits wallet, creates order, and writes ledger entry.
// Uses SELECT FOR UPDATE to prevent concurrent double-spend.
router.post("/orders/purchase", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { bundleId, phoneNumber } = parsed.data;
  const userId = req.session.userId!;

  const [bundle] = await db
    .select()
    .from(bundlesTable)
    .where(and(eq(bundlesTable.id, bundleId), eq(bundlesTable.isActive, true)));

  if (!bundle) {
    res.status(400).json({ error: "Bundle not found or inactive" });
    return;
  }

  if (!phoneNumber || phoneNumber.trim().length < 7) {
    res.status(400).json({ error: "Invalid phone number" });
    return;
  }

  const [currentUser2] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  const userRole = currentUser2?.role ?? "user";
  const rawPrice =
    userRole === "dealer" ? bundle.dealerPrice :
    userRole === "agent"  ? bundle.agentPrice  :
    bundle.price;

  if (rawPrice == null) {
    res.status(400).json({ error: `This bundle is not priced for ${userRole} accounts. Contact admin.` });
    return;
  }

  const price = parseFloat(rawPrice);

  await getOrCreateWallet(userId);

  let order: typeof ordersTable.$inferSelect;

  try {
    order = await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.userId, userId))
        .for("update");

      if (!wallet) throw Object.assign(new Error("Wallet not found"), { status: 404 });

      const balance = parseFloat(wallet.balance);
      if (balance < price) {
        throw Object.assign(
          new Error(`Insufficient balance. Need GH₵${price.toFixed(2)}, have GH₵${balance.toFixed(2)}`),
          { status: 400 }
        );
      }

      const newBalance = (balance - price).toFixed(2);
      await tx
        .update(walletsTable)
        .set({ balance: newBalance })
        .where(eq(walletsTable.userId, userId));

      const [created] = await tx
        .insert(ordersTable)
        .values({
          userId,
          bundleId: bundle.id,
          bundleName: bundle.name,
          bundleData: bundle.dataAmount,
          price: rawPrice,
          buyingCost: bundle.price,
          status: "pending",
          phoneNumber: phoneNumber.trim(),
        })
        .returning();

      // Write immutable ledger entry for this debit
      await insertLedgerEntry(
        tx,
        userId,
        -price,
        "debit",
        "order",
        `order-${created.id}`,
        `${bundle.name} → ${phoneNumber.trim()}`,
      );

      return created;
    });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Purchase failed" });
    return;
  }

  // Fire-and-forget McBIS dispatch
  dispatchToMcbis({
    orderId:    order.id,
    network:    bundle.network,
    phone:      order.phoneNumber,
    bundleData: order.bundleData,
  }).then(async (outcome) => {
    if (outcome.dispatched) {
      await db.update(ordersTable)
        .set({ status: "processing", mcbisReference: outcome.reference })
        .where(eq(ordersTable.id, order.id));
    }
  }).catch(() => {});

  res.status(201).json(formatOrder(order));
});

// ─── BULK ORDER ──────────────────────────────────────────────────────────────

const BulkOrderBody = z.object({
  items: z.array(z.object({
    phone: z.string().regex(/^\d{10}$/, "Phone must be exactly 10 digits"),
    gb: z.number().int().positive().max(100),
  })).min(1).max(50),
  network: z.string().min(1),
});

router.post("/orders/bulk", requireAuth, async (req, res): Promise<void> => {
  const parsed = BulkOrderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid bulk order data", details: parsed.error.issues }); return; }

  const userId = req.session.userId!;

  // 1. Load user role for pricing
  const [currentUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  const userRole = currentUser?.role ?? "agent";

  // 2. Load admin bundles for this network
  const networkBundles = await db
    .select()
    .from(bundlesTable)
    .where(and(eq(bundlesTable.isActive, true), eq(bundlesTable.network, parsed.data.network)));

  // 3. Build GB → bundle map
  const gbMap = new Map<number, typeof bundlesTable.$inferSelect>();
  for (const b of networkBundles) {
    const m = b.dataAmount.match(/^(\d+)\s*GB$/i);
    if (m) { const gb = parseInt(m[1], 10); if (!gbMap.has(gb)) gbMap.set(gb, b); }
  }

  // 4. Resolve items — skip unmatched GB sizes
  const skipped: Array<{ phone: string; gb: number; reason: string }> = [];
  const resolved: Array<{ phone: string; bundle: typeof bundlesTable.$inferSelect; price: number }> = [];

  for (const item of parsed.data.items) {
    const b = gbMap.get(item.gb);
    if (!b) {
      skipped.push({ phone: item.phone, gb: item.gb, reason: `No ${item.gb}GB bundle available` });
      continue;
    }
    const rawPrice = userRole === "dealer" ? b.dealerPrice : userRole === "agent" ? b.agentPrice : b.price;
    if (rawPrice == null) {
      skipped.push({ phone: item.phone, gb: item.gb, reason: `Bundle not priced for ${userRole}` });
      continue;
    }
    resolved.push({ phone: item.phone, bundle: b, price: parseFloat(rawPrice) });
  }

  if (resolved.length === 0) {
    res.status(400).json({ error: "No valid orders to process.", skipped }); return;
  }

  const totalCost = resolved.reduce((s, i) => s + i.price, 0);

  await getOrCreateWallet(userId);

  type OrderRow = typeof ordersTable.$inferSelect;
  let inserted: OrderRow[] = [];

  try {
    inserted = await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.userId, userId))
        .for("update");

      const balance = parseFloat(wallet?.balance ?? "0");
      if (balance < totalCost) {
        throw Object.assign(
          new Error(`Insufficient wallet balance. Need GH₵${totalCost.toFixed(2)}, have GH₵${balance.toFixed(2)}`),
          { status: 400 }
        );
      }

      await tx
        .update(walletsTable)
        .set({ balance: sql`balance - ${totalCost.toFixed(2)}::numeric` })
        .where(eq(walletsTable.userId, userId));

      await insertLedgerEntry(
        tx, userId, -totalCost, "debit", "bulk_order",
        `BULK-${userId}-${Date.now()}`,
        `Bulk order: ${resolved.length} item(s) on ${parsed.data.network.toUpperCase()}`,
      );

      const rows = await tx.insert(ordersTable).values(
        resolved.map(item => ({
          userId,
          bundleId: item.bundle.id,
          bundleName: item.bundle.name,
          bundleData: item.bundle.dataAmount,
          price: item.price.toFixed(2),
          buyingCost: item.bundle.price,
          status: "pending" as const,
          phoneNumber: item.phone,
        }))
      ).returning();

      return rows;
    });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Bulk order failed" }); return;
  }

  res.status(201).json({
    processed: inserted.length,
    skipped,
    totalCost: +totalCost.toFixed(2),
    orders: inserted.map(o => formatOrder(o, parsed.data.network)),
  });

  // Auto-dispatch MTN bulk orders to McbisSolution (fire-and-forget)
  for (let i = 0; i < inserted.length; i++) {
    const order   = inserted[i];
    const network = resolved[i].bundle.network;
    dispatchToMcbis({
      orderId:    order.id,
      network,
      phone:      order.phoneNumber,
      bundleData: order.bundleData,
    }).then(async (outcome) => {
      if (outcome.dispatched) {
        await db.update(ordersTable)
          .set({ status: "processing", mcbisReference: outcome.reference })
          .where(eq(ordersTable.id, order.id));
      }
    }).catch(() => {/* non-fatal */});
  }
});

router.get("/orders/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetOrderParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = req.session.userId!;
  const userRole = req.session.userRole!;

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  if (userRole !== "admin" && order.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json(formatOrder(order));
});

export default router;
