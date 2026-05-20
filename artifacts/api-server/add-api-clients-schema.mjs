/**
 * Production migration: create api_clients and api_orders tables.
 * Run in Render Shell (or any environment with DATABASE_URL):
 *
 *   node add-api-clients-schema.mjs
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

await pool.query(`
  CREATE TABLE IF NOT EXISTS api_clients (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    email          TEXT NOT NULL,
    key_hash       TEXT NOT NULL UNIQUE,
    key_prefix     TEXT NOT NULL,
    credit_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    notes          TEXT,
    last_used_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS api_orders (
    id               SERIAL PRIMARY KEY,
    api_client_id    INTEGER NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
    reference        TEXT NOT NULL UNIQUE,
    bundle_id        INTEGER NOT NULL REFERENCES bundles(id),
    bundle_name      TEXT NOT NULL,
    bundle_data      TEXT NOT NULL,
    bundle_network   TEXT NOT NULL,
    price            NUMERIC(10,2) NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending',
    phone_number     TEXT NOT NULL,
    mcbis_reference  TEXT,
    topupgh_batch_id INTEGER,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT api_orders_status_check
      CHECK (status IN ('pending','processing','completed','failed'))
  );
`);

console.log("✓ api_clients and api_orders tables created (or already exist).");
await pool.end();
