---
name: orders data model quirks
description: Non-obvious facts about how order data is stored, for anyone aggregating it
---

# Orders aggregation quirks

- `orders.bundleData` (and `store_orders.bundle_data`) is a **text label** like `"1GB"`, `"500MB"`, `"50GB"` — NOT a numeric quantity. Any "total data" aggregation must parse it: strip the unit, treat MB as value/1000, TB as value*1000. Parse strictly (anchored, require a recognized unit) and return 0 on unrecognized labels, or junk like `"500KB"` / `"2 x 500MB"` silently overstates totals.
- `orders.buyingCost` is **nullable** (many legacy/dev rows are null). Coalesce to 0 before summing cost; profit = price - coalesce(buyingCost,0).
- The admin Report page (`/admin/report`) aggregates **completed platform orders only** (profit realized on completion). It deliberately excludes store_orders (agent sales have different profit semantics: sellingPrice/basePrice/agentCost/profit).
- Day-bucketing uses UTC `createdAt` date; safe because server + operator are both UTC/GMT (Ghana).
