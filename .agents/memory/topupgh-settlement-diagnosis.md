---
name: TopUpGH settlement diagnosis
description: How to diagnose why TopUpGH batches/orders are or aren't settling, and which channel settled one.
---

# Diagnosing TopUpGH batch settlement

## Which channel settled a batch? Read `delivery_data` (jsonb on topupgh_batches)
- **Poller** writes a *synthetic* payload: items have `item_id:""`, `network:""`, `data_size:0`, and `order.order_number`/`order.delivery_info` are `""`. The `timestamp` is our own ISO string. `delivery_status` carries TopUpGH's word from the delivery-status endpoint (e.g. "Sent").
- **Webhook** writes TopUpGH's *real* payload: `item_id`, `network`, `data_size`, `order_number` are populated.
- So empty item fields = poller settled it; populated = webhook. (Webhook has been 401'ing, so in practice the poller is the active channel.)

## Poller cadence / health signal
- Round-robin: selects stalest batch by `updated_at`, bumps `updated_at` right after select, checks **1 batch per 2-min cycle**. Full loop ≈ (number of dispatched/processing batches) × 2 min.
- Healthy poller = `updated_at` on all processing batches advancing ~2 min apart. If only one batch's `updated_at` ever moves, head-of-line blocking is back.

## A batch settles ONLY when TopUpGH reports the recipient delivered
- `settleBatchDeliveries` marks an order completed only when `classifyDeliveryStatus` maps the per-recipient `delivery_status` to "delivered" (delivered/sent/completed/etc.). pending/queued/empty → order left "processing".
- **Therefore: a batch polled repeatedly (updated_at advancing) but still "processing" means TopUpGH has NOT delivered it — this is NOT a code bug.** The blocker is upstream delivery. Chase it in the TopUpGH dashboard, not in code.
- No auto-refund on failed delivery by design — an admin resolves failures manually.

## Never-dispatched batches need manual recovery
- Non-completed batches with `topupgh_order_id IS NULL` AND `dispatched_at IS NULL` were **never dispatched** (the create-order call failed). They usually sit in status `failed`. The poller only processes dispatched batches, so these **never auto-recover** — customer was charged but order never reached TopUpGH. Must manually re-dispatch or refund.

## Env quirk
- **The dev container IP is not on TopUpGH's IP/domain whitelist.** Calling TopUpGH directly from dev (even with correct HMAC auth) times out. Only the production server can reach TopUpGH. Use prod logs / prod to inspect live delivery-status.
