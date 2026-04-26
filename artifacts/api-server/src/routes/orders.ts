import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, ordersTable, bundlesTable, walletsTable } from "@workspace/db";
import {
  CreateOrderBody,
  GetOrderParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { getOrCreateWallet } from "./wallet";

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

router.post("/orders", requireAuth, async (req, res): Promise<void> => {
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

  const [order] = await db
    .insert(ordersTable)
    .values({
      userId,
      bundleId: bundle.id,
      bundleName: bundle.name,
      bundleData: bundle.dataAmount,
      price: bundle.price,
      status: "pending",
      phoneNumber: phoneNumber.trim(),
    })
    .returning();

  res.status(201).json(formatOrder(order));
});

// Direct purchase: deducts wallet balance + creates order in one step
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

  const price = parseFloat(bundle.price);
  const wallet = await getOrCreateWallet(userId);
  const balance = parseFloat(wallet.balance);

  if (balance < price) {
    res.status(400).json({
      error: `Insufficient balance. Need GH₵${price.toFixed(2)}, have GH₵${balance.toFixed(2)}`,
    });
    return;
  }

  const newBalance = (balance - price).toFixed(2);
  await db
    .update(walletsTable)
    .set({ balance: newBalance })
    .where(eq(walletsTable.userId, userId));

  const [order] = await db
    .insert(ordersTable)
    .values({
      userId,
      bundleId: bundle.id,
      bundleName: bundle.name,
      bundleData: bundle.dataAmount,
      price: bundle.price,
      status: "pending",
      phoneNumber: phoneNumber.trim(),
    })
    .returning();

  res.status(201).json(formatOrder(order));
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
