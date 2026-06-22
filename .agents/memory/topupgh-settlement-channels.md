---
name: TopUpGH settlement channels — webhook vs poller
description: Why TopUpGH-delivered orders can get stuck in 'processing'; how the poller must round-robin; webhook signature scheme caveats.
---

# The poller's real failure mode is head-of-line blocking (NOT rate limiting)

The delivery-status endpoint (`GET /orders/{id}/delivery-status`) is documented at 1
req/min, but in practice the prod poller calls it every 2 min and gets HTTP 200 fine.
429s seen from the Replit dev env are just collisions with the prod poller — they are
NOT evidence the poller is starved. Do not conclude "rate limited" from a dev-side 429.

The real bug: a backup poller that always picks the **stalest batch by dispatchedAt** and
checks only ONE per cycle will jam. If that order's 200 yields no settleable items (still
pending on TopUpGH's side, or empty `order.items`), the batch never settles, stays the
stalest, and is re-queried forever — so every other processing batch is never polled.

**Fix / principle:** round-robin by a last-checked timestamp. Order processing batches by
`updatedAt` (least-recently-checked first) and bump `updatedAt` on EVERY check — success,
empty-items, or error alike — so the just-checked batch rotates to the back of the queue.
`updatedAt` already exists, so no migration (prod DB is external Render — avoid migrations).
Keep one check per cycle (rate limit) and keep the poller single-instance (`WEB_CONCURRENCY=1`);
multi-instance would need `FOR UPDATE SKIP LOCKED` / a lease column to avoid duplicate polls.

# topupghRequest must surface non-OK responses

Returning `res.json()` without checking `res.ok` parses a 429/error into an error-shaped
object, so the caller silently no-op's (`data.order?.items` undefined → early return) with
no log. Always log non-2xx from the TopUpGH API or failures look like "poller does nothing".

# The webhook carries NO usable signature — ack 200 always, treat it as a trigger only

The earlier assumption that TopUpGH HMAC-signs webhooks was WRONG. In practice TopUpGH
POSTs the bare payload with no usable `X-Webhook-Signature`, so a handler that required a
signature 401'd every callback (this is the "Failed" count on the TopUpGH dashboard). A
non-200 response makes TopUpGH stop retrying, which is why delivery confirmations never
arrived and orders sat in `processing` until the slow poller caught them.

**Rule:** the webhook endpoint must ALWAYS `res.sendStatus(200)` and must be treated as an
unauthenticated, untrusted TRIGGER — never trust its body for settlement.

**Why:** any non-200 halts TopUpGH callbacks; and since the request is unauthenticated, a
forged body could otherwise falsely complete orders / credit agent profit.

**How to apply:** on `delivery_status_updated`, cheap-reject unless `order.order_id` is a
positive number, look up the batch by `topupghOrderId`, then settle via
`fetchAndSettleBatchDelivery(batch)` — the AUTHENTICATED HMAC-signed `GET
/orders/{id}/delivery-status` re-fetch — NOT from the webhook payload. That path is
idempotent (status-guarded) + per-batch in-flight guarded, so forged/replayed webhooks can
at most cause a bounded, harmless re-check. A forged webhook can never settle or credit.
The endpoint is public+always-200, so it has its own dedicated generous rate limiter
(300/min/IP, `webhookLimiter`) and is exempted from the general 120/min `apiLimiter` so a
real burst of per-item callbacks for a large batch is never dropped. `verifyTopupghWebhook-
Signature` is now dead in the route (kept exported); `diagnoseTopupghWebhookSignature` is
kept as a best-effort log only when a signature header happens to be present.
