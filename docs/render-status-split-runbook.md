# Render deploy runbook — order status split

This release splits the order lifecycle into two columns on `orders` and `store_orders`:

- `status` — **payment only**: `pending | paid | failed | refunded` (+ `cancelled` for store orders)
- `delivered` — **fulfillment**: `NULL` (not dispatched) `| processing | delivered | failed`

## What happens automatically

The API server migrates the database **by itself on boot** (`migrateStatusSplit` in
`artifacts/api-server/src/lib/ensureSchema.ts`). It is:

- gated on the new `*_payment_status_check` constraint existing, so it runs exactly once;
- transactional — a partial failure rolls back and retries on the next boot;
- safe to run on both the dev DB and the Render prod DB.

Legacy value mapping applied by the migration:

| table | old status | new (status, delivered) |
|---|---|---|
| orders | completed | (paid, delivered) |
| orders | processing | (paid, processing) |
| orders | pending | (paid, NULL) |
| orders | failed **with** `refund-order-{id}` ledger entry | (refunded, failed) |
| orders | failed **without** refund ledger entry | (paid, failed) — still refundable |
| store_orders | completed | (paid, delivered) |
| store_orders | processing | (paid, processing) |
| store_orders | pending / paid / failed / cancelled | unchanged, delivered = NULL |

## Deploy steps

1. **Deploy at a quiet time.** Old code writes `status='completed'`, which the new CHECK
   rejects — don't leave an old instance running against the migrated DB.
2. Push/redeploy on Render as usual.
3. Watch the boot logs for:
   - `migrateStatusSplit: orders migrated to payment/delivered split`
   - `migrateStatusSplit: store_orders migrated to payment/delivered split`
   - If you instead see `migrateStatusSplit failed`, go to the manual fallback below.
4. Verify (psql against `RENDER_DATABASE_URL`):

```sql
-- Both tables should show ONLY the new constraints:
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN ('orders'::regclass, 'store_orders'::regclass) AND contype = 'c';

-- No legacy values may remain in status ('completed'/'processing' must be gone):
SELECT status, delivered, count(*) FROM orders GROUP BY 1, 2 ORDER BY 1, 2;
SELECT status, delivered, count(*) FROM store_orders GROUP BY 1, 2 ORDER BY 1, 2;
```

5. Smoke-check the app: admin → Orders tabs (Pending/Processing/Completed/Failed/Refunded),
   a store page order tracker, and the user My Orders page.

## Manual fallback (only if the boot log shows `migrateStatusSplit failed`)

Most likely cause: the legacy CHECK constraint on prod has a different name than
`orders_status_check`, so the drop missed it and the backfill UPDATE violated it.

```sql
-- 0. Find the ACTUAL legacy constraint names first:
SELECT conname FROM pg_constraint WHERE conrelid = 'orders'::regclass AND contype = 'c';
SELECT conname FROM pg_constraint WHERE conrelid = 'store_orders'::regclass AND contype = 'c';
```

Then run, substituting the real names in the DROP lines:

```sql
BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered text;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;  -- ← real name here
UPDATE orders SET status = 'paid', delivered = 'delivered'  WHERE status = 'completed';
UPDATE orders SET status = 'paid', delivered = 'processing' WHERE status = 'processing';
-- ORDER MATTERS: ledger-backed refunds first, then the remaining failed rows.
UPDATE orders SET status = 'refunded', delivered = 'failed'
  WHERE status = 'failed'
    AND EXISTS (SELECT 1 FROM wallet_ledger wl WHERE wl.reference = 'refund-order-' || orders.id);
UPDATE orders SET status = 'paid', delivered = 'failed' WHERE status = 'failed';
UPDATE orders SET status = 'paid' WHERE status = 'pending';
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'refunded'));
ALTER TABLE orders ADD CONSTRAINT orders_delivered_check
  CHECK (delivered IS NULL OR delivered IN ('processing', 'delivered', 'failed'));
COMMIT;

BEGIN;
ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS delivered text;
ALTER TABLE store_orders DROP CONSTRAINT IF EXISTS store_orders_status_check;  -- ← real name here
UPDATE store_orders SET status = 'paid', delivered = 'delivered'  WHERE status = 'completed';
UPDATE store_orders SET status = 'paid', delivered = 'processing' WHERE status = 'processing';
ALTER TABLE store_orders ADD CONSTRAINT store_orders_payment_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded'));
ALTER TABLE store_orders ADD CONSTRAINT store_orders_delivered_check
  CHECK (delivered IS NULL OR delivered IN ('processing', 'delivered', 'failed'));
COMMIT;
```

After the manual run, restart the Render service; on boot the migration gate sees the new
constraints and skips itself. Re-run the verification queries from step 4.
