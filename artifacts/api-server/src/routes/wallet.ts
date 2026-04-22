import { Router } from "express";
import { db, walletsTable, depositsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { eq, desc } from "drizzle-orm";
import { DepositToWalletBody } from "@workspace/api-zod";

const router = Router();

async function getOrCreateWallet(userId: number) {
  const [existing] = await db.select().from(walletsTable).where(eq(walletsTable.userId, userId));
  if (existing) return existing;
  const [created] = await db.insert(walletsTable).values({ userId, balance: "0.00" }).returning();
  return created;
}

router.get("/balance", requireAuth, async (req, res) => {
  const wallet = await getOrCreateWallet(req.session.userId!);
  res.json({ balance: parseFloat(wallet.balance), updatedAt: wallet.updatedAt });
});

router.post("/deposit", requireAuth, async (req, res) => {
  const parsed = DepositToWalletBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid deposit data" });
    return;
  }

  const { amount, method, reference, note } = parsed.data;
  if (!amount || amount <= 0) {
    res.status(400).json({ error: "Amount must be positive" });
    return;
  }

  const userId = req.session.userId!;

  await db.insert(depositsTable).values({
    userId,
    amount: amount.toFixed(2),
    status: "completed",
    method: method ?? "mobile_money",
    reference: reference ?? null,
    note: note ?? null,
  });

  const wallet = await getOrCreateWallet(userId);
  const newBalance = (parseFloat(wallet.balance) + amount).toFixed(2);
  const [updated] = await db.update(walletsTable)
    .set({ balance: newBalance })
    .where(eq(walletsTable.userId, userId))
    .returning();

  res.json({ balance: parseFloat(updated.balance), updatedAt: updated.updatedAt });
});

router.get("/deposits", requireAuth, async (req, res) => {
  const deposits = await db.select().from(depositsTable)
    .where(eq(depositsTable.userId, req.session.userId!))
    .orderBy(desc(depositsTable.createdAt));

  res.json(deposits.map(d => ({
    id: d.id,
    userId: d.userId,
    amount: parseFloat(d.amount),
    status: d.status,
    method: d.method,
    reference: d.reference,
    note: d.note,
    createdAt: d.createdAt,
  })));
});

export { router as walletRouter, getOrCreateWallet };
