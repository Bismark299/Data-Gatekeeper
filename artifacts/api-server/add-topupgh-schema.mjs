/**
 * Production migration: TopUpGH schema
 *
 * Run on Render via the Shell tab:
 *   DATABASE_URL="postgresql://..." node add-topupgh-schema.mjs
 *
 * Or from the Render dashboard → your service → Shell:
 *   node add-topupgh-schema.mjs
 *
 * Safe to re-run — all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING.
 */

import pg from "pg";
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

console.log("Starting TopUpGH schema migration...\n");

// ── 1. topupgh_batches table ──────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS topupgh_batches (
    id               SERIAL PRIMARY KEY,
    topupgh_order_id INTEGER,
    status           TEXT NOT NULL DEFAULT 'pending',
    network          TEXT NOT NULL DEFAULT 'mtn',
    item_count       INTEGER NOT NULL DEFAULT 0,
    items_added      INTEGER NOT NULL DEFAULT 0,
    items_skipped    INTEGER NOT NULL DEFAULT 0,
    total_amount     NUMERIC(10,2),
    wallet_deducted  NUMERIC(10,2),
    previous_balance NUMERIC(10,2),
    new_balance      NUMERIC(10,2),
    delivery_data    JSONB,
    error_message    TEXT,
    dispatched_at    TIMESTAMP WITH TIME ZONE,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  )
`);
console.log("✓ topupgh_batches table exists");

// ── 2. orders.topupgh_batch_id column ────────────────────────────────────────
await pool.query(`
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS topupgh_batch_id INTEGER
`);
console.log("✓ orders.topupgh_batch_id column exists");

// ── 3. orders.mcbis_reference column (added in earlier migration) ─────────────
await pool.query(`
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS mcbis_reference TEXT
`);
console.log("✓ orders.mcbis_reference column exists");

// ── 4. orders.buying_cost column (added in earlier migration) ─────────────────
await pool.query(`
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS buying_cost NUMERIC(10,2)
`);
console.log("✓ orders.buying_cost column exists");

// ── 5. Seed TopUpGH settings keys ────────────────────────────────────────────
await pool.query(`
  INSERT INTO settings (key, value) VALUES
    ('topupgh_enabled',   'false'),
    ('topupgh_min_batch', '5'),
    ('topupgh_max_batch', '50')
  ON CONFLICT (key) DO NOTHING
`);
console.log("✓ topupgh settings keys seeded");

// ── 6. Seed mcbis_enabled key if missing ─────────────────────────────────────
await pool.query(`
  INSERT INTO settings (key, value) VALUES ('mcbis_enabled', 'false')
  ON CONFLICT (key) DO NOTHING
`);
console.log("✓ mcbis_enabled settings key exists");

await pool.end();
console.log("\n✓ Migration complete — your production DB is ready for TopUpGH.");
