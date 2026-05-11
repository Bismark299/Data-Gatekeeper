import { Router } from "express";
import { db, walletsTable, depositsTable, usersTable, walletLedgerTable, settingsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
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
 * Write a single entry to the wallet ledger.
 * Positive amount = credit, negative = debit.
 * Must be called inside the same transaction as the balance update.
 */
async function insertLedgerEntry(
  client: DbOrTx,
  userId: number,
  amount: number,
  type: "credit" | "debit",
  source: string,
  reference?: string,
  note?: string,
) {
  await client.insert(walletLedgerTable).values({
    userId,
    amount: amount.toFixed(2),
    type,
    source,
    reference: reference ?? null,
    note: note ?? null,
  });
}

/**
 * Atomically increment a wallet balance using a SQL expression.
 * Also writes a ledger entry for every credit.
 * Accepts an optional Drizzle transaction context (tx).
 */
async function creditWallet(
  userId: number,
  amount: number,
  tx?: DbOrTx,
  ledger?: { source: string; reference?: string; note?: string },
) {
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

  let result = updated;

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
    result = created;
  }

  if (ledger) {
    await insertLedgerEntry(client, userId, amount, "credit", ledger.source, ledger.reference, ledger.note);
  }

  return result;
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get("/balance", requireAuth, async (req, res) => {
  const wallet = await getOrCreateWallet(req.session.userId!);
  res.json({ balance: parseFloat(wallet.balance), updatedAt: wallet.updatedAt });
});

router.post("/deposit", requireAdmin, async (req, res) => {
  const parsed = DepositToWalletBody.extend({ userId: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid deposit data — userId, amount are required" });
    return;
  }

  const { amount, method, reference, note, userId } = parsed.data;
  if (!amount || amount <= 0) {
    res.status(400).json({ error: "Amount must be positive" });
    return;
  }

  // Admins cannot credit their own wallet via this endpoint to prevent self-enrichment
  if (userId === req.session.userId) {
    res.status(403).json({ error: "Admins cannot deposit to their own wallet via this endpoint" });
    return;
  }

  // Verify the target user exists
  const [targetUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId));
  if (!targetUser) {
    res.status(404).json({ error: "Target user not found" });
    return;
  }

  // Atomic: insert deposit record + credit wallet + ledger entry in one transaction
  const updated = await db.transaction(async (tx) => {
    const ref = reference ?? `admin-direct-${userId}-${Date.now()}`;
    await tx.insert(depositsTable).values({
      userId,
      amount: amount.toFixed(2),
      status: "completed",
      method: method ?? "mobile_money",
      reference: ref,
      note: note ?? null,
    });
    return creditWallet(userId, amount, tx, { source: method ?? "mobile_money", reference: ref, note: note ?? undefined });
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

router.get("/ledger", requireAuth, async (req, res) => {
  const entries = await db
    .select()
    .from(walletLedgerTable)
    .where(eq(walletLedgerTable.userId, req.session.userId!))
    .orderBy(desc(walletLedgerTable.createdAt))
    .limit(100);

  res.json(entries.map(e => ({
    id: e.id,
    amount: parseFloat(e.amount),
    type: e.type,
    source: e.source,
    reference: e.reference,
    note: e.note,
    createdAt: e.createdAt,
  })));
});

const PaystackInitBodySchema = z.object({ amount: z.number().positive().max(10000) });
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
  const PAYSTACK_FEE_RATE = 0.02; // 2% Paystack processing fee passed to customer
  const feeGhs = parseFloat((amountGhs * PAYSTACK_FEE_RATE).toFixed(2));
  const chargedGhs = parseFloat((amountGhs + feeGhs).toFixed(2));
  const amountPesewas = Math.round(chargedGhs * 100); // what Paystack charges the customer
  const reference = `DB-PS-${userId}-${Date.now()}`;

  const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:5173";
  const callbackUrl = `${appOrigin}/wallet?paystack_ref=${reference}`;

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
      metadata: { userId, amountGhs, feeGhs, chargedGhs },
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
    note: `Awaiting payment confirmation (charged GH₵${chargedGhs.toFixed(2)} incl. 2% fee)`,
  });

  res.json({
    authorizationUrl: paystackData.data.authorization_url,
    reference: paystackData.data.reference,
    amountGhs,
    feeGhs,
    chargedGhs,
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

  if (deposit.status === "completed") {
    const wallet = await getOrCreateWallet(userId);
    res.json({ balance: parseFloat(wallet.balance), updatedAt: wallet.updatedAt });
    return;
  }

  const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  });

  const verifyData = (await verifyRes.json()) as {
    status: boolean;
    data?: { status: string; amount: number; currency: string };
    message?: string;
  };

  if (!verifyData.status || verifyData.data?.status !== "success") {
    // Explicitly mark the deposit as failed so it doesn't stay "pending" forever
    if (verifyData.data?.status === "failed" || verifyData.data?.status === "abandoned") {
      await db.update(depositsTable)
        .set({ status: "failed", note: "Payment cancelled or failed" })
        .where(and(eq(depositsTable.id, deposit.id), eq(depositsTable.status, "pending")));
    }
    res.status(400).json({ error: "Payment not successful yet. Please wait a moment and try again." });
    return;
  }

  const wallet = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(depositsTable)
      .where(and(eq(depositsTable.id, deposit.id), eq(depositsTable.status, "pending")))
      .for("update");

    if (!locked) {
      const [w] = await tx.select().from(walletsTable).where(eq(walletsTable.userId, userId));
      return w;
    }

    await tx
      .update(depositsTable)
      .set({ status: "completed", note: "Paystack payment verified" })
      .where(eq(depositsTable.id, deposit.id));

    return creditWallet(userId, parseFloat(locked.amount), tx, {
      source: "paystack",
      reference: locked.reference ?? undefined,
      note: `Paystack deposit of GH₵${locked.amount}`,
    });
  });

  res.json({ balance: parseFloat(wallet!.balance), updatedAt: wallet!.updatedAt });
});

