import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Idempotent startup schema guards.
 *
 * The production database is external (Render) and is NOT managed by Replit's
 * publish-time migrations, so columns added in dev do not propagate. Without the
 * matching DDL on Render the live app crashes (e.g. dispatch queries selecting a
 * column that "does not exist"). Running these `ADD COLUMN IF NOT EXISTS`
 * statements at boot makes the deployed app self-heal regardless of which DB it
 * connects to. Each statement is idempotent and safe to run on every start.
 */
export async function ensureSchema(): Promise<void> {
  const statements = [
    sql`ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS topupgh_batch_id integer`,
  ];

  for (const stmt of statements) {
    try {
      await db.execute(stmt);
    } catch (err) {
      logger.error({ err }, "ensureSchema statement failed");
    }
  }

  await migrateStatusSplit();
}

async function hasConstraint(name: string): Promise<boolean> {
  const res = await db.execute(
    sql`SELECT 1 FROM pg_constraint WHERE conname = ${name}`,
  );
  return ((res as { rows?: unknown[] }).rows?.length ?? 0) > 0;
}

/**
 * One-shot split of the legacy dual-purpose `status` column into:
 *   - status    = payment only  (pending | paid | failed | refunded)
 *   - delivered = fulfillment   (NULL | processing | delivered | failed)
 *
 * Legacy mapping (platform orders are wallet-paid at creation, so every
 * non-failed legacy row was already paid):
 *   orders:       completed → (paid, delivered)   processing → (paid, processing)
 *                 pending   → (paid, NULL)        failed     → (refunded, failed)
 *   store_orders: completed → (paid, delivered)   processing → (paid, processing)
 *                 paid      → (paid, NULL)        pending/failed/cancelled unchanged
 *
 * Gated on the NEW check constraint existing — the constraint is added last,
 * inside the same transaction as the backfill, so a partial failure re-runs the
 * whole (idempotent) block on next boot. Safe to run on every start, on both
 * the dev DB and the external Render prod DB.
 */
async function migrateStatusSplit(): Promise<void> {
  try {
    if (!(await hasConstraint("orders_payment_status_check"))) {
      await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered text`);
      await db.transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check`);
        await tx.execute(sql`UPDATE orders SET status = 'paid', delivered = 'delivered' WHERE status = 'completed'`);
        await tx.execute(sql`UPDATE orders SET status = 'paid', delivered = 'processing' WHERE status = 'processing'`);
        // Legacy 'failed' rows: only call them refunded when the refund ledger
        // entry actually exists; the rest stay 'paid' (fulfillment failed, money
        // never returned) so they remain visible as refundable.
        await tx.execute(sql`
          UPDATE orders SET status = 'refunded', delivered = 'failed'
          WHERE status = 'failed'
            AND EXISTS (SELECT 1 FROM wallet_ledger wl WHERE wl.reference = 'refund-order-' || orders.id)
        `);
        await tx.execute(sql`UPDATE orders SET status = 'paid', delivered = 'failed' WHERE status = 'failed'`);
        await tx.execute(sql`UPDATE orders SET status = 'paid' WHERE status = 'pending'`);
        await tx.execute(
          sql`ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check CHECK (status IN ('pending', 'paid', 'failed', 'refunded'))`,
        );
        await tx.execute(
          sql`ALTER TABLE orders ADD CONSTRAINT orders_delivered_check CHECK (delivered IS NULL OR delivered IN ('processing', 'delivered', 'failed'))`,
        );
      });
      logger.info("migrateStatusSplit: orders migrated to payment/delivered split");
    }

    if (!(await hasConstraint("store_orders_payment_status_check"))) {
      await db.execute(sql`ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS delivered text`);
      await db.transaction(async (tx) => {
        // Drop any legacy status CHECK first (name varies by how the DB was created)
        await tx.execute(sql`ALTER TABLE store_orders DROP CONSTRAINT IF EXISTS store_orders_status_check`);
        await tx.execute(sql`UPDATE store_orders SET status = 'paid', delivered = 'delivered' WHERE status = 'completed'`);
        await tx.execute(sql`UPDATE store_orders SET status = 'paid', delivered = 'processing' WHERE status = 'processing'`);
        await tx.execute(
          sql`ALTER TABLE store_orders ADD CONSTRAINT store_orders_payment_status_check CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded'))`,
        );
        await tx.execute(
          sql`ALTER TABLE store_orders ADD CONSTRAINT store_orders_delivered_check CHECK (delivered IS NULL OR delivered IN ('processing', 'delivered', 'failed'))`,
        );
      });
      logger.info("migrateStatusSplit: store_orders migrated to payment/delivered split");
    }
  } catch (err) {
    logger.error({ err }, "migrateStatusSplit failed");
  }
}

