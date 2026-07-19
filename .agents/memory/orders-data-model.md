---
name: orders data model quirks
description: Non-obvious facts about how order data is stored, for anyone aggregating it
---

# Orders aggregation quirks

- `orders.bundleData` (and `store_orders.bundle_data`) is a **text label** like `"1GB"`, `"500MB"`, `"50GB"` — NOT a numeric quantity. Any "total data" aggregation must parse it: strip the unit, treat MB as value/1000, TB as value*1000. Parse strictly (anchored, require a recognized unit) and return 0 on unrecognized labels, or junk like `"500KB"` / `"2 x 500MB"` silently overstates totals.
- `orders.buyingCost` is **nullable** (many legacy/dev rows are null). Coalesce to 0 before summing cost; profit = price - coalesce(buyingCost,0).
- The admin Report page (`/admin/report`) aggregates **delivered platform orders only** (profit realized on delivery — since the status split this means `status='paid' AND delivered='delivered'`, not a legacy `status='completed'`). It deliberately excludes store_orders (agent sales have different profit semantics: sellingPrice/basePrice/agentCost/profit).
- **Status split (July 2026):** `status` = payment only (pending/paid/failed/refunded, +cancelled on store_orders); `delivered` = fulfillment (NULL/processing/delivered/failed). Legacy `completed`/`processing` status values no longer exist. UI "phase" is derived via `orderPhase.ts` (platformPhase/storePhase). Old failed-and-refunded rows were backfilled as (refunded, failed) so they intentionally appear under both Failed and Refunded filters.
- Day-bucketing uses UTC `createdAt` date; safe because server + operator are both UTC/GMT (Ghana).

# Bundle pricing tiers (cost vs selling price)

- `bundles.price` is the **platform cost** (lowest tier, e.g. MTN 1GB = 3.80), NOT a retail price. `bundles.dealerPrice` and `bundles.agentPrice` are higher **selling** tiers (agentPrice > dealerPrice > price). Many bundles leave dealer/agent prices null.
- On an order, `order.price` = the role-based `effectivePrice` the buyer actually paid (agent→agentPrice, dealer→dealerPrice, regular→bundle.price) and `order.buyingCost` = `bundle.price` (the cost).
- **Admin Report convention** (`/admin/report`): Cost column = `bundle.price` (cost), Price column = `bundle.agentPrice` (the selling price agents buy at, with fallback to order.price then cost when agentPrice is null), Profit = Price − Cost. **Why:** the operator defines the report as the platform's agent-sale margin, not actual per-buyer revenue — so it always values rows at the agent price regardless of who actually bought.
