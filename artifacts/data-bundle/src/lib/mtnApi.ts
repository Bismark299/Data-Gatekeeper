const BASE = "/api/mtn";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("auth:unauthorized"));
    throw Object.assign(new Error(json?.error ?? "Request failed"), { status: res.status, data: json });
  }
  return json as T;
}

export interface MtnTransfer {
  id: number;
  senderMsisdn: string;
  receiverMsisdn: string;
  transferType: "data" | "airtime";
  amount: string;
  productCode: string;
  status: "pending" | "success" | "failed" | "unknown";
  transactionId: string;
  mtnTransactionId: string;
  statusCode: string;
  statusMessage: string;
  createdAt: string;
}

export interface MtnStats {
  total: number;
  success: number;
  failed: number;
  pending: number;
  unknown: number;
  dataSent: number;
  airtimeSent: number;
}

export interface MtnTransfersPage {
  transfers: MtnTransfer[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MtnTransferInput {
  senderMsisdn: string;
  receiverMsisdn: string;
  transferType: "data" | "airtime";
  amount: string;
  pin: string;
  productCode?: string;
}

export const mtnApi = {
  testConnection: () => request<{ ok: boolean }>("GET", "/test"),
  getStats: () => request<MtnStats>("GET", "/stats"),
  getTransfers: (params: { page?: number; pageSize?: number; status?: string; phone?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.status && params.status !== "all") q.set("status", params.status);
    if (params.phone) q.set("phone", params.phone);
    const qs = q.toString();
    return request<MtnTransfersPage>("GET", `/transfers${qs ? `?${qs}` : ""}`);
  },
  transfer: (data: MtnTransferInput) =>
    request<{ transfer: MtnTransfer }>("POST", "/transfer", data),
};
