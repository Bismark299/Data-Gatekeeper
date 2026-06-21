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
