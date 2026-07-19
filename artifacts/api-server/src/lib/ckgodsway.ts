/**
 * CK Godsway data bundle fulfillment API client.
 * Docs: https://console.ckgodsway.com/api
 *
 * Used for Telecel, AT iShare, AT Big-Time. MTN stays on McBIS.
 *
 * Settings keys in DB:
 *   ckgodsway_enabled   — "true" | "false"
 *   ckgodsway_auto_sync — "true" | "false"  (default true; toggle to stop poller without redeploy)
 *
 * Env vars (set on server, never stored in DB):
 *   CKGODSWAY_API_KEY — X-API-Key header value
 *   CKGODSWAY_API_URL — Base URL (default: https://console.ckgodsway.com/api)
 */

import { eq, and, or, isNotNull, isNull, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import axios from "axios";
import crypto from "crypto";
import { db, settingsTable, ordersTable, storeOrdersTable, bundlesTable, storesTable } from "@workspace/db";
import { parseGb } from "./mcbis";
import { logger } from "./logger";

const ckgAxios = axios.create({
  timeout: 15_000,
  headers: {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "KemDataplus/1.0",
  },
});

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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
        await sleep((attempt + 1) * 1_000);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

const CKG_BASE = process.env.CKGODSWAY_API_URL ?? "https://console.ckgodsway.com/api";

// Maps internal network slugs → CK Godsway network keys.
// Note: MTN intentionally absent — handled by McBIS.
const NETWORK_MAP: Record<string, string> = {
  telecel:      "TELECEL",
  "at-bigtime": "AT_BIGTIME",
  "at-ishare":  "AT_PREMIUM",
  atbigtime:    "AT_BIGTIME",
  atpremium:    "AT_PREMIUM",
};

export function mapToCkgodswayNetwork(network: string): string | null {
  return NETWORK_MAP[network.toLowerCase()] ?? null;
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

export async function getCkgodswaySettings(): Promise<{ enabled: boolean; autoSync: boolean; apiKey: string }> {
  const [enabledRow, autoSyncRow] = await Promise.all([
    db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "ckgodsway_enabled")).then(r => r[0]),
    db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "ckgodsway_auto_sync")).then(r => r[0]),
  ]);
  const enabled  = enabledRow?.value === "true";
  const autoSync = autoSyncRow?.value !== "false";
  const apiKey   = process.env.CKGODSWAY_API_KEY ?? "";
  return { enabled, autoSync, apiKey };
}

// ─── Raw API calls ────────────────────────────────────────────────────────────

type PurchaseResp = {
  success?: boolean;
  error?: string;
  message?: string;
  data?: { reference?: string; status?: string; orderNumber?: number };
  balance?: { previous?: number | string; current?: number | string; deducted?: number | string };
};

