---
name: Admin order/list search must be server-side
description: Why admin phone/order-id search has to query all rows server-side and bypass the default date filter, or old records become unfindable.
---

# Admin list search must be server-side + date-filter-aware

**Rule:** Any admin list that (a) caps to the newest N rows and (b) defaults its
date filter to "today" MUST provide a server-side `search` query param and the
client MUST skip the date filter while a search is active. Never implement admin
search as a client-side filter over the capped/date-filtered slice.

**Why:** A report of "phone search shows some numbers but not others" + "500+
pending orders invisible" traced to `GET /admin/orders` returning only the newest
500 platform orders while the UI searched that slice client-side, with the page
defaulting to today's date range. Any order older than the newest-500 window (or
outside today) was unfindable even though it existed. Purely a visibility bug — no
money impact — but it looked like data loss to the operator.

**How to apply:**
- Server: add `search` param → `where or(ilike(phoneNumber, %s%), eq(id, n))` (only
  add the id branch when `search` parses to a positive int). Read-only; safe.
- Client: debounce the phone/id box into the `search` param; when searching, skip
  the client-side date filter (both platform and store lists). Keep status-tab
  filtering.
- Dashboard has TWO order hooks: the operational `useAdminListOrders({})` still
  feeds pending-fulfillment network counts + stat cards; a SEPARATE
  `useAdminListOrders({ search })` (enabled only when searching) feeds the search
  table. Do not point the counts at the search set.
- Optimistic updates / invalidation must target the *active* query key. With Orval
  the key is `["/api/admin/orders", params?]`, so `getAdminListOrdersQueryKey()`
  (no args) is the bare prefix that invalidates BOTH `{}` and `{ search }`. On the
  single-hook page, patch/invalidate with `getAdminListOrdersQueryKey(listParams)`.
- The raised row cap (500→2000) is a stopgap for backlog visibility; real fix is
  server pagination since the cap still grows unbounded.
