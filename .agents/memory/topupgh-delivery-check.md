---
name: TopUpGH delivery-check 502 + stuck batches
description: Why the admin "check delivery" button 502'd in prod and how live-status settlement must degrade gracefully
---

- TopUpGH `GET /orders/{id}/delivery-status` can answer **2xx with an empty / non-JSON body** when there is nothing to report. Calling `res.json()` then throws "Unexpected end of JSON input", which propagates out of the route and surfaces to the admin "Check delivery status" button as an **opaque 502**. Non-2xx is swallowed (returns empty → HTTP 200), so a 502 from this path is ALWAYS a genuine throw: empty-body parse, a network error, or the 20s `AbortSignal.timeout`.

- **Rule — request parsing:** `topupghRequest` must read `res.text()` once and `JSON.parse` inside try/catch for BOTH 2xx and non-2xx, returning `{}` on an unparseable/empty body. Never call `res.json()` directly — it makes an empty 2xx fatal.

- **Rule — settlement degradation:** `settleBatchFromLiveStatus` (shared by the manual button via `fetchAndSettleBatchDelivery` AND the 2-min poller `checkProcessingBatches`) must wrap the fetch in try/catch, treat a failure/empty as "no items", and STILL call `settleBatchDeliveries(batch, [])`. An empty list is a per-order no-op (no profit credited → financially safe) but still runs the auto-close that moves a batch out of "processing" once every linked order is terminal. Persist `deliveryData` ONLY when items are returned, so an empty response never overwrites recorded data.

- **Why:** a missed webhook plus a delivery-status endpoint that never returns parseable items means the poller can otherwise never close the batch. Reconciling from current order states is the only way to clear a batch stranded in "processing". Real case: prod batch 90 had all 5 platform orders `completed` but sat in `processing` with `delivery_data` null for ~15h, and every button press 502'd.

- **Testability:** this path only works in prod (Render IP is whitelisted with TopUpGH; dev cannot reach the API). Diagnose by querying the Render prod DB read-only (RENDER_DATABASE_URL) for batch + linked order states; fixes can only be verified after a Render redeploy.
