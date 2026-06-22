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

## The per-item-empty stuck-batch failure mode (and the order-level reconcile fallback)
- A real failure mode observed: batches polled fine (updated_at fresh, no errors) but the per-recipient **delivery-status endpoint returns EMPTY items**, while TopUpGH's dashboard shows the order delivered. Since the canonical `settleBatchDeliveries` only completes from per-recipient "delivered/sent" items, nothing ever settles — orders stay "processing" forever.
- Fallback = **admin-gated** `reconcileBatchOrderLevel(batch,{force})` + route `POST /admin/topupgh/reconcile-range`. It confirms via TopUpGH's **order-level** status (`topupghGetOrderStatus`) — a *different* endpoint from per-item delivery-status — then settles still-open rows through the canonical `settleBatchDeliveries` with synthesized `{phone,status:"delivered"}` items (so store profit is credited once, idempotently). `force=true` skips the API call (admin attestation from the dashboard).
- **Why order-level is admin-only, never in the poller:** order-level status flips to "completed" on *acceptance*, before recipients receive data. The auto-poller deliberately distrusts it. The reconcile guards this premature window by refusing batches dispatched <10 min ago in non-force mode.
- **Safety invariants to preserve if editing this:** (1) always settle via `settleBatchDeliveries`, never raw status flips (raw flip skips store-profit credit); (2) hold the per-batch `_settleInFlight` guard while settling so reconcile can't race the poller; (3) only target rows still in `pending|processing` (platform) / `paid|processing` (store) — terminal rows are skipped, making re-runs idempotent.
