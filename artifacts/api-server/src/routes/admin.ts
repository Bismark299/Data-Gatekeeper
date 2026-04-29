import { Router, type IRouter } from "express";
import {
  eq, count, sum, desc, gte, and, ilike, inArray, isNull, isNotNull, lt,
  type SQL, sql,
} from "drizzle-orm";
import {
  db, usersTable, bundlesTable, ordersTable, walletsTable, depositsTable,
  storesTable, settingsTable, walletLedgerTable,
} from "@workspace/db";
import { creditWallet, insertLedgerEntry } from "./wallet";
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
import { z } from "zod";

const router: IRouter = Router();

// ── Pagination helper ─────────────────────────────────────────────────────────

function parsePage(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query.page ?? "1")));
  const pageSize = Math.min(200, Math.max(1, parseInt(String(query.pageSize ?? "50"))));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    isActive: u.isActive,
    depositCode: u.depositCode ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

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
    updatedAt: o.updatedAt.toISOString(),
  };
}

// ── Users ─────────────────────────────────────────────────────────────────────

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const params = AdminListUsersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { search, role } = params.data;
  const conditions: SQL[] = [isNull(usersTable.deletedAt)];

  if (search) conditions.push(ilike(usersTable.name, `%${search}%`));
  if (role)   conditions.push(eq(usersTable.role, role));

  const rows = await db
    .select({ user: usersTable, balance: walletsTable.balance })
    .from(usersTable)
    .leftJoin(walletsTable, eq(walletsTable.userId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(usersTable.createdAt))
    .limit(500);

  res.json(rows.map(r => ({ ...formatUser(r.user), walletBalance: Number(r.balance ?? 0) })));
});

router.get("/admin/users/deleted", requireAdmin, async (req, res): Promise<void> => {
  const rows = await db
    .select({ user: usersTable })
    .from(usersTable)
    .where(isNotNull(usersTable.deletedAt))
    .orderBy(desc(usersTable.updatedAt))
    .limit(500);

  res.json(rows.map(r => ({
    ...formatUser(r.user),
    deletedAt: r.user.deletedAt?.toISOString() ?? null,
  })));
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
    .where(and(eq(usersTable.id, paramsParsed.data.id), isNull(usersTable.deletedAt)))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(formatUser(user));
});

// Soft-delete: sets deletedAt instead of removing the row.
// Financial records (orders, deposits, wallet) are preserved for dispute resolution.
// Use GET /admin/users/deleted to view and potentially restore deleted users.
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

  const [deleted] = await db
    .update(usersTable)
    .set({ deletedAt: new Date(), isActive: false })
    .where(and(eq(usersTable.id, params.data.id), isNull(usersTable.deletedAt)))
    .returning({ id: usersTable.id });

  if (!deleted) {
    res.status(404).json({ error: "User not found or already deleted" });
    return;
  }

  res.sendStatus(204);
});

// Restore a previously soft-deleted user
router.post("/admin/users/:id/restore", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const [restored] = await db
    .update(usersTable)
    .set({ deletedAt: null, isActive: true })
    .where(and(eq(usersTable.id, id), isNotNull(usersTable.deletedAt)))
    .returning();

  if (!restored) {
    res.status(404).json({ error: "User not found or not deleted" });
    return;
  }

  res.json(formatUser(restored));
});

// Create a new user account (admin, dealer, or regular user)
router.post("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const schema = z.object({
    name:     z.string().min(2).max(80),
    email:    z.string().email(),
    phone:    z.string().min(7).max(20).optional(),
    password: z.string().min(6),
    role:     z.enum(["user", "agent", "dealer", "admin"]).default("user"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
    return;
  }

  const { name, email, phone, password, role } = parsed.data;

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (existing) { res.status(409).json({ error: "Email already in use" }); return; }

  const { default: bcrypt } = await import("bcryptjs");
  const passwordHash = await bcrypt.hash(password, 12);

  const depositCode = "DC" + Math.floor(100000 + Math.random() * 900000).toString();

  const [user] = await db.insert(usersTable).values({
    name, email, phone: phone ?? null, passwordHash, role,
    depositCode, isActive: true,
  }).returning();

  await db.insert(walletsTable).values({ userId: user.id, balance: "0" });

  res.status(201).json(formatUser(user));
});

