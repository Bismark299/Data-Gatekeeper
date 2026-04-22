import { Router, type IRouter } from "express";
import { eq, count, sum, desc, gte, and, ilike, type SQL } from "drizzle-orm";
import { db, usersTable, bundlesTable, ordersTable, walletsTable, depositsTable } from "@workspace/db";
import {
  AdminListUsersQueryParams,
  AdminUpdateUserParams,
  AdminUpdateUserBody,
  AdminDeleteUserParams,
  AdminListOrdersQueryParams,
  AdminUpdateOrderStatusParams,
  AdminUpdateOrderStatusBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

function formatUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
  };
}

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

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const params = AdminListUsersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { search, role } = params.data;
  const conditions: SQL[] = [];

  if (search) {
    conditions.push(ilike(usersTable.name, `%${search}%`));
  }
  if (role) {
    conditions.push(eq(usersTable.role, role));
  }

  const users = conditions.length > 0
    ? await db.select().from(usersTable).where(and(...conditions)).orderBy(desc(usersTable.createdAt))
    : await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));

  res.json(users.map(formatUser));
});

router.patch("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = AdminUpdateUserParams.safeParse({ id: raw });
  if (!paramsParsed.success) {
    res.status(400).json({ error: paramsParsed.error.message });
    return;
  }

  const parsed = AdminUpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set(parsed.data)
    .where(eq(usersTable.id, paramsParsed.data.id))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(formatUser(user));
});

router.delete("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = AdminDeleteUserParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const adminId = req.session.userId!;
  if (params.data.id === adminId) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, params.data.id));

  res.sendStatus(204);
});

router.get("/admin/orders", requireAdmin, async (req, res): Promise<void> => {
  const params = AdminListOrdersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { status, userId } = params.data;
  const conditions: SQL[] = [];

  if (status) {
    conditions.push(eq(ordersTable.status, status));
  }
  if (userId !== undefined) {
    conditions.push(eq(ordersTable.userId, userId));
  }

  const orders = conditions.length > 0
    ? await db.select().from(ordersTable).where(and(...conditions)).orderBy(desc(ordersTable.createdAt))
    : await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));

  res.json(orders.map(formatOrder));
});

router.patch("/admin/orders/:id/status", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = AdminUpdateOrderStatusParams.safeParse({ id: raw });
  if (!paramsParsed.success) {
    res.status(400).json({ error: paramsParsed.error.message });
    return;
  }

  const parsed = AdminUpdateOrderStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const validStatuses = ["pending", "processing", "completed", "failed"];
  if (!validStatuses.includes(parsed.data.status)) {
    res.status(400).json({ error: "Invalid status value" });
    return;
  }

  const [order] = await db
    .update(ordersTable)
    .set({ status: parsed.data.status })
    .where(eq(ordersTable.id, paramsParsed.data.id))
    .returning();

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json(formatOrder(order));
});

router.get("/admin/wallets", requireAdmin, async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: walletsTable.id,
      userId: walletsTable.userId,
      balance: walletsTable.balance,
      updatedAt: walletsTable.updatedAt,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(walletsTable)
    .leftJoin(usersTable, eq(walletsTable.userId, usersTable.id))
    .orderBy(desc(walletsTable.updatedAt));

  res.json(rows.map(w => ({
    id: w.id,
    userId: w.userId,
    balance: Number(w.balance),
    updatedAt: w.updatedAt?.toISOString() ?? null,
    userName: w.userName ?? "Unknown",
    userEmail: w.userEmail ?? "Unknown",
  })));
});

router.get("/admin/wallets/:userId/deposits", requireAdmin, async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const deposits = await db
    .select()
    .from(depositsTable)
    .where(eq(depositsTable.userId, userId))
    .orderBy(desc(depositsTable.createdAt));

  res.json(deposits.map(d => ({
    id: d.id,
    amount: Number(d.amount),
    method: d.method,
    reference: d.reference,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
  })));
});

router.get("/admin/stats", requireAdmin, async (req, res): Promise<void> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [totalUsers] = await db.select({ count: count() }).from(usersTable);
  const [totalOrders] = await db.select({ count: count() }).from(ordersTable);
  const [revenueRow] = await db.select({ total: sum(ordersTable.price) }).from(ordersTable).where(eq(ordersTable.status, "completed"));
  const [activeBundles] = await db.select({ count: count() }).from(bundlesTable).where(eq(bundlesTable.isActive, true));
  const [pendingOrders] = await db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "pending"));
  const [completedOrders] = await db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "completed"));
  const [recentUsers] = await db.select({ count: count() }).from(usersTable).where(gte(usersTable.createdAt, thirtyDaysAgo));
  const [recentOrders] = await db.select({ count: count() }).from(ordersTable).where(gte(ordersTable.createdAt, thirtyDaysAgo));

  res.json({
    totalUsers: totalUsers.count,
    totalOrders: totalOrders.count,
    totalRevenue: Number(revenueRow.total ?? 0),
    activeBundles: activeBundles.count,
    pendingOrders: pendingOrders.count,
    completedOrders: completedOrders.count,
    recentUsers: recentUsers.count,
    recentOrders: recentOrders.count,
  });
});

