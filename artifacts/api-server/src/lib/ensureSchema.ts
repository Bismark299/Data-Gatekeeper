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
    const freedOrders = await db.execute(sql`
      UPDATE orders SET topupgh_batch_id = NULL
      WHERE status = 'pending' AND topupgh_batch_id IN (
        SELECT id FROM topupgh_batches WHERE status = 'failed'
      )
    `);
    const freedStore = await db.execute(sql`
      UPDATE store_orders SET topupgh_batch_id = NULL
      WHERE status = 'paid' AND topupgh_batch_id IN (
        SELECT id FROM topupgh_batches WHERE status = 'failed'
      )
    `);
    const freedCount =
      ((freedOrders as { rowCount?: number }).rowCount ?? 0) +
      ((freedStore as { rowCount?: number }).rowCount ?? 0);

    if (deletedCount > 0 || freedCount > 0) {
      logger.info(
        { deletedBatches: deletedCount, freedFromFailed: freedCount },
        "Recovered stuck TopUpGH orders (requeued)",
      );
    }
  } catch (err) {
    logger.error({ err }, "recoverStuckTopupghBatches failed");
  }
}
