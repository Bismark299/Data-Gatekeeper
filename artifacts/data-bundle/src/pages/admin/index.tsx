import { useState, useMemo, useCallback } from "react";
import { Link } from "wouter";
import {
  useAdminGetStats,
  useAdminListOrders,
  useAdminUpdateOrderStatus,
  useAdminListDeposits,
  getAdminListOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { AdminFinancialSummary } from "@/components/AdminFinancialSummary";
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
  XCircle, Copy, Zap, AlertCircle, Trash2, Store, TrendingUp,
} from "lucide-react";

const PAGE_SIZE = 10;

const STATUS_COLORS: Record<string, string> = {
  pending:    "bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400",
  paid:       "bg-violet-100 text-violet-800 dark:bg-violet-900/20 dark:text-violet-400",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
  completed:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed:     "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
};

const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber-400", paid: "bg-violet-400", processing: "bg-blue-400",
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
  new Date(iso).toLocaleString("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });

function StatCard({
  icon: Icon, label, value, moneyValue, dataValue, sub, colorClass, bgClass, accent, pulse,
}: {
  icon: React.ElementType; label: string; value: string | number;
  moneyValue?: string; dataValue?: string; sub: string; colorClass: string; bgClass: string; accent?: boolean; pulse?: boolean;
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
        {moneyValue && (
          <div className={`text-sm font-bold mt-0.5 ${accent ? "text-primary-foreground/80" : "text-emerald-600 dark:text-emerald-400"}`}>
            {moneyValue}
            {dataValue && (
              <span className={`ml-2 ${accent ? "text-primary-foreground/70" : "text-sky-600 dark:text-sky-400"}`}>
                · {dataValue}
              </span>
            )}
          </div>
        )}
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
  const todayStr = new Date().toISOString().slice(0, 10);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [statusTab, setStatusTab]     = useState<typeof ORDER_STATUSES[number]>("all");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [orderIdSearch, setOrderIdSearch] = useState("");
  const [dateFrom, setDateFrom]       = useState(todayStr);
  const [dateTo, setDateTo]           = useState(todayStr);
  const [pageView, setPageView]       = useState<"platform" | "store">("platform");
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(10);
  const [completing, setCompleting]   = useState(false);
  const [refunding, setRefunding]     = useState<number | null>(null);
  const [storeActionId, setStoreActionId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useAdminGetStats({
    refetchInterval: 30000,
    staleTime: 15_000,
  } as Parameters<typeof useAdminGetStats>[0]);
  const { data: deposits } = useAdminListDeposits({});
  const { data: allOrders, refetch: refetchOrders } = useAdminListOrders({}, {
    refetchInterval: 30000,
    staleTime: 15_000,
  } as any);
  const updateStatus = useAdminUpdateOrderStatus();

  const { data: storeOrders, refetch: refetchStoreOrders } = useQuery<any[]>({
    queryKey: ["adminStoreOrdersDash"],
    queryFn: async () => {
      const r = await fetch("/api/admin/store-orders", { credentials: "include" });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 5000,
    staleTime: 0,
  });

  const handleRefresh = () => { refetchStats(); refetchOrders(); refetchStoreOrders(); toast({ title: "Dashboard refreshed" }); };

  const invalidateOrders = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getAdminListOrdersQueryKey({}) });
  }, [queryClient]);

  const handleStatusChange = (orderId: number, status: string) => {
    updateStatus.mutate({ id: orderId, data: { status } }, {
      onSuccess: () => { toast({ title: `Order #${orderId} → ${status}` }); invalidateOrders(); refetchStats(); },
      onError:   () => toast({ title: "Error updating status", variant: "destructive" }),
    });
  };

  const handleRefundOrder = async (orderId: number, price: number) => {
    setRefunding(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/refund`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error();
      toast({ title: `Order #${orderId} cancelled & GH₵${price.toFixed(2)} refunded to wallet` });
      invalidateOrders(); refetchStats();
    } catch {
      toast({ title: "Refund failed", variant: "destructive" });
    } finally {
      setRefunding(null);
    }
  };

  const handleCompleteAll = async () => {
    setCompleting(true);
    try {
      const inRange = (o: any) => {
        const d = new Date(o.createdAt);
        if (dateFrom && d < new Date(dateFrom)) return false;
        if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); if (d > to) return false; }
        return true;
      };
      const processingStoreOrders = (Array.isArray(storeOrders) ? storeOrders : []).filter((o: any) => o.status === "processing" && inRange(o));
      const [platformRes] = await Promise.all([
        fetch("/api/admin/orders/complete-processing", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dateFrom, dateTo }),
        }),
        ...processingStoreOrders.map((o: any) =>
          fetch(`/api/admin/store-orders/${o.id}/complete`, { method: "PATCH", credentials: "include" })
        ),
      ]);
      const json = await platformRes.json();
      const total = json.updated + processingStoreOrders.length;
      toast({ title: `Completed ${total} processing order${total !== 1 ? "s" : ""}` });
      refetchOrders(); refetchStats(); refetchStoreOrders();
    } catch {
      toast({ title: "Error completing orders", variant: "destructive" });
    } finally {
      setCompleting(false);
    }
  };

  const networkPendingCounts = useMemo(() => {
    type NormOrder = { id: number; phoneNumber: string; bundleData: string; status: string; network: string; isStore: boolean };
    const platform: NormOrder[] = (allOrders ?? []).map(o => ({
      id: o.id, phoneNumber: o.phoneNumber, bundleData: o.bundleData ?? "",
      status: o.status, network: (o as any).network ?? "", isStore: false,
    }));
    const store: NormOrder[] = (Array.isArray(storeOrders) ? storeOrders : []).map((o: any) => ({
      id: o.id, phoneNumber: o.customerPhone, bundleData: o.bundleData ?? "",
      status: o.status, network: o.bundleNetwork ?? "", isStore: true,
    }));
    const all = [...platform, ...store];
    return NETWORKS.map(n => ({
      ...n,
      count: all.filter(o => o.status === "pending" && o.network === n.value).length,
      orders: all.filter(o => o.status === "pending" && o.network === n.value),
    }));
  }, [allOrders, storeOrders]);

  const handleNetworkCopy = async (network: typeof networkPendingCounts[number]) => {
    if (network.count === 0) return;
    const addGB = (s: string) => {
      const m = s.match(/^([\d.]+)\s*(GB|MB|TB)?$/i);
      if (!m) return s;
      const unit = (m[2] ?? "GB").toUpperCase();
      return `${m[1]}${unit === "GB" ? "GB" : unit}`;
    };
    const text = network.orders.map(o => `${o.phoneNumber}\t${addGB(o.bundleData ?? "")}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `Copied ${network.count} ${network.label} pending orders` });
      const platformIds = network.orders.filter(o => !(o as any).isStore).map(o => o.id);
      const storeIds    = network.orders.filter(o =>  (o as any).isStore).map(o => o.id);
      const tasks: Promise<any>[] = [];
      if (platformIds.length > 0) tasks.push(fetch("/api/admin/orders/bulk-status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: platformIds, status: "processing" }), credentials: "include",
      }));
      if (storeIds.length > 0) tasks.push(fetch("/api/admin/store-orders/bulk-status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: storeIds, status: "processing" }), credentials: "include",
      }));
      await Promise.all(tasks);
      invalidateOrders(); refetchStats(); refetchStoreOrders();
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  // Orders filtered only by date (for stat cards — not affected by status/phone/ID search)
  const dayOrders = useMemo(() => {
    let src = allOrders ?? [];
    if (dateFrom) src = src.filter(o => new Date(o.createdAt) >= new Date(dateFrom));
    if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); src = src.filter(o => new Date(o.createdAt) <= to); }
    return src;
  }, [allOrders, dateFrom, dateTo]);

  const sumPrice = (orders: typeof dayOrders) =>
    `GH₵${orders.reduce((s, o) => s + Number(o.price), 0).toFixed(2)}`;

  // Parse a bundle-data string (e.g. "5GB", "500MB", "1TB") into GB.
  // Strict: only a clean "<number><unit>" string counts; anything else is 0.
  const toGB = (raw: string): number => {
    const m = String(raw ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*(TB|GB|MB)?$/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return 0;
    const unit = (m[2] ?? "GB").toUpperCase();
    return unit === "TB" ? n * 1024 : unit === "MB" ? n / 1024 : n;
  };

  // Total data volume of a set of orders, formatted (e.g. "500MB", "54GB", "1.5TB").
  const sumData = (orders: Array<{ bundleData?: string | null }>) => {
    const totalGB = orders.reduce((s, o) => s + toGB(o.bundleData ?? ""), 0);
    if (totalGB >= 1024) return `${(totalGB / 1024).toFixed(totalGB % 1024 === 0 ? 0 : 1)}TB`;
    if (totalGB > 0 && totalGB < 1) {
      const mb = totalGB * 1024;
      return `${Number.isInteger(mb) ? mb : mb.toFixed(0)}MB`;
    }
    return `${Number.isInteger(totalGB) ? totalGB : totalGB.toFixed(1)}GB`;
  };

  const dayPending    = dayOrders.filter(o => o.status === "pending");
  const dayCompleted  = dayOrders.filter(o => o.status === "completed");
  const dayProcessing = dayOrders.filter(o => o.status === "processing");
  const dayFailed     = dayOrders.filter(o => o.status === "failed" || o.status === "cancelled");

  const dayStoreOrders = useMemo(() => {
    let src = Array.isArray(storeOrders) ? storeOrders : [];
    if (dateFrom) src = src.filter((o: any) => new Date(o.createdAt) >= new Date(dateFrom));
    if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); src = src.filter((o: any) => new Date(o.createdAt) <= to); }
    return src;
  }, [storeOrders, dateFrom, dateTo]);

  const totalOrderCount = dayOrders.length + dayStoreOrders.length;
  const totalCompleted  = dayCompleted.length + dayStoreOrders.filter((o: any) => o.status === "completed").length;
  // "paid" = payment confirmed, awaiting dispatch — counts alongside pending for admin attention
  const storePendingCount = dayStoreOrders.filter((o: any) => o.status === "pending" || o.status === "paid").length;
  const totalPending    = dayPending.length + storePendingCount;
  const totalProcessing = dayProcessing.length + dayStoreOrders.filter((o: any) => o.status === "processing").length;
  const totalFailed     = dayFailed.length    + dayStoreOrders.filter((o: any) => o.status === "failed" || o.status === "cancelled").length;

  const statCards = useMemo(() => stats ? [
    { icon: Wallet,       label: "Wallet Balance",  value: `GH₵${((stats as { totalWalletBalance?: number }).totalWalletBalance ?? 0).toFixed(2)}`, sub: "Total user wallet funds",              colorClass: "text-emerald-600", bgClass: "bg-emerald-100 dark:bg-emerald-900/20", accent: true },
    { icon: ShoppingCart, label: "Total Orders",    value: totalOrderCount, moneyValue: sumPrice(dayOrders), dataValue: sumData([...dayOrders, ...dayStoreOrders]), sub: `${dayOrders.length} direct · ${dayStoreOrders.length} store`, colorClass: "text-violet-600",  bgClass: "bg-violet-100 dark:bg-violet-900/20" },
    { icon: Clock,        label: "Pending",         value: totalPending,    sub: `${dayPending.length} direct · ${storePendingCount} store`,   colorClass: "text-amber-600",   bgClass: "bg-amber-100 dark:bg-amber-900/20",   pulse: totalPending > 0 },
    { icon: CheckCircle2, label: "Completed",       value: totalCompleted,  moneyValue: sumPrice(dayCompleted), dataValue: sumData([...dayCompleted, ...dayStoreOrders.filter((o: any) => o.status === "completed")]), sub: `${dayCompleted.length} direct · ${dayStoreOrders.filter((o: any) => o.status === "completed").length} store`, colorClass: "text-teal-600",    bgClass: "bg-teal-100 dark:bg-teal-900/20" },
    { icon: Zap,          label: "Processing",      value: totalProcessing, sub: `${dayProcessing.length} direct · ${dayStoreOrders.filter((o: any) => o.status === "processing").length} store`, colorClass: "text-sky-600", bgClass: "bg-sky-100 dark:bg-sky-900/20", pulse: totalProcessing > 0 },
    { icon: AlertCircle,  label: "Failed",          value: totalFailed,     sub: `${dayFailed.length} direct · ${dayStoreOrders.filter((o: any) => o.status === "failed" || o.status === "cancelled").length} store`, colorClass: "text-red-600",     bgClass: "bg-red-100 dark:bg-red-900/20" },
  ] : [], [stats, dayOrders, dayStoreOrders, dayPending, dayCompleted, dayProcessing, dayFailed, totalOrderCount, totalCompleted, totalPending, storePendingCount, totalProcessing, totalFailed, dateFrom, dateTo]);

  const pendingDeposits = useMemo(() => (deposits ?? []).filter(d => d.status === "pending"), [deposits]);

  const filteredOrders = useMemo(() => {
    let src = allOrders ?? [];
    if (dateFrom) src = src.filter(o => new Date(o.createdAt) >= new Date(dateFrom));
    if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); src = src.filter(o => new Date(o.createdAt) <= to); }
    if (statusTab !== "all") src = src.filter(o => o.status === statusTab);
    if (phoneSearch.trim()) src = src.filter(o => o.phoneNumber.includes(phoneSearch.trim()));
    if (orderIdSearch.trim()) src = src.filter(o => String(o.id).includes(orderIdSearch.trim()));
    return src;
  }, [allOrders, statusTab, phoneSearch, orderIdSearch, dateFrom, dateTo]);

  const statusCounts = useMemo(() => {
    // Status counts from date-filtered orders (dayOrders)
    return Object.fromEntries(
      ORDER_STATUSES.map(s => [s, s === "all" ? dayOrders.length : dayOrders.filter(o => o.status === s).length])
    );
  }, [dayOrders]);

  // Store order actions
  const handleStoreOrderComplete = async (id: number) => {
    setStoreActionId(id);
    try {
      const res = await fetch(`/api/admin/store-orders/${id}/complete`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Store order #${id} completed — profit credited` });
      refetchStoreOrders(); refetchStats();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error completing order", variant: "destructive" });
    } finally { setStoreActionId(null); }
  };

  const handleStoreOrderCancel = async (id: number) => {
    setStoreActionId(id);
    try {
      const res = await fetch(`/api/admin/store-orders/${id}/cancel`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Store order #${id} cancelled` });
      refetchStoreOrders();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error cancelling order", variant: "destructive" });
    } finally { setStoreActionId(null); }
  };

  const totalPages  = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const pagedOrders = useMemo(() => filteredOrders.slice((page - 1) * pageSize, page * pageSize), [filteredOrders, page, pageSize]);

  const changeTab = (t: typeof ORDER_STATUSES[number]) => { setStatusTab(t); setPage(1); };

  const today = new Date().toLocaleDateString("en-GH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });


  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-3 sm:px-6 py-4 flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)} data-testid="button-sidebar-toggle">
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Admin Dashboard</h1>
            <p className="text-xs text-muted-foreground">{today}</p>
          </div>
          <AdminFinancialSummary />
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

        <main className="flex-1 p-3 sm:p-6 space-y-6">

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
            {totalProcessing > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 ml-auto border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                onClick={handleCompleteAll}
                disabled={completing}
                data-testid="button-complete-all"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Complete all processing ({totalProcessing})
              </Button>
            )}
          </div>

          {/* Orders Table */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1">
                  <h2 className="font-bold text-foreground">Orders</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {pageView === "platform" ? `${filteredOrders.length} platform order${filteredOrders.length !== 1 ? "s" : ""}` : `${dayStoreOrders.length} store order${dayStoreOrders.length !== 1 ? "s" : ""}`}
                    {" "}for {dateFrom === dateTo ? dateFrom : `${dateFrom} → ${dateTo}`}
                  </p>
                </div>
                <div className="flex items-center rounded-xl border border-border bg-muted/40 p-1 gap-1">
                  <button onClick={() => setPageView("platform")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${pageView === "platform" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    <ShoppingCart className="w-3.5 h-3.5" /> Platform
                  </button>
                  <button onClick={() => setPageView("store")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${pageView === "store" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    Store
                    {(dayStoreOrders ?? []).filter((o: any) => o.status === "processing").length > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-blue-500 text-white text-[10px] font-bold">
                        {dayStoreOrders.filter((o: any) => o.status === "processing").length}
                      </span>
                    )}
                  </button>
                </div>
                <Link href="/admin/orders">
                  <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                    <ArrowUpRight className="w-3.5 h-3.5" /> Full View
                  </Button>
                </Link>
              </div>
              {/* Date range + search filters */}
              <div className="flex flex-wrap gap-2 items-center">
                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs" title="From" />
                <span className="text-xs text-muted-foreground">to</span>
                <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs" title="To" />
                <button onClick={() => { setDateFrom(todayStr); setDateTo(todayStr); setPage(1); }}
                  className="text-xs text-primary hover:underline px-1">Today</button>
                <button onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
                  className="text-xs text-muted-foreground hover:text-foreground px-1">All time</button>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input type="tel" inputMode="numeric" maxLength={10} placeholder="Phone…" value={phoneSearch}
                    onChange={e => { setPhoneSearch(e.target.value.replace(/\D/g, "").slice(0, 10)); setPage(1); }}
                    className="pl-8 h-8 text-xs w-36" data-testid="input-phone-search" />
                  {phoneSearch && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setPhoneSearch(""); setPage(1); }}><X className="w-3 h-3 text-muted-foreground" /></button>}
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input placeholder="Order ID…" value={orderIdSearch}
                    onChange={e => { setOrderIdSearch(e.target.value); setPage(1); }}
                    className="pl-8 h-8 text-xs w-28" data-testid="input-orderid-search" />
                  {orderIdSearch && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setOrderIdSearch(""); setPage(1); }}><X className="w-3 h-3 text-muted-foreground" /></button>}
                </div>
              </div>
            </div>

            {/* Status tabs — platform only */}
            {pageView === "platform" && (
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
            )}

            {/* ── Store Orders View ── */}
            {pageView === "store" && (
              dayStoreOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Store className="w-10 h-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No store orders for this period</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        {[["#","hidden sm:table-cell"],["Store",""],["Agent","hidden md:table-cell"],["Data",""],["Network","hidden sm:table-cell"],["Phone","hidden sm:table-cell"],["Revenue","hidden sm:table-cell"],["Sys. Profit","hidden sm:table-cell"],["Status",""],["Date","hidden sm:table-cell"],["Actions",""]].map(([h, cls]) => (
                          <th key={h} className={`text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${cls}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {dayStoreOrders.map((o: any) => {
                        const statusColor = STATUS_COLORS[o.status] ?? "bg-gray-100 text-gray-700";
                        const isActioning = storeActionId === o.id;
                        const canAct = o.status !== "completed" && o.status !== "cancelled";
                        const nConf = NETWORKS.find(n => n.value === o.bundleNetwork);
                        return (
                          <tr key={o.id} className="hover:bg-muted/20 transition-colors">
                            <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-muted-foreground">#{o.id}</td>
                            <td className="px-4 py-3">
                              <div className="text-xs font-semibold text-foreground">{o.storeName}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">/{o.storeSlug}</div>
                            </td>
                            <td className="hidden md:table-cell px-4 py-3 text-xs text-foreground">{o.ownerName ?? "—"}</td>
                            <td className="px-4 py-3 font-bold text-foreground text-xs">{o.bundleData}</td>
                            <td className="hidden sm:table-cell px-4 py-3">
                              {nConf ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${nConf.badge}`}>{nConf.label}</span>
                                : <span className="text-xs text-muted-foreground">{o.bundleNetwork}</span>}
                            </td>
                            <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs">{o.customerPhone}</td>
                            <td className="hidden sm:table-cell px-4 py-3 font-semibold text-xs">GH₵{o.sellingPrice.toFixed(2)}</td>
                            <td className="hidden sm:table-cell px-4 py-3 font-semibold text-xs">
                              {o.systemProfit != null
                                ? <span className="text-emerald-600">+GH₵{o.systemProfit.toFixed(2)}</span>
                                : <span className="text-muted-foreground italic text-[10px]">—</span>}
                            </td>
                            <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor}`}>{o.status}</span></td>
                            <td className="hidden sm:table-cell px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                            <td className="px-4 py-3">
                              {canAct ? (
                                <div className="flex items-center gap-1.5">
                                  <button onClick={() => handleStoreOrderComplete(o.id)} disabled={isActioning}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 transition-colors">
                                    <CheckCircle2 className="w-3 h-3" />{isActioning ? "…" : "Complete"}
                                  </button>
                                  <button onClick={() => handleStoreOrderCancel(o.id)} disabled={isActioning}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors">
                                    <XCircle className="w-3 h-3" />{isActioning ? "…" : "Cancel"}
                                  </button>
                                </div>
                              ) : <span className="text-xs text-muted-foreground/40 italic">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* ── Platform Orders Table ── */}
            {pageView === "platform" && (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {([["Date","hidden sm:table-cell"],["Agent","hidden md:table-cell"],["Order ID","hidden sm:table-cell"],["Phone",""],["Network","hidden sm:table-cell"],["Data",""],["Amount",""],["Status",""],["Update","hidden md:table-cell"],["Actions",""]] as [string,string][]).map(([h,cls]) => (
                      <th key={h} className={`text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${cls}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pagedOrders.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center py-14 text-muted-foreground text-sm">
                        <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        No orders match your filters
                      </td>
                    </tr>
                  ) : pagedOrders.map(order => (
                    <tr key={order.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-order-${order.id}`}>
                      <td className="hidden sm:table-cell px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(order.createdAt)}</td>
                      <td className="hidden md:table-cell px-5 py-3.5 text-xs text-foreground">{(order as any).userName ?? "—"}</td>
                      <td className="hidden sm:table-cell px-5 py-3.5 text-xs font-mono text-muted-foreground">#{order.id}</td>
                      <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{order.phoneNumber}</td>
                      <td className="hidden sm:table-cell px-5 py-3.5">
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
                      <td className="px-5 py-3.5 font-bold text-foreground text-xs">GH₵{Number(order.price).toFixed(2)}</td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[order.status]}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[order.status]}`} />
                          {order.status}
                        </span>
                      </td>
                      <td className="hidden md:table-cell px-5 py-3.5">
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
                        {order.status !== "failed" && (
                          <button
                            onClick={() => handleRefundOrder(order.id, Number(order.price))}
                            disabled={refunding === order.id}
                            title="Cancel order & refund wallet"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-red-200 dark:border-red-800"
                            data-testid={`button-refund-${order.id}`}
                          >
                            {refunding === order.id ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <Trash2 className="w-3 h-3" />
                            )}
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredOrders.length > 0 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs text-muted-foreground">
                <div className="flex items-center gap-3">
                  <span>Showing {Math.min((page - 1) * pageSize + 1, filteredOrders.length)}–{Math.min(page * pageSize, filteredOrders.length)} of {filteredOrders.length}</span>
                  <div className="flex items-center gap-1.5">
                    <span>Per page:</span>
                    <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
                      <SelectTrigger className="h-6 w-16 text-xs px-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 25, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
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
            </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
