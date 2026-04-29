import { Router } from "express";
import { db, walletsTable, depositsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { eq, desc, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";
import { DepositToWalletBody } from "@workspace/api-zod";
import { z } from "zod";
import crypto from "crypto";

// Union type that accepts both the top-level db and a transaction context
type DbOrTx = typeof db | NodePgTransaction<any, any>;

const router = Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? "";
const MOMO_NUMBER = process.env.MOMO_NUMBER ?? "0200000000";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOrCreateWallet(userId: number) {
  const [existing] = await db.select().from(walletsTable).where(eq(walletsTable.userId, userId));
  if (existing) return existing;
  const [created] = await db.insert(walletsTable).values({ userId, balance: "0.00" }).returning();
  return created;
}

/**
 * Atomically increment a wallet balance using a SQL expression.
 * Accepts an optional Drizzle transaction context (tx) so callers
 * can use this inside their own transaction.
 */
async function creditWallet(userId: number, amount: number, tx?: DbOrTx) {
  const client = tx ?? db;
  // Upsert wallet row if it doesn't exist yet
  await client
    .insert(walletsTable)
    .values({ userId, balance: amount.toFixed(2) })
    .onConflictDoNothing();

  const [updated] = await client
    .update(walletsTable)
    .set({ balance: sql`balance + ${amount.toFixed(2)}::numeric` })
    .where(eq(walletsTable.userId, userId))
    .returning();

  if (!updated) {
    // Row didn't exist yet (race on insert above) — retry credit
    const [created] = await client
      .insert(walletsTable)
      .values({ userId, balance: amount.toFixed(2) })
      .onConflictDoUpdate({
        target: walletsTable.userId,
        set: { balance: sql`wallets.balance + ${amount.toFixed(2)}::numeric` },
      })
      .returning();
    return created;
  }

  return updated;
}

// ── Routes ────────────────────────────────────────────────────────────────────

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

  // Atomic: insert deposit record + credit wallet in one transaction
  const updated = await db.transaction(async (tx) => {
    await tx.insert(depositsTable).values({
      userId,
      amount: amount.toFixed(2),
      status: "completed",
      method: method ?? "mobile_money",
      reference: reference ?? null,
      note: note ?? null,
    });
    return creditWallet(userId, amount, tx);
  });

  res.json({ balance: parseFloat(updated.balance), updatedAt: updated.updatedAt });
});

router.get("/deposits", requireAuth, async (req, res) => {
  const deposits = await db
    .select()
    .from(depositsTable)
    .where(eq(depositsTable.userId, req.session.userId!))
    .orderBy(desc(depositsTable.createdAt));

  res.json(
    deposits.map((d) => ({
      id: d.id,
      userId: d.userId,
      amount: parseFloat(d.amount),
      status: d.status,
      method: d.method,
      reference: d.reference,
      note: d.note,
      createdAt: d.createdAt,
    }))
  );
});

const PaystackInitBodySchema = z.object({ amount: z.number().positive() });
router.post("/paystack/initialize", requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) {
    res.status(503).json({ error: "Paystack is not configured" });
    return;
  }

  const parsed = PaystackInitBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid amount" });
    return;
  }

  const userId = req.session.userId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const amountGhs = parsed.data.amount;
  const amountPesewas = Math.round(amountGhs * 100);
  const reference = `DB-PS-${userId}-${Date.now()}`;

  const domain = process.env.REPLIT_DOMAINS ?? process.env.REPLIT_DEV_DOMAIN ?? "localhost";
  const callbackUrl = `https://${domain}/wallet?paystack_ref=${reference}`;

  const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: user.email,
      amount: amountPesewas,
      currency: "GHS",
      reference,
      callback_url: callbackUrl,
      metadata: { userId, amountGhs },
    }),
  });

  const paystackData = (await paystackRes.json()) as {
    status: boolean;
    data?: { authorization_url: string; reference: string };
    message?: string;
  };

  if (!paystackData.status || !paystackData.data) {
    res.status(400).json({ error: paystackData.message ?? "Paystack initialization failed" });
    return;
  }

  await db.insert(depositsTable).values({
    userId,
    amount: amountGhs.toFixed(2),
    status: "pending",
    method: "paystack",
    reference,
    note: "Awaiting payment confirmation",
  });

  res.json({
    authorizationUrl: paystackData.data.authorization_url,
    reference: paystackData.data.reference,
  });
});

