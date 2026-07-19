---
name: Render production DB schema drift
description: This project's production database is external (Render), not Replit-managed — schema changes must be applied manually.
---

# Production database is on Render (external)

The deployed app runs on **Render** (host `*.oregon-postgres.render.com`, app path `/opt/render/project/src`), with its **own external PostgreSQL** separate from this Replit dev database.

**Why this matters:** Replit's Publish-time schema migration does **not** manage this production DB, and `executeSql({ environment: "production" })` does **not** target it. Schema changes made in dev (especially via direct `ALTER TABLE` SQL rather than a tracked migration) do **not** propagate to Render. After a deploy that adds/renames columns, the live app crashes with `column "..." does not exist` (500s) until the same DDL is run against the Render DB.

**How to apply:** When adding DB columns, after deploying, run the matching `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` against the Render database (connect with `pg` + `ssl: { rejectUnauthorized: false }`). To diagnose drift, introspect `information_schema.columns` per table and diff against the Drizzle schema in `lib/db/src/schema/`. Note: Render Postgres throttles rapid reconnects — connections can intermittently fail; retry with a short backoff.

**Self-healing at boot:** `artifacts/api-server/src/lib/ensureSchema.ts` runs idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on every server start (called from `index.ts` before pollers). This makes the deployed app auto-apply needed columns to Render instead of relying on a manual ALTER. Add new drift-prone columns to its `statements` list. It also runs `recoverStuckTopupghBatches()` to requeue orders stranded on stuck/failed batches. Bigger one-time backfills (e.g. the status/delivered split) also live here as gated, transactional blocks (gate = new CHECK constraint added last inside the same tx) — but drop legacy CHECK constraints with `DROP CONSTRAINT IF EXISTS <name>`; if prod's constraint name differs, the backfill violates it and the whole tx silently rolls back (error is caught + logged only). Runbook pattern: verify by conname via `pg_constraint` after deploy (see `docs/render-status-split-runbook.md`).

**Recovery must be periodic, not boot-only:** `recoverStuckTopupghBatches()` MUST run every TopUpGH poll cycle (it's called at the top of `startTopupghPoller`'s poll loop), not just at boot. The dispatcher skips any order with a non-null `topupgh_batch_id`, so an order pinned to a batch that gets stuck *while the server is running* is silently skipped forever (sits at "pending") while newer unpinned orders dispatch — until the next restart. Symptom users report: "old pending orders skipped, new ones dispatched." Recovery covers two pin states: (1) aborted-before-send pending batch with null `topupgh_order_id` older than the grace window → unlink + delete empty batch; (2) safety net: still-pending/paid orders pinned to a `failed` batch → unlink (keep the failed batch as audit).

**Lesson (store_orders.topupgh_batch_id):** when this column existed in dev but not Render, every TopUpGH dispatch threw mid-flight (an UNCONDITIONAL `store_orders` re-select runs even with no store orders) AFTER the batch row was created → batches stuck "pending" with no order id / item count / wallet-deducted, breaking ALL dispatch. Symptom of Render drift is often a half-completed write, not a clean 500.
