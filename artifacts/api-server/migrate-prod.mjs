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

await pool.end();
console.log("✓ Migration complete");
