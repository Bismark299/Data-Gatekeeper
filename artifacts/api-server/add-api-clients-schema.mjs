/**
 * Production migration: add API key columns to users table.
 * Run once in Render Shell:  node add-api-clients-schema.mjs
 */
import pg from "pg";
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

console.log("Running migration: add API key columns to users...");

await client.query(`
  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS api_key_hash TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS api_key_prefix TEXT,
    ADD COLUMN IF NOT EXISTS api_key_last_used_at TIMESTAMPTZ;
`);
console.log("✓ users.api_key_hash, api_key_prefix, api_key_last_used_at added");

await client.query(`DROP TABLE IF EXISTS api_orders CASCADE;`);
await client.query(`DROP TABLE IF EXISTS api_clients CASCADE;`);
console.log("✓ legacy api_orders / api_clients tables dropped (if present)");

await client.end();
console.log("Migration complete.");
