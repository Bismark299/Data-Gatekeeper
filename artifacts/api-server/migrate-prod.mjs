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

await pool.end();
console.log("✓ Migration complete");
