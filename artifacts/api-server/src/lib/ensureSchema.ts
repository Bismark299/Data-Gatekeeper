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
 * If a dispatch aborts after the batch row is created and orders are linked but
 * before anything is sent to TopUpGH (e.g. a schema-drift error mid-dispatch),
 * the batch is left "pending" with no topupgh_order_id and its orders keep a
 * topupgh_batch_id pointing at a dead batch. Both the dispatcher and the McBIS
 * poller skip already-linked orders, so without recovery those orders would
 * never be fulfilled. We only touch batches that never reached TopUpGH (no
 * order id) and are older than the grace window, so an in-flight dispatch is
 * never disturbed. Unlinking lets the orders requeue on the next cycle; the
 * empty batch row is then deleted (nothing was sent, no funds moved).
 */
export async function recoverStuckTopupghBatches(): Promise<void> {
  try {
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
    const count = (deleted as { rowCount?: number }).rowCount ?? 0;
    if (count > 0) logger.info({ count }, "Recovered stuck TopUpGH batches (orders requeued)");
  } catch (err) {
    logger.error({ err }, "recoverStuckTopupghBatches failed");
  }
}
