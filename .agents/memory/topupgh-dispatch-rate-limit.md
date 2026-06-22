---
name: TopUpGH dispatch rate-limit
description: Why the TopUpGH poller dispatches one batch per cycle and treats rate-limit rejections as retryable, not failures.
---

# TopUpGH dispatch rate-limiting

TopUpGH throttles **consecutive create-order calls**. Two create-order requests fired within a few seconds → the second returns `success:false, message:"Rate limit exceeded"`. (The delivery-status endpoint is separately capped at ~1 req/min.)

**Rule — one batch per poll cycle.** The dispatch poller must send at most one batch per cycle (cycle = 2 min). Do NOT drain the pending queue in a tight loop — every batch after the first in the same cycle gets rate-limited and used to be marked `status="failed"`, producing pairs of batches at the same second (first ok, second failed).

**Rule — rate-limit = transient retry, not a failed batch.** When a create-order rejection message matches rate-limit, `unlinkAll()` (orders return to the pending pool) + DELETE the empty batch row, return `reason:"rate_limited"`. The same orders re-dispatch next cycle once the window resets. Non-rate-limit rejections still mark the batch `failed`.

**Why retry is safe:** a rate-limit/429 means TopUpGH created nothing (no order_id, no wallet deduction). Orders stay `pending`/`paid` until a *successful* dispatch, so re-queuing cannot double-charge or double-deliver. A create-order **timeout** is different — the request may have landed — so timeouts still mark the batch failed for manual review, NOT auto-retry.

**Throughput lever is batch SIZE, not frequency.** With one batch/2min, raise `topupgh_max_batch` (admin setting; TopUpGH supports up to 100/order) to move more orders per cycle. Don't shorten the poll interval — it shares the cycle with delivery-status checks (1 req/min cap).

**Not yet built:** a DB-backed dispatch cooldown/lock shared across the poller, admin force-dispatch, and overlapping Render pods during rolling deploys. Without it, a manual dispatch or deploy-overlap can still collide — but now harmlessly (transient `rate_limited`, no permanent failed batch).