/**
 * Recover orders stranded on stuck TopUpGH batches.
 *
 * Two stuck states pin an order to a dead batch. Because the dispatcher and the
 * McBIS poller both skip any order that already has a topupgh_batch_id, a pinned
 * order is silently skipped forever while newer (unpinned) orders keep
 * dispatching — the order just sits at "pending". The two states:
 *
 *  1. Aborted-before-send: a dispatch creates the batch row and links orders but
 *     throws before reaching TopUpGH (e.g. schema drift). The batch is left
 *     "pending" with no topupgh_order_id and its orders keep the link. We unlink
 *     them and delete the empty batch (nothing was sent, no funds moved). Only
 *     batches older than the grace window are touched so an in-flight dispatch is
 *     never disturbed.
 *  2. Failed batch with a missed unlink: a batch marked "failed" should have had
 *     its orders unlinked, but if that unlink ever partially failed the orders
 *     stay pinned. Any still-pending order linked to a failed batch is freed
 *     (the failed batch row is kept as an audit record).
 *
 * This MUST run periodically (every poll cycle), not only at boot — batches that
 * get stuck while the server is running would otherwise never recover until the
 * next restart.
 */
export async function recoverStuckTopupghBatches(): Promise<void> {
  try {
    // (1) Aborted-before-send: unlink orders, then delete the empty pending batch.
    await db.execute(sql`
      UPDATE orders SET topupgh_batch_id = NULL
      WHERE topupgh_batch_id IN (
        SELECT id FROM topupgh_batches
        WHERE status = 'pending' AND topupgh_order_id IS NULL
          AND created_at < now() - interval '5 minutes'
      )
    `);
    await db.execute(sql`
      UPDATE store_orders SET topupgh_batch_id = NULL
      WHERE topupgh_batch_id IN (
        SELECT id FROM topupgh_batches
        WHERE status = 'pending' AND topupgh_order_id IS NULL
          AND created_at < now() - interval '5 minutes'
      )
    `);
    const deleted = await db.execute(sql`
      DELETE FROM topupgh_batches
      WHERE status = 'pending' AND topupgh_order_id IS NULL
        AND created_at < now() - interval '5 minutes'
    `);
    const deletedCount = (deleted as { rowCount?: number }).rowCount ?? 0;

    // (2) Safety net: free still-unfulfilled orders pinned to a failed batch.
    // "Unfulfilled" = paid but never dispatched (delivered IS NULL) — parked
    // (delivered='processing') orders are deliberately excluded (see (3)).
    const freedOrders = await db.execute(sql`
      UPDATE orders SET topupgh_batch_id = NULL
      WHERE status = 'paid' AND delivered IS NULL AND topupgh_batch_id IN (
        SELECT id FROM topupgh_batches WHERE status = 'failed'
      )
    `);
    const freedStore = await db.execute(sql`
      UPDATE store_orders SET topupgh_batch_id = NULL
      WHERE status = 'paid' AND delivered IS NULL AND topupgh_batch_id IN (
        SELECT id FROM topupgh_batches WHERE status = 'failed'
      )
    `);
    const freedCount =
      ((freedOrders as { rowCount?: number }).rowCount ?? 0) +
      ((freedStore as { rowCount?: number }).rowCount ?? 0);

    // (3) Crash-during-send: a batch left in 'dispatching' (the durable marker set
    // just before the create-order call) that never resolved means the process
    // died after the request was issued but before the result was recorded. The
    // order MAY have been created + charged at TopUpGH, so it is AMBIGUOUS — never
    // requeue it. Park the orders as delivered='processing' (excluded from
    // re-dispatch and from the failed-batch safety-net above) and fail the batch
    // for manual review. The 5-minute age guard avoids touching a dispatch that is
    // legitimately in-flight (a normal create-order resolves in seconds).
    await db.execute(sql`
      UPDATE orders SET delivered = 'processing'
      WHERE status = 'paid' AND delivered IS NULL AND topupgh_batch_id IN (
        SELECT id FROM topupgh_batches
        WHERE status = 'dispatching' AND created_at < now() - interval '5 minutes'
      )
    `);
    await db.execute(sql`
      UPDATE store_orders SET delivered = 'processing'
      WHERE status = 'paid' AND delivered IS NULL AND topupgh_batch_id IN (
        SELECT id FROM topupgh_batches
        WHERE status = 'dispatching' AND created_at < now() - interval '5 minutes'
      )
    `);
    const parked = await db.execute(sql`
      UPDATE topupgh_batches
      SET status = 'failed', error_message = 'Process crashed mid-dispatch — UNCONFIRMED, manual review'
      WHERE status = 'dispatching' AND created_at < now() - interval '5 minutes'
    `);
    const parkedCount = (parked as { rowCount?: number }).rowCount ?? 0;

    if (deletedCount > 0 || freedCount > 0 || parkedCount > 0) {
      logger.info(
        { deletedBatches: deletedCount, freedFromFailed: freedCount, parkedAmbiguous: parkedCount },
        "Recovered stuck TopUpGH orders",
      );
    }
  } catch (err) {
    logger.error({ err }, "recoverStuckTopupghBatches failed");
  }
}
