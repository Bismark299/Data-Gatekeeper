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
 *   mcbis_enabled  — "true" | "false"
 *
 * Env vars (set on server, never stored in DB):
 *   DATAHUB_API_TOKEN — Bearer token for McbisSolution API
 *   DATAHUB_API_URL   — Base URL for McbisSolution API (default: https://datahub.mcbissolution.com/api/v1)
 */

import { eq, and, isNotNull, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, settingsTable, ordersTable, storeOrdersTable, bundlesTable, storesTable } from "@workspace/db";

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

export async function getMcbisSettings(): Promise<{ enabled: boolean; apiKey: string }> {
  const [row] = await db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "mcbis_enabled"));
  const enabled = row?.value === "true";
  const apiKey  = process.env.DATAHUB_API_TOKEN ?? "";
  return { enabled, apiKey };
}

// ─── Raw API calls ────────────────────────────────────────────────────────────

export async function mcbisGetBalance(apiKey: string): Promise<number> {
  const res = await fetch(`${MCBIS_BASE}/walletBalance`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`McbisSolution HTTP ${res.status}`);
  const data = await res.json() as { data: { walletBalance: string } };
  return parseFloat(data.data.walletBalance);
}

export async function mcbisPlaceOrder(opts: {
  apiKey: string;
  network: string;
  reference: string;
  receiver: string;
  amountGb: number;
}): Promise<{ accepted: boolean; status: string; message: string }> {
  const res = await fetch(`${MCBIS_BASE}/placeOrder`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      network:   opts.network,
      reference: opts.reference,
      receiver:  opts.receiver,
      amount:    opts.amountGb,
    }),
  });

  const data = await res.json() as Record<string, unknown>;
  const inner  = data.data as Record<string, unknown> | undefined;
  const status  = String(inner?.status ?? data.status ?? "");
  const message = String(data.message ?? data.error ?? "");

  return {
    accepted: res.ok && (status === "success" || status === "pending"),
    status,
    message,
  };
}