const PaystackVerifyBodySchema = z.object({ reference: z.string() });
router.post("/paystack/verify", requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) {
    res.status(503).json({ error: "Paystack is not configured" });
    return;
  }

  const parsed = PaystackVerifyBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Reference required" });
    return;
  }

  const userId = req.session.userId!;
  const { reference } = parsed.data;

  // Fetch the deposit first (outside the transaction) to check ownership
  const [deposit] = await db
    .select()
    .from(depositsTable)
    .where(eq(depositsTable.reference, reference));

  if (!deposit) {
    res.status(404).json({ error: "Deposit not found" });
    return;
  }

  if (deposit.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Already completed — idempotent return
  if (deposit.status === "completed") {
    const wallet = await getOrCreateWallet(userId);
    res.json({ balance: parseFloat(wallet.balance), updatedAt: wallet.updatedAt });
    return;
  }

  // Verify with Paystack
  const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  });

  const verifyData = (await verifyRes.json()) as {
    status: boolean;
    data?: { status: string; amount: number; currency: string };
    message?: string;
  };

  if (!verifyData.status || verifyData.data?.status !== "success") {
    res.status(400).json({ error: "Payment not successful yet. Please wait a moment and try again." });
    return;
  }

  // Atomic: flip deposit to completed + credit wallet.
  // SELECT FOR UPDATE prevents concurrent requests from double-crediting.
  const wallet = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(depositsTable)
      .where(and(eq(depositsTable.id, deposit.id), eq(depositsTable.status, "pending")))
      .for("update");

    if (!locked) {
      // Another concurrent request already processed this — return current balance
      const [w] = await tx.select().from(walletsTable).where(eq(walletsTable.userId, userId));
      return w;
    }

    await tx
      .update(depositsTable)
      .set({ status: "completed", note: "Paystack payment verified" })
      .where(eq(depositsTable.id, deposit.id));

    return creditWallet(userId, parseFloat(locked.amount), tx);
  });

  res.json({ balance: parseFloat(wallet!.balance), updatedAt: wallet!.updatedAt });
});

router.post("/paystack/webhook", async (req, res) => {
  const signature = req.headers["x-paystack-signature"] as string;
  if (PAYSTACK_SECRET && signature) {
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== signature) {
      res.status(401).send("Invalid signature");
      return;
    }
  }

  const event = req.body as { event: string; data?: { reference: string; status: string } };
  if (event.event === "charge.success" && event.data?.status === "success") {
    const { reference } = event.data;

    // Atomic: only credit if status is still pending (FOR UPDATE prevents race)
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(depositsTable)
        .where(and(eq(depositsTable.reference, reference), eq(depositsTable.status, "pending")))
        .for("update");

      if (!locked) return; // Already processed

      await tx
        .update(depositsTable)
        .set({ status: "completed", note: "Auto-credited via Paystack webhook" })
        .where(eq(depositsTable.id, locked.id));

      await creditWallet(locked.userId, parseFloat(locked.amount), tx);
    });
  }

  res.sendStatus(200);
});

const MomoClaimBodySchema = z.object({
  amount: z.number().positive(),
  transactionId: z.string().min(3),
});
router.post("/momo/claim", requireAuth, async (req, res) => {
  const parsed = MomoClaimBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Amount and transaction ID are required" });
    return;
  }

  const userId = req.session.userId!;
  const { amount, transactionId } = parsed.data;

  const existing = await db
    .select()
    .from(depositsTable)
    .where(eq(depositsTable.reference, transactionId));

  if (existing.length > 0) {
    res.status(400).json({ error: "This transaction ID has already been submitted" });
    return;
  }

  await db.insert(depositsTable).values({
    userId,
    amount: amount.toFixed(2),
    status: "pending",
    method: "momo",
    reference: transactionId,
    note: "Manual claim — pending admin review",
  });

  res.json({
    message:
      "Claim submitted. Your deposit will be reviewed and credited within a few minutes.",
  });
});

router.post("/sms-webhook", async (req, res) => {
  const body = req.body as { from?: string; text?: string; sender?: string; message?: string };
  const smsText = body.text ?? body.message ?? "";

  const amountMatch = smsText.match(/GH[SC]?\s*([\d,]+\.?\d*)/i);
  const refMatch = smsText.match(/\b(BT-[A-Z0-9]{6})\b/i);

  if (!amountMatch || !refMatch) {
    res.sendStatus(200);
    return;
  }

  const amount = parseFloat(amountMatch[1].replace(/,/g, ""));
  const depositCode = refMatch[1].toUpperCase();

  if (!amount || !depositCode) {
    res.sendStatus(200);
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.depositCode, depositCode));
  if (!user) {
    res.sendStatus(200);
    return;
  }

  const reference = `MOMO-SMS-${user.id}-${Date.now()}`;

  // Atomic: insert deposit record + credit wallet in one transaction
  await db.transaction(async (tx) => {
    await tx.insert(depositsTable).values({
      userId: user.id,
      amount: amount.toFixed(2),
      status: "completed",
      method: "momo",
      reference,
      note: `Auto-credited from MoMo SMS (ref: ${depositCode})`,
    });
    await creditWallet(user.id, amount, tx);
  });

  res.sendStatus(200);
});

router.get("/momo-info", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const referenceCode = user?.depositCode ?? `BT-${String(userId).padStart(6, "0")}`;
  res.json({ momoNumber: MOMO_NUMBER, referenceCode });
});

export { router as walletRouter, getOrCreateWallet, creditWallet };
