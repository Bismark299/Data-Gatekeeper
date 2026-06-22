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

# Webhook scheme is HMAC-SHA256 over body with the API Secret — debugging a 401

TopUpGH signs webhooks with `X-Webhook-Signature` = HMAC-SHA256, verified with the API
Secret, and this worked historically before starting to 401. Because outbound API calls
still succeed with the same secret, a 401 is most likely an **encoding difference**
(base64 vs hex) or a **raw-body mismatch**, NOT a wrong secret.

**How to apply:** the verifier accepts several candidate encodings (hex, `sha256=` hex,
base64, x-timestamp variants), all derived from the secret (not weakened), and honors an
optional `TOPUPGH_WEBHOOK_SECRET` env. A temporary `diagnoseTopupghWebhookSignature` logs
which candidate matches a captured webhook (no secret logged). The TopUpGH dashboard has
"Test Webhook" / "Retry All" buttons to trigger one on demand. Read the Render log: if a
candidate matches → lock to it and drop the others; if `anyMatch:false` → it's a raw-body
capture problem (verify `req.rawBody` is the exact untouched bytes).
