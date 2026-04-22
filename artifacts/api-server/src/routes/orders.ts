import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, ordersTable, bundlesTable } from "@workspace/db";
import {
  CreateOrderBody,
  GetOrderParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

function formatOrder(o: typeof ordersTable.$inferSelect) {
  return {
    id: o.id,
    userId: o.userId,
    bundleId: o.bundleId,
    bundleName: o.bundleName,
    bundleData: o.bundleData,
    price: Number(o.price),
    status: o.status,
    phoneNumber: o.phoneNumber,
    createdAt: o.createdAt.toISOString(),
  };
}

router.get("/orders", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const orders = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.userId, userId))
    .orderBy(ordersTable.createdAt);

  res.json(orders.map(formatOrder));
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
