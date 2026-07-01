---
name: TopUpGH batch finalize gate
description: Why any admin force-complete / reconcile of a TopUpGH batch must be gated to "processing" batches only.
---

# Force-complete / reconcile must target only "processing" batches

`settleBatchDeliveries` recomputes a batch's FINAL status (completed / partial / failed) only inside a guard of the form `if (allSettled && batch.status === "processing")`. It settles individual orders regardless, but it will NOT re-derive the batch label unless the batch started as `processing`.

**Consequence:** if an admin force-completes (or reconciles) a batch whose status is already `partial` / `failed` / `completed`, the stray open orders flip to `completed` but the batch label stays stale — the batch reads `partial` while all its orders are done. Not a double-credit bug, but it corrupts the meaning of the status and confuses reconciliation.

**Rule:** any per-batch or range force-complete/reconcile entry point must reject / skip non-`processing` batches (backend guard + hide the frontend button). The existing reconcile-range tool already filters `status = 'processing'`; the per-batch complete endpoint returns 400 for anything else.

**Why:** caught in an architect review of the per-batch "Complete" button. The safe money path (`reconcileBatchOrderLevel({force:true})` → `settleBatchDeliveries`) is idempotent + row-locked, but its batch-finalization step is status-gated, so the *entry points* must be gated too.

**How to apply:** when adding any new admin action that settles/closes a batch, gate it to `processing`, or change the finalization to recompute for the actual current status — but changing shared `settleBatchDeliveries` finalization is riskier than gating the caller.
