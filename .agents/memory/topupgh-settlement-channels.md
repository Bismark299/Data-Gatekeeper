---
name: TopUpGH settlement channels — webhook vs poller
description: Why the delivery-status poller can't settle the backlog and the webhook is the only reliable channel; webhook signature scheme caveats.
---

# The poller is NOT a reliable settlement channel

`GET /orders/{id}/delivery-status` is rate-limited to **1 req/min per API key** and in
production that slot is **perpetually exhausted** — a probe still gets `429 remaining:0`
even after waiting a full 65s. So the fallback poller (`checkProcessingBatches`, one batch
per cycle) can almost never get a successful read and makes zero progress on a backlog.

**Why:** something consumes the delivery-status slot faster than 1/min (prod poller +
any other caller sharing the key). Attribution couldn't be confirmed remotely, but the
empirical fact stands: do not rely on delivery-status polling to clear stuck batches.

**How to apply:** treat the **webhook** (`POST /api/topupgh/webhook`,
`delivery_status_updated`) as the primary settlement channel — it is push-based, has no
rate limit, and TopUpGH actively fires it (and retries when the endpoint was returning
non-200). The poller is best-effort backup only.

# topupghRequest must surface non-OK responses

`topupghRequest` historically did `return res.json()` without checking `res.ok`, so a 429
(or any error) was parsed into an error-shaped object and the caller silently no-op'd
(`data.order?.items` undefined → early return) with **no log**. Always log non-2xx from
the TopUpGH API, or rate-limit failures are invisible and look like "poller does nothing".

# Webhook signature scheme is NOT the plain assumption

`HMAC-SHA256(rawBody, apiSecret)` hex (the original assumption) is rejected by TopUpGH in
production (401). The real scheme is unconfirmed — could be base64, a `sha256=` prefix, a
timestamped string, or a **dedicated webhook secret** distinct from the API secret.

**How to apply:** the verifier accepts several candidate encodings (all derived from the
secret, so verification is not weakened) and honors an optional `TOPUPGH_WEBHOOK_SECRET`
env var, falling back to the API secret. A temporary `diagnoseTopupghWebhookSignature`
logs which candidate matches a real webhook (no secret logged) — use one captured webhook
to lock the scheme, then remove the diagnostic. If `anyMatch:false`, a dedicated webhook
secret is needed (read it from the TopUpGH webhook config page → `TOPUPGH_WEBHOOK_SECRET`).
