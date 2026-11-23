---
name: McBIS uncertain-send safety
description: Conservative handling of purchase responses when provider idempotency is unverified.
---

Retain the durable dispatch claim after uncertain McBIS purchase responses. Never retry purchase POSTs or automatically clear a claim after a timeout, generic HTTP error, malformed response, or failed status lookup. Explicit insufficient-funds rejections without any provider order/reference are the exception: leave Pending and release only the matching attempt so funding can trigger the normal background retry.

**Why:** McBIS may have accepted a purchase before its response was lost. Provider-enforced reference idempotency and definitive no-order rejection semantics have not been verified. User authorized sending protection, not duplicate-purchase creation controls.

**How to apply:** Preserve uncertain attempts across restarts, but save the confirmed reference and mark Processing ONLY after McBIS confirms acceptance, either by purchase response or order lookup. Check fresh balance before sending; on unavailable/empty balance leave the order unclaimed. The user explicitly requires MTN low-balance retries to behave like Telecel after funding, while keeping duplicate protection. Store the outgoing attempt separately from the confirmed reference, and include attempts in provider-switch/admin/refund guards. Unrecognized rejections require manual reconciliation; even a crash between claim and POST must not trigger an automatic resend. Do not retrofit/requeue old uncertain orders automatically.

**Documentation constraint:** The Postman documentation at https://documenter.getpostman.com/view/11929812/2sB34kDynu shows `reference` supplied in the purchase request and the same value returned as `data.reference` in the successful response. It does not document a provider-generated replacement or a reference-free purchase flow. The numeric example does not establish a numeric-only restriction.

**Why:** The user insists on following the documentation, and earlier explanations incorrectly agreed that McBIS independently supplies the reference. Distinguish a request reference from confirmation that McBIS recorded it; do not infer receipt from local storage alone.