// ── Orders ────────────────────────────────────────────────────────────────────

router.get("/admin/orders", requireAdmin, async (req, res): Promise<void> => {
  const params = AdminListOrdersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { status, userId } = params.data;
  const conditions: SQL[] = [];
  if (status)               conditions.push(eq(ordersTable.status, status));
  if (userId !== undefined) conditions.push(eq(ordersTable.userId, userId));

  const baseQuery = db
    .select({ order: ordersTable, network: bundlesTable.network })
    .from(ordersTable)
    .leftJoin(bundlesTable, eq(bundlesTable.id, ordersTable.bundleId));

  const rows = conditions.length > 0
    ? await baseQuery.where(and(...conditions)).orderBy(desc(ordersTable.createdAt)).limit(500)
    : await baseQuery.orderBy(desc(ordersTable.createdAt)).limit(500);

  res.json(rows.map(r => formatOrder(r.order, r.network)));
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

router.post("/admin/orders/:id/refund", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid order ID" }); return; }

  try {
    const refunded = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.id, id))
        .for("update");

      if (!locked) throw Object.assign(new Error("Order not found"), { status: 404 });
      if (locked.status === "completed") throw Object.assign(new Error("Cannot refund a completed order"), { status: 400 });
      if (locked.status === "failed")    throw Object.assign(new Error("Order is already failed/refunded"), { status: 400 });

      await tx.update(ordersTable).set({ status: "failed" }).where(eq(ordersTable.id, id));

      // Credit the refund amount back to wallet and record in the ledger
      await creditWallet(locked.userId, parseFloat(locked.price), tx, {
        source: "refund",
        reference: `refund-order-${id}`,
        note: `Refund for order #${id} (${locked.bundleName})`,
      });

      return Number(locked.price);
    });

    res.json({ success: true, refunded });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Refund failed" });
  }
});

router.post("/admin/orders/bulk-status", requireAdmin, async (req, res): Promise<void> => {
  const { ids, status } = req.body as { ids?: unknown; status?: unknown };
  if (!Array.isArray(ids) || ids.length === 0 || typeof status !== "string") {
    res.status(400).json({ error: "ids (array) and status (string) are required" });
    return;
  }
  const VALID_STATUSES = ["pending", "processing", "completed", "failed"] as const;
  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
    return;
  }
  const numIds = ids.map(Number).filter(n => !isNaN(n));
  if (numIds.length === 0) { res.status(400).json({ error: "No valid IDs" }); return; }

  await db.update(ordersTable).set({ status }).where(inArray(ordersTable.id, numIds));
  res.json({ updated: numIds.length });
});

router.post("/admin/orders/complete-processing", requireAdmin, async (req, res): Promise<void> => {
  const processingOrders = await db.select().from(ordersTable).where(eq(ordersTable.status, "processing"));

  if (processingOrders.length === 0) {
    res.json({ updated: 0 });
    return;
  }

  await db.update(ordersTable).set({ status: "completed" }).where(eq(ordersTable.status, "processing"));

  res.json({ updated: processingOrders.length });
});

// ── Users: password reset ─────────────────────────────────────────────────────

router.post("/admin/users/:id/reset-password", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const { default: bcrypt } = await import("bcryptjs");
  const tempPassword = "Reset@" + Math.floor(100000 + Math.random() * 900000);
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const [user] = await db
    .update(usersTable)
    .set({ passwordHash })
    .where(and(eq(usersTable.id, id), isNull(usersTable.deletedAt)))
    .returning();

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // NOTE: tempPassword is intentionally returned to the admin here.
  // When email delivery is configured, send it via email instead of this response.
  res.json({ success: true, tempPassword });
});

// ── Wallets ───────────────────────────────────────────────────────────────────

