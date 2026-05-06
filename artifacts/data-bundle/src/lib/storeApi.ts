const BASE = "/api";

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

export interface Store {
  id: number; userId: number; name: string; slug: string;
  description: string; colorTheme: string; isActive: boolean;
  profitBalance: number;
  momoNetwork: string | null; momoNumber: string | null; momoName: string | null;
  createdAt: string; updatedAt: string;
}
export interface StoreBundle {
  id: number; storeId: number; bundleId: number; sellingPrice: number;
  isActive: boolean; createdAt: string; name: string; description: string;
  dataAmount: string; validityDays: number; basePrice: number; network: string; category: string;
}
export interface StoreOrder {
  id: number; storeId: number; storeBundleId: number; bundleId: number;
  bundleName: string; bundleData: string; bundleNetwork: string; bundleValidityDays: number;
  customerPhone: string; customerEmail: string; sellingPrice: number; basePrice: number;
  profit: number; paystackReference: string; status: string;
  createdAt: string; updatedAt: string;
}
export interface StoreStats {
  totalSales: number; totalRevenue: number; totalProfit: number;
  profitBalance: number; totalPending: number;
}
export interface StoreWithdrawal {
  id: number; storeId: number; amount: number; status: string;
  method: string; accountNumber: string; accountName: string; note: string; createdAt: string;
  autoMessage?: "sent" | "processing" | "awaiting_admin";
}
export interface PublicStore {
  store: { id: number; name: string; slug: string; description: string; colorTheme: string; };
  bundles: StoreBundle[];
}

export const storeApi = {
  getMyStore: () => request<Store | null>("GET", "/stores/my"),
  createStore: (data: { name: string; description?: string; colorTheme?: string; slug?: string }) =>
    request<Store>("POST", "/stores", data),
  updateStore: (data: Partial<Pick<Store, "name" | "description" | "colorTheme" | "isActive">>) =>
    request<Store>("PUT", "/stores/my", data),
  getBundles: () => request<StoreBundle[]>("GET", "/stores/my/bundles"),
  addBundle: (data: { bundleId: number; sellingPrice: number }) =>
    request<StoreBundle>("POST", "/stores/my/bundles", data),
  updateBundle: (id: number, data: { sellingPrice: number; isActive?: boolean }) =>
    request<StoreBundle>("PUT", `/stores/my/bundles/${id}`, data),
  removeBundle: (id: number) => request<{ ok: boolean }>("DELETE", `/stores/my/bundles/${id}`),
  getOrders: () => request<StoreOrder[]>("GET", "/stores/my/orders"),
  getStats: () => request<StoreStats>("GET", "/stores/my/stats"),
  getWithdrawals: () => request<StoreWithdrawal[]>("GET", "/stores/my/withdrawals"),
  withdraw: (data: { amount: number; method?: string; bankCode?: string; accountNumber: string; accountName?: string; note?: string }) =>
    request<StoreWithdrawal>("POST", "/stores/my/withdraw", data),
  saveMomoDetails: (data: { momoNetwork: string; momoNumber: string; momoName: string }) =>
    request<{ ok: boolean }>("POST", "/stores/my/momo-details", data),
  deleteMomoDetails: () =>
    request<{ ok: boolean }>("DELETE", "/stores/my/momo-details"),
  bulkOrder: (data: { items: { phone: string; gb: number }[]; network: string }) =>
    request<{ processed: number; skipped: { phone: string; gb: number; reason: string }[]; totalCost: number; orders: unknown[] }>("POST", "/orders/bulk", data),
  // Public
  getPublicStore: (slug: string) => request<PublicStore>("GET", `/s/${slug}`),
  checkout: (slug: string, data: { storeBundleId: number; customerPhone: string; customerEmail: string }) =>
    request<{ authorizationUrl: string; reference: string; storeOrderId: number }>("POST", `/s/${slug}/checkout`, data),
  verifyPayment: (slug: string, ref: string) =>
    request<StoreOrder>("POST", `/s/${slug}/verify`, { ref }),
  trackOrders: (slug: string, phone: string) =>
    request<Array<{ id: number; bundleData: string; bundleNetwork: string; customerPhone: string; sellingPrice: number; status: string; paystackReference: string; createdAt: string }>>("GET", `/s/${slug}/orders?phone=${encodeURIComponent(phone)}`),
};
