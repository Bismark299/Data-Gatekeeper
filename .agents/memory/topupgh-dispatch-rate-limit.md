---
name: TopUpGH dispatch (instant) + ambiguous-outcome safety
description: How TopUpGH MTN dispatch fires instantly without rate-limit failures, and the non-obvious rule that any unconfirmed create-order outcome must park orders as 'processing' (never unlink) to avoid double-charge.
---

# TopUpGH dispatch: instant + double-delivery safety

## Instant dispatch
Dispatch is **instant**, not one-batch-per-poll. A serialized in-process runner
(single `dispatchRunning` lock + `rerunRequested` coalescing) fires the moment
`min_batch` is reached. It self-tunes the gap between create-order calls (floor
~8s, cap ~90s; first call instant, ×2 on rate_limited, ×0.8 on success) to ride
just under TopUpGH's throttle. The 2-min poller is now only a backup trigger +
delivery-status checker + stuck-batch recovery. (Supersedes the older
"one batch per 2-min cycle" rule.)

## Unconfirmed outcomes are resolved by TopUpGH WALLET BALANCE delta (not blind park)
Earlier this always parked. Blind parking stranded too many genuinely-unsent orders
in 'processing' (manual toil) — the user pushed back hard ("you are making things
bad"). The fix uses the merchant TopUpGH wallet balance as a hard financial signal,
because a successful create-order deducts it and a request that never landed does not.

`resolveAmbiguous(context)`:
- capture `preBalance` during the existing pre-flight balance check;
- on an unconfirmed outcome, **wait `BALANCE_SETTLE_MS` (~2.5s)** then read `postBalance`;
- balance **dropped** (>0.01) → order LANDED → `parkAmbiguous` (never resend), returns `ambiguous_landed`;
- balance **unchanged** → nothing charged → `unlinkAll()` + delete batch → returns `retry_safe` (runner re-queues, like rate_limited but no backoff);
- balance **undeterminable** (pre or post null) → `parkAmbiguous` (safe default), returns `ambiguous`.

**Why a global lock is mandatory here:** the balance-delta is only attributable to
THIS batch if no other create-order can deduct in the window. The in-process runner
lock is NOT enough — admin force-dispatch calls `dispatchPendingQueue(true)` directly,
and Render rolling deploys briefly overlap pods. So `dispatchPendingQueue` is a thin
wrapper that takes a **Postgres advisory lock** (`pg_try_advisory_lock(DISPATCH_LOCK_KEY)`)
on a **dedicated `pool.connect()` client** (same client for lock+unlock; unlock in
inner finally, `client.release()` in outer finally), then calls the renamed
`dispatchPendingQueueLocked`. Not acquired → returns reason `busy` BEFORE creating any
batch (orders stay pending, lock holder drains the global queue). Runner treats `busy`
as a quiet stop. The "resend" path (retry_safe) is the only financially dangerous
direction — global serialization + settle delay are what make it safe.

**Still true:** `recoverStuckTopupghBatches()` re-frees only `pending`/`paid` orders
from `failed` batches, so parked orders MUST be `status='processing'` to dodge both
dispatch selection AND the safety-net. You cannot invent a new order status —
`orders.status` has a DB CHECK and prod is external Render (migrations don't propagate).

## Create-order outcome classification (only these unlink+retry)
"Proven nothing was created" — safe to `unlinkAll()` + retry:
- HTTP 429 OR message matches `/rate.?limit/` → delete the empty batch + retry.
- Explicit `result.success === false`, OR a hard 4xx (>=400 && <500).

Everything else is AMBIGUOUS → `parkAmbiguous` (no unlink):
- Thrown error / timeout (AbortSignal) — request may have landed.
- HTTP 5xx or 408 — provider may have accepted+charged but errored.
- 2xx with **missing/invalid** `success` (empty/malformed body, `success===undefined`)
  — a 2xx empty body is NOT a proven rejection.

`topupghRequest` attaches `__httpStatus` to non-OK responses so 429/5xx/4xx are
detectable even when the body is empty (no "rate limit" text to match).

## Crash window (process dies after send, before local write)
A durable marker closes it: set `topupgh_batches.status='dispatching'` immediately
BEFORE the create-order call. `topupgh_batches.status` is free text (NO CHECK) so
this needs zero prod migration. Then `recoverStuckTopupghBatches` has 3 parts:
1. `status='pending'` batches >5min → create-order never started → unlink+delete (safe requeue).
2. existing safety-net: free pending/paid orders from `failed` batches.
3. `status='dispatching'` batches >5min → crashed mid-send, possibly-sent →
   park orders as `processing` + batch `failed` (set orders processing BEFORE
   failing the batch, so part 2 on the next run can't grab them).

## Accepted trade-off
Genuinely-unsent ambiguous orders may need manual review instead of auto-retry.
That is intentional: never auto-resend a possibly-charged order.
