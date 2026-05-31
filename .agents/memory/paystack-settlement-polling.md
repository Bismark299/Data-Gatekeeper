---
name: Paystack settlement polling
description: Ghana Mobile Money redirects back before Paystack marks the charge "success"; verify flows must poll, not fail on first attempt.
---

# Paystack verify must poll, not fail on first try

On this Ghana data-bundle platform, Paystack (especially Mobile Money) frequently
redirects the customer back to the callback URL **before** the charge has settled to
status `success`. A single verify call then returns "not successful yet" and the UX
looks like a failed transaction even though the money went through.

**Why:** The server `/wallet/paystack/verify` (and store `/s/:slug/verify`) returns the
ground-truth Paystack status; while pending it is not yet `success`. The reliable async
safety net is the webhook (`/api/paystack/webhook`, HMAC-SHA512, raw body via
`express.json` verify → `req.rawBody`). Both the webhook and verify paths credit
idempotently using a unique `reference`/`paystackReference` plus `SELECT ... FOR UPDATE`,
so repeated verify calls are safe and never double-credit.

**How to apply:** Frontend verify-on-redirect must **poll/retry** (e.g. ~10 tries × 4s) to
wait out settlement before surfacing failure, and should always have the webhook configured
in the Paystack dashboard as the async backstop. Reference prefixes: `DB-PS-` wallet top-up,
`STORE-` storefront order; the unified webhook routes by prefix.