router.get("/admin/wallets", requireAdmin, async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: walletsTable.id,
      userId: walletsTable.userId,
      balance: walletsTable.balance,
      updatedAt: walletsTable.updatedAt,
      userName: usersTable.name,
      userEmail: usersTable.email,
      userPhone: usersTable.phone,
      userRole: usersTable.role,
      userDepositCode: usersTable.depositCode,
    })
    .from(walletsTable)
    .leftJoin(usersTable, eq(walletsTable.userId, usersTable.id))
    .orderBy(desc(walletsTable.balance))
    .limit(500);

  const depositTotals = await db
    .select({ userId: depositsTable.userId, total: sum(depositsTable.amount) })
    .from(depositsTable)
    .where(eq(depositsTable.status, "completed"))
    .groupBy(depositsTable.userId);

  const orderTotals = await db
    .select({ userId: ordersTable.userId, total: sum(ordersTable.price) })
    .from(ordersTable)
    .groupBy(ordersTable.userId);

  const depMap = new Map(depositTotals.map(d => [d.userId, Number(d.total ?? 0)]));
  const ordMap = new Map(orderTotals.map(o => [o.userId, Number(o.total ?? 0)]));

  res.json(rows.map(w => ({
    id: w.id,
    userId: w.userId,
    balance: Number(w.balance),
    updatedAt: w.updatedAt?.toISOString() ?? null,
    userName: w.userName ?? "Unknown",
    userEmail: w.userEmail ?? "Unknown",
    userPhone: w.userPhone ?? null,
    userRole: w.userRole ?? "user",
    userDepositCode: w.userDepositCode ?? null,
    totalLoaded: depMap.get(w.userId!) ?? 0,
    totalOrders: ordMap.get(w.userId!) ?? 0,
  })));
});

router.post("/admin/wallets/:userId/topup", requireAdmin, async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  const amount = Number(req.body.amount);
  const note   = String(req.body.note ?? "Admin top-up");
  const adminId = req.session.userId!;
  if (isNaN(userId) || isNaN(amount) || amount <= 0) {
    res.status(400).json({ error: "Invalid user ID or amount" }); return;
  }

  const ref = `admin-topup-${adminId}-${Date.now()}`;

  // Atomic: insert audit record, credit wallet, write ledger entry — all or nothing
  const updated = await db.transaction(async (tx) => {
    await tx.insert(depositsTable).values({
      userId,
      amount: amount.toFixed(2),
      method: "admin",
      reference: ref,
      status: "completed",
      note: `${note} (by admin #${adminId})`,
    });
    return creditWallet(userId, amount, tx, {
      source: "admin",
      reference: ref,
      note: `Admin top-up: ${note} (admin #${adminId})`,
    });
  });

  res.json({ balance: Number(updated.balance), message: `GH₵${amount.toFixed(2)} added to wallet` });
});

router.post("/admin/wallets/:userId/debit", requireAdmin, async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  const amount = Number(req.body.amount);
  const note   = String(req.body.note ?? "Admin debit");
  const adminId = req.session.userId!;
  if (isNaN(userId) || isNaN(amount) || amount <= 0) {
    res.status(400).json({ error: "Invalid user ID or amount" }); return;
  }

  const ref = `admin-debit-${adminId}-${Date.now()}`;

  try {
    const updated = await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.userId, userId))
        .for("update");

      if (!wallet) throw Object.assign(new Error("Wallet not found"), { status: 404 });
      const currentBal = Number(wallet.balance);
      if (currentBal < amount) {
        throw Object.assign(
          new Error(`Insufficient balance. Current: GH₵${currentBal.toFixed(2)}`),
          { status: 400 }
        );
      }

      const [debited] = await tx
        .update(walletsTable)
        .set({ balance: sql`${walletsTable.balance} - ${amount.toFixed(2)}::numeric`, updatedAt: new Date() })
        .where(eq(walletsTable.userId, userId))
        .returning();

      // Audit record (positive amount stored separately, method:"admin")
      await tx.insert(depositsTable).values({
        userId,
        amount: (-amount).toFixed(2),
        method: "admin",
        reference: ref,
        status: "completed",
        note: `${note} (by admin #${adminId})`,
      });

      // Immutable ledger entry for the debit
      await insertLedgerEntry(tx, userId, -amount, "debit", "admin", ref, `Admin debit: ${note} (admin #${adminId})`);

      return debited;
    });

    res.json({ balance: Number(updated.balance), message: `GH₵${amount.toFixed(2)} debited from wallet` });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Debit failed" });
  }
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

