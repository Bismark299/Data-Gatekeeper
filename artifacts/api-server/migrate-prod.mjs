import pg from "pg";
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Drop NOT NULL on deposits.user_id so unmatched SMS deposits can be stored without a user
await pool.query("ALTER TABLE deposits ALTER COLUMN user_id DROP NOT NULL");
console.log("✓ deposits.user_id is now nullable");

// Add API key columns to users table (idempotent)
await pool.query(`
  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS api_key_hash TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS api_key_prefix TEXT,
    ADD COLUMN IF NOT EXISTS api_key_last_used_at TIMESTAMPTZ
`);
console.log("✓ users api_key columns exist");

// Ensure settings table exists
await pool.query(`
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
console.log("✓ settings table exists");

// Seed momo_number and momo_name if they don't exist yet
await pool.query(`
  INSERT INTO settings (key, value) VALUES ('momo_number', ''), ('momo_name', '')
  ON CONFLICT (key) DO NOTHING
`);
console.log("✓ momo_number and momo_name rows seeded");

// Seed mcbis_auto_sync = "true" (default ON; set to "false" in admin settings to disable poller)
await pool.query(`
  INSERT INTO settings (key, value) VALUES ('mcbis_auto_sync', 'true')
  ON CONFLICT (key) DO NOTHING
`);
console.log("✓ mcbis_auto_sync row seeded");
// Ensure topupgh_batches table exists
await pool.query(`
  CREATE TABLE IF NOT EXISTS topupgh_batches (
    id                SERIAL PRIMARY KEY,
    topupgh_order_id  INTEGER,
    status            TEXT NOT NULL DEFAULT 'pending',
    network           TEXT NOT NULL DEFAULT 'mtn',
    item_count        INTEGER NOT NULL DEFAULT 0,
    items_added       INTEGER NOT NULL DEFAULT 0,
    items_skipped     INTEGER NOT NULL DEFAULT 0,
    total_amount      NUMERIC(10,2),
    wallet_deducted   NUMERIC(10,2),
    previous_balance  NUMERIC(10,2),
    new_balance       NUMERIC(10,2),
    delivery_data     JSONB,
    error_message     TEXT,
    dispatched_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);
console.log("\u2713 topupgh_batches table exists");

// Add topupgh_batch_id column to orders if missing
await pool.query(`
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS topupgh_batch_id INTEGER
`);
console.log("\u2713 orders.topupgh_batch_id column exists");

// Add ckgodsway_reference columns for the CK Godsway fulfillment provider
// (handles Telecel, AT-iShare, AT-BigTime; MTN stays on McBIS/TopUpGH)
await pool.query(`
  ALTER TABLE orders       ADD COLUMN IF NOT EXISTS ckgodsway_reference TEXT;
  ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS ckgodsway_reference TEXT;
`);
console.log("\u2713 ckgodsway_reference columns exist on orders and store_orders");

await pool.end();
console.log("✓ Migration complete");
