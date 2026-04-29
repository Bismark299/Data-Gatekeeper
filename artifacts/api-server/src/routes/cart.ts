import { Router } from "express";
import { db, cartItemsTable, bundlesTable, ordersTable, walletsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { eq, and } from "drizzle-orm";
import { AddToCartBody } from "@workspace/api-zod";
import { getOrCreateWallet } from "./wallet";

const router = Router();

async function getCartWithDetails(userId: number) {
  const items = await db.select({
    id: cartItemsTable.id,
    userId: cartItemsTable.userId,
    bundleId: cartItemsTable.bundleId,
    phoneNumber: cartItemsTable.phoneNumber,
    createdAt: cartItemsTable.createdAt,
    bundleName: bundlesTable.name,
    bundleData: bundlesTable.dataAmount,
    bundleNetwork: bundlesTable.network,
    price: bundlesTable.price,
  })
    .from(cartItemsTable)
    .innerJoin(bundlesTable, eq(cartItemsTable.bundleId, bundlesTable.id))
    .where(eq(cartItemsTable.userId, userId));

  return items.map(i => ({ ...i, price: parseFloat(i.price) }));
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
    price: parseFloat(bundle.price),
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

// Checkout: atomically debits wallet and creates all orders.
// SELECT FOR UPDATE on the wallet row prevents concurrent checkouts from
// both reading the same balance and both succeeding (double-spend).
router.post("/checkout", requireAuth, async (req, res) => {
  const userId = req.session.userId!;

  const items = await getCartWithDetails(userId);
  if (!items.length) {
    res.status(400).json({ error: "Cart is empty" });
    return;
  }

  const total = items.reduce((sum, i) => sum + i.price, 0);

  // Ensure wallet exists before entering the transaction
  await getOrCreateWallet(userId);

  let result: { orders: object[]; totalCharged: number; remainingBalance: number };

  try {
    result = await db.transaction(async (tx) => {
      // Lock wallet row — prevents another concurrent checkout from double-spending
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

      // Insert all orders within the same transaction — if any fail, wallet debit rolls back
      const createdOrders = await Promise.all(
        items.map(item =>
          tx.insert(ordersTable).values({
            userId,
            bundleId: item.bundleId,
            bundleName: item.bundleName,
            bundleData: item.bundleData,
            price: item.price.toFixed(2),
            status: "pending",
            phoneNumber: item.phoneNumber,
          }).returning()
        )
      );

      // Clear cart within the same transaction
      await tx.delete(cartItemsTable).where(eq(cartItemsTable.userId, userId));

      const orders = createdOrders.flat().map(o => ({
        id: o.id,
        userId: o.userId,
        bundleId: o.bundleId,
        bundleName: o.bundleName,
        bundleData: o.bundleData,
        price: parseFloat(o.price),
        status: o.status,
        phoneNumber: o.phoneNumber,
        createdAt: o.createdAt,
      }));

      return { orders, totalCharged: total, remainingBalance: parseFloat(newBalance) };
    });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    res.status(e.status ?? 500).json({ error: e.message ?? "Checkout failed" });
    return;
  }

  res.json(result);
});

export { router as cartRouter };
