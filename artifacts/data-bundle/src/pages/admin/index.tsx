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
  Search, X, RefreshCw, ArrowUpRight, BarChart3,
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
  const [search, setSearch]           = useState("");
  const [page, setPage]               = useState(1);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useAdminGetStats();
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

  const statCards = useMemo(() => stats ? [
    { icon: DollarSign,   label: "Total Revenue",   value: `GH₵${stats.totalRevenue.toFixed(2)}`,  sub: "From completed orders",             colorClass: "text-emerald-600", bgClass: "bg-emerald-100 dark:bg-emerald-900/20", accent: true },
    { icon: ShoppingCart, label: "Total Orders",    value: stats.totalOrders,    sub: `+${stats.recentOrders} this month`,         colorClass: "text-violet-600",  bgClass: "bg-violet-100 dark:bg-violet-900/20" },
    { icon: Clock,        label: "Pending Orders",  value: stats.pendingOrders,  sub: "Awaiting processing",                       colorClass: "text-amber-600",   bgClass: "bg-amber-100 dark:bg-amber-900/20",   pulse: stats.pendingOrders > 0 },
    { icon: CheckCircle2, label: "Completed",       value: stats.completedOrders, sub: "Successfully fulfilled",                   colorClass: "text-teal-600",    bgClass: "bg-teal-100 dark:bg-teal-900/20" },
    { icon: Users,        label: "Total Users",     value: stats.totalUsers,     sub: `+${stats.recentUsers} new this month`,      colorClass: "text-sky-600",     bgClass: "bg-sky-100 dark:bg-sky-900/20" },
    { icon: Package,      label: "Active Bundles",  value: stats.activeBundles,  sub: "Currently listed",                          colorClass: "text-pink-600",    bgClass: "bg-pink-100 dark:bg-pink-900/20" },
  ] : [], [stats]);

  const pendingDeposits = useMemo(() => (deposits ?? []).filter(d => d.status === "pending"), [deposits]);

  const filteredOrders = useMemo(() => {
    let src = allOrders ?? [];
    if (statusTab !== "all") src = src.filter(o => o.status === statusTab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      src = src.filter(o => o.bundleName.toLowerCase().includes(q) || o.phoneNumber.includes(q));
    }
    return src;
  }, [allOrders, statusTab, search]);

  const statusCounts = useMemo(() => {
    const src = allOrders ?? [];
    return Object.fromEntries(
      ORDER_STATUSES.map(s => [s, s === "all" ? src.length : src.filter(o => o.status === s).length])
    );
  }, [allOrders]);

  const totalPages  = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const pagedOrders = useMemo(() => filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredOrders, page]);

  const changeTab = (t: typeof ORDER_STATUSES[number]) => { setStatusTab(t); setPage(1); };
  const changeSearch = (v: string) => { setSearch(v); setPage(1); };

  const today = new Date().toLocaleDateString("en-GH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

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

          {/* Orders Table */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <h2 className="font-bold text-foreground">Orders</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{filteredOrders.length} orders</p>
              </div>
              <div className="relative w-full sm:w-60">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Bundle or phone…"
                  value={search}
                  onChange={e => changeSearch(e.target.value)}
                  className="pl-8 h-8 text-xs"
                  data-testid="input-order-search"
                />
                {search && (
                  <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => changeSearch("")}>
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                )}
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
                    {["Date", "Order ID", "Bundle", "Phone", "Amount", "Status", "Update"].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pagedOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-14 text-muted-foreground text-sm">
                        <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        No orders match your filters
                      </td>
                    </tr>
                  ) : pagedOrders.map(order => (
                    <tr key={order.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-order-${order.id}`}>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(order.createdAt)}</td>
                      <td className="px-5 py-3.5 text-xs font-mono text-muted-foreground">#{order.id}</td>
                      <td className="px-5 py-3.5 max-w-[140px]">
                        <div className="font-medium text-foreground truncate">{order.bundleName}</div>
                        <div className="text-xs text-muted-foreground">{order.bundleData}</div>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{order.phoneNumber}</td>
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
