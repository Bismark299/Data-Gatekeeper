---
name: TopUpGH settlement channels — webhook vs poller
description: Why TopUpGH-delivered orders can get stuck in 'processing'; how the poller must round-robin; webhook signature scheme caveats.
---

# The poller's real failure mode is head-of-line blocking (NOT rate limiting)

The delivery-status endpoint (`GET /orders/{id}/delivery-status`) is documented at 1
req/min, but in practice the prod poller calls it every 2 min and gets HTTP 200 fine.
429s seen from the Replit dev env are just collisions with the prod poller — they are
NOT evidence the poller is starved. Do not conclude "rate limited" from a dev-side 429.

# A flood of `TimeoutError` (NOT 429) = connection blackhole, two possible causes

Symptom: prod logs show the SAME warn every 2 min — `TopUpGH delivery fetch failed —
reconciling…`, `name:"TimeoutError"` (the 20s `AbortSignal.timeout` firing) — across MANY
different batchIds, steadily. A hang-until-timeout is NOT a rate-limit 429 (those return
instantly) and NOT a single stuck batch (round-robin is rotating). The TCP connection is
being silently dropped/blackholed. Two leading causes, both consistent with the symptom:
1. **TopUpGH may enforce the 1/min cap by DROPPING connections, not returning 429.** If so,
   a burst from ANY caller (admin search, webhook re-fetch) poisons the shared budget and
   the poller's own call then also times out — collateral damage. → The shared delivery gate
   (`runDeliveryStatusCall`) is the fix; deploy it and the steady timeouts should stop.
2. **Prod egress IP no longer on TopUpGH's allowlist** (Render's outbound IP can change
   across pod restarts — the changing pod hostnames in the logs hint at this). → Ops fix:
   re-confirm the current prod egress IP is whitelisted, and that TopUpGH's API is up.
Money is safe either way: the timeout is caught and the batch is reconciled from order
states — no double-charge, no loss; only live delivery confirmation lags. Distinguish the
two by whether timeouts persist with zero admin/webhook activity (→ #2) or correlate with
bursts (→ #1).

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

# The webhook signature scheme is UNCONFIRMED — ack 200 always, treat it as a trigger only

History: requiring a signature 401'd every callback (the "Failed" count on the dashboard),
and a non-200 makes TopUpGH stop retrying — so confirmations never arrived and orders sat in
`processing` until the slow poller caught them. We removed the hard requirement.

Signature status is CONTESTED, do not assume either way: an external TopUpGH integration doc
later claimed webhooks DO sign with `X-Webhook-Signature = HMAC-SHA256(rawBody, API_SECRET)`,
hex (raw bytes, not parsed JSON). The code already computes that exact `hex` candidate AND
logs `diagnoseTopupghWebhookSignature` whenever a signature header is present. **Confirm the
real scheme from a prod (Render) log line `TopUpGH webhook signature diagnostic`** before
ever trusting the signature. Only after it's confirmed should you consider verify-and-settle
directly from the webhook (which would bypass the 1/min poll bottleneck for instant
settlement) — until then, keep re-fetching the authenticated delivery-status.

**Rule:** the webhook endpoint must ALWAYS `res.sendStatus(200)` and must be treated as an
unauthenticated, untrusted TRIGGER — never trust its body for settlement.

**Why:** any non-200 halts TopUpGH callbacks; and since the request is unauthenticated, a
forged body could otherwise falsely complete orders / credit agent profit.

**Payload shape is also uncertain — tolerate BOTH.** Our handler historically modeled the
NESTED shape `{ event:"delivery_status_updated", order:{ order_id, items:[...] } }` (copied
from the GET delivery-status response), but the external doc shows a FLAT shape
`{ order_id, status, network, recipient, data_size, updated_at }` with no `event`/`order`
wrapper. If the real webhook is flat, a handler that hard-requires `event` or `order.order_id`
silently no-ops on every callback. The handler now extracts `order_id` from either shape
(nested `order.order_id` OR top-level `order_id`, number or numeric string) and only enforces
`event === delivery_status_updated` when an `event` field is actually present. Confirm the
real shape from prod `no batch for order_id` / `no usable order_id` warnings.

**How to apply:** extract `order_id` from either shape, look up the batch by
`topupghOrderId`, then settle via `fetchAndSettleBatchDelivery(batch)` — the AUTHENTICATED HMAC-signed `GET
/orders/{id}/delivery-status` re-fetch — NOT from the webhook payload. That path is
idempotent (status-guarded) + per-batch in-flight guarded, so forged/replayed webhooks can
at most cause a bounded, harmless re-check. A forged webhook can never settle or credit.
The endpoint is public+always-200, so it has its own dedicated generous rate limiter
(300/min/IP, `webhookLimiter`) and is exempted from the general 120/min `apiLimiter` so a
real burst of per-item callbacks for a large batch is never dropped. `verifyTopupghWebhook-
Signature` is now dead in the route (kept exported); `diagnoseTopupghWebhookSignature` is
kept as a best-effort log only when a signature header happens to be present.

# "15 webhooks failed / check endpoint availability" = body-parser rejects BEFORE the 200 ack

The route always `res.sendStatus(200)`, but that only runs if the request REACHES the route.
The GLOBAL `express.json({ limit: "1mb" })` runs first and returns **400** on an unparseable
body or **413** on a body >1mb, BEFORE the handler — TopUpGH counts those as failures and
flags the endpoint "unavailable" (it stops retrying on non-2xx). Verified against prod:
malformed JSON→400, >1mb→413, clean small payload→200; GET/HEAD→200 (SPA catch-all).

**Fix / principle:** a webhook endpoint must ack 2xx for ANY request shape. (1) Mount a
dedicated `express.json({ limit:"5mb", verify: capture rawBody })` at the webhook path BEFORE
the global parser (body-parser no-ops once a body is parsed, so other routes keep their 1mb
cap). (2) In the global error handler, special-case the webhook path → log + `sendStatus(200)`
so even an unparseable/oversized body still acks 200. Settlement is unaffected — it only runs
from an HMAC-verified body, so acking 200 on a junk body settles nothing.

**Diagnosing remotely:** you can't read Render logs from Replit, but you CAN curl the public
domain to observe status codes per payload shape (malformed / oversized / clean) — that
pinned the cause without prod log access.
