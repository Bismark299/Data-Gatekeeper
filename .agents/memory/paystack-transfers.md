---
name: Paystack transfer references
description: Constraints on Paystack transfer (payout) references and OTP automation, learned from the agent profit-withdrawal flow.
---

# Paystack transfer references & automation

## Reference format constraint
Paystack **transfer** references (the `reference` sent to `POST /transfer`) must be:
- only lowercase `a-z`, digits `0-9`, underscore `_`, dash `-`
- 16–50 characters long

**Why:** An uppercase prefix (we previously used `WD-...`) is silently accepted in **test mode** but rejected by the **live** Transfer API, so live profit withdrawals fail while tests pass. Reference is generated in `genWithdrawalReference()` and must stay lowercase (now `wd-...`).

**How to apply:** Any new transfer/payout reference must match `/^[a-z0-9_-]{16,50}$/`. This rule is for transfers only — payment/charge references (wallet top-up `DB-PS-...`, store charge `STORE-...`) are not bound by it.

## OTP / "Confirm transfers before sending"
For fully automated payouts, OTP must be disabled in the Paystack Dashboard (Settings → Preferences → uncheck "Confirm transfers before sending"). If left on, the initiate-transfer response status is `otp` and the code (by design) routes the withdrawal to the admin queue instead of auto-completing — not a bug, just not automatic.

## Status flow
Initiate response status is normally `pending` (test mode often returns `success` immediately). Final settlement comes via webhooks `transfer.success` / `transfer.failed` / `transfer.reversed`, with a reconciler as fallback. Money model: amount + fee deducted at request time, so completion needs no balance change and failure/reversal must refund amount + fee.
