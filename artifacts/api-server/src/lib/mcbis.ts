/**
 * McbisSolution data bundle fulfillment API client.
 * Docs: https://documenter.getpostman.com/view/11929812/2sB34kDynu
 *
 * Flow:
 *  - McbisSolution ON + MTN network → dispatch → status "processing", reference stored
 *  - McbisSolution OFF or non-MTN   → order stays "pending" (untouched)
 *  - Background poller runs every 30 s, checks "processing" orders, marks "completed" when McbisSolution confirms
 *
 * Settings keys in DB:
 *   mcbis_enabled   — "true" | "false"
 *   mcbis_auto_sync — "true" | "false"  (default true; toggle to stop poller without redeploy)
 *
 * Env vars (set on server, never stored in DB):
 *   DATAHUB_API_TOKEN — Bearer token for McbisSolution API
 *   DATAHUB_API_URL   — Base URL for McbisSolution API (default: https://datahub.mcbissolution.com/api/v1)
 */

import { eq, and, isNotNull, isNull, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import axios from "axios";
import { db, settingsTable, ordersTable, storeOrdersTable, bundlesTable, storesTable } from "@workspace/db";
import { logger } from "./logger";

const mcbisAxios = axios.create({
  timeout: 15_000, // 15-second hard limit per request
  headers: {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "KemDataplus/1.0",
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Retries a flaky network call up to MAX_RETRIES times on connection-level
 * errors (timeout, reset). Waits 1 s then 2 s between attempts.
 */
async function apiRequest<T>(fn: () => Promise<T>): Promise<T> {
  const MAX_RETRIES = 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const retryable = ["ECONNABORTED", "ECONNRESET", "ETIMEDOUT"].includes(err?.code ?? "");
      if (retryable && attempt < MAX_RETRIES) {
        await sleep((attempt + 1) * 1_000); // 1 s, then 2 s
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

const MCBIS_BASE = process.env.DATAHUB_API_URL ?? "https://datahub.mcbissolution.com/api/v1";

// Maps internal network slugs → McbisSolution network keys
const NETWORK_MAP: Record<string, string> = {
  mtn:          "mtn",
  telecel:      "telecel",
  "at-bigtime": "atbigtime",
  "at-ishare":  "atpremium",
  atbigtime:    "atbigtime",
  atpremium:    "atpremium",
};

export function mapToMcbisNetwork(network: string): string | null {
  return NETWORK_MAP[network.toLowerCase()] ?? null;
}

/** Parse "5GB" → 5, "10GB" → 10. Returns 0 on failure. */
export function parseGb(dataAmount: string): number {
  const m = dataAmount.match(/^(\d+(?:\.\d+)?)\s*GB$/i);
  return m ? parseFloat(m[1]) : 0;
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

export async function getMcbisSettings(): Promise<{ enabled: boolean; autoSync: boolean; apiKey: string }> {
  const [enabledRow, autoSyncRow] = await Promise.all([
    db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "mcbis_enabled")).then(r => r[0]),
    db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "mcbis_auto_sync")).then(r => r[0]),
  ]);
  const enabled   = enabledRow?.value === "true";
  const autoSync  = autoSyncRow?.value !== "false"; // default ON unless explicitly set to "false"
  const apiKey    = process.env.DATAHUB_API_TOKEN ?? "";
  return { enabled, autoSync, apiKey };
}

// ─── Raw API calls ────────────────────────────────────────────────────────────

export async function mcbisGetBalance(apiKey: string): Promise<number> {
  const { data } = await apiRequest(() =>
    mcbisAxios.get<{ data: { walletBalance: string } }>(
      `${MCBIS_BASE}/walletBalance`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    )
  );
  return parseFloat(data.data.walletBalance);
}

// ─── Balance cache ──────────────────────────────────────────────────────────
// McbisSolution rate-limits /walletBalance (HTTP 429). Both the admin sidebar
// (auto-polls) and the dispatch poller (every 30 s) read it, so without caching
// the endpoint trips the limit and the admin widget surfaces a 502. Cache the
// value briefly and share it across ALL callers; on failure, fall back to the
// last-known value (flagged stale) instead of throwing, so the balance widget
// degrades gracefully rather than erroring out. Single-process safe (WEB_CONCURRENCY=1).
let balanceCache: { value: number; at: number } | null = null;
const BALANCE_CACHE_TTL_MS = 60_000;

export async function mcbisGetBalanceCached(
  apiKey: string,
  maxAgeMs: number = BALANCE_CACHE_TTL_MS,
): Promise<{ balance: number; stale: boolean; fetchedAt: number }> {
  const now = Date.now();
  if (balanceCache && now - balanceCache.at < maxAgeMs) {
    return { balance: balanceCache.value, stale: false, fetchedAt: balanceCache.at };
  }
  try {
    const value = await mcbisGetBalance(apiKey);
    balanceCache = { value, at: now };
    return { balance: value, stale: false, fetchedAt: now };
  } catch (err) {
    // Rate-limited or transient failure: serve the last-known balance if we have
    // one so callers never see a hard error just because Mcbis throttled us.
    if (balanceCache) {
      return { balance: balanceCache.value, stale: true, fetchedAt: balanceCache.at };
    }
    throw err;
  }
}

export async function mcbisPlaceOrder(opts: {
  apiKey: string;
  network: string;
  reference: string;
  receiver: string;
  amountGb: number;
}): Promise<{ accepted: boolean; status: string; message: string }> {
  const { data, status: httpStatus } = await apiRequest(() =>
    mcbisAxios.post<Record<string, unknown>>(
      `${MCBIS_BASE}/placeOrder`,
      {
        network:   opts.network,
        reference: opts.reference,
        receiver:  opts.receiver,
        amount:    opts.amountGb,
      },
      { headers: { Authorization: `Bearer ${opts.apiKey}` } },
    )
  );

  const inner   = data.data as Record<string, unknown> | undefined;
  const status  = String(inner?.status ?? data.status ?? "");
  const message = String(data.message ?? data.error ?? "");

  return {
    accepted: httpStatus < 300 && (status === "success" || status === "pending"),
    status,
    message,
  };
}

export async function mcbisCheckStatus(apiKey: string, reference: string): Promise<string> {
  // Response: { data: { status: "success", order: { status: "pending"|"success"|"failed", ... } } }
  // data.status is the API response status (always "success" if request worked).
  // data.order.status is the actual fulfillment status we need.
  const { data } = await apiRequest(() =>
    mcbisAxios.get<{ data: { order?: { status?: string } } }>(
      `${MCBIS_BASE}/checkOrderStatus/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    )
  );
  return String(data.data?.order?.status ?? "");
}

// ─── High-level dispatch ──────────────────────────────────────────────────────

export type DispatchOutcome =
  | { dispatched: true;  reference: string }
  | { dispatched: false; reason: "disabled" | "wrong_network" | "bad_data" | "api_error" | "already_dispatched" | "insufficient_funds" };

/**
 * Attempt to dispatch one order to McbisSolution.
 *
 * Guards (checked against DB before calling the API):
 *  - Order must be status "pending"
 *  - Order must not already have a mcbisReference (not yet sent)
 *
 * Returns `{ dispatched: true, reference }` if McbisSolution accepted the order.
 * Returns `{ dispatched: false, reason: "insufficient_funds" }` when McbisSolution
 *   wallet is empty — order stays "pending" so it can be retried later.
 * Returns `{ dispatched: false }` for all other non-dispatch cases.
 */
export async function dispatchToMcbis(opts: {
  orderId: number;
  network: string;
  phone: string;
  bundleData: string;
  isStoreOrder?: boolean;
}): Promise<DispatchOutcome> {
  const { enabled, apiKey } = await getMcbisSettings();
  if (!enabled || !apiKey) return { dispatched: false, reason: "disabled" };

  // Only MTN is currently connected
  const mcbisNetwork = mapToMcbisNetwork(opts.network);
  if (mcbisNetwork !== "mtn") return { dispatched: false, reason: "wrong_network" };

  const amountGb = parseGb(opts.bundleData);
  if (amountGb <= 0) return { dispatched: false, reason: "bad_data" };

  const prefix   = opts.isStoreOrder ? "SO" : "PO";
  const lockRef  = `LOCK-${prefix}-${opts.orderId}`;
  const finalRef = `${prefix}-${opts.orderId}-${Date.now()}`;

  // ── Atomic lock: write a temp ref before calling API ────────────────────────
  // Two concurrent callers (poller + admin) race on a single UPDATE.
  // The loser gets 0 rows back and returns immediately — no double-send.
  let locked = false;
  if (opts.isStoreOrder) {
    const rows = await db.update(storeOrdersTable)
      .set({ mcbisReference: lockRef })
      .where(and(
        eq(storeOrdersTable.id, opts.orderId),
        isNull(storeOrdersTable.mcbisReference),
        isNull(storeOrdersTable.topupghBatchId),
        inArray(storeOrdersTable.status, ["pending", "paid"]),
      ))
      .returning({ id: storeOrdersTable.id });
    locked = rows.length > 0;
  } else {
    const rows = await db.update(ordersTable)
      .set({ mcbisReference: lockRef })
      .where(and(
        eq(ordersTable.id, opts.orderId),
        isNull(ordersTable.mcbisReference),
        isNull(ordersTable.topupghBatchId),
        eq(ordersTable.status, "pending"),
      ))
      .returning({ id: ordersTable.id });
    locked = rows.length > 0;
  }
  if (!locked) return { dispatched: false, reason: "already_dispatched" };

  // Helper to release lock on this order
  const releaseLock = async () => {
    if (opts.isStoreOrder) {
      await db.update(storeOrdersTable).set({ mcbisReference: null }).where(eq(storeOrdersTable.id, opts.orderId));
    } else {
      await db.update(ordersTable).set({ mcbisReference: null }).where(eq(ordersTable.id, opts.orderId));
    }
  };

  try {
    const result = await mcbisPlaceOrder({
      apiKey,
      network:   mcbisNetwork,
      reference: finalRef,
      receiver:  opts.phone,
      amountGb,
    });

    if (!result.accepted) {
      await releaseLock();
      const msg = result.message.toLowerCase();
      if (msg.includes("insufficient") || msg.includes("balance") || msg.includes("fund") || msg.includes("wallet")) {
        return { dispatched: false, reason: "insufficient_funds" };
      }
      return { dispatched: false, reason: "api_error" };
    }

    return { dispatched: true, reference: finalRef };
  } catch {
    await releaseLock();
    return { dispatched: false, reason: "api_error" };
  }
}

// ─── Background poller ────────────────────────────────────────────────────────

let _pollerStarted = false;
let _pollRunning   = false; // prevents overlapping cycles if a cycle takes longer than INTERVAL_MS

/**
 * Start the background poller (idempotent — safe to call multiple times).
 *
 * Protection summary:
 *  1. 30-second interval — non-overlapping (cycle must finish before next starts)
 *  2. autoSync toggle in DB (mcbis_auto_sync = "false" → zero requests sent)
 *  3. Status checks: max 30 per cycle, 100 ms between each call
 *  4. Retry dispatch: max 5 per cycle, 500 ms between each call, 5-min grace period
 *  5. 45-second request timeout + 2 retries with back-off (in apiRequest())
 *  6. Atomic lock in dispatchToMcbis() prevents concurrent double-send
 *  7. Status checks round-robin by updatedAt so orders stuck "processing" at
 *     McBIS indefinitely cannot starve newer orders out of the per-cycle cap
 */
export function startMcbisPoller(): void {
  if (_pollerStarted) return;
  _pollerStarted = true;

  const INTERVAL_MS           = 10_000;  // 10 s between cycles
  const STATUS_CHECK_CAP      = 30;      // max checkOrderStatus calls per cycle
  const RETRY_CAP             = 5;       // max new dispatch attempts per cycle
  const STATUS_DELAY_MS       = 100;     // ms between status-check calls
  const DISPATCH_DELAY_MS     = 500;     // ms between dispatch calls

  const poll = async () => {
    if (_pollRunning) return; // skip if previous cycle still running
    _pollRunning = true;
    try {
      const { enabled, autoSync, apiKey } = await getMcbisSettings();
      if (!enabled || !autoSync || !apiKey) return; // toggle-gated

      // ── 1. Check status of processing platform orders (cap 30, 100 ms apart) ──
      const platformProcessing = await db
        .select({ id: ordersTable.id, ref: ordersTable.mcbisReference })
        .from(ordersTable)
        .where(and(
          eq(ordersTable.status, "processing"),
          isNotNull(ordersTable.mcbisReference),
        ))
        // Round-robin by updatedAt (bumped on every check below): a batch of
        // permanently-"processing" orders at McBIS would otherwise monopolize the
        // per-cycle cap forever and starve newer orders (head-of-line blocking).
        .orderBy(ordersTable.updatedAt)
        .limit(STATUS_CHECK_CAP);

      let checkErrors = 0;
      let lastCheckError = "";
      let rateLimited = false;

      for (const o of platformProcessing) {
        if (!o.ref) continue;
        let settled = false;
        try {
          // Normalize: McBIS status words are compared case-insensitively so a
          // "Success"/"COMPLETED"/"Delivered" response still settles the order.
          const s = (await mcbisCheckStatus(apiKey, o.ref)).trim().toLowerCase();
          // Guard on status="processing": an admin bulk-refund can commit during the
          // network call above (flipping this row to failed+refunded). Without the
          // guard this write would resurrect it to completed → refund + delivery.
          if (s === "success" || s === "completed" || s === "delivered") {
            await db.update(ordersTable).set({ status: "completed" }).where(and(eq(ordersTable.id, o.id), eq(ordersTable.status, "processing")));
            settled = true;
          } else if (s === "failed" || s === "cancelled" || s === "canceled") {
            await db.update(ordersTable).set({ status: "failed" }).where(and(eq(ordersTable.id, o.id), eq(ordersTable.status, "processing")));
            settled = true;
          } else if (s !== "pending" && s !== "processing") {
            // Unknown status word (or empty/unexpected response shape) — the order
            // would silently stay "processing" forever. Surface the raw value.
            logger.warn({ orderId: o.id, ref: o.ref, mcbisStatus: s || "(empty)" }, "McBIS poller: unrecognized platform order status");
          }
        } catch (err) {
          checkErrors++;
          lastCheckError = err instanceof Error ? err.message : String(err);
          if (axios.isAxiosError(err) && err.response?.status === 429) { rateLimited = true; break; }
        }
        // Push unsettled orders to the back of the round-robin queue so they
        // can't monopolize the per-cycle cap (settling updates already bump
        // updatedAt via $onUpdate).
        if (!settled) {
          await db.update(ordersTable).set({ updatedAt: new Date() }).where(eq(ordersTable.id, o.id));
        }
        await sleep(STATUS_DELAY_MS);
      }

      // ── 2. Check status of processing store orders (cap 30, 100 ms apart) ──
      const storeProcessing = await db
        .select({ id: storeOrdersTable.id, ref: storeOrdersTable.mcbisReference })
        .from(storeOrdersTable)
        .where(and(
          eq(storeOrdersTable.status, "processing"),
          isNotNull(storeOrdersTable.mcbisReference),
        ))
        // Round-robin by updatedAt — see platform loop above.
        .orderBy(storeOrdersTable.updatedAt)
        .limit(STATUS_CHECK_CAP);

      for (const o of storeProcessing) {
        if (rateLimited) break;
        if (!o.ref) continue;
        let settled = false;
        try {
          const s = (await mcbisCheckStatus(apiKey, o.ref)).trim().toLowerCase();
          if (s === "success" || s === "completed" || s === "delivered") {
            await db.transaction(async (tx) => {
              const [row] = await tx
                .select({ profit: storeOrdersTable.profit, storeId: storeOrdersTable.storeId, status: storeOrdersTable.status })
                .from(storeOrdersTable)
                .where(eq(storeOrdersTable.id, o.id))
                .for("update");
              // Only settle rows still "processing" — a concurrent admin refund/cancel
              // must not be resurrected to completed (which would also credit profit).
              if (!row || row.status !== "processing") return;
              await tx.update(storeOrdersTable).set({ status: "completed" }).where(and(eq(storeOrdersTable.id, o.id), eq(storeOrdersTable.status, "processing")));
              const profit = parseFloat(row.profit);
              await tx.update(storesTable)
                .set({ profitBalance: sql`profit_balance + ${profit.toFixed(2)}::numeric` })
                .where(eq(storesTable.id, row.storeId));
            });
            settled = true; // only after the tx commits — a thrown tx must still rotate the row
          } else if (s === "failed" || s === "cancelled" || s === "canceled") {
            await db.update(storeOrdersTable).set({ status: "failed" }).where(and(eq(storeOrdersTable.id, o.id), eq(storeOrdersTable.status, "processing")));
            settled = true;
          } else if (s !== "pending" && s !== "processing") {
            logger.warn({ storeOrderId: o.id, ref: o.ref, mcbisStatus: s || "(empty)" }, "McBIS poller: unrecognized store order status");
          }
        } catch (err) {
          checkErrors++;
          lastCheckError = err instanceof Error ? err.message : String(err);
          if (axios.isAxiosError(err) && err.response?.status === 429) { rateLimited = true; break; }
        }
        // Round-robin: push unsettled store orders to the back of the queue.
        if (!settled) {
          await db.update(storeOrdersTable).set({ updatedAt: new Date() }).where(eq(storeOrdersTable.id, o.id));
        }
        await sleep(STATUS_DELAY_MS);
      }

      // Surface check failures once per cycle (previously swallowed silently, which
      // made "orders complete at McBIS but stay processing here" undiagnosable).
      if (checkErrors > 0 || rateLimited) {
        logger.warn({ checkErrors, rateLimited, lastCheckError }, "McBIS poller: order status checks failed this cycle");
      }

      // ── 3. Retry pending platform MTN orders (cap 5, 500 ms apart, 30 s grace) ──
      // Pre-check balance once — skip all dispatches if wallet is empty
      let mcbisBalance = 0;
      // Use the shared cache so the poller doesn't add load to the rate-limited
      // balance endpoint; on failure assume non-zero so we still attempt dispatch.
      try { mcbisBalance = (await mcbisGetBalanceCached(apiKey)).balance; } catch { mcbisBalance = 1; }

      if (mcbisBalance > 0 && !rateLimited) { // skip dispatch when out of balance or rate-limited this cycle
      const pendingPlatform = await db
        .select({
          id:         ordersTable.id,
          phone:      ordersTable.phoneNumber,
          bundleData: ordersTable.bundleData,
          network:    bundlesTable.network,
          createdAt:  ordersTable.createdAt,
        })
        .from(ordersTable)
        .leftJoin(bundlesTable, eq(bundlesTable.id, ordersTable.bundleId))
        .where(and(
          eq(ordersTable.status, "pending"),
          isNull(ordersTable.mcbisReference),
          isNull(ordersTable.topupghBatchId),
          eq(bundlesTable.network, "mtn"),
        ))
        .orderBy(ordersTable.createdAt)
        .limit(RETRY_CAP);

      for (const o of pendingPlatform) {
        if (!o.network) continue;
        try {
          const outcome = await dispatchToMcbis({
            orderId:    o.id,
            network:    o.network,
            phone:      o.phone,
            bundleData: o.bundleData,
          });
          if (outcome.dispatched) {
            await db.update(ordersTable)
              .set({ status: "processing", mcbisReference: outcome.reference })
              .where(eq(ordersTable.id, o.id));
          } else if (outcome.reason === "insufficient_funds") {
            break; // wallet empty — no point trying more this cycle
          }
        } catch { /* retry next cycle */ }
        await sleep(DISPATCH_DELAY_MS);
      }

      // ── 4. Retry paid store MTN orders (cap 5, 500 ms apart, 30 s grace) ──
      const paidStore = await db
        .select({
          id:         storeOrdersTable.id,
          phone:      storeOrdersTable.customerPhone,
          bundleData: storeOrdersTable.bundleData,
          network:    storeOrdersTable.bundleNetwork,
          createdAt:  storeOrdersTable.createdAt,
        })
        .from(storeOrdersTable)
        .where(and(
          eq(storeOrdersTable.status, "paid"),
          isNull(storeOrdersTable.mcbisReference),
          isNull(storeOrdersTable.topupghBatchId),
          eq(storeOrdersTable.bundleNetwork, "mtn"),
        ))
        .orderBy(storeOrdersTable.createdAt)
        .limit(RETRY_CAP);

      for (const o of paidStore) {
        try {
          const outcome = await dispatchToMcbis({
            orderId:      o.id,
            network:      o.network,
            phone:        o.phone,
            bundleData:   o.bundleData,
            isStoreOrder: true,
          });
          if (outcome.dispatched) {
            await db.update(storeOrdersTable)
              .set({ status: "processing", mcbisReference: outcome.reference })
              .where(eq(storeOrdersTable.id, o.id));
          } else if (outcome.reason === "insufficient_funds") {
            break;
          }
        } catch { /* retry next cycle */ }
        await sleep(DISPATCH_DELAY_MS);
      }
      } // end mcbisBalance > 0 guard

    } catch { /* top-level guard */ }
    finally { _pollRunning = false; }
  };

  // First run after 5 s (let server finish startup), then every 30 s
  setTimeout(() => {
    poll();
    setInterval(poll, INTERVAL_MS);
  }, 5_000);
}

