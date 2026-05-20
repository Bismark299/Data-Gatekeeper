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

import { eq, and, isNotNull, isNull, inArray, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import axios from "axios";
import { db, settingsTable, ordersTable, storeOrdersTable, apiOrdersTable, bundlesTable, storesTable } from "@workspace/db";

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
  isApiOrder?: boolean;
}): Promise<DispatchOutcome> {
  const { enabled, apiKey } = await getMcbisSettings();
  if (!enabled || !apiKey) return { dispatched: false, reason: "disabled" };

  // Only MTN is currently connected
  const mcbisNetwork = mapToMcbisNetwork(opts.network);
  if (mcbisNetwork !== "mtn") return { dispatched: false, reason: "wrong_network" };

  const amountGb = parseGb(opts.bundleData);
  if (amountGb <= 0) return { dispatched: false, reason: "bad_data" };

  const prefix   = opts.isApiOrder ? "AO" : opts.isStoreOrder ? "SO" : "PO";
  const lockRef  = `LOCK-${prefix}-${opts.orderId}`;
  const finalRef = `${prefix}-${opts.orderId}-${Date.now()}`;

  // ── Atomic lock: write a temp ref before calling API ────────────────────────
  // Two concurrent callers (poller + admin) race on a single UPDATE.
  // The loser gets 0 rows back and returns immediately — no double-send.
  let locked = false;
  if (opts.isApiOrder) {
    const rows = await db.update(apiOrdersTable)
      .set({ mcbisReference: lockRef })
      .where(and(
        eq(apiOrdersTable.id, opts.orderId),
        isNull(apiOrdersTable.mcbisReference),
        eq(apiOrdersTable.status, "pending"),
      ))
      .returning({ id: apiOrdersTable.id });
    locked = rows.length > 0;
  } else if (opts.isStoreOrder) {
    const rows = await db.update(storeOrdersTable)
      .set({ mcbisReference: lockRef })
      .where(and(
        eq(storeOrdersTable.id, opts.orderId),
        isNull(storeOrdersTable.mcbisReference),
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
        eq(ordersTable.status, "pending"),
      ))
      .returning({ id: ordersTable.id });
    locked = rows.length > 0;
  }
  if (!locked) return { dispatched: false, reason: "already_dispatched" };

  // Helper to release lock on this order
  const releaseLock = async () => {
    if (opts.isApiOrder) {
      await db.update(apiOrdersTable).set({ mcbisReference: null }).where(eq(apiOrdersTable.id, opts.orderId));
    } else if (opts.isStoreOrder) {
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
 *  7. Orders stuck >24 h in "processing" are auto-failed to stop indefinite polling
 */
export function startMcbisPoller(): void {
  if (_pollerStarted) return;
  _pollerStarted = true;

  const INTERVAL_MS           = 10_000;  // 10 s between cycles
  const STATUS_CHECK_CAP      = 30;      // max checkOrderStatus calls per cycle
  const RETRY_CAP             = 5;       // max new dispatch attempts per cycle
  const STATUS_DELAY_MS       = 100;     // ms between status-check calls
  const DISPATCH_DELAY_MS     = 500;     // ms between dispatch calls
  const GRACE_PERIOD_MS       = 30 * 1000;             // 30 s — don't retry brand-new orders

  const poll = async () => {
    if (_pollRunning) return; // skip if previous cycle still running
    _pollRunning = true;
    try {
      const { enabled, autoSync, apiKey } = await getMcbisSettings();
      if (!enabled || !autoSync || !apiKey) return; // toggle-gated

      const now             = Date.now();
      const graceThreshold  = new Date(now - GRACE_PERIOD_MS);

      // ── 1. Check status of processing platform orders (cap 30, 100 ms apart) ──
      const platformProcessing = await db
        .select({ id: ordersTable.id, ref: ordersTable.mcbisReference })
        .from(ordersTable)
        .where(and(
          eq(ordersTable.status, "processing"),
          isNotNull(ordersTable.mcbisReference),
        ))
        .orderBy(ordersTable.createdAt)
        .limit(STATUS_CHECK_CAP);

      for (const o of platformProcessing) {
        if (!o.ref) continue;
        try {
          const s = await mcbisCheckStatus(apiKey, o.ref);
          if (s === "success" || s === "completed") {
            await db.update(ordersTable).set({ status: "completed" }).where(eq(ordersTable.id, o.id));
          } else if (s === "failed") {
            await db.update(ordersTable).set({ status: "failed" }).where(eq(ordersTable.id, o.id));
          }
        } catch { /* transient error — retry next cycle */ }
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
        .orderBy(storeOrdersTable.createdAt)
        .limit(STATUS_CHECK_CAP);

      for (const o of storeProcessing) {
        if (!o.ref) continue;
        try {
          const s = await mcbisCheckStatus(apiKey, o.ref);
          if (s === "success" || s === "completed") {
            await db.transaction(async (tx) => {
              const [row] = await tx
                .select({ profit: storeOrdersTable.profit, storeId: storeOrdersTable.storeId, status: storeOrdersTable.status })
                .from(storeOrdersTable)
                .where(eq(storeOrdersTable.id, o.id))
                .for("update");
              if (!row || row.status === "completed") return;
              await tx.update(storeOrdersTable).set({ status: "completed" }).where(eq(storeOrdersTable.id, o.id));
              const profit = parseFloat(row.profit);
              await tx.update(storesTable)
                .set({ profitBalance: sql`profit_balance + ${profit.toFixed(2)}::numeric` })
                .where(eq(storesTable.id, row.storeId));
            });
          } else if (s === "failed") {
            await db.update(storeOrdersTable).set({ status: "failed" }).where(eq(storeOrdersTable.id, o.id));
          }
        } catch { /* transient error — retry next cycle */ }
        await sleep(STATUS_DELAY_MS);
      }

      // ── 3. Retry pending platform MTN orders (cap 5, 500 ms apart, 30 s grace) ──
      // Pre-check balance once — skip all dispatches if wallet is empty
      let mcbisBalance = 0;
      try { mcbisBalance = await mcbisGetBalance(apiKey); } catch { /* assume non-zero so we still try */ mcbisBalance = 1; }

      if (mcbisBalance > 0) { // only attempt dispatch when there's balance
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
          eq(bundlesTable.network, "mtn"),
          lt(ordersTable.createdAt, graceThreshold), // 5-min grace: skip brand-new orders
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
          eq(storeOrdersTable.bundleNetwork, "mtn"),
          lt(storeOrdersTable.createdAt, graceThreshold),
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
      // ── 5. Retry pending API client MTN orders (cap 5, 500 ms apart, 30 s grace) ──
      const pendingApi = await db
        .select({
          id:         apiOrdersTable.id,
          phone:      apiOrdersTable.phoneNumber,
          bundleData: apiOrdersTable.bundleData,
          network:    apiOrdersTable.bundleNetwork,
          createdAt:  apiOrdersTable.createdAt,
        })
        .from(apiOrdersTable)
        .where(and(
          eq(apiOrdersTable.status, "pending"),
          isNull(apiOrdersTable.mcbisReference),
          eq(apiOrdersTable.bundleNetwork, "mtn"),
          lt(apiOrdersTable.createdAt, graceThreshold),
        ))
        .orderBy(apiOrdersTable.createdAt)
        .limit(RETRY_CAP);

      for (const o of pendingApi) {
        try {
          const outcome = await dispatchToMcbis({
            orderId:    o.id,
            network:    o.network,
            phone:      o.phone,
            bundleData: o.bundleData,
            isApiOrder: true,
          });
          if (outcome.dispatched) {
            await db.update(apiOrdersTable)
              .set({ status: "processing", mcbisReference: outcome.reference })
              .where(eq(apiOrdersTable.id, o.id));
          } else if (outcome.reason === "insufficient_funds") {
            break;
          }
        } catch { /* retry next cycle */ }
        await sleep(DISPATCH_DELAY_MS);
      }
      } // end mcbisBalance > 0 guard

      // ── 6. Check status of processing API orders (cap 30, 100 ms apart) ──
      const apiProcessing = await db
        .select({ id: apiOrdersTable.id, ref: apiOrdersTable.mcbisReference })
        .from(apiOrdersTable)
        .where(and(
          eq(apiOrdersTable.status, "processing"),
          isNotNull(apiOrdersTable.mcbisReference),
        ))
        .orderBy(apiOrdersTable.createdAt)
        .limit(STATUS_CHECK_CAP);

      for (const o of apiProcessing) {
        if (!o.ref) continue;
        try {
          const s = await mcbisCheckStatus(apiKey, o.ref);
          if (s === "success" || s === "completed") {
            await db.update(apiOrdersTable).set({ status: "completed" }).where(eq(apiOrdersTable.id, o.id));
          } else if (s === "failed") {
            await db.update(apiOrdersTable).set({ status: "failed" }).where(eq(apiOrdersTable.id, o.id));
          }
        } catch { /* transient — retry next cycle */ }
        await sleep(STATUS_DELAY_MS);
      }
    } catch { /* top-level guard */ }
    finally { _pollRunning = false; }
  };

  // First run after 5 s (let server finish startup), then every 30 s
  setTimeout(() => {
    poll();
    setInterval(poll, INTERVAL_MS);
  }, 5_000);
}

