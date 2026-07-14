---
name: McBIS poller status matching & diagnosability
description: Why McBIS-fulfilled orders stayed "processing" locally and rules for the status-check poller.
---

**Rule:** The McBIS status poller must (1) compare provider status words after `.trim().toLowerCase()`, (2) accept success/completed/delivered → completed and failed/cancelled/canceled → failed, (3) warn-log any unrecognized or empty status with orderId/ref/raw value, (4) count check errors and emit one summary warn per cycle, and (5) break both check loops AND skip the dispatch sections for the rest of the cycle on HTTP 429.

**Why:** Orders completed at McBIS but sat "processing" on-site for weeks. The old poller matched only exact lowercase "success"/"completed" and swallowed every error in bare `catch {}` — a casing change, new status word, response-shape change, or rate-limit was completely invisible in logs, making the failure undiagnosable from production.

**How to apply:** Never add a bare `catch {}` around provider calls in any fulfillment poller (McBIS, TopUpGH, etc.) — always at least count + surface the last error once per cycle. Every settle-write must stay status-guarded (`WHERE status='processing'`, store-order completes inside tx + FOR UPDATE) so a concurrent admin refund can't be resurrected to completed/profit-credited. Prod runs on Render — fixes only take effect after the user redeploys there; the warn lines then reveal the true root cause in Render live logs.
