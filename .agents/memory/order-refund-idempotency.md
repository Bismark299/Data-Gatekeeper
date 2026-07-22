---
name: Order refund / bulk-cancel money-safety
description: Rules for refunding platform orders safely (single + bulk) without double-credit or refund-plus-delivery.
---

# Refunding platform orders safely

Any admin refund/cancel of a platform order credits a real customer wallet, so it must be idempotent and must never race a live delivery.

## Rules

1. **Idempotency must be anchored on the immutable wallet_ledger entry, not orders.status.**
   `orders.status` is mutable by many writers (admin status routes, provider pollers), so a refunded order can be resurrected to `pending`. Guard by checking, inside the refund transaction (after `SELECT ... FOR UPDATE` on the order row), whether a credit ledger row already exists with `reference = refund-order-{id}`; if so, skip. The row lock makes this race-safe. **Why:** `wallet_ledger.reference` has NO DB UNIQUE constraint, and the prod DB is external Render — adding one requires risky manual DDL, so the lock+existence-check gives the same guarantee for this code path.

2. **Bulk cancel covers PENDING and PROCESSING; the provider-ref exclusion applies to PENDING only.**
   A `pending` order can already be in-flight: `mcbis.ts` / `ckgodsway.ts` set `mcbisReference` / `ckgodswayReference` to a `LOCK-*` value (and TopUpGH sets `topupghBatchId`) **while status is still `pending`**, before flipping to `processing`. So a *pending* order with any provider ref is still skipped (`mcbisReference IS NULL AND ckgodswayReference IS NULL AND topupghBatchId IS NULL`) in both preview and the tx guard, or it risks refund + delivery. A *processing* order ALWAYS has a provider ref (that's how it dispatched), so it is refunded **deliberately, with no delivery check — same mechanics as a pending cancel** (user's explicit choice). Encode this as: eligible = in `["pending","processing"]` AND (`status !== "pending"` OR no provider ref). **Why safe:** see rule 3. **How to apply:** the single-order refund route stays more permissive; only the bulk path enforces this.

3. **Every PLATFORM-order provider-settle write MUST be status-guarded, because processing orders are now refundable.**
   Refund money-safety already comes from the `refund-order-{id}` ledger idempotency (rule 1) — that prevents double *credit*. The status guard prevents a refunded order (marked `failed`) being silently resurrected to `completed` by a late provider settle (which would hide a refund + delivery). `settleBatchDeliveries` (topupgh) is **NOT** the only place orders are marked delivered — the **McBIS poller**, **CKG poller**, and **CKG webhook** also settle platform orders, and all do `SELECT`-then-`UPDATE … WHERE id=X` with a network call in between (pollers). Every such write must add `AND status IN ('pending','processing')` (pollers: `= 'processing'`) to its WHERE. Store-order settle paths already lock+guard in a tx and only platform orders are bulk-refundable, so they need no change.

4. **Money-moving previews should fail closed on bad input** (e.g. invalid date filters → 400) rather than silently widening scope.

5. **Auto-refund is allowed ONLY for an explicit provider "cancelled/canceled" word, and only through the shared refund tx.**
   The McBIS poller auto-refunds platform orders when the provider explicitly reports cancelled (user's explicit choice, overriding the earlier no-auto-refund default) — it calls the same shared `refundOrderInTx` (lib/refunds.ts) with a **null actor** (null skips the admin audit ledger entry, which is ledger-only/no balance effect; the customer's `refund-order-{id}` credit stays the sole money anchor). Provider "failed" still moves NO money — admin refunds via the Cancel & Refund button (now shown for `delivered='failed'` too). **How to apply:** any future provider poller wanting auto-refund must reuse `refundOrderInTx(tx, id, null)` inside one tx that also sets `delivered='failed'`, with a guarded mark-failed fallback on error. (Post-status-split note: settle/refund guards are now `status='paid' AND delivered='processing'`, not the old status-word lists in rule 3.)

6. **Store-order cancel refunds the STORE OWNER, not the Paystack customer.**
   `cancelStoreOrderInTx` (lib/refunds.ts) refunds the full `sellingPrice` to the store owner's main wallet — the agent settles with their customer off-platform (user's explicit choice; no Paystack API refund). Idempotency anchor: `refund-store-order-{id}` credit checked under the store_orders row lock. All cancel surfaces MUST go through it — the admin single-cancel route, the bulk-status `cancelled` branch (per-order loop; a plain bulk UPDATE would cancel paid orders WITHOUT refund and make them permanently unrefundable), and the McBIS store branch (null actor). Blocked when `delivered='delivered'`; unpaid cancels move no money; already-cancelled → 400 (callers treat as no-op).

## Known residual (accepted)
Dispatcher *claim* UPDATEs (not the settle writes) remain unguarded, so a *concurrent* dispatch of a genuinely-idle pending order could still deliver one just refunded. Also: refunding a processing order that TopUpGH/McBIS/CKG **physically delivered but hadn't reported yet** still double-loses (no code can retract a sent bundle) — this is the accepted risk of the no-delivery-check design the user chose. Bulk cancel targets stale, long-stuck orders, so it's safe in practice; if you ever bulk-cancel fresh orders, ensure no dispatch is running.
Also pre-existing (unrelated to refunds): admin `bulk-status` sets any status on any ids with no guard — it can flip a refunded `failed` order back to `pending` (re-enabling dispatch) and accepts `"paid"` which violates `orders_status_check` (would 500).
