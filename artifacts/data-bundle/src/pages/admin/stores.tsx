import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminSidebar } from "@/components/AdminSidebar";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Menu, Store, ChevronLeft, ExternalLink, ArrowDownCircle,
  ShoppingCart, TrendingUp, Wallet, Search, X, RefreshCw,
  CheckCircle2, XCircle, ThumbsUp, ThumbsDown,
} from "lucide-react";

const NETWORK_BADGE: Record<string, string> = {
  MTN:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400",
  VDF:  "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
  ATL:  "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
  mtn:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400",
  telecel: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
  "at-ishare":  "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
  "at-bigtime": "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
};
const NETWORK_LABEL: Record<string, string> = {
  MTN: "MTN MoMo", VDF: "Telecel Cash", ATL: "AirtelTigo",
  mtn: "MTN", telecel: "Telecel", "at-ishare": "AT iShare", "at-bigtime": "AT Big-Time",
};

const STATUS_COLORS: Record<string, string> = {
  pending:    "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  completed:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed:     "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  cancelled:  "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};
const STATUS_LABEL: Record<string, string> = {
  pending:    "Awaiting Admin",
  processing: "Sent via Paystack",
  completed:  "Paid",
  failed:     "Failed",
  cancelled:  "Refunded",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });

export default function AdminStores() {
  return (
    <ProtectedRoute adminOnly>
      <AdminStoresContent />
    </ProtectedRoute>
  );
}

function AdminStoresContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<"orders" | "withdrawals">("orders");
  const [actionId, setActionId] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: stores, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["adminStores"],
    queryFn: () => fetch("/api/admin/stores", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 15000,
  });

  const { data: storeOrders, refetch: refetchOrders } = useQuery<any[]>({
    queryKey: ["adminStoreOrders", selectedStoreId],
    queryFn: () => fetch(`/api/admin/stores/${selectedStoreId}/orders`, { credentials: "include" }).then(r => r.json()),
    enabled: selectedStoreId !== null && detailTab === "orders",
  });

  const { data: storeWithdrawals, refetch: refetchWithdrawals } = useQuery<any[]>({
    queryKey: ["adminStoreWithdrawals", selectedStoreId],
    queryFn: () => fetch(`/api/admin/stores/${selectedStoreId}/withdrawals`, { credentials: "include" }).then(r => r.json()),
    enabled: selectedStoreId !== null && detailTab === "withdrawals",
  });

  const [withdrawalActionId, setWithdrawalActionId] = useState<number | null>(null);

  const handleWithdrawalApprove = async (wId: number) => {
    setWithdrawalActionId(wId);
    try {
      const res = await fetch(`/api/admin/stores/withdrawals/${wId}/approve`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Withdrawal #${wId} approved` });
      refetchWithdrawals(); refetch();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error approving withdrawal", variant: "destructive" });
    } finally { setWithdrawalActionId(null); }
  };

  const handleWithdrawalReject = async (wId: number) => {
    setWithdrawalActionId(wId);
    try {
      const res = await fetch(`/api/admin/stores/withdrawals/${wId}/reject`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Withdrawal #${wId} rejected — amount refunded to store balance` });
      refetchWithdrawals(); refetch();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error rejecting withdrawal", variant: "destructive" });
    } finally { setWithdrawalActionId(null); }
  };

  const filteredStores = useMemo(() => {
    let src = stores ?? [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      src = src.filter((s: any) => s.name.toLowerCase().includes(q) || s.slug?.toLowerCase().includes(q));
    }
    return src;
  }, [stores, search]);

  const selectedStore = useMemo(() => (stores ?? []).find((s: any) => s.id === selectedStoreId), [stores, selectedStoreId]);

  const handleComplete = async (orderId: number) => {
    setActionId(orderId);
    try {
      const res = await fetch(`/api/admin/store-orders/${orderId}/complete`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Order #${orderId} completed` });
      refetchOrders(); refetch();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error", variant: "destructive" });
    } finally { setActionId(null); }
  };

  const handleCancel = async (orderId: number) => {
    setActionId(orderId);
    try {
      const res = await fetch(`/api/admin/store-orders/${orderId}/cancel`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Order #${orderId} cancelled` });
      refetchOrders(); refetch();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error", variant: "destructive" });
    } finally { setActionId(null); }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <div className="hidden lg:block w-64 shrink-0 border-r border-border">
        <AdminSidebar />
      </div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64 z-50">
            <AdminSidebar open onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 flex items-center gap-3 px-4 border-b border-border bg-background shrink-0">
          <button className="lg:hidden p-2 rounded-lg hover:bg-muted" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          {selectedStoreId ? (
            <div className="flex items-center gap-2">
              <button onClick={() => setSelectedStoreId(null)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-sm">
                <ChevronLeft className="w-4 h-4" /> All Stores
              </button>
              <span className="text-muted-foreground">/</span>
              <span className="font-semibold text-sm">{selectedStore?.name}</span>
            </div>
          ) : (
            <h1 className="font-bold text-lg flex items-center gap-2"><Store className="w-5 h-5" /> Stores</h1>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {/* Store Detail View */}
          {selectedStoreId && selectedStore ? (
            <div className="max-w-5xl mx-auto space-y-6">
              {/* Store header card */}
              <div className="bg-card border border-border rounded-2xl p-6 flex flex-col sm:flex-row gap-4 items-start">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Store className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-foreground">{selectedStore.name}</h2>
                    <Link href={`/s/${selectedStore.slug}`} className="text-muted-foreground hover:text-primary">
                      <ExternalLink className="w-4 h-4" />
                    </Link>
                  </div>
                  <p className="text-sm text-muted-foreground font-mono">/{selectedStore.slug}</p>
                  {selectedStore.description && <p className="text-sm text-muted-foreground mt-1">{selectedStore.description}</p>}
                </div>
                <div className="grid grid-cols-3 gap-4 shrink-0">
                  {[
                    { label: "Total Orders", value: selectedStore.totalOrders, icon: ShoppingCart },
                    { label: "Total Earned", value: `GH₵${(selectedStore.totalEarned ?? 0).toFixed(2)}`, icon: TrendingUp },
                    { label: "Balance", value: `GH₵${(selectedStore.profitBalance ?? 0).toFixed(2)}`, icon: Wallet },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="bg-muted/30 rounded-xl p-3 text-center">
                      <Icon className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                      <div className="text-base font-bold text-foreground">{value}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detail tabs */}
              <div className="flex items-center gap-1 bg-muted/40 rounded-xl p-1 border border-border w-fit">
                <button onClick={() => setDetailTab("orders")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${detailTab === "orders" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <ShoppingCart className="w-4 h-4" /> Orders ({selectedStore.totalOrders})
                </button>
                <button onClick={() => setDetailTab("withdrawals")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${detailTab === "withdrawals" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <ArrowDownCircle className="w-4 h-4" /> Withdrawals
                </button>
              </div>

              {/* Orders detail */}
              {detailTab === "orders" && (
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    {!storeOrders ? (
                      <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
                    ) : storeOrders.length === 0 ? (
                      <div className="py-16 text-center text-muted-foreground text-sm">No orders yet</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/20">
                            {["#", "Data", "Network", "Phone", "Revenue", "Profit", "Status", "Date", "Actions"].map(h => (
                              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {storeOrders.map(o => {
                            const canAct = o.status !== "completed" && o.status !== "cancelled";
                            const isActioning = actionId === o.id;
                            return (
                              <tr key={o.id} className="hover:bg-muted/20 transition-colors">
                                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{o.id}</td>
                                <td className="px-4 py-3 font-bold text-xs">{o.bundleData}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${NETWORK_BADGE[o.bundleNetwork] ?? "bg-gray-100 text-gray-700"}`}>
                                    {NETWORK_LABEL[o.bundleNetwork] ?? o.bundleNetwork}
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs">{o.customerPhone}</td>
                                <td className="px-4 py-3 font-semibold text-xs">GH₵{o.sellingPrice.toFixed(2)}</td>
                                <td className="px-4 py-3 text-emerald-600 font-semibold text-xs">+GH₵{o.profit.toFixed(2)}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[o.status] ?? ""}`}>
                                    {o.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                                <td className="px-4 py-3">
                                  {canAct ? (
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => handleComplete(o.id)} disabled={isActioning}
                                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 transition-colors">
                                        <CheckCircle2 className="w-3 h-3" />{isActioning ? "…" : "Complete"}
                                      </button>
                                      <button onClick={() => handleCancel(o.id)} disabled={isActioning}
                                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors">
                                        <XCircle className="w-3 h-3" />{isActioning ? "…" : "Cancel"}
                                      </button>
                                    </div>
                                  ) : <span className="text-xs text-muted-foreground/40">—</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

              {/* Withdrawals detail */}
              {detailTab === "withdrawals" && (
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    {!storeWithdrawals ? (
                      <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
                    ) : storeWithdrawals.length === 0 ? (
                      <div className="py-16 text-center text-muted-foreground text-sm">No withdrawals yet</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/20">
                            {["#", "Amount", "Method", "Account", "Account Name", "Status", "Ref", "Date", "Actions"].map(h => (
                              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {storeWithdrawals.map((w: any) => {
                            const needsAction = w.status === "pending";
                            const isActioning = withdrawalActionId === w.id;
                            const networkKey = w.bankCode ?? w.momoNetwork;
                            return (
                            <tr key={w.id} className={`hover:bg-muted/20 transition-colors ${needsAction ? "bg-amber-50/40 dark:bg-amber-900/5" : ""}`}>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{w.id}</td>
                              <td className="px-4 py-3 font-bold text-foreground">GH₵{w.amount.toFixed(2)}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${NETWORK_BADGE[networkKey] ?? "bg-gray-100 text-gray-700"}`}>
                                  {NETWORK_LABEL[networkKey] ?? w.method ?? networkKey ?? "—"}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs">{w.accountNumber || "—"}</td>
                              <td className="px-4 py-3 text-xs font-medium">{w.accountName || "—"}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[w.status] ?? "bg-gray-100 text-gray-700"}`}>
                                  {STATUS_LABEL[w.status] ?? w.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground max-w-[120px] truncate" title={w.note}>{w.note || "—"}</td>
                              <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(w.createdAt)}</td>
                              <td className="px-4 py-3">
                                {needsAction ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => handleWithdrawalApprove(w.id)}
                                      disabled={isActioning}
                                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 transition-colors whitespace-nowrap"
                                      title="Send via Paystack"
                                    >
                                      <ThumbsUp className="w-3 h-3" />
                                      {isActioning ? "Sending…" : "Send"}
                                    </button>
                                    <button
                                      onClick={() => handleWithdrawalReject(w.id)}
                                      disabled={isActioning}
                                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors whitespace-nowrap"
                                      title="Reject and refund to store balance"
                                    >
                                      <ThumbsDown className="w-3 h-3" />
                                      {isActioning ? "…" : "Refund"}
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground/40 italic">—</span>
                                )}
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* All Stores List */
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    className="w-full pl-9 pr-4 h-9 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="Search stores…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  {search && (
                    <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch("")}>
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  )}
                </div>
                <span className="text-sm text-muted-foreground">{filteredStores.length} store{filteredStores.length !== 1 ? "s" : ""}</span>
              </div>

              {isLoading ? (
                <div className="py-20 text-center text-muted-foreground">Loading stores…</div>
              ) : filteredStores.length === 0 ? (
                <div className="py-20 text-center text-muted-foreground">
                  <Store className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No stores found</p>
                </div>
              ) : (
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        {["Store", "Orders", "Completed", "Processing", "Earned", "Withdrawn", "Balance", "Created"].map(h => (
                          <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredStores.map((s: any) => (
                        <tr
                          key={s.id}
                          className="hover:bg-muted/20 transition-colors cursor-pointer"
                          onClick={() => { setSelectedStoreId(s.id); setDetailTab("orders"); }}
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                <Store className="w-4 h-4 text-primary" />
                              </div>
                              <div>
                                <div className="font-semibold text-foreground text-sm">{s.name}</div>
                                <div className="text-[10px] text-muted-foreground font-mono">/{s.slug}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4 font-semibold text-foreground">{s.totalOrders}</td>
                          <td className="px-5 py-4 text-emerald-600 font-semibold">{s.completedOrders}</td>
                          <td className="px-5 py-4">
                            {s.processingOrders > 0 ? (
                              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 text-xs font-bold">
                                {s.processingOrders}
                              </span>
                            ) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-5 py-4 font-semibold text-foreground">GH₵{(s.totalEarned ?? 0).toFixed(2)}</td>
                          <td className="px-5 py-4 text-muted-foreground">GH₵{(s.totalWithdrawn ?? 0).toFixed(2)}</td>
                          <td className="px-5 py-4">
                            <span className={`font-bold ${(s.profitBalance ?? 0) > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                              GH₵{(s.profitBalance ?? 0).toFixed(2)}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(s.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
