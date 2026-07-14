---
name: McBIS poller status matching & diagnosability
description: Why McBIS-fulfilled orders stayed "processing" locally and rules for the status-check poller.
---

**Rule:** The McBIS status poller must (1) compare provider status words after `.trim().toLowerCase()`, (2) accept success/completed/delivered → completed and failed/cancelled/canceled → failed, (3) warn-log any unrecognized or empty status with orderId/ref/raw value, (4) count check errors and emit one summary warn per cycle, (5) break both check loops AND skip the dispatch sections for the rest of the cycle on HTTP 429, and (6) round-robin the check queue: order by updatedAt asc and bump updatedAt on every checked-but-unsettled order. Because of (6), `orders.updatedAt` now means "last polled", NOT "last state change" — any stuck-order detector (e.g. `/admin/reconcile`) must key off `createdAt`, never `updatedAt`, or polled-but-stuck orders become invisible to admins.

**Why (confirmed root cause):** A live read-only test against McBIS checkOrderStatus proved head-of-line blocking: an old batch of orders (Jun 22) that McBIS itself reports as permanently "processing" occupied the entire per-cycle cap (30, ordered by createdAt asc), so newer orders — which McBIS returns as "completed" — were never checked at all. Same failure mode as the TopUpGH backup poller. Also: the old poller swallowed every check error in bare `catch {}`, and a header comment claimed a ">24h auto-fail" that was never implemented (stale comments lie).

**Live-test recipe:** GET `{DATAHUB_API_URL}/checkOrderStatus/{ref}` with `Authorization: Bearer $DATAHUB_API_TOKEN` → `data.order.status` in response JSON ("processing"/"completed"). Stuck refs come from prod (RENDER_DATABASE_URL) `orders.mcbis_reference WHERE status='processing'`.

**How to apply:** Never add a bare `catch {}` around provider calls in any fulfillment poller (McBIS, TopUpGH, etc.) — always at least count + surface the last error once per cycle. Every settle-write must stay status-guarded (`WHERE status='processing'`, store-order completes inside tx + FOR UPDATE) so a concurrent admin refund can't be resurrected to completed/profit-credited. Prod runs on Render — fixes only take effect after the user redeploys there; the warn lines then reveal the true root cause in Render live logs.