// ── Deposits ──────────────────────────────────────────────────────────────────

router.get("/admin/deposits", requireAdmin, async (req, res): Promise<void> => {
  const { status } = req.query as { status?: string };
  const conditions: SQL[] = [];
  if (status) conditions.push(eq(depositsTable.status, status));

  const baseQuery = db
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
    .innerJoin(usersTable, eq(depositsTable.userId, usersTable.id));

  const rows = conditions.length > 0
    ? await baseQuery.where(and(...conditions)).orderBy(desc(depositsTable.createdAt)).limit(500)
    : await baseQuery.orderBy(desc(depositsTable.createdAt)).limit(500);

  res.json(rows.map(d => ({ ...d, amount: parseFloat(d.amount) })));
});

router.post("/admin/deposits/:id/approve", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid deposit ID" });
    return;
  }

  let updated: typeof depositsTable.$inferSelect;

  try {
    updated = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(depositsTable)
        .where(eq(depositsTable.id, id))
        .for("update");

      if (!locked) throw Object.assign(new Error("Deposit not found"), { status: 404 });
      if (locked.status !== "pending") {
        throw Object.assign(
          new Error(`Deposit is already ${locked.status}`),
          { status: 400 }
        );
      }

      const [dep] = await tx
        .update(depositsTable)
        .set({ status: "completed", note: `Approved by admin #${req.session.userId!}` })
        .where(eq(depositsTable.id, id))
        .returning();

      await creditWallet(locked.userId, parseFloat(locked.amount), tx, {
        source: locked.method,
        reference: locked.reference ?? undefined,
        note: `Deposit approved GH₵${locked.amount} (admin #${req.session.userId!})`,
      });

      return dep;
    });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Approval failed" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, updated.userId));

  res.json({
    ...updated,
    amount: parseFloat(updated.amount),
    userName: user?.name ?? "",
    userEmail: user?.email ?? "",
  });
});

router.post("/admin/deposits/:id/reject", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
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

// ── Stats / Revenue ───────────────────────────────────────────────────────────

router.get("/admin/stats", requireAdmin, async (req, res): Promise<void> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [totalUsers]       = await db.select({ count: count() }).from(usersTable).where(isNull(usersTable.deletedAt));
  const [totalOrders]      = await db.select({ count: count() }).from(ordersTable);
  const [revenueRow]       = await db.select({ total: sum(ordersTable.price) }).from(ordersTable).where(eq(ordersTable.status, "completed"));
  const [activeBundles]    = await db.select({ count: count() }).from(bundlesTable).where(eq(bundlesTable.isActive, true));
  const [pendingOrders]    = await db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "pending"));
  const [completedOrders]  = await db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "completed"));
  const [processingOrders] = await db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "processing"));
  const [failedOrders]     = await db.select({ count: count() }).from(ordersTable).where(eq(ordersTable.status, "failed"));
  const [recentUsers]      = await db.select({ count: count() }).from(usersTable).where(and(gte(usersTable.createdAt, thirtyDaysAgo), isNull(usersTable.deletedAt)));
  const [recentOrders]     = await db.select({ count: count() }).from(ordersTable).where(gte(ordersTable.createdAt, thirtyDaysAgo));
  const [walletRow]        = await db.select({ total: sum(walletsTable.balance) }).from(walletsTable);

  res.json({
    totalUsers: totalUsers.count,
    totalOrders: totalOrders.count,
    totalRevenue: Number(revenueRow.total ?? 0),
    totalWalletBalance: Number(walletRow?.total ?? 0),
    activeBundles: activeBundles.count,
    pendingOrders: pendingOrders.count,
    completedOrders: completedOrders.count,
    processingOrders: processingOrders.count,
    failedOrders: failedOrders.count,
    recentUsers: recentUsers.count,
    recentOrders: recentOrders.count,
  });
});

