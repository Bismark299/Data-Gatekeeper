import { logger } from "./logger";

// ─── MTN MADAPI Customer Transfer client ──────────────────────────────────────
// Spec: POST /customers/{senderMsisdn} — transfers airtime/data from one MTN
// number to another. Auth is OAuth2 client-credentials.
//
// Credentials come from secrets:
//   MTN_CONSUMER_KEY    — Customer / Consumer Key
//   MTN_CONSUMER_SECRET — Customer / Consumer Secret
// Optional config (env):
//   MTN_API_BASE        — defaults to https://api.mtn.com/v1
//   MTN_COUNTRY_CODE    — defaults to GH
//   MTN_TARGET_SYSTEM   — MADAPI targetSystem value (required by MTN per onboarding)
//   MTN_CALLBACK_URL    — optional async callback URL

const API_BASE = process.env.MTN_API_BASE ?? "https://api.mtn.com/v1";
const COUNTRY_CODE = process.env.MTN_COUNTRY_CODE ?? "GH";

export function mtnConfigured(): boolean {
  return !!(process.env.MTN_CONSUMER_KEY && process.env.MTN_CONSUMER_SECRET);
}

// ─── OAuth token cache ────────────────────────────────────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const key = process.env.MTN_CONSUMER_KEY ?? "";
  const secret = process.env.MTN_CONSUMER_SECRET ?? "";
  if (!key || !secret) throw new Error("MTN API credentials not configured");

  const basic = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch(`${API_BASE}/oauth/access_token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const text = await res.text();
  let data: { access_token?: string; expires_in?: number; token_type?: string } = {};
  try { data = JSON.parse(text); } catch { /* non-JSON error body */ }

  if (!res.ok || !data.access_token) {
    logger.error({ status: res.status, body: text.slice(0, 500) }, "MTN OAuth token request failed");
    throw new Error(`MTN authentication failed (HTTP ${res.status})`);
  }

  const ttlMs = (data.expires_in ?? 3600) * 1000;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + ttlMs };
  return data.access_token;
}

// Verify credentials by fetching a token. Used by the dashboard "test connection".
export async function mtnTestConnection(): Promise<{ ok: true }> {
  await getAccessToken();
  return { ok: true };
}

export interface TransferParams {
  senderMsisdn: string;
  receiverMsisdn: string;
  transferType: string; // "data" | "airtime"
  amount: string;
  pin: string;
  productCode?: string;
  transactionId: string; // caller-generated correlation id, persisted BEFORE the call
}

// "unknown" = the request reached MTN but the outcome is ambiguous (network drop,
// 5xx, unparseable body). The transfer may or may not have completed, so it must
// NOT be auto-treated as failed/retried — an operator should verify first.
export type TransferOutcome = "success" | "failed" | "unknown";

export interface TransferResult {
  outcome: TransferOutcome;
  mtnTransactionId: string;
  statusCode: string;
  statusMessage: string;
  raw: unknown;
}

export async function mtnTransfer(params: TransferParams): Promise<TransferResult> {
  // Token failures throw → caller treats as a pre-flight failure (no transfer sent).
  const token = await getAccessToken();

  const body: Record<string, unknown> = {
    receiverMsisdn: params.receiverMsisdn,
    transferAmount: params.amount,
    type: params.transferType,
    targetSystem: process.env.MTN_TARGET_SYSTEM ?? "",
    pin: params.pin,
  };
  if (params.productCode) body.productCode = params.productCode;
  if (process.env.MTN_CALLBACK_URL) body.callbackUrl = process.env.MTN_CALLBACK_URL;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    transactionId: params.transactionId,
    "x-country-code": COUNTRY_CODE,
  };
  if (process.env.MTN_ORIGIN_CHANNEL_ID) headers["x-origin-channelid"] = process.env.MTN_ORIGIN_CHANNEL_ID;

  const url = `${API_BASE}/customers/${encodeURIComponent(params.senderMsisdn)}?network=mtn`;

  let res: Response;
  let text: string;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    text = await res.text();
  } catch (e) {
    // Network-level failure AFTER the request may have been received by MTN → ambiguous.
    logger.error({ err: e, transactionId: params.transactionId }, "MTN transfer network error — outcome unknown");
    return {
      outcome: "unknown",
      mtnTransactionId: "",
      statusCode: "",
      statusMessage: "Network error contacting MTN — verify on MTN before retrying",
      raw: null,
    };
  }

  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text); } catch { /* non-JSON */ }

  const statusCode = String((data.statusCode as string) ?? res.status);
  const statusMessage = String((data.statusMessage as string) ?? (data.message as string) ?? (res.ok ? "Success" : "Transfer failed"));
  const inner = (data.data as { localTransactionId?: string; transactionState?: string }) ?? {};
  const mtnTransactionId = String((data.transactionId as string) ?? inner.localTransactionId ?? "");

  let outcome: TransferOutcome;
  if (res.ok && inner.transactionState?.toLowerCase() !== "failed") {
    outcome = "success";                       // 2xx and not explicitly failed
  } else if (res.status >= 500) {
    outcome = "unknown";                        // server error — transfer may still have processed
  } else {
    outcome = "failed";                         // clear 4xx business rejection — no transfer happened
  }

  if (outcome !== "success") {
    logger.warn({ status: res.status, statusCode, statusMessage, outcome, transactionId: params.transactionId }, "MTN transfer not successful");
  }

  return { outcome, mtnTransactionId, statusCode, statusMessage, raw: data };
}
