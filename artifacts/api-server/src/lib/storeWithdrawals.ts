/**
 * Agent store profit-withdrawal processing.
 *
 * This module centralizes the Paystack transfer lifecycle for agent payouts so
 * the withdraw route, admin approve/bulk-approve, the transfer webhook, and the
 * background stuck-checker all share one correct, idempotent implementation.
 *
 * Money model on this platform: the withdrawal amount + GH₵1 fee is deducted
 * from `stores.profit_balance` at request time. So:
 *   - completing a transfer requires NO balance change (already deducted)
 *   - a failed / reversed / cancelled transfer must REFUND amount + fee
 *
 * All terminal transitions are row-locked and status-guarded so the webhook and
 * the reconciler can both fire without double-completing or double-refunding.
 */

import { eq, and, inArray, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, storesTable, storeWithdrawalsTable } from "@workspace/db";
import { logger } from "./logger";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? "";
export const WITHDRAWAL_FEE = 1;

type Withdrawal = typeof storeWithdrawalsTable.$inferSelect;
type Store = typeof storesTable.$inferSelect;

/** Generate a unique transfer reference that Paystack echoes back in webhooks. */
export function genWithdrawalReference(): string {
  return `WD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Paystack HTTP helpers ──────────────────────────────────────────────────

/** Current GHS balance sitting in the Paystack account, in cedis. 0 on failure. */
export async function getPaystackBalanceGHS(): Promise<number> {
  try {
    const res = await fetch("https://api.paystack.co/balance", {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    });
    const data = await res.json() as { status: boolean; data?: { currency: string; balance: number }[] };
    if (data.status && data.data) {
      const ghs = data.data.find(b => b.currency === "GHS");
      return ghs ? ghs.balance / 100 : 0;
    }
  } catch (err) {
    logger.warn({ err }, "Paystack balance check failed");
  }
  return 0;
}

/**
 * Returns a Paystack transfer recipient code for the withdrawal's account.
 * Reuses the cached code on the store when the withdrawal targets the same
 * saved MoMo account, otherwise creates a fresh recipient.
 */
export async function getOrCreateRecipient(store: Store, w: Withdrawal): Promise<string> {
  // The store only ever stores a mobile-money payout account, so the cache is
  // only valid for mobile_money withdrawals that target that saved account.
  const usesSavedAccount =
    w.method !== "bank" &&
    !!store.momoNumber &&
    store.momoNumber === w.accountNumber &&
    (store.momoNetwork ?? "") === (w.bankCode ?? "");

  if (usesSavedAccount && store.paystackRecipientCode) {
    return store.paystackRecipientCode;
  }

  const recipientType = w.method === "bank" ? "ghipss" : "mobile_money";
  const res = await fetch("https://api.paystack.co/transferrecipient", {
    method: "POST",
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: recipientType,
      name: w.accountName || store.name,
      account_number: w.accountNumber,
      bank_code: w.bankCode || "MTN",
      currency: "GHS",
    }),
  });
  const data = await res.json() as { data?: { recipient_code?: string }; message?: string };
  const code = data.data?.recipient_code;
  if (!res.ok || !code) throw new Error(data.message ?? "Failed to create transfer recipient");

  // Cache for reuse only when this is the agent's saved account
  if (usesSavedAccount) {
    await db.update(storesTable)
      .set({ paystackRecipientCode: code })
      .where(eq(storesTable.id, store.id));
  }
  return code;
}

/** Initiate a Paystack transfer. Returns the transfer code and Paystack status. */
export async function initiateTransfer(opts: {
  amount: number;
  recipientCode: string;
  reference: string;
  reason: string;
}): Promise<{ transferCode: string; status: string }> {
  const res = await fetch("https://api.paystack.co/transfer", {
    method: "POST",
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "balance",
      amount: Math.round(opts.amount * 100),
      recipient: opts.recipientCode,
      reference: opts.reference,
      reason: opts.reason,
      currency: "GHS",
    }),
  });
  const data = await res.json() as { data?: { transfer_code?: string; status?: string }; message?: string };
  if (!res.ok) throw new Error(data.message ?? "Transfer initiation failed");
  return { transferCode: data.data?.transfer_code ?? "", status: data.data?.status ?? "" };
}

/** Look up the live Paystack status for a transfer by our reference. null on failure. */
export async function verifyPaystackTransfer(reference: string): Promise<string | null> {
  if (!reference) return null;
  try {
    const res = await fetch(`https://api.paystack.co/transfer/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    });
    const data = await res.json() as { status: boolean; data?: { status?: string } };
    if (data.status && data.data?.status) return data.data.status;
  } catch (err) {
    logger.warn({ err, reference }, "Paystack transfer verify failed");
  }
  return null;
}

// ─── Idempotent terminal transitions ────────────────────────────────────────

/** Mark a withdrawal completed. Idempotent: only acts on pending/processing rows. */
export async function markWithdrawalCompleted(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(storeWithdrawalsTable)
      .where(eq(storeWithdrawalsTable.id, id)).for("update");
    if (!locked || (locked.status !== "pending" && locked.status !== "processing")) return;
    await tx.update(storeWithdrawalsTable)
      .set({ status: "completed" })
      .where(eq(storeWithdrawalsTable.id, id));
  });
}

/**
 * Mark a withdrawal failed and refund amount + fee to the store's profit balance.
 * Idempotent: only acts on pending/processing rows, so the webhook and the
 * reconciler can't both refund the same withdrawal.
 */
