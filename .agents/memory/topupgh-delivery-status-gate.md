---
name: TopUpGH delivery-status shared gate
description: Every caller of the 1-req/min TopUpGH delivery-status endpoint must go through the shared in-process gate; queue vs skip semantics and why.
---

# TopUpGH delivery-status shared gate

`GET /orders/{id}/delivery-status` is capped at **1 req/min/key**. Multiple callers hit it
(background poller, webhook-triggered re-fetch, admin manual "check delivery" button,
admin order/phone search). Without coordination they burst past the cap (aborted-timeout
warnings) and starve the poller — which is the only proven settlement channel (webhook has
been 401'ing in prod).

## Rule
**Any new code path that calls the delivery-status endpoint MUST route through
`runDeliveryStatusCall(fn, mode)` in `lib/topupgh.ts`.** Never call
`topupghGetDeliveryStatus` directly. (Note: the order-level `GET /orders/{id}` /
`topupghGetOrderStatus` is a *separate* budget and is NOT gated by this — only
delivery-status is.)

Two modes:
- **"queue"** — serialized promise chain, waits ≥60s since the last call *start*, runs in
  background. Use for non-interactive callers where latency is fine (poller, webhook
  re-fetch). The webhook ROUTE acks 200 *before* settling, so the 60s wait drains in the
  background and never hangs TopUpGH's POST.
- **"skip"** — runs only if no queue caller is active AND ≥60s elapsed; otherwise returns
  `{ ran: false }` WITHOUT calling. Use for interactive callers so they never hang ~60s or
  burst — they fall back to the batch's stored `deliveryData`.

## Why skip-fallback is financially safe
On skip, settlement gets `data=undefined` → `items=[]` → `settleBatchDeliveries` applies
nothing (no order completed/failed, no profit credited from cached data). It only
auto-closes a batch if all linked orders are *already* terminal. The queued poller/webhook
path still settles later. So serving cached data to the UI can only *delay* a visible
update, never strand or mis-complete a paid order.

## Bounded queue
queue mode has a hard cap `MAX_DELIVERY_GATE_QUEUE` (50). Beyond it, new queue-mode calls
return `{ ran: false }` instead of growing unbounded under a webhook storm — the
round-robin poller settles those batches on a later cycle. Same-batch storms never reach
the cap: `_settleInFlight` coalesces them *before* the gate, and unknown order_ids are
rejected before any settle.

**Why:** keeps the single proven settlement channel (poller) alive and the money path
correct under bursty/multi-batch load without ever double-delivering or prematurely
completing.