router.post("/paystack/webhook", async (req, res) => {
  // Mandatory signature verification — reject unconditionally if secret not set or signature absent/invalid
  if (!PAYSTACK_SECRET) {
    res.status(503).send("Webhook not configured");
    return;
  }
  const signature = req.headers["x-paystack-signature"] as string | undefined;
  if (!signature) {
    res.status(401).send("Missing signature");
    return;
  }
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(req.rawBody ?? Buffer.from(JSON.stringify(req.body)))
    .digest("hex");
  if (hash !== signature) {
    res.status(401).send("Invalid signature");
    return;
  }

  const event = req.body as { event: string; data?: { reference: string; status: string } };
  if (event.event === "charge.success" && event.data?.status === "success") {
    const { reference } = event.data;

    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(depositsTable)
        .where(and(eq(depositsTable.reference, reference), eq(depositsTable.status, "pending")))
        .for("update");

      if (!locked) return;

      await tx
        .update(depositsTable)
        .set({ status: "completed", note: "Auto-credited via Paystack webhook" })
        .where(eq(depositsTable.id, locked.id));

      await creditWallet(locked.userId, parseFloat(locked.amount), tx, {
        source: "paystack",
        reference: locked.reference ?? undefined,
        note: `Paystack webhook credit GH₵${locked.amount}`,
      });
    });
  }

  res.sendStatus(200);
});

const MomoClaimBodySchema = z.object({
  amount: z.number().positive().optional(),
  transactionId: z.string().min(3),
});
router.post("/momo/claim", requireAuth, async (req, res) => {
  const parsed = MomoClaimBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Transaction ID is required" });
    return;
  }

  const userId = req.session.userId!;
  const { amount, transactionId } = parsed.data;
  const webhookRef = `MOMO-SMS-EXT-${transactionId}`;

  // Check for existing records:
  //  - direct: user manually submitted this txId before
  //  - webhook: android app forwarded this SMS (may be unmatched or already credited)
  const [existingDirect, existingWebhook] = await Promise.all([
    db.select().from(depositsTable).where(eq(depositsTable.reference, transactionId)),
    db.select().from(depositsTable).where(eq(depositsTable.reference, webhookRef)),
  ]);

  // Already submitted manually before
  if (existingDirect.length > 0) {
    res.status(400).json({ error: "This transaction ID has already been submitted" });
    return;
  }

  // Webhook captured this transaction
  if (existingWebhook.length > 0) {
    const existing = existingWebhook[0];

    // Already credited to someone — cannot claim again
    if (existing.status === "completed" || existing.userId !== null) {
      res.status(400).json({ error: "This transaction was already credited to an account" });
      return;
    }

    // Stored as unmatched — credit it now to this user
    const creditAmount = Number(existing.amount);
    await db.transaction(async (tx) => {
      await tx.update(depositsTable)
        .set({ userId, status: "completed", note: `Claimed by user — wallet credited GH₵${creditAmount.toFixed(2)}`, updatedAt: new Date() })
        .where(eq(depositsTable.reference, webhookRef));
      await creditWallet(userId, creditAmount, tx, {
        source: "momo",
        reference: transactionId,
        note: `MoMo claim GH₵${creditAmount.toFixed(2)} (txId: ${transactionId})`,
      });
    });

    res.json({ message: `GH₵${creditAmount.toFixed(2)} credited to your wallet.` });
    return;
  }

  // No webhook record — create pending claim for admin to verify
  await db.insert(depositsTable).values({
    userId,
    amount: amount != null ? amount.toFixed(2) : "0.00",
    status: "pending",
    method: "momo",
    reference: transactionId,
    note: "Manual claim — pending admin review",
  });

  res.json({
    message: "Claim submitted. Your deposit will be reviewed and credited within a few minutes.",
  });
});

const SMS_WEBHOOK_SECRET = process.env.SMS_WEBHOOK_SECRET ?? "";
const SMS_MAX_AMOUNT = 5000; // GH₵ — reject implausibly large credits

