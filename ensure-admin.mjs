/**
 * ensure-admin.mjs
 *
 * Upserts the admin user from environment variables before the server starts.
 * Run this before the main server process on Render (see Start Command).
 *
 * Required env vars:
 *   ADMIN_EMAIL     — admin login email
 *   ADMIN_PASSWORD  — admin login password (plain text; will be hashed)
 *   ADMIN_NAME      — (optional) display name, defaults to "Admin"
 *   DATABASE_URL    — PostgreSQL connection string
 */

import pg from "pg";
import bcrypt from "bcryptjs";

const { Client } = pg;

const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = "Admin" } = process.env;

if (!DATABASE_URL) {
  console.error("❌  DATABASE_URL is not set.");
  process.exit(1);
}
if (!ADMIN_EMAIL) {
  console.error("❌  ADMIN_EMAIL is not set.");
  process.exit(1);
}
if (!ADMIN_PASSWORD) {
  console.error("❌  ADMIN_PASSWORD is not set.");
  process.exit(1);
}

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

// Ensure sessions table exists (connect-pg-simple cannot auto-create it when bundled)
await client.query(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid  varchar      NOT NULL COLLATE "default",
    sess json         NOT NULL,
    expire timestamp(6) NOT NULL,
    CONSTRAINT sessions_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
  ) WITH (OIDS=FALSE);
  CREATE INDEX IF NOT EXISTS IDX_sessions_expire ON sessions (expire);
`);
console.log('✅  sessions table ensured');

const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

await client.query(
  `INSERT INTO users (name, email, password_hash, role, is_active)
   VALUES ($1, $2, $3, 'admin', true)
   ON CONFLICT (email)
   DO UPDATE SET
     name          = EXCLUDED.name,
     password_hash = EXCLUDED.password_hash,
     role          = 'admin',
     is_active     = true`,
  [ADMIN_NAME, ADMIN_EMAIL, passwordHash],
);

console.log(`✅  Admin user ensured: ${ADMIN_EMAIL}`);

await client.end();
