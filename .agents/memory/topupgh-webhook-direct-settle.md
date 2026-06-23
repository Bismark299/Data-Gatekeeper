---
name: TopUpGH verified-webhook direct-settle gates
description: Why a signature-verified delivery webhook may settle a batch directly, and the two gates that keep it from mis-settling same-phone siblings.
---

# Verified-webhook direct-settle

When outbound egress to TopUpGH's delivery-status endpoint is blocked (only the Render
prod IP is whitelisted), the inbound delivery webhook is the only working settlement
signal. If the webhook's HMAC signature verifies (authentic TopUpGH body), we settle the
batch DIRECTLY from the body instead of re-fetching. Unverified bodies fall back to the
prior re-fetch trigger, byte-identical to before.

**Why this is dangerous:** the shared settle routine settles "the next unsettled order
for this phone" independently in the platform loop and the store loop. It has NO per-order
TopUpGH id to map a delivery item to a specific order. So trusting a webhook body blindly
can complete/credit the WRONG sibling when one phone has multiple orders.

**Two gates are REQUIRED before any direct-settle (both run before the in-flight guard):**

1. **Same-phone conflicting-outcome gate.** Group items by phone; if any phone has more
   than one distinct classified outcome (delivered/failed/pending/unknown), bail to
   ambiguous → fallback. Mixed outcomes for one phone cannot be mapped to the right order.
   Same-phone siblings sharing ONE outcome (all delivered / all failed) are symmetric and safe.

2. **Exact per-phone multiset match for "full" mode.** A merely count-equal snapshot
   (`items.length === totalLinked`) is NOT enough: a phone-skewed snapshot (e.g. one
   delivered item for a phone that has both a platform AND a store order, padded by an
   unrelated phone) lets that single item settle BOTH orders off ONE real delivery.
   Full mode must additionally require the webhook phone multiset to equal the linked-orders
   phone multiset exactly (same phones, same per-phone counts). Otherwise drop to partial,
   which only settles when every item phone maps to exactly one linked order with no repeats.

**How to apply:** any future "trust an external callback and settle directly" path must keep
both gates. During the egress outage, bailing to ambiguous leaves the batch `processing` for
admin force-reconcile — that is the intended safe outcome, never a guess. The underlying
settle routine stays idempotent (status-guarded, FOR UPDATE, store profit credited once),
so verified replays are safe; the gates exist only for the same-batch mixed/skewed case.
