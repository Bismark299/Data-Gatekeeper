---
name: TopUpGH delivery-status endpoint shape & words
description: Real response shape of GET /orders/{id}/delivery-status vs the webhook, and the per-endpoint delivery words. Verified against live API June 2026.
---

# GET /orders/{id}/delivery-status — real shape

Verified against the live TopUpGH reseller API (not just docs):

```json
{
  "success": true,
  "order": {
    "id": 1919253,
    "delivery_info": "Submited to the Yello server on ...",
    "date_created": "2026-06-21 20:49:52",
    "payment_status": "completed",
    "items": [
      { "name": "2GB - MTN", "beneficiary_number": "0538772271",
        "data_size": "2GB", "delivery_status": "Sent",
        "processed_date": "22/Jun/2026, 4:24:29 AM" }
    ]
  }
}
```

**Rule:** the GET delivery-status response is the SAME `order.items[]` array shape as the
webhook — it does NOT return a phone-keyed `delivery_status` object. Parse `data.order.items`,
key by `item.beneficiary_number`.

**Why:** assuming `data.delivery_status` was a phone-keyed object makes the guard return early
(that key does not exist in the real response), so orders never settle and sit in "processing"
even though the TopUpGH dashboard shows them delivered. Any code reading delivery-status must
parse `order.items`, not `delivery_status`.

# Delivery words differ per endpoint
- **GET delivery-status** reports a delivered bundle as **"Sent"**.
- **Webhook** reports the same as **"Delivered"**.
Both must map to delivered. `classifyDeliveryStatus` lowercases and treats
delivered/sent/completed/complete/success(ful) as delivered — keep "sent" in that set.

# Field name differences (GET items vs webhook items)
- GET items: `delivery_status` + single `processed_date` ("DD/Mon/YYYY, h:mm:ss AM"), `data_size` is a string ("2GB"), `name` instead of `network`, no `item_id`.
- Webhook items: `delivery_status` + separate `delivery_date` & `delivery_time`, `data_size` numeric, has `item_id` ("{order_id}-{n}").
- When adapting GET → webhook shape, split `processed_date` on the first ", " into date + time.

# Rate limit
`/orders/{id}/delivery-status` is limited to **1 request/min per API key**. Dev and prod share
the same key, so they compete — expect 429s when probing from dev while prod's poller runs.
Respect `data.rate_limit.retry_after`.
