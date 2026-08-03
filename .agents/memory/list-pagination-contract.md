---
name: List pagination contract
description: How list endpoints opt into server-side pagination without breaking legacy callers
---

Every list endpoint follows an opt-in envelope contract: sending `page` (or `pageSize`) returns `{ total, page, pageSize, data, ...extras }`; omitting them returns the legacy plain array with a bounded cap (100–5000 depending on endpoint). Shared helpers live in the api-server's `lib/pagination.ts` (`parsePage`, `parseDateRange`).

**Why:** generated api-zod/api-client-react types weren't regenerated; updated pages use raw fetch + react-query (the wallets AllTransactions pattern) while old hooks keep working against the legacy shape.

**How to apply:**
- New/changed list endpoints must keep both shapes (envelope only when `wantsPage`).
- Admin orders + store-orders: a date range ALWAYS also returns paid-but-unfinished rows (delivered null/'processing') out of range — required so network-pending copy buttons and "complete all processing" see older unfinished orders; the client still date-filters for date-scoped stats. Do not "fix" that as a bug.
- Search params (`search`/`phone`) deliberately ignore the date range — full-history search powers the "matches outside this date range — widen dates" hints.
- Stat cards/summaries are computed with global SQL aggregates in the envelope (`stats`/`counts`/`summary`), never from the returned page.