export async function markWithdrawalFailedAndRefund(id: number, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(storeWithdrawalsTable)
      .where(eq(storeWithdrawalsTable.id, id)).for("update");
    if (!locked || (locked.status !== "pending" && locked.status !== "processing")) return;

    await tx.update(storeWithdrawalsTable)
      .set({ status: "failed", failureReason: reason.slice(0, 200) })
      .where(eq(storeWithdrawalsTable.id, id));

    const refund = parseFloat(locked.amount) + WITHDRAWAL_FEE;
    await tx.update(storesTable)
      .set({ profitBalance: sql`profit_balance + ${refund.toFixed(2)}::numeric` })
      .where(eq(storesTable.id, locked.storeId));
  });
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export interface TransferResult {
  status: "pending" | "processing" | "completed";
  transferCode: string;
  autoMessage: "sent" | "processing" | "awaiting_admin";
}

/**
 * Attempt to send a withdrawal via Paystack. Never throws — on any failure
 * (insufficient Paystack balance, OTP required, API error) it returns a
 * "pending" result so the request lands in the admin queue.
 */
export async function processWithdrawalTransfer(w: Withdrawal, store: Store): Promise<TransferResult> {
  const amount = parseFloat(w.amount);
  const pending: TransferResult = { status: "pending", transferCode: "", autoMessage: "awaiting_admin" };

  const balance = await getPaystackBalanceGHS();
  if (balance < amount) return pending;

  try {
    const recipientCode = await getOrCreateRecipient(store, w);
    const { transferCode, status } = await initiateTransfer({
      amount,
      recipientCode,
      reference: w.reference,
      reason: w.note || `Profit withdrawal - ${store.name}`,
    });

    // OTP enabled on the Paystack account → can't auto-complete; leave for admin
    if (status === "otp") return { status: "pending", transferCode, autoMessage: "awaiting_admin" };

    if (status === "success") return { status: "completed", transferCode, autoMessage: "sent" };
    return { status: "processing", transferCode, autoMessage: "processing" };
  } catch (err) {
    logger.warn({ err, withdrawalId: w.id }, "Auto transfer failed; queued for admin");
    return pending;
  }
}

// ─── Transfer webhook handler ────────────────────────────────────────────────

/**
 * Handle Paystack transfer.* webhook events for agent payouts.
 * Matches the withdrawal by our reference (preferred) or the transfer code.
 */
export async function handleStoreTransferWebhook(body: {
  event: string;
  data?: { reference?: string; transfer_code?: string; status?: string };
}): Promise<void> {
  const { event, data } = body;
  if (!data) return;
  const reference = data.reference ?? "";
  const transferCode = data.transfer_code ?? "";

  let row: Withdrawal | undefined;
  if (reference) {
    [row] = await db.select().from(storeWithdrawalsTable)
      .where(eq(storeWithdrawalsTable.reference, reference));
  }
  if (!row && transferCode) {
    [row] = await db.select().from(storeWithdrawalsTable)
      .where(eq(storeWithdrawalsTable.transferCode, transferCode));
  }
  if (!row) return;

  if (event === "transfer.success") {
    await markWithdrawalCompleted(row.id);
  } else if (event === "transfer.failed" || event === "transfer.reversed") {
    await markWithdrawalFailedAndRefund(row.id, `Paystack ${event.replace("transfer.", "")}`);
  }
}

// ─── Background stuck-checker ────────────────────────────────────────────────

const RECONCILE_INTERVAL_MS = 3 * 60 * 1000; // every 3 minutes
const STUCK_AFTER_MS = 2 * 60 * 1000;        // older than 2 minutes in "processing"

async function reconcileStuckWithdrawals(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const stuck = await db.select().from(storeWithdrawalsTable)
    .where(and(
      eq(storeWithdrawalsTable.status, "processing"),
      lt(storeWithdrawalsTable.updatedAt, cutoff),
    ));
  if (stuck.length === 0) return;

  for (const w of stuck) {
    const status = await verifyPaystackTransfer(w.reference) ??
      (w.transferCode ? await verifyTransferByCode(w.transferCode) : null);
    if (!status) continue;
    if (status === "success") {
      await markWithdrawalCompleted(w.id);
      logger.info({ withdrawalId: w.id }, "Reconciler completed stuck withdrawal (webhook missed)");
    } else if (status === "failed" || status === "reversed") {
      await markWithdrawalFailedAndRefund(w.id, `Reconciler: transfer ${status}`);
      logger.info({ withdrawalId: w.id, status }, "Reconciler refunded failed withdrawal");
    }
    // "pending"/"otp" → leave for the next pass
  }
}

/** Fallback lookup by transfer code when no reference is stored. */
async function verifyTransferByCode(transferCode: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.paystack.co/transfer/${encodeURIComponent(transferCode)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    });
    const data = await res.json() as { status: boolean; data?: { status?: string } };
    if (data.status && data.data?.status) return data.data.status;
  } catch (err) {
    logger.warn({ err, transferCode }, "Paystack transfer lookup by code failed");
  }
  return null;
}

export function startWithdrawalReconciler(): void {
  if (!PAYSTACK_SECRET) {
    logger.info("Withdrawal reconciler disabled (no Paystack secret)");
    return;
  }
  setInterval(() => {
    reconcileStuckWithdrawals().catch((err) => logger.error({ err }, "Withdrawal reconciler pass failed"));
  }, RECONCILE_INTERVAL_MS);
  logger.info("Withdrawal reconciler started (every 3 min)");
}