export async function ckgodswayPlaceOrder(opts: {
  apiKey: string;
  networkKey: string;     // YELLO | TELECEL | AT_PREMIUM | AT_BIGTIME
  recipient: string;      // 10-digit phone starting with 0
  capacityGb: number;     // e.g. 1, 2, 5
  reference: string;
}): Promise<{ accepted: boolean; reference: string; status: string; message: string }> {
  const { data, status: httpStatus } = await apiRequest(() =>
    ckgAxios.post<PurchaseResp>(
      `${CKG_BASE}/data-purchase`,
      {
        networkKey: opts.networkKey,
        recipient:  opts.recipient,
        capacity:   String(opts.capacityGb),
        reference:  opts.reference,
      },
      {
        headers: { "X-API-Key": opts.apiKey },
        validateStatus: () => true, // we handle non-2xx below
      },
    )
  );

  const ok       = httpStatus < 300 && data?.success === true;
  const status   = String(data?.data?.status ?? "");
  const message  = String(data?.error ?? "");
  const echoedRef = String(data?.data?.reference ?? opts.reference);

  // Cache the post-purchase wallet balance. CK Godsway has no separate balance
  // endpoint — `balance.current` on every purchase response is our only source.
  if (ok && data?.balance?.current != null) {
    const raw = data.balance.current;
    const n = typeof raw === "string" ? parseFloat(raw) : raw;
    if (Number.isFinite(n)) {
      cacheCkgodswayBalance(n).catch(err =>
        logger.warn(`ckgodsway: failed to cache balance: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  return { accepted: ok, reference: echoedRef, status, message };
}

// ─── Cached balance (CK Godsway has no balance endpoint) ──────────────────────

async function cacheCkgodswayBalance(balance: number): Promise<void> {
  const value = balance.toFixed(2);
  const at    = new Date().toISOString();
  await db.insert(settingsTable)
    .values([
      { key: "ckgodsway_last_balance",    value },
      { key: "ckgodsway_last_balance_at", value: at },
    ])
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: sql`excluded.value`, updatedAt: sql`now()` },
    });
}

export async function getCachedCkgodswayBalance(): Promise<{ balance: number | null; at: string | null }> {
  const rows = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable)
    .where(inArray(settingsTable.key, ["ckgodsway_last_balance", "ckgodsway_last_balance_at"]));
  const map = new Map(rows.map(r => [r.key, r.value]));
  const raw = map.get("ckgodsway_last_balance");
  const at  = map.get("ckgodsway_last_balance_at") ?? null;
  const n   = raw != null ? parseFloat(raw) : NaN;
  return { balance: Number.isFinite(n) ? n : null, at };
}

type StatusResp = {
  success?: boolean;
  error?: string;
  data?: { status?: string };
};

/**
 * Returns the upstream order status string (one of:
 * INITIATED, PENDING, PROCESSING, SUCCESSFUL, FAILED, CANCELLED) — or "" on error.
 */
export async function ckgodswayCheckStatus(apiKey: string, reference: string): Promise<string> {
  const { data, status: httpStatus } = await apiRequest(() =>
    ckgAxios.get<StatusResp>(
      `${CKG_BASE}/external/order-status`,
      {
        params: { reference },
        headers: { "X-API-Key": apiKey },
        validateStatus: () => true,
      },
    )
  );
  if (httpStatus >= 300 || !data?.success) return "";
  return String(data?.data?.status ?? "").toUpperCase();
}

// ─── High-level dispatch ──────────────────────────────────────────────────────

export type DispatchOutcome =
  | { dispatched: true;  reference: string }
  | { dispatched: false; reason: "disabled" | "wrong_network" | "bad_data" | "api_error" | "already_dispatched" | "insufficient_funds" };

export async function dispatchToCkgodsway(opts: {
  orderId: number;
  network: string;
  phone: string;
  bundleData: string;
  isStoreOrder?: boolean;
}): Promise<DispatchOutcome> {
  const { enabled, apiKey } = await getCkgodswaySettings();
  if (!enabled || !apiKey) return { dispatched: false, reason: "disabled" };

  const networkKey = mapToCkgodswayNetwork(opts.network);
  if (!networkKey) return { dispatched: false, reason: "wrong_network" };

  const capacityGb = parseGb(opts.bundleData);
  if (capacityGb <= 0) return { dispatched: false, reason: "bad_data" };

  // recipient must be 10 digits starting with 0
  const recipient = opts.phone.replace(/\D/g, "");
  if (!/^0\d{9}$/.test(recipient)) return { dispatched: false, reason: "bad_data" };

  const prefix   = opts.isStoreOrder ? "SO" : "PO";
  const lockRef  = `LOCK-CKG-${prefix}-${opts.orderId}`;
  const finalRef = `CKG-${prefix}-${opts.orderId}-${Date.now()}`;

  // ── Atomic lock ────────────────────────────────────────────────────────────
  let locked = false;
  if (opts.isStoreOrder) {
    const rows = await db.update(storeOrdersTable)
      .set({ ckgodswayReference: lockRef })
      .where(and(
        eq(storeOrdersTable.id, opts.orderId),
        isNull(storeOrdersTable.ckgodswayReference),
        eq(storeOrdersTable.status, "paid"),
        isNull(storeOrdersTable.delivered),
      ))
      .returning({ id: storeOrdersTable.id });
    locked = rows.length > 0;
  } else {
    const rows = await db.update(ordersTable)
      .set({ ckgodswayReference: lockRef })
      .where(and(
        eq(ordersTable.id, opts.orderId),
        isNull(ordersTable.ckgodswayReference),
        eq(ordersTable.status, "paid"),
        isNull(ordersTable.delivered),
      ))
      .returning({ id: ordersTable.id });
    locked = rows.length > 0;
  }
  if (!locked) return { dispatched: false, reason: "already_dispatched" };

  const releaseLock = async () => {
    if (opts.isStoreOrder) {
      await db.update(storeOrdersTable).set({ ckgodswayReference: null }).where(eq(storeOrdersTable.id, opts.orderId));
    } else {
      await db.update(ordersTable).set({ ckgodswayReference: null }).where(eq(ordersTable.id, opts.orderId));
    }
  };

  try {
    const result = await ckgodswayPlaceOrder({
      apiKey,
      networkKey,
      recipient,
      capacityGb,
      reference: finalRef,
    });

    if (!result.accepted) {
      await releaseLock();
      const msg = result.message.toLowerCase();
      if (msg.includes("insufficient") || msg.includes("balance") || msg.includes("fund")) {
        return { dispatched: false, reason: "insufficient_funds" };
      }
      return { dispatched: false, reason: "api_error" };
    }

    return { dispatched: true, reference: result.reference || finalRef };
  } catch {
    await releaseLock();
    return { dispatched: false, reason: "api_error" };
  }
}

// ─── Webhook (optional — coexists with the poller as a fallback) ─────────────

export type CkgodswayWebhookPayload = {
  event?: string;
  data?: {
    reference?: string;
    status?: string;
  };
  // Some providers send these flat — accept both shapes.
  reference?: string;
  status?: string;
};

/**
 * Verify the X-Webhook-Signature header from CK Godsway.
 * Signature = HMAC-SHA256(rawBody, webhookSecret), hex-encoded.
 * Returns false if secret is missing or signature doesn't match.
 */
export function verifyCkgodswayWebhookSignature(signature: string, rawBody: Buffer): boolean {
  const secret = process.env.CKGODSWAY_WEBHOOK_SECRET ?? "";
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  // Length check before timingSafeEqual to avoid a throw on mismatched lengths
  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Process an order status webhook from CK Godsway.
 * Idempotent — safe if the poller already moved the order.
 * Looks up the order by ckgodsway_reference and applies the same status
 * transitions as the poller (SUCCESSFUL → completed, FAILED/CANCELLED → failed).
 * Store-order success credits the store's profit_balance inside a transaction.
 */
export async function handleCkgodswayWebhook(payload: CkgodswayWebhookPayload): Promise<void> {
  const reference = (payload?.data?.reference ?? payload?.reference ?? "").trim();
  const status    = (payload?.data?.status    ?? payload?.status    ?? "").toUpperCase().trim();
  if (!reference || !status) {
    logger.warn({ payload }, "CK Godsway webhook: missing reference or status");
    return;
  }

  const isStoreOrder = reference.startsWith("CKG-SO-");
  const isPlatform   = reference.startsWith("CKG-PO-");
  if (!isStoreOrder && !isPlatform) {
    logger.warn({ reference }, "CK Godsway webhook: unrecognized reference prefix");
    return;
  }

  if (isPlatform) {
    const [row] = await db
      .select({ id: ordersTable.id, status: ordersTable.status, delivered: ordersTable.delivered })
      .from(ordersTable)
      .where(eq(ordersTable.ckgodswayReference, reference));
    if (!row) { logger.warn({ reference }, "CK Godsway webhook: platform order not found"); return; }
    if (row.delivered === "delivered" || row.delivered === "failed") return; // idempotent

    // Guard on status='paid' + non-terminal delivered: an admin bulk-refund can
    // commit between the SELECT above and here, flipping status to refunded. The
    // guard makes that refund authoritative so this webhook can't mark a refunded
    // order as delivered.
    const openDelivery = and(
      eq(ordersTable.status, "paid"),
      or(isNull(ordersTable.delivered), eq(ordersTable.delivered, "processing")),
    );
    if (status === "SUCCESSFUL") {
      await db.update(ordersTable).set({ delivered: "delivered" }).where(and(eq(ordersTable.id, row.id), openDelivery));
    } else if (status === "FAILED" || status === "CANCELLED") {
      await db.update(ordersTable).set({ delivered: "failed" }).where(and(eq(ordersTable.id, row.id), openDelivery));
    }
    return;
  }

  // Store order
  if (status === "SUCCESSFUL") {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: storeOrdersTable.id, profit: storeOrdersTable.profit, storeId: storeOrdersTable.storeId, status: storeOrdersTable.status, delivered: storeOrdersTable.delivered })
        .from(storeOrdersTable)
        .where(eq(storeOrdersTable.ckgodswayReference, reference))
        .for("update");
      if (!row) { logger.warn({ reference }, "CK Godsway webhook: store order not found"); return; }
      if (row.delivered === "delivered" || row.delivered === "failed") return; // idempotent
      if (row.status !== "paid") return; // refunded/cancelled — never credit profit
      await tx.update(storeOrdersTable).set({ delivered: "delivered" }).where(eq(storeOrdersTable.id, row.id));
      const profit = parseFloat(row.profit);
      await tx.update(storesTable)
        .set({ profitBalance: sql`profit_balance + ${profit.toFixed(2)}::numeric` })
        .where(eq(storesTable.id, row.storeId));
    });
  } else if (status === "FAILED" || status === "CANCELLED") {
    const [row] = await db
      .select({ id: storeOrdersTable.id, status: storeOrdersTable.status, delivered: storeOrdersTable.delivered })
      .from(storeOrdersTable)
      .where(eq(storeOrdersTable.ckgodswayReference, reference));
    if (!row) { logger.warn({ reference }, "CK Godsway webhook: store order not found"); return; }
    if (row.delivered === "delivered" || row.delivered === "failed") return; // idempotent
    await db.update(storeOrdersTable).set({ delivered: "failed" }).where(and(
      eq(storeOrdersTable.id, row.id),
      eq(storeOrdersTable.status, "paid"),
      or(isNull(storeOrdersTable.delivered), eq(storeOrdersTable.delivered, "processing")),
    ));
  }
}

// ─── Background poller ────────────────────────────────────────────────────────

let _pollerStarted = false;
let _pollRunning   = false;

export function startCkgodswayPoller(): void {
  if (_pollerStarted) return;
  _pollerStarted = true;

  const INTERVAL_MS       = 10_000;
  const STATUS_CHECK_CAP  = 30;
  const RETRY_CAP         = 5;
  const STATUS_DELAY_MS   = 100;
  const DISPATCH_DELAY_MS = 500;

  const CKG_NETWORKS = ["telecel", "at-ishare", "at-bigtime", "atpremium", "atbigtime"];

  const poll = async () => {
    if (_pollRunning) return;
    _pollRunning = true;
    try {
      const { enabled, autoSync, apiKey } = await getCkgodswaySettings();
      if (!enabled || !autoSync || !apiKey) return;

      // ── 1. Check delivery of processing platform orders ──
      const platformProcessing = await db
        .select({ id: ordersTable.id, ref: ordersTable.ckgodswayReference })
        .from(ordersTable)
        .where(and(
          eq(ordersTable.status, "paid"),
          eq(ordersTable.delivered, "processing"),
          isNotNull(ordersTable.ckgodswayReference),
        ))
        .orderBy(ordersTable.createdAt)
        .limit(STATUS_CHECK_CAP);

      for (const o of platformProcessing) {
        if (!o.ref || o.ref.startsWith("LOCK-")) continue;
        try {
          const s = await ckgodswayCheckStatus(apiKey, o.ref);
          // Guard on status='paid' AND delivered='processing': an admin bulk-refund
          // can commit during the network call above (flipping status to refunded).
          // Without the dual-column guard this write would mark a refunded order
          // delivered → refund + delivery.
          if (s === "SUCCESSFUL") {
            await db.update(ordersTable).set({ delivered: "delivered" }).where(and(eq(ordersTable.id, o.id), eq(ordersTable.status, "paid"), eq(ordersTable.delivered, "processing")));
          } else if (s === "FAILED" || s === "CANCELLED") {
            await db.update(ordersTable).set({ delivered: "failed" }).where(and(eq(ordersTable.id, o.id), eq(ordersTable.status, "paid"), eq(ordersTable.delivered, "processing")));
          }
        } catch { /* transient — retry next cycle */ }
        await sleep(STATUS_DELAY_MS);
      }

      // ── 2. Check delivery of processing store orders ──
      const storeProcessing = await db
        .select({ id: storeOrdersTable.id, ref: storeOrdersTable.ckgodswayReference })
        .from(storeOrdersTable)
        .where(and(
          eq(storeOrdersTable.status, "paid"),
          eq(storeOrdersTable.delivered, "processing"),
          isNotNull(storeOrdersTable.ckgodswayReference),
        ))
        .orderBy(storeOrdersTable.createdAt)
        .limit(STATUS_CHECK_CAP);

      for (const o of storeProcessing) {
        if (!o.ref || o.ref.startsWith("LOCK-")) continue;
        try {
          const s = await ckgodswayCheckStatus(apiKey, o.ref);
          if (s === "SUCCESSFUL") {
            await db.transaction(async (tx) => {
              const [row] = await tx
                .select({ profit: storeOrdersTable.profit, storeId: storeOrdersTable.storeId, status: storeOrdersTable.status, delivered: storeOrdersTable.delivered })
                .from(storeOrdersTable)
                .where(eq(storeOrdersTable.id, o.id))
                .for("update");
              // Only settle rows still paid + delivering — a concurrent admin
              // refund/cancel must never be credited profit or marked delivered.
              if (!row || row.status !== "paid" || row.delivered !== "processing") return;
              await tx.update(storeOrdersTable).set({ delivered: "delivered" }).where(and(eq(storeOrdersTable.id, o.id), eq(storeOrdersTable.status, "paid"), eq(storeOrdersTable.delivered, "processing")));
              const profit = parseFloat(row.profit);
              await tx.update(storesTable)
                .set({ profitBalance: sql`profit_balance + ${profit.toFixed(2)}::numeric` })
                .where(eq(storesTable.id, row.storeId));
            });
          } else if (s === "FAILED" || s === "CANCELLED") {
            await db.update(storeOrdersTable).set({ delivered: "failed" }).where(and(eq(storeOrdersTable.id, o.id), eq(storeOrdersTable.status, "paid"), eq(storeOrdersTable.delivered, "processing")));
          }
        } catch { /* transient — retry next cycle */ }
        await sleep(STATUS_DELAY_MS);
      }

      // ── 3. Retry undispatched platform CKG-network orders ──
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
          eq(ordersTable.status, "paid"),
          isNull(ordersTable.delivered),
          isNull(ordersTable.ckgodswayReference),
          inArray(bundlesTable.network, CKG_NETWORKS),
        ))
        .orderBy(ordersTable.createdAt)
        .limit(RETRY_CAP);

      for (const o of pendingPlatform) {
        if (!o.network) continue;
        try {
          const outcome = await dispatchToCkgodsway({
            orderId:    o.id,
            network:    o.network,
            phone:      o.phone,
            bundleData: o.bundleData,
          });
          if (outcome.dispatched) {
            await db.update(ordersTable)
              .set({ delivered: "processing", ckgodswayReference: outcome.reference })
              .where(eq(ordersTable.id, o.id));
          } else if (outcome.reason === "insufficient_funds") {
            break;
          }
        } catch { /* retry next cycle */ }
        await sleep(DISPATCH_DELAY_MS);
      }

      // ── 4. Retry undispatched paid store CKG-network orders ──
      const paidStore = await db
        .select({
          id:         storeOrdersTable.id,
          phone:      storeOrdersTable.customerPhone,
          bundleData: storeOrdersTable.bundleData,
          network:    storeOrdersTable.bundleNetwork,
        })
        .from(storeOrdersTable)
        .where(and(
          eq(storeOrdersTable.status, "paid"),
          isNull(storeOrdersTable.delivered),
          isNull(storeOrdersTable.ckgodswayReference),
          inArray(storeOrdersTable.bundleNetwork, CKG_NETWORKS),
        ))
        .orderBy(storeOrdersTable.createdAt)
        .limit(RETRY_CAP);

      for (const o of paidStore) {
        try {
          const outcome = await dispatchToCkgodsway({
            orderId:      o.id,
            network:      o.network,
            phone:        o.phone,
            bundleData:   o.bundleData,
            isStoreOrder: true,
          });
          if (outcome.dispatched) {
            await db.update(storeOrdersTable)
              .set({ delivered: "processing", ckgodswayReference: outcome.reference })
              .where(eq(storeOrdersTable.id, o.id));
          } else if (outcome.reason === "insufficient_funds") {
            break;
          }
        } catch { /* retry next cycle */ }
        await sleep(DISPATCH_DELAY_MS);
      }
    } catch { /* top-level guard */ }
    finally { _pollRunning = false; }
  };

  setTimeout(() => {
    poll();
    setInterval(poll, INTERVAL_MS);
  }, 7_000);
}
