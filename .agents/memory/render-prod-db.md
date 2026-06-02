---
name: Render production DB schema drift
description: This project's production database is external (Render), not Replit-managed — schema changes must be applied manually.
---

# Production database is on Render (external)

The deployed app runs on **Render** (host `*.oregon-postgres.render.com`, app path `/opt/render/project/src`), with its **own external PostgreSQL** separate from this Replit dev database.

**Why this matters:** Replit's Publish-time schema migration does **not** manage this production DB, and `executeSql({ environment: "production" })` does **not** target it. Schema changes made in dev (especially via direct `ALTER TABLE` SQL rather than a tracked migration) do **not** propagate to Render. After a deploy that adds/renames columns, the live app crashes with `column "..." does not exist` (500s) until the same DDL is run against the Render DB.

**How to apply:** When adding DB columns, after deploying, run the matching `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` against the Render database (connect with `pg` + `ssl: { rejectUnauthorized: false }`). To diagnose drift, introspect `information_schema.columns` per table and diff against the Drizzle schema in `lib/db/src/schema/`. Note: Render Postgres throttles rapid reconnects — connections can intermittently fail; retry with a short backoff.
