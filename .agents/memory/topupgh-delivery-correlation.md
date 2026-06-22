---
name: TopUpGH delivery → order correlation
description: Why TopUpGH delivery date/time is matched to orders by phone, and the ambiguity that causes
---

# TopUpGH delivery info has no per-order correlation key

TopUpGH webhook payloads (`delivery_status_updated`) carry per-recipient
`delivery_status` / `delivery_date` / `delivery_time`, keyed only by
`beneficiary_number` (phone). The full payload is stored as `delivery_data` jsonb
on the batch. There is **no TopUpGH item id persisted on our `orders` row**, so
delivery info can only be re-attached to an order by **matching phone number**
(beneficiary_number is stored exactly as it matches `orders.phone_number`).

**The ambiguity:** a single batch can legitimately contain two orders for the
same phone (customer buys two bundles to one number). Phone-keyed matching can't
tell which item belongs to which order. The shared helper `extractDeliveryInfo`
therefore marks an entry `ambiguous` (status `"multiple"`) when same-phone items
in one batch carry *conflicting* outcomes; identical duplicates collapse silently.

**Why:** without this guard, a last-wins map silently shows the wrong
date/time/status on one of the two same-phone orders.

**How to apply:** the only real fix is to persist a per-order TopUpGH item
identifier at dispatch/webhook time and resolve delivery by that key. Until then,
do NOT assume phone→delivery is 1:1; preserve the ambiguous marking.

# TopUpGH per-item delivery_status has many wordings for one outcome

TopUpGH reports the same per-recipient outcome with different wording/casing across
its dashboard, webhook, and delivery-status endpoint. A successful delivery can
arrive as `Delivered`, `Sent`, `Completed`, `Success`, etc. Matching only the
literal `"delivered"` left settled orders stuck at `processing` (customer reported
"delivered/sent on TopUpGH site but processing in our system").

**How to apply:** never compare the raw status to a single literal. Use the shared
`classifyDeliveryStatus()` helper (case-insensitive, trimmed; returns
delivered/failed/pending/unknown) in BOTH settlement loops. `unknown` (non-empty,
unrecognized) is logged as a warning and the order is left processing — watch those
logs to discover new vocabulary and extend the term sets.

**Why:** `sent` is mapped to delivered because on this account's TopUpGH dashboard
"sent" reflects actual delivery. If an account instead uses `sent` to mean merely
*submitted/accepted* (not yet delivered), move it to the PENDING set — otherwise
orders get marked completed (and store profit credited) before real delivery.

# TopUpGH order-level status ≠ actual delivery

TopUpGH's **order-level** status (`GET /orders/{id}` → `order.status === "completed"`)
means the bulk order was **accepted/processed** by TopUpGH — NOT that bundles reached
customers. Actual delivery is **per recipient** via the delivery-status endpoint /
`delivery_status_updated` webhook (`delivery_status` = delivered/pending/failed).

**Why:** the fallback poller once trusted order-level "completed" and flipped whole
batches + all orders to completed within minutes of dispatch, while TopUpGH still
showed them undelivered. It also pre-empted failed-delivery refunds (the
`status==='completed'` guard then skipped the webhook's refund path).

**How to apply:** only mark an order delivered from **per-item** `delivery_status`.
Both webhook and poller must funnel through the one settlement function. Because that
adds two concurrent settlement paths and `wallet_ledger.reference` is NOT unique, each
order's settle+refund must be a tx with `SELECT ... FOR UPDATE` + in-tx terminal-status
recheck, or you get double refunds.