router.get("/admin/financial-summary", requireAdmin, async (req, res): Promise<void> => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [completedToday, allCompleted] = await Promise.all([
    db.select({ price: ordersTable.price, buyingCost: bundlesTable.price })
      .from(ordersTable)
      .leftJoin(bundlesTable, eq(ordersTable.bundleId, bundlesTable.id))
      .where(and(eq(ordersTable.status, "completed"), gte(ordersTable.createdAt, todayStart))),
    db.select({ price: ordersTable.price, buyingCost: bundlesTable.price })
      .from(ordersTable)
      .leftJoin(bundlesTable, eq(ordersTable.bundleId, bundlesTable.id))
      .where(eq(ordersTable.status, "completed")),
  ]);

  const todayRevenue   = completedToday.reduce((s, o) => s + Number(o.price), 0);
  const todayProfit    = completedToday.reduce((s, o) => s + (Number(o.price) - Number(o.buyingCost ?? 0)), 0);
  const allTimeRevenue = allCompleted.reduce((s, o) => s + Number(o.price), 0);
  const allTimeProfit  = allCompleted.reduce((s, o) => s + (Number(o.price) - Number(o.buyingCost ?? 0)), 0);

  let paystackBalance: number | null = null;
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  if (paystackSecret) {
    try {
      const r = await fetch("https://api.paystack.co/balance", {
        headers: { Authorization: `Bearer ${paystackSecret}` },
      });
      if (r.ok) {
        const body = await r.json() as {
          status: boolean;
          data: Array<{ currency: string; balance: number }>;
        };
        if (body.status && Array.isArray(body.data) && body.data.length) {
          const ghs = body.data.find(d => d.currency === "GHS") ?? body.data[0];
          paystackBalance = ghs.balance / 100;
        }
      }
    } catch { /* Paystack unreachable — return null */ }
  }

  res.json({ todayRevenue, todayProfit, allTimeRevenue, allTimeProfit, paystackBalance });
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
    if (!byDate[date]) byDate[date] = { revenue: 0, orders: 0 };
    byDate[date].orders += 1;
    if (order.status === "completed") byDate[date].revenue += Number(order.price);
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
    if (!bundleMap[o.bundleId]) bundleMap[o.bundleId] = { name: o.bundleName, orders: 0, revenue: 0 };
    bundleMap[o.bundleId].orders += 1;
    if (o.status === "completed") bundleMap[o.bundleId].revenue += Number(o.price);
  }

  const bundles = await db.select().from(bundlesTable);
  const bundleCategoryMap: Record<number, string> = {};
  for (const b of bundles) bundleCategoryMap[b.id] = b.category;

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

// ── Agents ────────────────────────────────────────────────────────────────────

router.get("/admin/agents/:userId", requireAdmin, async (req, res): Promise<void> => {
  const userId = parseInt(String(req.params.userId), 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const [user] = await db.select().from(usersTable).where(and(eq(usersTable.id, userId), isNull(usersTable.deletedAt)));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.userId, userId));

  const [depTotal] = await db
    .select({ total: sum(depositsTable.amount) })
    .from(depositsTable)
    .where(and(eq(depositsTable.userId, userId), eq(depositsTable.status, "completed")));

  const [ordTotal] = await db
    .select({ total: sum(ordersTable.price), cnt: count() })
    .from(ordersTable)
    .where(eq(ordersTable.userId, userId));

  const [completedOrd] = await db
    .select({ cnt: count() })
    .from(ordersTable)
    .where(and(eq(ordersTable.userId, userId), eq(ordersTable.status, "completed")));

  const [pendingOrd] = await db
    .select({ cnt: count() })
    .from(ordersTable)
    .where(and(eq(ordersTable.userId, userId), inArray(ordersTable.status, ["pending", "processing"])));

  const recentOrders = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.userId, userId))
    .orderBy(desc(ordersTable.createdAt))
    .limit(50);

  const recentDeposits = await db
    .select()
    .from(depositsTable)
    .where(eq(depositsTable.userId, userId))
    .orderBy(desc(depositsTable.createdAt))
    .limit(50);

  const [store] = await db.select().from(storesTable).where(eq(storesTable.userId, userId));

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      depositCode: user.depositCode ?? null,
      createdAt: user.createdAt.toISOString(),
    },
    wallet: {
      balance: wallet ? Number(wallet.balance) : 0,
      updatedAt: wallet?.updatedAt?.toISOString() ?? null,
    },
    stats: {
      totalLoaded: Number(depTotal?.total ?? 0),
      totalOrderValue: Number(ordTotal?.total ?? 0),
      totalOrders: Number(ordTotal?.cnt ?? 0),
      completedOrders: Number(completedOrd?.cnt ?? 0),
      pendingOrders: Number(pendingOrd?.cnt ?? 0),
    },
    recentOrders: recentOrders.map(o => ({
      id: o.id, bundleName: o.bundleName, bundleData: o.bundleData,
      price: Number(o.price), status: o.status,
      phoneNumber: o.phoneNumber, createdAt: o.createdAt.toISOString(),
    })),
    recentDeposits: recentDeposits.map(d => ({
      id: d.id, amount: Number(d.amount), status: d.status,
      method: d.method, reference: d.reference, note: d.note,
      createdAt: d.createdAt.toISOString(),
    })),
    store: store ? { id: store.id, name: store.name, slug: store.slug, isActive: store.isActive } : null,
  });
});

