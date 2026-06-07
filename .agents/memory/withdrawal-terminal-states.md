---
name: store withdrawal terminal-state invariant
description: Money-safety rule for any code that finalises an agent store_withdrawals row
---

# Store withdrawal terminal-state invariant

Money model: `amount + GH₵1 fee` is deducted from `stores.profit_balance` at request
time. So completing requires NO balance change; any failed/cancelled transfer MUST
refund `amount + fee`.

**Rule:** EVERY transition that finalises a `store_withdrawals` row — admin complete
(Manual Pay / Force Complete), reject, force-cancel, the Paystack transfer webhook,
and the background reconciler — must run inside a `db.transaction` with a
`SELECT ... FOR UPDATE` lock and a strict status guard. Only `pending|processing`
rows may move to a terminal state; `completed/failed/cancelled` are monotonic and
must be refused.

**Why:** the webhook, reconciler, force-cancel and admin clicks can all fire on the
same row. If `complete` is an unguarded read-then-update (the bug found), it can flip
a row that was already `failed`+refunded (or `cancelled`+refunded) to `completed`,
leaving the agent both refunded AND marked paid — broken accounting / double settle.

**How to apply:** reuse the shared idempotent helpers in
`api-server/src/lib/storeWithdrawals.ts` (`markWithdrawalCompleted`,
`markWithdrawalFailedAndRefund`) — they already lock + guard. If a route needs extra
work (e.g. minting a `reference` on manual completion), replicate the same
lock+guard pattern inside its own transaction; never do a bare update-by-id.
