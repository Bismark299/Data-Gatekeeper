---
name: TopUpGH outgoing request signing
description: How we HMAC-sign outbound requests to TopUpGH; the non-obvious internal-prefix + path-only rules.
---

# TopUpGH outbound request signature (authoritative, per their Swagger 1.3.0)

Base URL: `https://reseller.etopupgh.com/api/v1`. Headers: `X-API-Key`, `X-Timestamp`
(Unix SECONDS as string), `X-API-Signature`.

Signature = `HMAC-SHA256(timestamp + method + endpoint + body, API_SECRET)` hex, where:

- **endpoint = the INTERNAL route `/topupgh-api/v1/<path>`, NOT the public `/api/v1/...`.**
  We store this as `TOPUPGH_INTERNAL_PREFIX` and prepend it when signing.
- **endpoint EXCLUDES the query string.** Their code samples sign
  `/topupgh-api/v1/products` while fetching `/products?network=mtn`. Signing WITH the query
  → 401. Fix: `pathForSig = endpoint.split("?")[0]`.
- **body**: the EXACT JSON string sent as the request body. Stringify ONCE and reuse for both
  the signature and the request body, or key-order drift breaks the HMAC.

**Why this matters / diagnosis:** a wrong signature yields **401**. A path-only GET that
returns **404** (e.g. `/orders/{id}/delivery-status`) therefore proves the signature is
correct and the order is simply not found — do NOT chase it as an auth bug.

Signature is REQUIRED for POST (order create); GETs also send it and it's accepted.
