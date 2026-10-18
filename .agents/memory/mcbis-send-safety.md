---
name: McBIS uncertain-send safety
description: Conservative handling of purchase responses when provider idempotency is unverified.
---

Retain the durable dispatch claim after any unconfirmed McBIS purchase response. Never retry purchase POSTs or automatically clear a reference after a timeout, HTTP error, malformed response, or failed status lookup.

**Why:** McBIS may have accepted a purchase before its response was lost. Provider-enforced reference idempotency and definitive no-order rejection semantics have not been verified. User authorized sending protection, not duplicate-purchase creation controls.

**How to apply:** Preserve the reference across restarts, but mark Processing ONLY after McBIS confirms acceptance, either by purchase response or order lookup. Check fresh balance before sending; on unavailable/empty balance leave the order unclaimed. The user explicitly requires balance checks and acceptance before Processing. Unconfirmed or rejected sends may require manual provider reconciliation; even a process crash between claim and POST must not trigger an automatic resend. Do not retrofit/requeue old uncertain orders automatically. Keep provider-switch and admin paths subject to the same claim. Prefer delayed/manual resolution over duplicate fulfillment.
