// ─── Shared money-safe order refund ──────────────────────────────────────────
// Locks the order row, guards terminal states, marks it refunded, credits the
// customer's wallet, and records the ledger entries. Used by the single-order
// admin refund route, the bulk cancel-and-refund route, AND the McBIS poller's
// auto-refund on provider cancellation — so all paths behave identically.
// Must be called inside a db.transaction.
//
// Idempotency anchor: the credit ledger entry `refund-order-{id}` (checked under
// the row lock) — independent of orders.status, which other writers can change.

import { eq, and } from "drizzle-orm";
import { db, ordersTable, walletLedgerTable } from "@workspace/db";
import { creditWallet, insertLedgerEntry } from "../routes/wallet";
import { logger } from "./logger";

type OrderRefundTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function refundOrderInTx(
  tx: OrderRefundTx,
  id: number,
  // null = automatic system refund (e.g. provider reported "cancelled");
  // a number = the admin who triggered it (gets an audit ledger entry).
  adminId: number | null,
  opts?: { allowedDelivered?: (string | null)[]; requireNoProviderRef?: boolean },
): Promise<number> {
  const [locked] = await tx
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id))
    .for("update");

  if (!locked) throw Object.assign(new Error("Order not found"), { status: 404 });
  if (locked.delivered === "delivered") throw Object.assign(new Error("Cannot refund a delivered order"), { status: 400 });
  if (locked.status === "refunded") throw Object.assign(new Error("Order is already refunded"), { status: 400 });
  if (locked.status !== "paid") {
    throw Object.assign(new Error(`Order payment status is ${locked.status}; only paid orders can be refunded`), { status: 400 });
  }
  // Callers (e.g. bulk cancel) may restrict which fulfillment states are eligible.
  if (opts?.allowedDelivered && !opts.allowedDelivered.includes(locked.delivered)) {
    throw Object.assign(new Error(`Order delivery state is ${locked.delivered ?? "not dispatched"}; not eligible for bulk cancel`), { status: 400 });
  }
  // An undispatched order (delivered IS NULL) can already be provider-locked (LOCK-*
  // reference set before `delivered` flips to "processing"), so refuse to bulk-refund
  // an undispatched order that has been handed to a provider — that would risk
  // refund + delivery. A delivered='processing' order ALWAYS carries a provider ref
  // (that's how it was dispatched); it is refunded here deliberately. This is
  // money-safe against a late delivery because every settle path requires
  // status='paid', so once this order is refunded no webhook/poll can complete it.
  if (
    opts?.requireNoProviderRef &&
    locked.delivered == null &&
    (locked.mcbisReference || locked.ckgodswayReference || locked.topupghBatchId != null)
  ) {
    throw Object.assign(new Error("Order is already dispatched/in-flight; cancel individually after a delivery check"), { status: 400 });
  }

  // Durable idempotency independent of orders.status (which other writers — admin
  // status routes, provider pollers — can change): never credit twice for the
  // same order. The order row is locked above, so concurrent refunds on this
  // order serialize and the second one sees this committed ledger entry.
  const [existingRefund] = await tx
    .select({ ref: walletLedgerTable.reference })
    .from(walletLedgerTable)
    .where(and(
      eq(walletLedgerTable.reference, `refund-order-${id}`),
      eq(walletLedgerTable.type, "credit"),
    ))
    .limit(1);
  if (existingRefund) throw Object.assign(new Error("Order is already failed/refunded"), { status: 400 });

  await tx.update(ordersTable).set({ status: "refunded" }).where(eq(ordersTable.id, id));

  // Credit the refund amount back to wallet and record in the ledger
  await creditWallet(locked.userId, parseFloat(locked.price), tx, {
    source: "refund",
    reference: `refund-order-${id}`,
    note: `Refund for cancelled order #${id} (${locked.bundleName})`,
  });

  if (adminId != null) {
    // Log the cancellation in the admin's own ledger for audit trail
    await insertLedgerEntry(
      tx, adminId, parseFloat(locked.price), "debit", "order_cancelled",
      `cancel-order-${id}`,
      `Cancelled order #${id} for user #${locked.userId} — GH₵${locked.price} refunded`,
    );
  } else {
    // Automatic refund (no admin actor) — audit trail via server log; the user's
    // own `refund-order-{id}` ledger entry is the durable money record.
    logger.info(
      { orderId: id, userId: locked.userId, amount: locked.price },
      "Auto-refund: provider cancelled order — wallet credited",
    );
  }

  return Number(locked.price);
}
