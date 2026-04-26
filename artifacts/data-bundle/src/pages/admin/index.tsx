import { useState, useMemo, useCallback } from "react";
import { Link } from "wouter";
import {
  useAdminGetStats,
  useAdminListOrders,
  useAdminUpdateOrderStatus,
  useAdminListDeposits,
  getAdminListOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Menu, Users, ShoppingCart, DollarSign, Package, Clock,
  CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight,
  Search, X, RefreshCw, ArrowUpRight, BarChart3, Wallet,
  XCircle, Copy, Zap, AlertCircle,
} from "lucide-react";

const PAGE_SIZE = 10;

const STATUS_COLORS: Record<string, string> = {
  pending:    "bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
  completed:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed:     "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
};

const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber-400", processing: "bg-blue-400",
  completed: "bg-emerald-400", failed: "bg-red-400",
};

const ORDER_STATUSES = ["all", "pending", "processing", "completed", "failed"] as const;

const NETWORKS = [
  { value: "mtn",         label: "MTN",         dot: "bg-yellow-400", badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400" },
  { value: "telecel",     label: "Telecel",      dot: "bg-red-500",    badge: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400" },
  { value: "at-ishare",   label: "AT iShare",    dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400" },
  { value: "at-bigtime",  label: "AT Big-Time",  dot: "bg-green-600",  badge: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400" },
] as const;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });

function StatCard({
  icon: Icon, label, value, sub, colorClass, bgClass, accent, pulse,
}: {
  icon: React.ElementType; label: string; value: string | number;
  sub: string; colorClass: string; bgClass: string; accent?: boolean; pulse?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 flex flex-col gap-3
        ${accent ? "bg-primary text-primary-foreground border-primary/50" : "bg-card border-border"}`}
      data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold uppercase tracking-widest ${accent ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
          {label}
        </span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${accent ? "bg-white/15" : bgClass}`}>
          <Icon className={`w-4 h-4 ${accent ? "text-primary-foreground" : colorClass}`} />
        </div>
      </div>
      <div>
        <div className={`text-3xl font-extrabold tracking-tight ${accent ? "text-primary-foreground" : "text-foreground"}`}>
          {value}
        </div>
        <div className={`text-xs mt-1 flex items-center gap-1.5 ${accent ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
          {pulse && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
            </span>
          )}
          {sub}
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  return (
    <ProtectedRoute adminOnly>
      <AdminDashboardContent />
    </ProtectedRoute>
  );
}

function AdminDashboardContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [statusTab, setStatusTab]     = useState<typeof ORDER_STATUSES[number]>("all");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [orderIdSearch, setOrderIdSearch] = useState("");
  const [page, setPage]               = useState(1);
  const [completing, setCompleting]   = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useAdminGetStats({
    refetchInterval: 5000,
  } as Parameters<typeof useAdminGetStats>[0]);
  const { data: deposits } = useAdminListDeposits({});
  const { data: allOrders, refetch: refetchOrders } = useAdminListOrders({});
  const updateStatus = useAdminUpdateOrderStatus();

  const handleRefresh = () => { refetchStats(); refetchOrders(); toast({ title: "Dashboard refreshed" }); };

  const invalidateOrders = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getAdminListOrdersQueryKey({}) });
  }, [queryClient]);

  const handleStatusChange = (orderId: number, status: string) => {
    updateStatus.mutate({ id: orderId, data: { status } }, {
      onSuccess: () => { toast({ title: `Order #${orderId} → ${status}` }); invalidateOrders(); },
      onError:   () => toast({ title: "Error updating status", variant: "destructive" }),
    });
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
      refetchOrders(); refetchStats();
    } catch {
      toast({ title: "Error completing orders", variant: "destructive" });
    } finally {
      setCompleting(false);
    }
  };

  const networkPendingCounts = useMemo(() => {
    const src = allOrders ?? [];
    return NETWORKS.map(n => ({
      ...n,
      count: src.filter(o => o.status === "pending" && (o as { network?: string }).network === n.value).length,
      orders: src.filter(o => o.status === "pending" && (o as { network?: string }).network === n.value),
    }));
  }, [allOrders]);

  const handleNetworkCopy = (network: typeof networkPendingCounts[number]) => {
    const text = network.orders
      .map(o => `${o.phoneNumber} - ${o.bundleData}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: `Copied ${network.count} ${network.label} pending orders` });
    });
  };

  const statCards = useMemo(() => stats ? [
    { icon: Wallet,       label: "Wallet Balance",  value: `GH₵${((stats as { totalWalletBalance?: number }).totalWalletBalance ?? 0).toFixed(2)}`, sub: "Total user wallet funds",              colorClass: "text-emerald-600", bgClass: "bg-emerald-100 dark:bg-emerald-900/20", accent: true },
    { icon: ShoppingCart, label: "Total Orders",    value: stats.totalOrders,    sub: `+${stats.recentOrders} this month`,         colorClass: "text-violet-600",  bgClass: "bg-violet-100 dark:bg-violet-900/20" },
    { icon: Clock,        label: "Pending Orders",  value: stats.pendingOrders,  sub: "Awaiting processing",                       colorClass: "text-amber-600",   bgClass: "bg-amber-100 dark:bg-amber-900/20",   pulse: stats.pendingOrders > 0 },
    { icon: CheckCircle2, label: "Completed",       value: stats.completedOrders, sub: "Successfully fulfilled",                   colorClass: "text-teal-600",    bgClass: "bg-teal-100 dark:bg-teal-900/20" },
    { icon: Zap,          label: "Processing",      value: (stats as { processingOrders?: number }).processingOrders ?? 0, sub: "Currently being processed",     colorClass: "text-sky-600",     bgClass: "bg-sky-100 dark:bg-sky-900/20",       pulse: ((stats as { processingOrders?: number }).processingOrders ?? 0) > 0 },
    { icon: AlertCircle,  label: "Failed",          value: (stats as { failedOrders?: number }).failedOrders ?? 0, sub: "Failed or cancelled",                  colorClass: "text-red-600",     bgClass: "bg-red-100 dark:bg-red-900/20" },
  ] : [], [stats]);

  const pendingDeposits = useMemo(() => (deposits ?? []).filter(d => d.status === "pending"), [deposits]);

  const filteredOrders = useMemo(() => {
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
    return src;
  }, [allOrders, statusTab, phoneSearch, orderIdSearch]);

  const statusCounts = useMemo(() => {
    const src = allOrders ?? [];
    return Object.fromEntries(
      ORDER_STATUSES.map(s => [s, s === "all" ? src.length : src.filter(o => o.status === s).length])
    );
  }, [allOrders]);

  const totalPages  = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const pagedOrders = useMemo(() => filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredOrders, page]);

  const changeTab = (t: typeof ORDER_STATUSES[number]) => { setStatusTab(t); setPage(1); };

  const today = new Date().toLocaleDateString("en-GH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const processingCount = (stats as { processingOrders?: number } | undefined)?.processingOrders ?? 0;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-auto">
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-6 py-4 flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)} data-testid="button-sidebar-toggle">
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Admin Dashboard</h1>
            <p className="text-xs text-muted-foreground">{today}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
            <Link href="/admin/stats">
              <Button variant="outline" size="sm" className="gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" /> Statistics
              </Button>
            </Link>
            {pendingDeposits.length > 0 && (
              <Link href="/admin/deposits">
                <Button variant="destructive" size="sm" className="gap-1.5" data-testid="alert-pending-deposits">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {pendingDeposits.length} Pending
                </Button>
              </Link>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 space-y-6">

          {/* Stat Cards */}
          {statsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-32 rounded-2xl bg-muted animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {statCards.map(c => <StatCard key={c.label} {...c} />)}
            </div>
          )}

          {/* Network pending buttons */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pending by Network:</span>
            {networkPendingCounts.map(n => (
              <button
                key={n.value}
                onClick={() => handleNetworkCopy(n)}
                disabled={n.count === 0}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${n.badge} hover:opacity-80`}
                title={n.count > 0 ? `Click to copy ${n.count} pending ${n.label} orders` : `No pending ${n.label} orders`}
              >
                <span className={`w-2 h-2 rounded-full ${n.dot}`} />
                {n.label}
                <span className="font-extrabold">({n.count})</span>
                {n.count > 0 && <Copy className="w-3 h-3 ml-0.5 opacity-70" />}
              </button>
            ))}
            {processingCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 ml-auto border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                onClick={handleCompleteAll}
                disabled={completing}
                data-testid="button-complete-all"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Complete all processing ({processingCount})
              </Button>
            )}
          </div>

          {/* Orders Table */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <h2 className="font-bold text-foreground">Orders</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{filteredOrders.length} orders</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Phone number…"
                    value={phoneSearch}
                    onChange={e => { setPhoneSearch(e.target.value); setPage(1); }}
                    className="pl-8 h-8 text-xs w-40"
                    data-testid="input-phone-search"
                  />
                  {phoneSearch && (
                    <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setPhoneSearch(""); setPage(1); }}>
                      <X className="w-3 h-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Order ID…"
                    value={orderIdSearch}
                    onChange={e => { setOrderIdSearch(e.target.value); setPage(1); }}
                    className="pl-8 h-8 text-xs w-32"
                    data-testid="input-orderid-search"
                  />
                  {orderIdSearch && (
                    <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setOrderIdSearch(""); setPage(1); }}>
                      <X className="w-3 h-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
              <Link href="/admin/orders">
                <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                  <ArrowUpRight className="w-3.5 h-3.5" /> Full View
                </Button>
              </Link>
            </div>

            {/* Status tabs */}
            <div className="flex items-center gap-1 px-6 py-2.5 border-b border-border overflow-x-auto">
              {ORDER_STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => changeTab(s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-colors ${
                    statusTab === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                  data-testid={`tab-${s}`}
                >
                  {s !== "all" && <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s]}`} />}
                  {s} <span className="opacity-60">({statusCounts[s]})</span>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {["Date", "Order ID", "Phone", "Network", "Data", "Amount", "Status", "Update"].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pagedOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-14 text-muted-foreground text-sm">
                        <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        No orders match your filters
                      </td>
                    </tr>
                  ) : pagedOrders.map(order => (
                    <tr key={order.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-order-${order.id}`}>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(order.createdAt)}</td>
                      <td className="px-5 py-3.5 text-xs font-mono text-muted-foreground">#{order.id}</td>
                      <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{order.phoneNumber}</td>
                      <td className="px-5 py-3.5">
                        {(order as { network?: string | null }).network ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold ${
                            (order as { network?: string }).network === "mtn" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400" :
                            (order as { network?: string }).network === "telecel" ? "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400" :
                            (order as { network?: string }).network === "at-ishare" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400" :
                            "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400"
                          }`}>
                            {NETWORKS.find(n => n.value === (order as { network?: string }).network)?.label ?? (order as { network?: string }).network}
                          </span>
                        ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                      </td>
                      <td className="px-5 py-3.5 font-bold text-foreground text-xs">{(order as { bundleData?: string }).bundleData ?? "—"}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredOrders.length > 0 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs text-muted-foreground">
                <span>Showing {Math.min((page - 1) * PAGE_SIZE + 1, filteredOrders.length)}–{Math.min(page * PAGE_SIZE, filteredOrders.length)} of {filteredOrders.length}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                    .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                      if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
                      acc.push(p); return acc;
                    }, [])
                    .map((p, i) => p === "…" ? <span key={`e${i}`} className="px-2">…</span> : (
                      <button key={p} onClick={() => setPage(p as number)}
                        className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${page === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                        {p}
                      </button>
                    ))
                  }
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
