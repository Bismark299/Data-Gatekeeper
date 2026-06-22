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

## The core non-obvious rule: unconfirmed outcome ⇒ park as 'processing', NEVER unlink
**Why:** `recoverStuckTopupghBatches()` has a safety-net that **re-frees orders
from `failed` batches back into the pending pool** — but only those still
`status='pending'` (platform) / `'paid'` (store). So merely pinning a possibly-sent
order to a failed batch is NOT enough: the safety-net unlinks it again →
re-dispatch → double-charge/double-deliver. The user is extremely credit-sensitive.

**How to apply:** for ANY unconfirmed create-order outcome, set the linked orders
to `status='processing'` (helper `parkAmbiguous`). `'processing'` is the only
existing status that dodges BOTH dispatch selection (picks pending/paid) AND the
failed-batch safety-net (frees pending/paid). You CANNOT invent a new order status
— `orders.status` has a DB CHECK (pending/processing/completed/failed) and prod is
external Render (migrations don't propagate). Parked orders surface in admin
reconciliation for manual handling; they are never auto-resent.

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
