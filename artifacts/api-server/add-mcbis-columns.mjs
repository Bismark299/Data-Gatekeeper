import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS mcbis_reference TEXT");
await pool.query("ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS mcbis_reference TEXT");
console.log("✓ mcbis_reference columns added to orders + store_orders");
await pool.end();