router.post("/sms-webhook", async (req, res) => {
  // Secret is mandatory — reject silently if not configured to avoid info leakage
  if (!SMS_WEBHOOK_SECRET) {
    res.sendStatus(200);
    return;
  }
  const provided = (req.headers["x-sms-secret"] ?? req.query["secret"]) as string | undefined;
  if (!provided || provided !== SMS_WEBHOOK_SECRET) {
    res.status(401).send("Unauthorized");
    return;
  }

  const body = req.body as {
    from?: string; text?: string; sender?: string; message?: string; id?: string;
    amount?: string | number; reference?: string; receivedAt?: number;
  };

  // Require a unique external message ID for deduplication — without it we cannot
  // safely guarantee idempotency, so we silently ignore the message.
  if (!body.id) {
    res.sendStatus(200);
    return;
  }

  const smsText = body.text ?? body.message ?? "";

  // Use pre-parsed amount from app if provided, otherwise extract from SMS text
  let amount: number;
  if (body.amount && Number(body.amount) > 0) {
    amount = Number(body.amount);
  } else {
    const amountMatch = smsText.match(/GH[SC]?\s*([\d,]+\.?\d*)/i);
    amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : 0;
  }

  // Parse sender name from SMS text for display in admin console
  // MTN Ghana format: "You have received GHS X from FIRSTNAME LASTNAME. Your balance..."
  const senderMatch = smsText.match(/from\s+([A-Za-z][A-Za-z ]+?)(?=\.\s|\s+Your|\s+Balance|\s+Trans)/i);
  const parsedSender = senderMatch ? senderMatch[1].trim() : (body.sender ?? "");
  const senderPrefix = parsedSender ? `Sender: ${parsedSender}. ` : "";

  // Use pre-parsed reference from app if provided (whatever agent code the customer typed)
  // Fallback: scan the raw SMS text for a standalone word that could be an agent code
  let depositCode: string | null = null;
  if (body.reference && body.reference.trim().length >= 4) {
    depositCode = body.reference.trim().toUpperCase();
  } else {
    // Try to extract any 4–10 char alphanumeric token from the SMS text
    const refMatch = smsText.match(/\b([A-Z0-9]{4,10})\b/gi);
    if (refMatch) {
      // Find whichever token actually matches a deposit code in the DB (checked below)
      depositCode = refMatch[refMatch.length - 1].toUpperCase();
    }
  }

  if (!amount || amount <= 0) {
    res.sendStatus(200);
    return;
  }

  // Reject implausibly large amounts as a sanity check
  if (amount > SMS_MAX_AMOUNT) {
    res.sendStatus(200);
    return;
  }

  const reference = `MOMO-SMS-EXT-${body.id}`;

  // Check for duplicate by the external transaction ID
  const [existing] = await db
    .select()
    .from(depositsTable)
    .where(eq(depositsTable.reference, reference));

  if (existing) {
    res.json({ success: true, duplicate: true, message: "Already processed" });
    return;
  }

  // If no deposit code found, store as unmatched — user can claim later with transactionId
  if (!depositCode) {
    await db.insert(depositsTable).values({
      userId: null,
      amount: amount.toFixed(2),
      status: "unmatched",
      method: "momo",
      reference,
      note: `${senderPrefix}Unmatched MoMo SMS — no agent code. Raw: ${smsText.slice(0, 200)}`,
    });
    res.json({ success: true, matched: false, message: "Stored for manual claim" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.depositCode, depositCode));
  if (!user) {
    // Agent code present but no matching user — also store unmatched
    await db.insert(depositsTable).values({
      userId: null,
      amount: amount.toFixed(2),
      status: "unmatched",
      method: "momo",
      reference,
      note: `${senderPrefix}Unmatched MoMo SMS — unknown agent code ${depositCode}. Raw: ${smsText.slice(0, 200)}`,
    });
    res.json({ success: true, matched: false, message: "Stored for manual claim" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.insert(depositsTable).values({
      userId: user.id,
      amount: amount.toFixed(2),
      status: "completed",
      method: "momo",
      reference,
      note: `${senderPrefix}Auto-credited from MoMo SMS (ref: ${depositCode}). Raw: ${smsText.slice(0, 200)}`,
    });
    await creditWallet(user.id, amount, tx, {
      source: "momo",
      reference,
      note: `MoMo SMS auto-credit GH₵${amount.toFixed(2)}`,
    });
  });

  res.json({ success: true, matched: true, message: `GH₵${amount.toFixed(2)} credited to ${user.username}` });
});

router.get("/momo-info", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const [user, numRow, nameRow] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, userId)).then(r => r[0]),
    db.select().from(settingsTable).where(eq(settingsTable.key, "momo_number")).then(r => r[0]),
    db.select().from(settingsTable).where(eq(settingsTable.key, "momo_name")).then(r => r[0]),
  ]);
  const referenceCode = user?.depositCode ?? `BT-${String(userId).padStart(6, "0")}`;
  const momoNumber = numRow?.value || MOMO_NUMBER;
  const momoName = nameRow?.value || "";
  res.json({ momoNumber, momoName, referenceCode });
});

export { router as walletRouter, getOrCreateWallet, creditWallet, insertLedgerEntry };