// ── Wallet transactions (combined ledger view) ────────────────────────────────

router.get("/admin/wallet-transactions", requireAdmin, async (req, res) => {
  const {
    agentId = "", type = "all", status = "all",
    source = "all", dateFrom = "", dateTo = "",
    page = "1", pageSize = "50",
  } = req.query as Record<string, string>;

  const wallets = await db.select().from(walletsTable);
  const walletByUser = new Map(wallets.map(w => [w.userId, parseFloat(w.balance)]));

  const deposits = await db
    .select({
      id:          depositsTable.id,
      userId:      depositsTable.userId,
      amount:      depositsTable.amount,
      status:      depositsTable.status,
      method:      depositsTable.method,
      reference:   depositsTable.reference,
      note:        depositsTable.note,
      createdAt:   depositsTable.createdAt,
      userName:    usersTable.name,
      depositCode: usersTable.depositCode,
    })
    .from(depositsTable)
    .leftJoin(usersTable, eq(depositsTable.userId, usersTable.id))
    .where(eq(depositsTable.status, "completed"));

  const orders = await db
    .select({
      id:          ordersTable.id,
      userId:      ordersTable.userId,
      price:       ordersTable.price,
      status:      ordersTable.status,
      bundleName:  ordersTable.bundleName,
      createdAt:   ordersTable.createdAt,
      userName:    usersTable.name,
      depositCode: usersTable.depositCode,
    })
    .from(ordersTable)
    .leftJoin(usersTable, eq(ordersTable.userId, usersTable.id));

  interface TxItem {
    key: string; userId: number; userName: string; depositCode: string | null;
    amount: number; status: string;
    type: "credit" | "debit"; source: string;
    reference: string; note: string | null; date: Date;
  }

  const txns: TxItem[] = [
    ...deposits.map(d => ({
      key: `DEP-${d.id}`,
      userId: d.userId,
      userName: d.userName ?? "Unknown",
      depositCode: d.depositCode ?? null,
      amount: parseFloat(d.amount),
      status: d.status,
      type: "credit" as const,
      source: d.method,
      reference: d.reference || `DEP-${d.id}`,
      note: d.note,
      date: d.createdAt,
    })),
    ...orders.map(o => ({
      key: `ORD-${o.id}`,
      userId: o.userId,
      userName: o.userName ?? "Unknown",
      depositCode: o.depositCode ?? null,
      amount: -parseFloat(o.price),
      status: o.status,
      type: "debit" as const,
      source: "order",
      reference: `#${String(o.id).padStart(6, "0")}`,
      note: o.bundleName,
      date: o.createdAt,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const userTxns = new Map<number, TxItem[]>();
  for (const t of txns) {
    if (!userTxns.has(t.userId)) userTxns.set(t.userId, []);
    userTxns.get(t.userId)!.push(t);
  }
  const balMap = new Map<string, { prev: number; curr: number }>();
  for (const [uid, utxns] of userTxns) {
    let running = walletByUser.get(uid) ?? 0;
    for (const t of utxns) {
      const curr = running;
      const prev = curr - t.amount;
      balMap.set(t.key, { curr, prev });
      running = prev;
    }
  }

  interface ResultTx {
    key: string; ref: string; userId: number; userName: string; agentCode: string;
    date: string; amount: number; prevBalance: number; currBalance: number;
    status: string; type: "credit" | "debit"; source: string; note: string | null;
  }

  let result: ResultTx[] = txns.map(t => {
    const bal = balMap.get(t.key) ?? { prev: 0, curr: 0 };
    return {
      key: t.key, ref: t.reference,
      userId: t.userId, userName: t.userName,
      agentCode: t.depositCode ?? `BT-${String(t.userId).padStart(4, "0")}`,
      date: t.date.toISOString(),
      amount: t.amount,
      prevBalance: Math.round(bal.prev * 100) / 100,
      currBalance: Math.round(bal.curr * 100) / 100,
      status: t.status, type: t.type, source: t.source, note: t.note,
    };
  });

  if (agentId.trim()) {
    const q = agentId.trim().toLowerCase();
    result = result.filter(t =>
      String(t.userId).includes(q) ||
      t.agentCode.toLowerCase().includes(q) ||
      t.userName.toLowerCase().includes(q)
    );
  }
  if (type !== "all")   result = result.filter(t => t.type === type);
  if (status !== "all") result = result.filter(t => t.status === status);
  if (source !== "all") result = result.filter(t => t.source === source);
  if (dateFrom) {
    const from = new Date(dateFrom);
    result = result.filter(t => new Date(t.date) >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo); to.setHours(23, 59, 59, 999);
    result = result.filter(t => new Date(t.date) <= to);
  }

  const total = result.length;
  const pg = Math.max(1, parseInt(page));
  const ps = Math.min(500, Math.max(1, parseInt(pageSize)));
  res.json({ total, page: pg, pageSize: ps, data: result.slice((pg - 1) * ps, pg * ps) });
});

// ── Reconciliation ────────────────────────────────────────────────────────────
// Surfaces two classes of issues that require admin attention:
//   1. Orders stuck in "processing" for > 24 hours (fulfilment may have failed silently)
//   2. Users whose wallet balance diverges from the sum of their ledger entries
//      (only relevant once ledger entries start being written — new balances only)

router.get("/admin/reconcile", requireAdmin, async (req, res): Promise<void> => {
  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const stuckOrders = await db
    .select({ order: ordersTable, network: bundlesTable.network })
    .from(ordersTable)
    .leftJoin(bundlesTable, eq(bundlesTable.id, ordersTable.bundleId))
    .where(and(eq(ordersTable.status, "processing"), lt(ordersTable.updatedAt, threshold)))
    .orderBy(ordersTable.updatedAt);

  const wallets = await db.select().from(walletsTable);

  const ledgerSums = await db
    .select({ userId: walletLedgerTable.userId, total: sum(walletLedgerTable.amount) })
    .from(walletLedgerTable)
    .groupBy(walletLedgerTable.userId);

  const ledgerMap = new Map(ledgerSums.map(l => [l.userId, Number(l.total ?? 0)]));

  // Only report discrepancies for wallets that have ledger entries
  const discrepancies = wallets
    .filter(w => {
      const ls = ledgerMap.get(w.userId!);
      if (ls === undefined) return false; // No entries yet — this wallet predates the ledger
      return Math.abs(Number(w.balance) - ls) > 0.01;
    })
    .map(w => ({
      userId: w.userId,
      walletBalance: Number(w.balance),
      ledgerSum: +(ledgerMap.get(w.userId!) ?? 0).toFixed(2),
      difference: +(Number(w.balance) - (ledgerMap.get(w.userId!) ?? 0)).toFixed(2),
    }));

  res.json({
    summary: {
      stuckOrderCount: stuckOrders.length,
      discrepancyCount: discrepancies.length,
    },
    stuckOrders: stuckOrders.map(r => formatOrder(r.order, r.network)),
    discrepancies,
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────

router.get("/admin/settings", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(settingsTable);
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

router.put("/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body as Record<string, string>;
  if (typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: "Body must be a key-value object" });
    return;
  }
  for (const [key, value] of Object.entries(body)) {
    if (typeof key !== "string" || typeof value !== "string") continue;
    await db.insert(settingsTable)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  }
  const rows = await db.select().from(settingsTable);
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

// ── Store orders (admin) ──────────────────────────────────────────────────────
// (store order complete / reject / store order list handled in stores.ts admin section)

export default router;
