import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminSidebar } from "@/components/AdminSidebar";
import { AdminFinancialSummary } from "@/components/AdminFinancialSummary";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Menu, Store, ChevronLeft, ExternalLink, ArrowDownCircle,
  ShoppingCart, TrendingUp, Wallet, Search, X, RefreshCw,
  CheckCircle2, XCircle, ThumbsUp, ThumbsDown,
  Banknote, Clock, Loader2, CircleDollarSign, Send, Ban,
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
  const [topTab, setTopTab] = useState<"stores" | "withdrawals">("stores");
  const [wdStatusFilter, setWdStatusFilter] = useState<string>("all");
  const [wdSearch, setWdSearch] = useState("");
  const [bulkApproving, setBulkApproving] = useState(false);
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

  const { data: globalWithdrawals, refetch: refetchGlobalWithdrawals } = useQuery<any>({
    queryKey: ["adminAllWithdrawals"],
    queryFn: () => fetch("/api/admin/withdrawals", { credentials: "include" }).then(r => r.json()),
    enabled: selectedStoreId === null && topTab === "withdrawals",
    refetchInterval: 15000,
  });

  const [withdrawalActionId, setWithdrawalActionId] = useState<number | null>(null);

  // Refresh after a withdrawal action — only the dataset for the current view,
  // so we never hit /admin/stores/null/withdrawals while in the global tab.
  const refetchWd = () => {
    refetch();
    if (selectedStoreId !== null) refetchWithdrawals();
    else refetchGlobalWithdrawals();
  };

  // Refresh whatever the admin is currently looking at (used by the header button).
  const refreshVisible = () => {
    refetch();
    if (selectedStoreId !== null) {
      if (detailTab === "orders") refetchOrders();
      else refetchWithdrawals();
    } else if (topTab === "withdrawals") {
      refetchGlobalWithdrawals();
    }
  };

  const handleWithdrawalApprove = async (wId: number) => {
    setWithdrawalActionId(wId);
    try {
      const res = await fetch(`/api/admin/stores/withdrawals/${wId}/approve`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Withdrawal #${wId} approved` });
      refetchWd();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error approving withdrawal", variant: "destructive" });
    } finally { setWithdrawalActionId(null); }
  };

  const handleWithdrawalComplete = async (wId: number) => {
    setWithdrawalActionId(wId);
    try {
      const res = await fetch(`/api/admin/stores/withdrawals/${wId}/complete`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Withdrawal #${wId} marked as completed` });
      refetchWd();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error completing withdrawal", variant: "destructive" });
    } finally { setWithdrawalActionId(null); }
  };

  const handleWithdrawalReject = async (wId: number) => {
    const reason = window.prompt("Reason for rejecting this withdrawal? (shown to the agent — optional)") ?? undefined;
    if (reason === undefined) return; // admin cancelled the prompt
    setWithdrawalActionId(wId);
    try {
      const res = await fetch(`/api/admin/stores/withdrawals/${wId}/reject`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Withdrawal #${wId} rejected — amount refunded to store balance` });
      refetchWd();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error rejecting withdrawal", variant: "destructive" });
    } finally { setWithdrawalActionId(null); }
  };

  const handleWithdrawalForceCancel = async (wId: number) => {
    const ok = window.confirm(
      "Force-cancel this stuck transfer?\n\nOnly do this if Paystack confirms the money did NOT go out. " +
      "The amount + fee will be refunded to the agent so they can request again.",
    );
    if (!ok) return;
    const reason = window.prompt("Reason / note for this force-cancel? (optional)") ?? "";
    setWithdrawalActionId(wId);
    try {
      const res = await fetch(`/api/admin/stores/withdrawals/${wId}/force-cancel`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Withdrawal #${wId} force-cancelled — amount refunded to agent` });
      refetchWd();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error force-cancelling withdrawal", variant: "destructive" });
    } finally { setWithdrawalActionId(null); }
  };

  const handleBulkApprove = async () => {
    setBulkApproving(true);
    try {
      const res = await fetch("/api/admin/stores/withdrawals/bulk-approve", { method: "POST", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Bulk approve complete — ${json.approved} sent, ${json.failed} could not be sent` });
      refetchWd();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error during bulk approve", variant: "destructive" });
    } finally { setBulkApproving(false); }
  };

  const wdSummary = globalWithdrawals?.summary;
  const filteredWithdrawals = useMemo(() => {
    let src: any[] = globalWithdrawals?.withdrawals ?? [];
    if (wdStatusFilter !== "all") src = src.filter((w: any) => w.status === wdStatusFilter);
    if (wdSearch.trim()) {
      const q = wdSearch.trim().toLowerCase();
      src = src.filter((w: any) =>
        (w.storeName ?? "").toLowerCase().includes(q) ||
        (w.accountNumber ?? "").toLowerCase().includes(q) ||
        (w.accountName ?? "").toLowerCase().includes(q),
      );
    }
    return src;
  }, [globalWithdrawals, wdStatusFilter, wdSearch]);

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

  const handleCancel = async (orderId: number, isPaid: boolean, amount: number) => {
    if (isPaid) {
      const ok = window.confirm(
        `Cancel order #${orderId}?\n\nGH₵${amount.toFixed(2)} will be refunded to the store owner's wallet — they settle with their customer directly.`
      );
      if (!ok) return;
    }
    setActionId(orderId);
    try {
      const res = await fetch(`/api/admin/store-orders/${orderId}/cancel`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: isPaid ? `Order #${orderId} cancelled — GH₵${amount.toFixed(2)} refunded to store owner` : `Order #${orderId} cancelled` });
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

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
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
          <AdminFinancialSummary />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refreshVisible()} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-3 sm:p-6">
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
                            {([["#","hidden sm:table-cell"],["Data",""],["Network","hidden sm:table-cell"],["Phone",""],["Revenue","hidden sm:table-cell"],["Profit","hidden sm:table-cell"],["Status",""],["Paystack Ref","hidden md:table-cell"],["Date","hidden sm:table-cell"],["Actions",""]] as [string,string][]).map(([h,cls]) => (
                              <th key={h} className={`text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${cls}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {storeOrders.map(o => {
                            // Complete only makes sense for a paid order still being fulfilled.
                            const canComplete = o.status === "paid" && o.delivered === "processing";
                            // Cancel: anything not already cancelled/refunded and not delivered.
                            const canCancel = o.status !== "cancelled" && o.status !== "refunded" && o.delivered !== "delivered";
                            const canAct = canComplete || canCancel;
                            const isPaid = o.status === "paid";
                            const isActioning = actionId === o.id;
                            return (
                              <tr key={o.id} className="hover:bg-muted/20 transition-colors">
                                <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-muted-foreground">#{o.id}</td>
                                <td className="px-4 py-3 font-bold text-xs">{o.bundleData}</td>
                                <td className="hidden sm:table-cell px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${NETWORK_BADGE[o.bundleNetwork] ?? "bg-gray-100 text-gray-700"}`}>
                                    {NETWORK_LABEL[o.bundleNetwork] ?? o.bundleNetwork}
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs">{o.customerPhone}</td>
                                <td className="hidden sm:table-cell px-4 py-3 font-semibold text-xs">GH₵{o.sellingPrice.toFixed(2)}</td>
                                <td className="hidden sm:table-cell px-4 py-3 text-emerald-600 font-semibold text-xs">+GH₵{o.profit.toFixed(2)}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[o.status] ?? ""}`}>
                                    {o.status}
                                  </span>
                                </td>
                                <td className="hidden md:table-cell px-4 py-3 font-mono text-[10px] text-muted-foreground max-w-[140px] truncate" title={o.paystackReference || undefined}>
                                  {o.paystackReference || <span className="italic opacity-50">—</span>}
                                </td>
                                <td className="hidden sm:table-cell px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                                <td className="px-4 py-3">
                                  {canAct ? (
                                    <div className="flex items-center gap-1">
                                      {canComplete && (
                                        <button onClick={() => handleComplete(o.id)} disabled={isActioning}
                                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 transition-colors">
                                          <CheckCircle2 className="w-3 h-3" />{isActioning ? "…" : "Complete"}
                                        </button>
                                      )}
                                      {canCancel && (
                                        <button onClick={() => handleCancel(o.id, isPaid, o.sellingPrice)} disabled={isActioning}
                                          title={isPaid ? "Cancel this order and refund the full amount to the store owner's wallet" : "Cancel this unpaid order"}
                                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors">
                                          <XCircle className="w-3 h-3" />{isActioning ? "…" : isPaid ? "Cancel & Refund" : "Cancel"}
                                        </button>
                                      )}
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
                            {([["#","hidden sm:table-cell"],["Amount",""],["Method","hidden sm:table-cell"],["Account",""],["Account Name","hidden sm:table-cell"],["Status",""],["Ref","hidden sm:table-cell"],["Date","hidden sm:table-cell"],["Actions",""]] as [string,string][]).map(([h,cls]) => (
                              <th key={h} className={`text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${cls}`}>{h}</th>
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
                              <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-muted-foreground">#{w.id}</td>
                              <td className="px-4 py-3 font-bold text-foreground">GH₵{w.amount.toFixed(2)}</td>
                              <td className="hidden sm:table-cell px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${NETWORK_BADGE[networkKey] ?? "bg-gray-100 text-gray-700"}`}>
                                  {NETWORK_LABEL[networkKey] ?? w.method ?? networkKey ?? "—"}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs">{w.accountNumber || "—"}</td>
                              <td className="hidden sm:table-cell px-4 py-3 text-xs font-medium">{w.accountName || "—"}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[w.status] ?? "bg-gray-100 text-gray-700"}`}>
                                  {STATUS_LABEL[w.status] ?? w.status}
                                </span>
                              </td>
                              <td className="hidden sm:table-cell px-4 py-3 font-mono text-[10px] text-muted-foreground max-w-[120px] truncate" title={w.note}>{w.note || "—"}</td>
                              <td className="hidden sm:table-cell px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(w.createdAt)}</td>
                              <td className="px-4 py-3">
                                <WithdrawalActions
                                  w={w}
                                  isActioning={isActioning}
                                  onApprove={handleWithdrawalApprove}
                                  onReject={handleWithdrawalReject}
                                  onComplete={handleWithdrawalComplete}
                                  onForceCancel={handleWithdrawalForceCancel}
                                />
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
            /* All Stores List + Global Withdrawals */
            <div className="max-w-5xl mx-auto space-y-6">
              {/* Top-level tab switcher */}
              <div className="flex items-center gap-1 bg-muted/40 rounded-xl p-1 border border-border w-fit">
                <button onClick={() => setTopTab("stores")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${topTab === "stores" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <Store className="w-4 h-4" /> Stores
                </button>
                <button onClick={() => setTopTab("withdrawals")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${topTab === "withdrawals" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <Banknote className="w-4 h-4" /> Withdrawals
                  {wdSummary?.pendingCount ? (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">{wdSummary.pendingCount}</span>
                  ) : null}
                </button>
              </div>

              {topTab === "stores" ? (
              <>
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
              </>
              ) : (
                /* Global Withdrawals panel */
                <div className="space-y-5">
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { label: "Ready for Withdrawal", value: `GH₵${(wdSummary?.readyForWithdrawal ?? 0).toFixed(2)}`, hint: `${wdSummary?.agentsOwed ?? 0} agents owed`, icon: CircleDollarSign, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/10" },
                      { label: "Pending Payouts", value: `GH₵${(wdSummary?.pendingAmount ?? 0).toFixed(2)}`, hint: `${wdSummary?.pendingCount ?? 0} requests · ${wdSummary?.agentsPending ?? 0} agents`, icon: Clock, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/10" },
                      { label: "Paid Today", value: `GH₵${(wdSummary?.paidToday ?? 0).toFixed(2)}`, hint: `${wdSummary?.paidTodayCount ?? 0} sent today`, icon: Send, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/10" },
                      { label: "Total Ever Paid", value: `GH₵${(wdSummary?.completedAmount ?? 0).toFixed(2)}`, hint: `${wdSummary?.completedCount ?? 0} completed`, icon: CheckCircle2, color: "text-slate-600 dark:text-slate-300", bg: "bg-muted/40" },
                    ].map(({ label, value, hint, icon: Icon, color, bg }) => (
                      <div key={label} className={`rounded-2xl border border-border p-4 ${bg}`}>
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${color}`} />
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
                        </div>
                        <div className={`text-xl font-bold mt-1.5 ${color}`}>{value}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
                      </div>
                    ))}
                  </div>

                  {/* Toolbar: status filters + search + bulk approve */}
                  <div className="flex flex-wrap items-center gap-2">
                    {(["all", "pending", "processing", "completed", "failed", "cancelled"] as const).map(st => (
                      <button
                        key={st}
                        onClick={() => setWdStatusFilter(st)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${wdStatusFilter === st ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                      >
                        {st === "all" ? "All" : STATUS_LABEL[st] ?? st}
                      </button>
                    ))}
                    <div className="relative flex-1 min-w-[160px] max-w-xs ml-auto">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        className="w-full pl-9 pr-4 h-9 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="Search store, account…"
                        value={wdSearch}
                        onChange={e => setWdSearch(e.target.value)}
                      />
                      {wdSearch && (
                        <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setWdSearch("")}>
                          <X className="w-4 h-4 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                    {(wdSummary?.pendingCount ?? 0) > 0 && (
                      <button
                        onClick={handleBulkApprove}
                        disabled={bulkApproving}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                        title="Send all pending withdrawals via Paystack"
                      >
                        {bulkApproving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        {bulkApproving ? "Sending…" : `Send All Pending (${wdSummary?.pendingCount})`}
                      </button>
                    )}
                  </div>

                  {/* Withdrawals table */}
                  <div className="bg-card border border-border rounded-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                      {!globalWithdrawals ? (
                        <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
                      ) : filteredWithdrawals.length === 0 ? (
                        <div className="py-16 text-center text-muted-foreground text-sm">
                          <ArrowDownCircle className="w-10 h-10 mx-auto mb-3 opacity-20" />
                          No withdrawals {wdStatusFilter !== "all" ? `with status "${STATUS_LABEL[wdStatusFilter] ?? wdStatusFilter}"` : "yet"}
                        </div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-muted/20">
                              {([["Store",""],["Amount",""],["Method","hidden sm:table-cell"],["Account",""],["Account Name","hidden md:table-cell"],["Status",""],["Date","hidden sm:table-cell"],["Actions",""]] as [string,string][]).map(([h,cls]) => (
                                <th key={h} className={`text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${cls}`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {filteredWithdrawals.map((w: any) => {
                              const isActioning = withdrawalActionId === w.id;
                              const networkKey = w.bankCode ?? w.method;
                              return (
                                <tr key={w.id} className={`hover:bg-muted/20 transition-colors ${w.status === "pending" ? "bg-amber-50/40 dark:bg-amber-900/5" : ""}`}>
                                  <td className="px-4 py-3">
                                    <button
                                      onClick={() => { setSelectedStoreId(w.storeId); setDetailTab("withdrawals"); }}
                                      className="text-left font-semibold text-foreground text-xs hover:text-primary hover:underline"
                                      title="Open store"
                                    >
                                      {w.storeName ?? "—"}
                                    </button>
                                    {w.storeSlug && <div className="text-[10px] text-muted-foreground font-mono">/{w.storeSlug}</div>}
                                  </td>
                                  <td className="px-4 py-3 font-bold text-foreground">GH₵{w.amount.toFixed(2)}</td>
                                  <td className="hidden sm:table-cell px-4 py-3">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${NETWORK_BADGE[networkKey] ?? "bg-gray-100 text-gray-700"}`}>
                                      {NETWORK_LABEL[networkKey] ?? w.method ?? networkKey ?? "—"}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 font-mono text-xs">{w.accountNumber || "—"}</td>
                                  <td className="hidden md:table-cell px-4 py-3 text-xs font-medium">{w.accountName || "—"}</td>
                                  <td className="px-4 py-3">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[w.status] ?? "bg-gray-100 text-gray-700"}`}>
                                      {STATUS_LABEL[w.status] ?? w.status}
                                    </span>
                                    {w.status === "failed" && w.failureReason && (
                                      <div className="text-[10px] text-red-500 mt-0.5 max-w-[160px] truncate" title={w.failureReason}>{w.failureReason}</div>
                                    )}
                                  </td>
                                  <td className="hidden sm:table-cell px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(w.createdAt)}</td>
                                  <td className="px-4 py-3">
                                    <WithdrawalActions
                                      w={w}
                                      isActioning={isActioning}
                                      onApprove={handleWithdrawalApprove}
                                      onReject={handleWithdrawalReject}
                                      onComplete={handleWithdrawalComplete}
                                      onForceCancel={handleWithdrawalForceCancel}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  {/* Pending Profits — money agents have earned but not yet requested */}
                  <div className="bg-card border border-border rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
                      <div className="flex items-center gap-2">
                        <CircleDollarSign className="w-4 h-4 text-emerald-600" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pending Profits — not yet requested</span>
                      </div>
                      <span className="text-xs font-bold text-emerald-600">GH₵{(wdSummary?.readyForWithdrawal ?? 0).toFixed(2)}</span>
                    </div>
                    {!globalWithdrawals ? (
                      <div className="py-10 text-center text-muted-foreground text-sm">Loading…</div>
                    ) : (globalWithdrawals.pendingProfits ?? []).length === 0 ? (
                      <div className="py-10 text-center text-muted-foreground text-sm">
                        <CircleDollarSign className="w-9 h-9 mx-auto mb-2 opacity-20" />
                        No outstanding agent balances
                      </div>
                    ) : (
                      <div className="divide-y divide-border max-h-72 overflow-y-auto">
                        {(globalWithdrawals.pendingProfits as any[]).map(p => (
                          <button
                            key={p.storeId}
                            onClick={() => { setSelectedStoreId(p.storeId); setDetailTab("withdrawals"); }}
                            className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
                            title="Open store"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-xs text-foreground truncate">{p.storeName ?? "—"}</div>
                              {p.storeSlug && <div className="text-[10px] text-muted-foreground font-mono truncate">/{p.storeSlug}</div>}
                            </div>
                            <span className="font-bold text-sm text-emerald-600 whitespace-nowrap ml-3">GH₵{p.profitBalance.toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function WithdrawalActions({
  w, isActioning, onApprove, onReject, onComplete, onForceCancel,
}: {
  w: any;
  isActioning: boolean;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onComplete: (id: number) => void;
  onForceCancel: (id: number) => void;
}) {
  if (w.status === "pending") {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onApprove(w.id)}
          disabled={isActioning}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 transition-colors whitespace-nowrap"
          title="Send via Paystack"
        >
          <ThumbsUp className="w-3 h-3" />
          {isActioning ? "Sending…" : "Send"}
        </button>
        <button
          onClick={() => onComplete(w.id)}
          disabled={isActioning}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 disabled:opacity-50 transition-colors whitespace-nowrap"
          title="Mark as paid without Paystack (cash / bank transfer / settled outside the system)"
        >
          <Banknote className="w-3 h-3" />
          {isActioning ? "…" : "Manual Pay"}
        </button>
        <button
          onClick={() => onReject(w.id)}
          disabled={isActioning}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors whitespace-nowrap"
          title="Reject and refund to store balance"
        >
          <ThumbsDown className="w-3 h-3" />
          {isActioning ? "…" : "Reject"}
        </button>
      </div>
    );
  }
  if (w.status === "processing") {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onComplete(w.id)}
          disabled={isActioning}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50 transition-colors whitespace-nowrap"
          title="Force complete: Paystack sent the money but the webhook never arrived"
        >
          <CheckCircle2 className="w-3 h-3" />
          {isActioning ? "…" : "Force Complete"}
        </button>
        <button
          onClick={() => onForceCancel(w.id)}
          disabled={isActioning}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-orange-100 text-orange-700 hover:bg-orange-200 disabled:opacity-50 transition-colors whitespace-nowrap"
          title="Force cancel: the transfer genuinely failed but is stuck — refund the agent"
        >
          <Ban className="w-3 h-3" />
          {isActioning ? "…" : "Force Cancel"}
        </button>
      </div>
    );
  }
  return <span className="text-xs text-muted-foreground/40 italic">—</span>;
}