router.get("/admin/revenue", requireAdmin, async (req, res): Promise<void> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const orders = await db
    .select({
      createdAt: ordersTable.createdAt,
      price: ordersTable.price,
      status: ordersTable.status,
    })
    .from(ordersTable)
    .where(gte(ordersTable.createdAt, thirtyDaysAgo));

  const byDate: Record<string, { revenue: number; orders: number }> = {};

  for (const order of orders) {
    const date = order.createdAt.toISOString().split("T")[0];
    if (!byDate[date]) {
      byDate[date] = { revenue: 0, orders: 0 };
    }
    byDate[date].orders += 1;
    if (order.status === "completed") {
      byDate[date].revenue += Number(order.price);
    }
  }

  const result = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));

  res.json(result);
});

router.get("/admin/top-bundles", requireAdmin, async (req, res): Promise<void> => {
  const orders = await db
    .select({
      bundleId: ordersTable.bundleId,
      bundleName: ordersTable.bundleName,
      price: ordersTable.price,
      status: ordersTable.status,
    })
    .from(ordersTable);

  const bundleMap: Record<number, { name: string; orders: number; revenue: number }> = {};

  for (const o of orders) {
    if (!bundleMap[o.bundleId]) {
      bundleMap[o.bundleId] = { name: o.bundleName, orders: 0, revenue: 0 };
    }
    bundleMap[o.bundleId].orders += 1;
    if (o.status === "completed") {
      bundleMap[o.bundleId].revenue += Number(o.price);
    }
  }

  const bundles = await db.select().from(bundlesTable);
  const bundleCategoryMap: Record<number, string> = {};
  for (const b of bundles) {
    bundleCategoryMap[b.id] = b.category;
  }

  const result = Object.entries(bundleMap)
    .sort(([, a], [, b]) => b.orders - a.orders)
    .slice(0, 5)
    .map(([id, data]) => ({
      id: Number(id),
      name: data.name,
      orders: data.orders,
      revenue: data.revenue,
      category: bundleCategoryMap[Number(id)] ?? "unknown",
    }));

  res.json(result);
});

router.get("/admin/deposits", requireAdmin, async (req, res): Promise<void> => {
  const { status } = req.query as { status?: string };

  const depositsWithUsers = await db
    .select({
      id: depositsTable.id,
      userId: depositsTable.userId,
      userName: usersTable.name,
      userEmail: usersTable.email,
      amount: depositsTable.amount,
      status: depositsTable.status,
      method: depositsTable.method,
      reference: depositsTable.reference,
      note: depositsTable.note,
      createdAt: depositsTable.createdAt,
    })
    .from(depositsTable)
    .innerJoin(usersTable, eq(depositsTable.userId, usersTable.id))
    .orderBy(desc(depositsTable.createdAt));

  const filtered = status
    ? depositsWithUsers.filter((d) => d.status === status)
    : depositsWithUsers;

  res.json(
    filtered.map((d) => ({
      ...d,
      amount: parseFloat(d.amount),
    }))
  );
});

router.post("/admin/deposits/:id/approve", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid deposit ID" });
    return;
  }

  const [deposit] = await db.select().from(depositsTable).where(eq(depositsTable.id, id));
  if (!deposit) {
    res.status(404).json({ error: "Deposit not found" });
    return;
  }

  if (deposit.status === "completed") {
    res.status(400).json({ error: "Deposit already approved" });
    return;
  }

  const [updated] = await db
    .update(depositsTable)
    .set({ status: "completed", note: "Approved by admin" })
    .where(eq(depositsTable.id, id))
    .returning();

  const wallet = await db
    .select()
    .from(walletsTable)
    .where(eq(walletsTable.userId, deposit.userId));

  const currentBalance = wallet.length > 0 ? parseFloat(wallet[0].balance) : 0;
  const newBalance = (currentBalance + parseFloat(deposit.amount)).toFixed(2);

  if (wallet.length > 0) {
    await db
      .update(walletsTable)
      .set({ balance: newBalance })
      .where(eq(walletsTable.userId, deposit.userId));
  } else {
    await db
      .insert(walletsTable)
      .values({ userId: deposit.userId, balance: newBalance });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, deposit.userId));

  res.json({
    ...updated,
    amount: parseFloat(updated.amount),
    userName: user?.name ?? "",
    userEmail: user?.email ?? "",
  });
});

router.post("/admin/deposits/:id/reject", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid deposit ID" });
    return;
  }

  const [deposit] = await db.select().from(depositsTable).where(eq(depositsTable.id, id));
  if (!deposit) {
    res.status(404).json({ error: "Deposit not found" });
    return;
  }

  const [updated] = await db
    .update(depositsTable)
    .set({ status: "rejected", note: "Rejected by admin" })
    .where(eq(depositsTable.id, id))
    .returning();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, deposit.userId));

  res.json({
    ...updated,
    amount: parseFloat(updated.amount),
    userName: user?.name ?? "",
    userEmail: user?.email ?? "",
  });
});

export default router;
