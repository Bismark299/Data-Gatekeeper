---
name: MTN dual-provider mutual exclusion (McBIS vs TopUpGH)
description: How McBIS and TopUpGH avoid double-fulfilling the same MTN order/store-order, and the invariant that must hold.
---

# McBIS / TopUpGH must not both fulfill the same MTN order

Both providers fulfill MTN orders (platform `orders` and agent `store_orders`). Each "claims" an order by writing a **different** column:
- McBIS claims by setting `mcbisReference` (atomic-lock UPDATE in `dispatchToMcbis`).
- TopUpGH claims by setting `topupghBatchId` (link UPDATE in `dispatchPendingQueue`).

**The rule:** because the two claim UPDATEs touch different columns, they do NOT block each other unless **each side's WHERE also checks the OTHER provider's column**. So every McBIS claim must require `topupghBatchId IS NULL`, and every TopUpGH link must require `mcbisReference IS NULL` (store orders also `ckgodswayReference IS NULL`), plus the right status guard. Postgres row locks then serialize concurrent UPDATEs on the same row and the loser sees 0 rows.

**Why:** an architect review caught that the McBIS poller's retry SELECTs picked up store orders already linked to a TopUpGH batch (status still `paid` during dispatch latency) → duplicate fulfillment. The fix was cross-column guards at BOTH the claim UPDATEs and the poller prefilter SELECTs, on both tables.

**How to apply:** if you add a third MTN provider or a new claim path, it must (a) check all other providers' claim columns in its claim UPDATE, and (b) be excluded by the others' claim UPDATEs. In normal production only ONE MTN provider is enabled at a time (`mcbis_enabled` vs `topupgh_enabled`), so this is primarily defense-in-depth for a dual-enable misconfig — but keep the guards regardless.

**Related:** store-order completion via TopUpGH settlement also credits agent profit (`stores.profitBalance += profit`) in a `SELECT ... FOR UPDATE` tx, status-guarded (`paid`/`processing` only) so retries never double-credit. Failed delivery → `failed`, no auto-refund (admin handles). Same-phone orders in one batch are correlated by phone only — first non-terminal match wins (accepted limitation, see topupgh-delivery-correlation).
