import { useState, useMemo, useCallback } from "react";
import {
  useAdminListOrders,
  useAdminUpdateOrderStatus,
  getAdminListOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Menu, ShoppingCart, Search, X, Download, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, Filter, Copy,
  CheckCircle2, XCircle, Banknote, Zap, AlertCircle, Store, Clock,
} from "lucide-react";

// ─── constants ────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  pending:    "bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
  completed:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed:     "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
  cancelled:  "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
};

const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber-400", processing: "bg-blue-400",
  completed: "bg-emerald-400", failed: "bg-red-400", cancelled: "bg-gray-400",
};

const ORDER_STATUSES = ["all", "pending", "processing", "completed", "failed"] as const;
const PAGE_SIZES = [10, 25, 50, 100];

const NETWORKS = [
  { value: "mtn",         label: "MTN",         dot: "bg-yellow-400", badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400" },
  { value: "telecel",     label: "Telecel",      dot: "bg-red-500",    badge: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400" },
  { value: "at-ishare",   label: "AT iShare",    dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400" },
  { value: "at-bigtime",  label: "AT Big-Time",  dot: "bg-green-600",  badge: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400" },
] as const;

type SortField = "date" | "amount" | "id";
type SortDir   = "asc" | "desc";

// ─── helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });

function SortButton({ field, current, dir, onToggle }: { field: SortField; current: SortField; dir: SortDir; onToggle: (f: SortField) => void }) {
  const active = current === field;
  return (
    <button className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors" onClick={() => onToggle(field)}>
      {active ? (dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-50" />}
    </button>
  );
}

// ─── main export ──────────────────────────────────────────────────────────────
export default function AdminOrders() {
  return (
    <ProtectedRoute adminOnly>
      <AdminOrdersContent />
    </ProtectedRoute>
  );
}

function AdminOrdersContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pageView, setPageView]       = useState<"platform" | "store">("platform");
  const [statusTab, setStatusTab]     = useState<typeof ORDER_STATUSES[number]>("all");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [orderIdSearch, setOrderIdSearch] = useState("");
  const [dateFrom, setDateFrom]       = useState("");
  const [dateTo, setDateTo]           = useState("");
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(25);
  const [sortField, setSortField]     = useState<SortField>("date");
  const [sortDir, setSortDir]         = useState<SortDir>("desc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [refundingId, setRefundingId] = useState<number | null>(null);
  const [completing, setCompleting]   = useState(false);

  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const { data: allOrders, isLoading, refetch } = useAdminListOrders({});
  const updateStatus = useAdminUpdateOrderStatus();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getAdminListOrdersQueryKey({}) });
  }, [queryClient]);

  const handleStatusChange = (orderId: number, status: string) => {
    updateStatus.mutate({ id: orderId, data: { status } }, {
      onSuccess: () => { toast({ title: `Order #${orderId} updated to ${status}` }); invalidate(); },
      onError:   () => toast({ title: "Error updating status", variant: "destructive" }),
    });
  };

  const handleRefund = async (orderId: number) => {
    setRefundingId(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/refund`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Order #${orderId} cancelled & GH₵${json.refunded?.toFixed(2)} refunded` });
      invalidate();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error refunding order", variant: "destructive" });
    } finally {
      setRefundingId(null);
    }
  };

  const handleCompleteAll = async () => {
    setCompleting(true);
    try {
      const res = await fetch("/api/admin/orders/complete-processing", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      toast({ title: `Completed ${json.updated} processing orders` });
      invalidate();
    } catch {
      toast({ title: "Error completing orders", variant: "destructive" });
    } finally {
      setCompleting(false);
    }
  };

  // ── Store Orders ──
  const { data: storeOrders, isLoading: storeOrdersLoading, refetch: refetchStoreOrders } = useQuery<any[]>({
    queryKey: ["adminStoreOrders"],
    queryFn: () => fetch("/api/admin/store-orders", { credentials: "include" }).then(r => r.json()),
    enabled: pageView === "store",
  });

  const [actioningId, setActioningId] = useState<number | null>(null);

  const handleStoreOrderComplete = async (id: number) => {
    setActioningId(id);
    try {
      const res = await fetch(`/api/admin/store-orders/${id}/complete`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Store order #${id} completed — profit credited` });
      refetchStoreOrders();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error completing order", variant: "destructive" });
    } finally { setActioningId(null); }
  };

  const handleStoreOrderCancel = async (id: number) => {
    setActioningId(id);
    try {
      const res = await fetch(`/api/admin/store-orders/${id}/cancel`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Store order #${id} cancelled` });
      refetchStoreOrders();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error cancelling order", variant: "destructive" });
    } finally { setActioningId(null); }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
    setPage(1);
  };

  const clearFilters = () => { setPhoneSearch(""); setOrderIdSearch(""); setDateFrom(""); setDateTo(""); setStatusTab("all"); setPage(1); };
  const hasFilters = phoneSearch || orderIdSearch || dateFrom || dateTo || statusTab !== "all";

  // ── network pending counts ──
  const networkPendingCounts = useMemo(() => {
    const src = allOrders ?? [];
    return NETWORKS.map(n => ({
      ...n,
      count: src.filter(o => o.status === "pending" && (o as { network?: string }).network === n.value).length,
      orders: src.filter(o => o.status === "pending" && (o as { network?: string }).network === n.value),
    }));
  }, [allOrders]);

  const handleNetworkCopy = async (network: typeof networkPendingCounts[number]) => {
    if (network.count === 0) return;
    const parseDataNum = (s: string) => s.match(/^([\d.]+)/)?.[1] ?? s;
    const text = network.orders.map(o => `${o.phoneNumber}\t${parseDataNum(o.bundleData ?? "")}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `Copied ${network.count} ${network.label} pending orders` });
      const ids = network.orders.map(o => o.id);
      await fetch("/api/admin/orders/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status: "processing" }),
        credentials: "include",
      });
      invalidate();
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  // ── status counts ──
  const statusCounts = useMemo(() => {
    const src = allOrders ?? [];
    return Object.fromEntries(
      ORDER_STATUSES.map(s => [s, s === "all" ? src.length : src.filter(o => o.status === s).length])
    );
  }, [allOrders]);

  const processingCount = statusCounts["processing"] ?? 0;

  // ── filtering + sorting ──
  const processedOrders = useMemo(() => {
    let src = allOrders ?? [];

    if (statusTab !== "all") src = src.filter(o => o.status === statusTab);
    if (phoneSearch.trim()) {
      const q = phoneSearch.trim();
      src = src.filter(o => o.phoneNumber.includes(q));
    }
    if (orderIdSearch.trim()) {
      const q = orderIdSearch.trim();
      src = src.filter(o => String(o.id).includes(q));
    }
    if (dateFrom) src = src.filter(o => new Date(o.createdAt) >= new Date(dateFrom));
    if (dateTo) {
      const to = new Date(dateTo); to.setHours(23, 59, 59, 999);
      src = src.filter(o => new Date(o.createdAt) <= to);
    }

    src = [...src].sort((a, b) => {
      let diff = 0;
      if (sortField === "date")   diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sortField === "amount") diff = Number(a.price) - Number(b.price);
      if (sortField === "id")     diff = a.id - b.id;
      return sortDir === "asc" ? diff : -diff;
    });

    return src;
  }, [allOrders, statusTab, phoneSearch, orderIdSearch, dateFrom, dateTo, sortField, sortDir]);

  const totalPages  = Math.max(1, Math.ceil(processedOrders.length / pageSize));
  const pagedOrders = useMemo(() => processedOrders.slice((page - 1) * pageSize, page * pageSize), [processedOrders, page, pageSize]);

  const changeTab = (t: typeof ORDER_STATUSES[number]) => { setStatusTab(t); setPage(1); };

  // ── CSV export ──
  const handleExport = () => {
    const headers = ["ID", "Date", "Phone", "Network", "Data", "Amount", "Status"];
    const rows = processedOrders.map(o => [
      `#${o.id}`,
      fmtDate(o.createdAt),
      o.phoneNumber,
      `"${(o as { network?: string }).network ?? ""}"`,
      `"${o.bundleData}"`,
      Number(o.price).toFixed(2),
      o.status,
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast({ title: `Exported ${processedOrders.length} orders as CSV` });
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-auto">
        {/* ─── Header ─── */}
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-6 py-4 flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Orders</h1>
            <p className="text-xs text-muted-foreground">
              {pageView === "platform"
                ? `${processedOrders.length} order${processedOrders.length !== 1 ? "s" : ""} ${hasFilters ? "(filtered)" : "total"}`
                : `${storeOrders?.length ?? 0} store order${(storeOrders?.length ?? 0) !== 1 ? "s" : ""} total`}
            </p>
          </div>
          {/* ── View toggle ── */}
          <div className="flex items-center rounded-xl border border-border bg-muted/40 p-1 gap-1">
            <button
              onClick={() => setPageView("platform")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${pageView === "platform" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <ShoppingCart className="w-3.5 h-3.5" /> Platform Orders
            </button>
            <button
              onClick={() => { setPageView("store"); refetchStoreOrders(); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${pageView === "store" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Store className="w-3.5 h-3.5" /> Store Orders
              {(storeOrders ?? []).filter((o: any) => o.status === "processing").length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-500 text-white text-[10px] font-bold">
                  {(storeOrders ?? []).filter((o: any) => o.status === "processing").length}
                </span>
              )}
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {pageView === "platform" && (
              <>
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </Button>
                <Button variant="outline" size="sm" onClick={() => setFiltersOpen(v => !v)} className="gap-1.5">
                  <Filter className="w-3.5 h-3.5" /> Filters {hasFilters && <span className="w-2 h-2 rounded-full bg-primary" />}
                </Button>
                <Button variant="outline" size="sm" onClick={handleExport} disabled={processedOrders.length === 0} className="gap-1.5" data-testid="button-export-csv">
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </Button>
              </>
            )}
            {pageView === "store" && (
              <Button variant="outline" size="sm" onClick={() => refetchStoreOrders()} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 space-y-4">

          {/* ─── STORE ORDERS VIEW ─── */}
          {pageView === "store" && (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              {/* Info banner */}
              <div className="px-5 py-3 bg-blue-50 dark:bg-blue-900/10 border-b border-blue-200 dark:border-blue-800 flex items-center gap-2">
                <Store className="w-4 h-4 text-blue-600 shrink-0" />
                <p className="text-xs text-blue-700 dark:text-blue-400 font-medium">
                  Store orders arrive here as <strong>Processing</strong> after customer payment. Complete each order after activating the data bundle on the customer's phone. Profit is credited to the store owner on completion.
                </p>
              </div>
              {storeOrdersLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Zap className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : !storeOrders || storeOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Store className="w-12 h-12 text-muted-foreground" />
                  <p className="font-semibold text-foreground">No store orders yet</p>
                  <p className="text-sm text-muted-foreground">Orders placed through agent stores will appear here.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        {["#", "Store", "Data", "Network", "Phone", "Revenue", "Profit", "Status", "Date", "Actions"].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {storeOrders.map((o: any) => {
                        const statusColor = STATUS_COLORS[o.status] ?? "bg-gray-100 text-gray-700";
                        const isActioning = actioningId === o.id;
                        const canAct = o.status !== "completed" && o.status !== "cancelled";
                        return (
                          <tr key={o.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{o.id}</td>
                            <td className="px-4 py-3">
                              <div className="text-sm font-semibold text-foreground">{o.storeName}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">/{o.storeSlug}</div>
                            </td>
                            <td className="px-4 py-3 font-bold text-foreground">{o.bundleData}</td>
                            <td className="px-4 py-3">
                              {NETWORKS.find(n => n.value === o.bundleNetwork)
                                ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${NETWORKS.find(n => n.value === o.bundleNetwork)!.badge}`}>{NETWORKS.find(n => n.value === o.bundleNetwork)!.label}</span>
                                : <span className="text-xs text-muted-foreground">{o.bundleNetwork}</span>}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">{o.customerPhone}</td>
                            <td className="px-4 py-3 font-semibold">GH₵{o.sellingPrice.toFixed(2)}</td>
                            <td className="px-4 py-3 text-emerald-600 font-semibold">+GH₵{o.profit.toFixed(2)}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor}`}>{o.status}</span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                            <td className="px-4 py-3">
                              {canAct ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleStoreOrderComplete(o.id)}
                                    disabled={isActioning}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 hover:bg-emerald-200 disabled:opacity-50 transition-colors whitespace-nowrap"
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                    {isActioning ? "…" : "Complete"}
                                  </button>
                                  <button
                                    onClick={() => handleStoreOrderCancel(o.id)}
                                    disabled={isActioning}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-200 disabled:opacity-50 transition-colors whitespace-nowrap"
                                  >
                                    <XCircle className="w-3 h-3" />
                                    {isActioning ? "…" : "Cancel"}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground/50 italic">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ─── PLATFORM ORDERS VIEW ─── */}
          {pageView === "platform" && (
          <>

          {/* ─── Network pending buttons ─── */}
          <div className="flex flex-wrap gap-2 items-center bg-card border border-border rounded-xl px-4 py-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Pending by Network:</span>
            {networkPendingCounts.map(n => (
              <button
                key={n.value}
                onClick={() => handleNetworkCopy(n)}
                disabled={n.count === 0}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${n.badge} hover:opacity-80`}
                title={n.count > 0 ? `Click to copy ${n.count} pending ${n.label} orders` : `No pending ${n.label} orders`}
              >
                <span className={`w-2 h-2 rounded-full ${n.dot}`} />
                {n.label} <span className="font-extrabold">({n.count})</span>
                {n.count > 0 && <Copy className="w-3 h-3 opacity-70" />}
              </button>
            ))}
          </div>

          {/* ─── Filter bar ─── */}
          {filtersOpen && (
            <div className="bg-card border border-border rounded-2xl p-4 space-y-4" data-testid="filter-panel">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Filter Orders</span>
                {hasFilters && (
                  <button className="text-xs text-primary font-semibold" onClick={clearFilters} data-testid="button-clear-filters">
                    Clear all filters
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Phone search */}
                <div className="space-y-1">
                  <Label className="text-xs">Phone Number</Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="e.g. 0244xxxxxx"
                      value={phoneSearch}
                      onChange={e => { setPhoneSearch(e.target.value); setPage(1); }}
                      className="pl-8 h-8 text-xs"
                      data-testid="input-phone-search"
                    />
                    {phoneSearch && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setPhoneSearch(""); setPage(1); }}><X className="w-3 h-3 text-muted-foreground" /></button>}
                  </div>
                </div>
                {/* Order ID search */}
                <div className="space-y-1">
                  <Label className="text-xs">Order ID</Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="e.g. 42"
                      value={orderIdSearch}
                      onChange={e => { setOrderIdSearch(e.target.value); setPage(1); }}
                      className="pl-8 h-8 text-xs"
                      data-testid="input-orderid-search"
                    />
                    {orderIdSearch && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setOrderIdSearch(""); setPage(1); }}><X className="w-3 h-3 text-muted-foreground" /></button>}
                  </div>
                </div>
                {/* Date from */}
                <div className="space-y-1">
                  <Label className="text-xs">From Date</Label>
                  <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="h-8 text-xs" data-testid="input-date-from" />
                </div>
                {/* Date to */}
                <div className="space-y-1">
                  <Label className="text-xs">To Date</Label>
                  <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="h-8 text-xs" data-testid="input-date-to" />
                </div>
              </div>
              {/* Page size */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Rows per page</Label>
                <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
                  <SelectTrigger className="h-8 text-xs w-20" data-testid="select-page-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* ─── Main table card ─── */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {/* Status tabs */}
            <div className="flex items-center gap-1 px-5 py-3 border-b border-border overflow-x-auto">
              {ORDER_STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => changeTab(s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-colors ${
                    statusTab === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                  data-testid={`filter-${s}`}
                >
                  {s !== "all" && <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s]}`} />}
                  {s}
                  <span className={`ml-0.5 ${statusTab === s ? "text-primary-foreground/70" : "text-muted-foreground/60"}`}>
                    ({statusCounts[s]})
                  </span>
                </button>
              ))}
            </div>

            {/* Table */}
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
              </div>
            ) : pagedOrders.length === 0 ? (
              <div className="py-20 flex flex-col items-center text-muted-foreground">
                <ShoppingCart className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm">No orders match your filters</p>
                {hasFilters && (
                  <button className="mt-2 text-xs text-primary font-semibold" onClick={clearFilters}>Clear all filters</button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <div className="flex items-center gap-1">Date <SortButton field="date" current={sortField} dir={sortDir} onToggle={handleSort} /></div>
                      </th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <div className="flex items-center gap-1">ID <SortButton field="id" current={sortField} dir={sortDir} onToggle={handleSort} /></div>
                      </th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phone</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Data</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <div className="flex items-center gap-1">Amount <SortButton field="amount" current={sortField} dir={sortDir} onToggle={handleSort} /></div>
                      </th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Update</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pagedOrders.map(order => (
                      <tr key={order.id} className="hover:bg-muted/20 transition-colors group" data-testid={`row-order-${order.id}`}>
                        <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(order.createdAt)}</td>
                        <td className="px-5 py-3.5 text-xs font-mono text-muted-foreground">#{order.id}</td>
                        <td className="px-5 py-3.5 font-mono text-sm text-muted-foreground">{order.phoneNumber}</td>
                        <td className="px-5 py-3.5 font-bold text-foreground text-xs">{order.bundleData ?? "—"}</td>
                        <td className="px-5 py-3.5 font-bold text-foreground">GH₵{Number(order.price).toFixed(2)}</td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[order.status]}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[order.status]}`} />
                            {order.status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <Select defaultValue={order.status} onValueChange={v => handleStatusChange(order.id, v)}>
                            <SelectTrigger className="w-32 h-7 text-xs" data-testid={`select-status-${order.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="processing">Processing</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="failed">Failed</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-5 py-3.5">
                          {order.status !== "completed" && order.status !== "failed" ? (
                            <button
                              onClick={() => handleRefund(order.id)}
                              disabled={refundingId === order.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-200 disabled:opacity-50 transition-colors"
                              data-testid={`button-refund-${order.id}`}
                            >
                              <Banknote className="w-3 h-3" />
                              {refundingId === order.id ? "…" : "Cancel & Refund"}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground/50 italic">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ─── Pagination footer ─── */}
            {processedOrders.length > 0 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs text-muted-foreground flex-wrap gap-2">
                <span>
                  Showing {Math.min((page - 1) * pageSize + 1, processedOrders.length)}–{Math.min(page * pageSize, processedOrders.length)} of {processedOrders.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    className="px-2 py-1 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed text-xs"
                  >First</button>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                    .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                      if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
                      acc.push(p); return acc;
                    }, [])
                    .map((p, i) => p === "…" ? (
                      <span key={`e${i}`} className="px-2">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${page === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                      >{p}</button>
                    ))
                  }
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    className="px-2 py-1 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed text-xs"
                  >Last</button>
                </div>
              </div>
            )}
          </div>
          </>
          )}
        </main>
      </div>
    </div>
  );
}
