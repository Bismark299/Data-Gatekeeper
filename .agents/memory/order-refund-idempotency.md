---
name: Order refund / bulk-cancel money-safety
description: Rules for refunding platform orders safely (single + bulk) without double-credit or refund-plus-delivery.
---

# Refunding platform orders safely

Any admin refund/cancel of a platform order credits a real customer wallet, so it must be idempotent and must never race a live delivery.

## Rules

1. **Idempotency must be anchored on the immutable wallet_ledger entry, not orders.status.**
   `orders.status` is mutable by many writers (admin status routes, provider pollers), so a refunded order can be resurrected to `pending`. Guard by checking, inside the refund transaction (after `SELECT ... FOR UPDATE` on the order row), whether a credit ledger row already exists with `reference = refund-order-{id}`; if so, skip. The row lock makes this race-safe. **Why:** `wallet_ledger.reference` has NO DB UNIQUE constraint, and the prod DB is external Render — adding one requires risky manual DDL, so the lock+existence-check gives the same guarantee for this code path.

2. **Bulk cancel is PENDING-only AND must exclude provider-locked orders.**
   A `pending` order can already be in-flight: `mcbis.ts` / `ckgodsway.ts` set `mcbisReference` / `ckgodswayReference` to a `LOCK-*` value (and TopUpGH sets `topupghBatchId`) **while status is still `pending`**, before flipping to `processing`. So bulk refund must require `mcbisReference IS NULL AND ckgodswayReference IS NULL AND topupghBatchId IS NULL` in both preview and the transactional guard, or it risks refund + delivery. `processing` is excluded too. **How to apply:** the single-order refund route stays more permissive (deliberate one-at-a-time admin use after a delivery check); only the bulk path enforces pending + no-provider-ref.

3. **Money-moving previews should fail closed on bad input** (e.g. invalid date filters → 400) rather than silently widening scope.

## Known residual (accepted)
Dispatcher claim UPDATEs are not status-guarded, so a *concurrent* dispatch of a genuinely-idle pending order could still deliver one just refunded. Not fixed here (touching delivery code is broad/risky). Safe in practice because bulk cancel targets stale, long-stuck pending orders with no active dispatch. If you ever bulk-cancel fresh orders, ensure no dispatch is running.
