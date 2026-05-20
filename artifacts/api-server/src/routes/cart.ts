import { Router } from "express";
import { db, cartItemsTable, bundlesTable, ordersTable, walletsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { eq, and } from "drizzle-orm";
import { AddToCartBody } from "@workspace/api-zod";
import { getOrCreateWallet, insertLedgerEntry } from "./wallet";
import { dispatchToMcbis } from "../lib/mcbis";

const router = Router();

async function getCartWithDetails(userId: number) {
  const [currentUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  const userRole = currentUser?.role ?? "user";

  const items = await db.select({
    id: cartItemsTable.id,
    userId: cartItemsTable.userId,
    bundleId: cartItemsTable.bundleId,
    phoneNumber: cartItemsTable.phoneNumber,
    createdAt: cartItemsTable.createdAt,
    bundleName: bundlesTable.name,
    bundleData: bundlesTable.dataAmount,
    bundleNetwork: bundlesTable.network,
    basePrice:   bundlesTable.price,
    agentPrice:  bundlesTable.agentPrice,
    dealerPrice: bundlesTable.dealerPrice,
  })
    .from(cartItemsTable)
    .innerJoin(bundlesTable, eq(cartItemsTable.bundleId, bundlesTable.id))
    .where(eq(cartItemsTable.userId, userId));

  return items.map(i => {
    const raw =
      userRole === "dealer" ? i.dealerPrice :
      userRole === "agent"  ? i.agentPrice  :
      i.basePrice;
    return { ...i, price: raw != null ? parseFloat(raw) : null };
  });
}

router.get("/", requireAuth, async (req, res) => {
  const items = await getCartWithDetails(req.session.userId!);
  res.json(items);
});

router.post("/", requireAuth, async (req, res) => {
  const parsed = AddToCartBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid cart data" });
    return;
  }

  const { bundleId, phoneNumber } = parsed.data;
  const userId = req.session.userId!;

  const [bundle] = await db.select().from(bundlesTable).where(eq(bundlesTable.id, bundleId));
  if (!bundle || !bundle.isActive) {
    res.status(404).json({ error: "Bundle not found or inactive" });
    return;
  }

  const [currentUserCart] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  const cartUserRole = currentUserCart?.role ?? "user";
  const cartRawPrice =
    cartUserRole === "dealer" ? bundle.dealerPrice :
    cartUserRole === "agent"  ? bundle.agentPrice  :
    bundle.price;

  if (cartRawPrice == null) {
    res.status(400).json({ error: `This bundle is not priced for ${cartUserRole} accounts. Contact admin.` });
    return;
  }

  const [item] = await db.insert(cartItemsTable).values({ userId, bundleId, phoneNumber }).returning();

  res.status(201).json({
    id: item.id,
    userId: item.userId,
    bundleId: item.bundleId,
    phoneNumber: item.phoneNumber,
    createdAt: item.createdAt,
    bundleName: bundle.name,
    bundleData: bundle.dataAmount,
    bundleNetwork: bundle.network,
    price: parseFloat(cartRawPrice),
  });
});

router.delete("/", requireAuth, async (req, res) => {
  await db.delete(cartItemsTable).where(eq(cartItemsTable.userId, req.session.userId!));
  res.status(204).send();
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [item] = await db.select().from(cartItemsTable)
    .where(and(eq(cartItemsTable.id, id), eq(cartItemsTable.userId, req.session.userId!)));

  if (!item) { res.status(404).json({ error: "Item not found" }); return; }

  await db.delete(cartItemsTable).where(eq(cartItemsTable.id, id));
  res.status(204).send();
});

// Checkout: atomically debits wallet, creates all orders, and writes one ledger entry per order.
// SELECT FOR UPDATE on the wallet row prevents concurrent checkouts from double-spending.
// Bundle prices are re-fetched INSIDE the transaction to eliminate TOCTOU race conditions.
router.post("/checkout", requireAuth, async (req, res) => {
  const userId = req.session.userId!;

  // Pre-check outside transaction for early user-facing errors (empty cart, unpriced bundles)
  const preCheck = await getCartWithDetails(userId);
  if (!preCheck.length) {
    res.status(400).json({ error: "Cart is empty" });
    return;
  }
  const unpriced = preCheck.filter(i => i.price == null);
  if (unpriced.length) {
    res.status(400).json({ error: `Some bundles are not priced for your account type: ${unpriced.map(i => i.bundleName).join(", ")}` });
    return;
  }

  await getOrCreateWallet(userId);

  let result: { orders: object[]; totalCharged: number; remainingBalance: number; _dispatch: { orderId: number; network: string; phone: string; bundleData: string }[] };

  try {
    result = await db.transaction(async (tx) => {
      // Re-fetch prices atomically inside the transaction — prevents a price change
      // between the pre-check above and the actual wallet debit (TOCTOU fix)
      const [txUser] = await tx
        .select({ role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      const userRole = txUser?.role ?? "user";

      const txItems = await tx
        .select({
          id: cartItemsTable.id,
          userId: cartItemsTable.userId,
          bundleId: cartItemsTable.bundleId,
          phoneNumber: cartItemsTable.phoneNumber,
          createdAt: cartItemsTable.createdAt,
          bundleName: bundlesTable.name,
          bundleData: bundlesTable.dataAmount,
          bundleNetwork: bundlesTable.network,
          basePrice:   bundlesTable.price,
          agentPrice:  bundlesTable.agentPrice,
          dealerPrice: bundlesTable.dealerPrice,
        })
        .from(cartItemsTable)
        .innerJoin(bundlesTable, eq(cartItemsTable.bundleId, bundlesTable.id))
        .where(and(eq(cartItemsTable.userId, userId), eq(bundlesTable.isActive, true)));

      if (!txItems.length) throw Object.assign(new Error("Cart is empty"), { status: 400 });

      const resolvedItems = txItems.map(i => {
        const raw =
          userRole === "dealer" ? i.dealerPrice :
          userRole === "agent"  ? i.agentPrice  :
          i.basePrice;
        return { ...i, price: raw != null ? parseFloat(raw) : null };
      });

      const txUnpriced = resolvedItems.filter(i => i.price == null);
      if (txUnpriced.length) {
        throw Object.assign(
          new Error(`Some bundles are not priced for your account: ${txUnpriced.map(i => i.bundleName).join(", ")}`),
          { status: 400 }
        );
      }

      const total = resolvedItems.reduce((sum, i) => sum + i.price!, 0);

      const [wallet] = await tx
        .select()
        .from(walletsTable)
        .where(eq(walletsTable.userId, userId))
        .for("update");

      if (!wallet) throw Object.assign(new Error("Wallet not found"), { status: 404 });

      const currentBalance = parseFloat(wallet.balance);
      if (currentBalance < total) {
        throw Object.assign(
          new Error(`Insufficient wallet balance. Need GH₵${total.toFixed(2)}, have GH₵${currentBalance.toFixed(2)}`),
          { status: 400 }
        );
      }

      const newBalance = (currentBalance - total).toFixed(2);
      await tx.update(walletsTable).set({ balance: newBalance }).where(eq(walletsTable.userId, userId));

      const createdOrders = await Promise.all(
        resolvedItems.map(item =>
          tx.insert(ordersTable).values({
            userId,
            bundleId: item.bundleId,
            bundleName: item.bundleName,
            bundleData: item.bundleData,
            price: item.price!.toFixed(2),
            buyingCost: item.basePrice,
            status: "pending",
            phoneNumber: item.phoneNumber,
          }).returning()
        )
      );

      await tx.delete(cartItemsTable).where(eq(cartItemsTable.userId, userId));

      const orders = createdOrders.flat();

      // Write one ledger debit entry per order, all within this transaction
      await Promise.all(
        orders.map(o =>
          insertLedgerEntry(
            tx,
            userId,
            -parseFloat(o.price),
            "debit",
            "cart",
            `order-${o.id}`,
            `${o.bundleName} → ${o.phoneNumber}`,
          )
        )
      );

      return {
        orders: orders.map(o => ({
          id: o.id,
          userId: o.userId,
          bundleId: o.bundleId,
          bundleName: o.bundleName,
          bundleData: o.bundleData,
          price: parseFloat(o.price),
          status: o.status,
          phoneNumber: o.phoneNumber,
          createdAt: o.createdAt,
        })),
        totalCharged: total,
        remainingBalance: parseFloat(newBalance),
        _dispatch: orders.map((o, i) => ({
          orderId:    o.id,
          network:    resolvedItems[i]?.bundleNetwork ?? "",
          phone:      o.phoneNumber,
          bundleData: o.bundleData,
        })),
      };
    });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Checkout failed" });
    return;
  }

  // Fire-and-forget: dispatch each order to McBIS immediately after checkout
  const { _dispatch, ...responseResult } = result;
  _dispatch.forEach(({ orderId, network, phone, bundleData }) => {
    dispatchToMcbis({ orderId, network, phone, bundleData })
      .then(async (outcome) => {
        if (outcome.dispatched) {
          await db.update(ordersTable)
            .set({ status: "processing", mcbisReference: outcome.reference })
            .where(eq(ordersTable.id, orderId));
        }
      })
      .catch(() => {});
  });

  res.json(responseResult);
});

export { router as cartRouter };