export async function mcbisCheckStatus(apiKey: string, reference: string): Promise<string> {
  const res = await fetch(`${MCBIS_BASE}/checkOrderStatus/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`McbisSolution HTTP ${res.status}`);
  // Response: { data: { status: "success", order: { status: "pending"|"success"|"failed", ... } } }
  // data.status is the API response status (always "success" if request worked).
  // data.order.status is the actual fulfillment status we need.
  const body = await res.json() as { data: { order?: { status?: string } } };
  return String(body.data?.order?.status ?? "");
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

  // ── Guard: verify order is still pending and not already dispatched ──────────
  if (opts.isStoreOrder) {
    const [row] = await db
      .select({ status: storeOrdersTable.status, ref: storeOrdersTable.mcbisReference })
      .from(storeOrdersTable)
      .where(eq(storeOrdersTable.id, opts.orderId));
    // Only allow dispatch from "pending" (pre-payment) or "paid" (payment confirmed, awaiting dispatch)
    if (!row || row.ref || (row.status !== "pending" && row.status !== "paid")) {
      return { dispatched: false, reason: "already_dispatched" };
    }
  } else {
    const [row] = await db
      .select({ status: ordersTable.status, ref: ordersTable.mcbisReference })
      .from(ordersTable)
      .where(eq(ordersTable.id, opts.orderId));
    if (!row || row.ref || row.status !== "pending") {
      return { dispatched: false, reason: "already_dispatched" };
    }
  }

  const prefix    = opts.isStoreOrder ? "SO" : "PO";
  const reference = `${prefix}-${opts.orderId}-${Date.now()}`;

  try {
    const result = await mcbisPlaceOrder({
      apiKey,
      network:   mcbisNetwork,
      reference,
      receiver:  opts.phone,
      amountGb,
    });

    if (!result.accepted) {
      // Detect insufficient wallet balance — order stays pending for retry
      const msg = result.message.toLowerCase();
      if (msg.includes("insufficient") || msg.includes("balance") || msg.includes("fund") || msg.includes("wallet")) {
        return { dispatched: false, reason: "insufficient_funds" };
      }
      return { dispatched: false, reason: "api_error" };
    }

    return { dispatched: true, reference };
  } catch {
    return { dispatched: false, reason: "api_error" };
  }
}

// ─── Background poller ────────────────────────────────────────────────────────

let _pollerStarted = false;

/**
 * Start the background poller (idempotent — safe to call multiple times).
 * Every 30 seconds, checks all "processing" orders that have a mcbisReference
 * and updates them to "completed" or "failed" based on McbisSolution's response.
 */
export function startMcbisPoller(): void {
  if (_pollerStarted) return;
  _pollerStarted = true;

  const INTERVAL_MS = 30_000;

  const poll = async () => {
    try {
      const { enabled, apiKey } = await getMcbisSettings();
      if (!enabled || !apiKey) return;

      // ── Platform orders ───────────────────────────────────────────────────
      const platformOrders = await db
        .select({ id: ordersTable.id, ref: ordersTable.mcbisReference })
        .from(ordersTable)
        .where(and(
          eq(ordersTable.status, "processing"),
          isNotNull(ordersTable.mcbisReference),
        ));

      for (const o of platformOrders) {
        if (!o.ref) continue;
        try {
          const mcbisStatus = await mcbisCheckStatus(apiKey, o.ref);
          if (mcbisStatus === "success" || mcbisStatus === "completed") {
            await db.update(ordersTable).set({ status: "completed" }).where(eq(ordersTable.id, o.id));
          } else if (mcbisStatus === "failed") {
            await db.update(ordersTable).set({ status: "failed" }).where(eq(ordersTable.id, o.id));
          }
          // "pending" or unknown → leave as "processing", check again next cycle
        } catch { /* network error — retry next cycle */ }
      }

      // ── Store orders ──────────────────────────────────────────────────────
      const storeOrders = await db
        .select({ id: storeOrdersTable.id, ref: storeOrdersTable.mcbisReference })
        .from(storeOrdersTable)
        .where(and(
          eq(storeOrdersTable.status, "processing"),
          isNotNull(storeOrdersTable.mcbisReference),
        ));

      for (const o of storeOrders) {
        if (!o.ref) continue;
        try {
          const mcbisStatus = await mcbisCheckStatus(apiKey, o.ref);
          if (mcbisStatus === "success" || mcbisStatus === "completed") {
            // Credit profit atomically alongside the status change
            await db.transaction(async (tx) => {
              const [row] = await tx
                .select({ profit: storeOrdersTable.profit, storeId: storeOrdersTable.storeId, status: storeOrdersTable.status })
                .from(storeOrdersTable)
                .where(eq(storeOrdersTable.id, o.id))
                .for("update");
              if (!row || row.status === "completed") return; // already done
              await tx.update(storeOrdersTable).set({ status: "completed" }).where(eq(storeOrdersTable.id, o.id));
              const profit = parseFloat(row.profit);
              await tx.update(storesTable)
                .set({ profitBalance: sql`profit_balance + ${profit.toFixed(2)}::numeric` })
                .where(eq(storesTable.id, row.storeId));
            });
          } else if (mcbisStatus === "failed") {
            await db.update(storeOrdersTable).set({ status: "failed" }).where(eq(storeOrdersTable.id, o.id));
          }
        } catch { /* retry next cycle */ }
      }

      // ── Retry: pending MTN platform orders with no mcbisReference (cap 5) ──
      const RETRY_CAP = 5;
      const pendingPlatform = await db
        .select({
          id:         ordersTable.id,
          phone:      ordersTable.phoneNumber,
          bundleData: ordersTable.bundleData,
          network:    bundlesTable.network,
        })
        .from(ordersTable)
        .leftJoin(bundlesTable, eq(bundlesTable.id, ordersTable.bundleId))
        .where(and(
          eq(ordersTable.status, "pending"),
          isNull(ordersTable.mcbisReference),
          eq(bundlesTable.network, "mtn"),
        ))
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
            // Wallet still empty — stop retrying for this cycle to avoid hammering the API
            break;
          }
        } catch { /* retry next cycle */ }
      }

      // ── Retry: "paid" MTN store orders not yet dispatched (cap 5) ──────────
      // "paid" = Paystack payment confirmed, awaiting McbisSolution dispatch.
      // "pending" store orders are unpaid — never auto-dispatch those.
      const paidStore = await db
        .select({
          id:          storeOrdersTable.id,
          phone:       storeOrdersTable.customerPhone,
          bundleData:  storeOrdersTable.bundleData,
          network:     storeOrdersTable.bundleNetwork,
        })
        .from(storeOrdersTable)
        .where(and(
          eq(storeOrdersTable.status, "paid"),
          isNull(storeOrdersTable.mcbisReference),
          eq(storeOrdersTable.bundleNetwork, "mtn"),
        ))
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
      }
    } catch { /* top-level guard */ }
  };

  // Run immediately on start, then on interval
  poll();
  setInterval(poll, INTERVAL_MS);
}

