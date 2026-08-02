import { useState, useMemo, useCallback, useEffect } from "react";
import {
  useAdminListOrders,
  useAdminUpdateOrderStatus,
  getAdminListOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { AdminFinancialSummary } from "@/components/AdminFinancialSummary";
import { OrderDeliveryCheckButton } from "@/components/OrderDeliveryCheckButton";
import { BulkCancelRefundDialog } from "@/components/BulkCancelRefundDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Menu, ShoppingCart, Search, X, Download, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, Copy, Loader2,
  CheckCircle2, XCircle, Banknote, Zap, AlertCircle, Store, Clock,
  DollarSign, TrendingUp,
} from "lucide-react";
import { platformPhase, storePhase, awaitingDispatch } from "@/lib/orderPhase";

// ─── constants ────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  pending:    "bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400",
  paid:       "bg-violet-100 text-violet-800 dark:bg-violet-900/20 dark:text-violet-400",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
  completed:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400",
  delivered:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed:     "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
  cancelled:  "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
  refunded:   "bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400",
};

const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber-400", paid: "bg-violet-400", processing: "bg-blue-400",
  completed: "bg-emerald-400", delivered: "bg-emerald-400", failed: "bg-red-400",
  cancelled: "bg-gray-400", refunded: "bg-rose-400",
};

const ORDER_STATUSES = ["all", "pending", "processing", "completed", "failed", "refunded"] as const;
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
  const todayStr = new Date().toISOString().slice(0, 10);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pageView, setPageView]       = useState<"platform" | "store">("platform");
  const [statusTab, setStatusTab]     = useState<typeof ORDER_STATUSES[number]>("all");
  const [networkFilter, setNetworkFilter] = useState<string>("all");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [orderIdSearch, setOrderIdSearch] = useState("");
  const [dateFrom, setDateFrom]       = useState(todayStr);
  const [dateTo, setDateTo]           = useState(todayStr);
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(25);
  const [sortField, setSortField]     = useState<SortField>("date");
  const [sortDir, setSortDir]         = useState<SortDir>("desc");
  const [refundingId, setRefundingId] = useState<number | null>(null);
  const [completing, setCompleting]   = useState(false);

  const { toast }   = useToast();
  const queryClient = useQueryClient();

  // Server-side search: when an admin types a phone number / order id, ask the
  // server for matches across ALL orders (not just the recent page), debounced.
  const searchTerm = phoneSearch.trim() || orderIdSearch.trim();
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);
  const listParams = useMemo(() => (debouncedSearch ? { search: debouncedSearch } : {}), [debouncedSearch]);

  const { data: allOrders, isLoading, refetch } = useAdminListOrders(listParams);
  const updateStatus = useAdminUpdateOrderStatus();

  const patchOrder = useCallback((orderId: number, patch: Record<string, unknown>) => {
    queryClient.setQueryData(
      getAdminListOrdersQueryKey(listParams),
      (old: unknown) => Array.isArray(old) ? old.map((o: { id: number }) => o.id === orderId ? { ...o, ...patch } : o) : old
    );
  }, [queryClient, listParams]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getAdminListOrdersQueryKey(listParams) });
  }, [queryClient, listParams]);

  const handleStatusChange = (orderId: number, status: string) => {
    updateStatus.mutate({ id: orderId, data: { status } }, {
      onSuccess: (updated) => { toast({ title: `Order #${orderId} updated to ${status}` }); patchOrder(orderId, updated as unknown as Record<string, unknown>); },
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
      patchOrder(orderId, { status: "refunded" });
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error refunding order", variant: "destructive" });
    } finally {
      setRefundingId(null);
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
      const processingStoreOrders = (Array.isArray(storeOrders) ? storeOrders : []).filter((o: any) => o.delivered === "processing" && inRange(o));
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
      invalidate();
      refetchStoreOrders();
    } catch {
      toast({ title: "Error completing orders", variant: "destructive" });
    } finally {
      setCompleting(false);
    }
  };

  // ── Store Orders (always fetched so network pending counts include them) ──
  const { data: storeOrders, isLoading: storeOrdersLoading, refetch: refetchStoreOrders } = useQuery<any[]>({
    queryKey: ["adminStoreOrders"],
    queryFn: () => fetch("/api/admin/store-orders", { credentials: "include" }).then(r => r.json()),
  });

  const [actioningId, setActioningId] = useState<number | null>(null);
  const [storeStatusFilter, setStoreStatusFilter] = useState<string>("all");
  const [storePhoneSearch, setStorePhoneSearch] = useState("");

  // Store orders share the SAME date range + network filter as platform orders
  // (one filter bar for the whole page — no duplicate controls).
  const filteredStoreOrders = useMemo(() => {
    let src = Array.isArray(storeOrders) ? storeOrders : [];
    if (networkFilter !== "all") src = src.filter((o: any) => (o.bundleNetwork ?? "") === networkFilter);
    if (storeStatusFilter !== "all") src = src.filter((o: any) => storePhase(o) === storeStatusFilter);
    if (dateFrom) src = src.filter((o: any) => new Date(o.createdAt) >= new Date(dateFrom));
    if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); src = src.filter((o: any) => new Date(o.createdAt) <= to); }
    if (storePhoneSearch.trim()) src = src.filter((o: any) => String(o.customerPhone ?? "").includes(storePhoneSearch.trim()));
    return src;
  }, [storeOrders, networkFilter, storeStatusFilter, dateFrom, dateTo, storePhoneSearch]);

  const handleStoreOrderComplete = async (id: number) => {
    setActioningId(id);
    try {
      const res = await fetch(`/api/admin/store-orders/${id}/complete`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: `Store order #${id} completed — profit credited` });
      invalidate();
      refetchStoreOrders();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error completing order", variant: "destructive" });
    } finally { setActioningId(null); }
  };

  const handleStoreOrderCancel = async (id: number, isPaid: boolean, amount: number) => {
    if (isPaid) {
      const ok = window.confirm(
        `Cancel store order #${id}?\n\nGH₵${amount.toFixed(2)} will be refunded to the store owner's wallet — they settle with their customer directly.`
      );
      if (!ok) return;
    }
    setActioningId(id);
    try {
      const res = await fetch(`/api/admin/store-orders/${id}/cancel`, { method: "PATCH", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: isPaid ? `Store order #${id} cancelled — GH₵${amount.toFixed(2)} refunded to store owner` : `Store order #${id} cancelled` });
      invalidate();
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

  const clearFilters = () => { setPhoneSearch(""); setOrderIdSearch(""); setDateFrom(todayStr); setDateTo(todayStr); setStatusTab("all"); setNetworkFilter("all"); setPage(1); };
  const hasFilters = phoneSearch || orderIdSearch || dateFrom !== todayStr || dateTo !== todayStr || statusTab !== "all" || networkFilter !== "all";

  // ── network pending counts (platform + store orders combined) ──
  const networkPendingCounts = useMemo(() => {
    type NormalOrder = { id: number; phoneNumber: string; bundleData: string; status: string; delivered: string | null; network: string; isStore?: boolean };
    const platform: NormalOrder[] = (allOrders ?? []).map(o => ({
      id: o.id,
      phoneNumber: o.phoneNumber,
      bundleData: o.bundleData ?? "",
      status: o.status,
      delivered: (o as any).delivered ?? null,
      network: (o as any).network ?? "",
      isStore: false,
    }));
    const store: NormalOrder[] = (Array.isArray(storeOrders) ? storeOrders : []).map(o => ({
      id: o.id,
      phoneNumber: o.customerPhone,
      bundleData: o.bundleData ?? "",
      status: o.status,
      delivered: o.delivered ?? null,
      network: o.bundleNetwork ?? "",
      isStore: true,
    }));
    const all = [...platform, ...store];
    return NETWORKS.map(n => ({
      ...n,
      count: all.filter(o => awaitingDispatch(o) && o.network === n.value).length,
      orders: all.filter(o => awaitingDispatch(o) && o.network === n.value),
    }));
  }, [allOrders, storeOrders]);

  const handleNetworkCopy = async (network: typeof networkPendingCounts[number]) => {
    if (network.count === 0) return;
    const parseDataNum = (s: string) => s.match(/^([\d.]+)/)?.[1] ?? s;
    const text = network.orders.map(o => `${o.phoneNumber}\t${parseDataNum(o.bundleData ?? "")}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `Copied ${network.count} ${network.label} pending orders` });
      const platformIds = network.orders.filter(o => !o.isStore).map(o => o.id);
      const storeIds    = network.orders.filter(o =>  o.isStore).map(o => o.id);
      const tasks: Promise<any>[] = [];
      if (platformIds.length > 0) {
        tasks.push(fetch("/api/admin/orders/bulk-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: platformIds, status: "processing" }),
          credentials: "include",
        }));
      }
      if (storeIds.length > 0) {
        tasks.push(fetch("/api/admin/store-orders/bulk-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: storeIds, status: "processing" }),
          credentials: "include",
        }));
      }
      await Promise.all(tasks);
      invalidate();
      refetchStoreOrders();
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  // ── day-filtered orders for stat cards (date only, not status/phone) ──
  const dayOrders = useMemo(() => {
    let src = allOrders ?? [];
    if (networkFilter !== "all") src = src.filter(o => (o.network ?? "") === networkFilter);
    if (dateFrom) src = src.filter(o => new Date(o.createdAt) >= new Date(dateFrom));
    if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); src = src.filter(o => new Date(o.createdAt) <= to); }
    return src;
  }, [allOrders, networkFilter, dateFrom, dateTo]);

  // ── combined platform + store day orders for unified stat cards ──
  const combinedDayStats = useMemo(() => {
    type NormOrder = { phase: string; amount: number };
    const platform: NormOrder[] = dayOrders.map(o => ({ phase: platformPhase(o as any), amount: Number(o.price) }));
    const storeDay: NormOrder[] = (Array.isArray(storeOrders) ? storeOrders : [])
      .filter((o: any) => {
        if (networkFilter !== "all" && (o.bundleNetwork ?? "") !== networkFilter) return false;
        const d = new Date(o.createdAt);
        if (dateFrom && d < new Date(dateFrom)) return false;
        if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); if (d > to) return false; }
        return true;
      })
      .map((o: any) => ({ phase: storePhase(o), amount: Number(o.sellingPrice) }));
    return [...platform, ...storeDay];
  }, [dayOrders, storeOrders, networkFilter, dateFrom, dateTo]);

  const combinedProcessingCount = combinedDayStats.filter(o => o.phase === "processing").length;

  // ── stat cards ──
  const statCards = useMemo(() => [
    { icon: ShoppingCart, label: "Total Orders",    value: combinedDayStats.length,                                                    sub: dateFrom === dateTo ? `For ${dateFrom}` : `${dateFrom} → ${dateTo}`, colorClass: "text-violet-600",  bgClass: "bg-violet-100 dark:bg-violet-900/20" },
    { icon: Clock,        label: "Pending",          value: combinedDayStats.filter(o => o.phase === "pending" || o.phase === "paid").length,               sub: "Awaiting processing",    colorClass: "text-amber-600",   bgClass: "bg-amber-100 dark:bg-amber-900/20",   pulse: combinedDayStats.filter(o => o.phase === "pending" || o.phase === "paid").length > 0 },
    { icon: Zap,          label: "Processing",       value: combinedDayStats.filter(o => o.phase === "processing").length,            sub: "Being processed",        colorClass: "text-sky-600",     bgClass: "bg-sky-100 dark:bg-sky-900/20",       pulse: combinedDayStats.filter(o => o.phase === "processing").length > 0 },
    { icon: CheckCircle2, label: "Completed",        value: combinedDayStats.filter(o => o.phase === "completed").length,             sub: "Successfully fulfilled", colorClass: "text-emerald-600", bgClass: "bg-emerald-100 dark:bg-emerald-900/20" },
    { icon: AlertCircle,  label: "Failed/Refunded",  value: combinedDayStats.filter(o => o.phase === "failed" || o.phase === "cancelled" || o.phase === "refunded").length, sub: "Failed, cancelled or refunded", colorClass: "text-red-600", bgClass: "bg-red-100 dark:bg-red-900/20" },
    { icon: DollarSign,   label: "Revenue",          value: `GH₵${combinedDayStats.filter(o => o.phase === "completed").reduce((s, o) => s + o.amount, 0).toFixed(2)}`, sub: "Completed orders value", colorClass: "text-teal-600", bgClass: "bg-teal-100 dark:bg-teal-900/20", accent: true },
  ], [combinedDayStats, dateFrom, dateTo]);

  // ── status counts ──
  const statusCounts = useMemo(() => {
    const src = (allOrders ?? []).filter(o => networkFilter === "all" || (o.network ?? "") === networkFilter);
    return Object.fromEntries(
      ORDER_STATUSES.map(s => [s, s === "all" ? src.length : src.filter(o => platformPhase(o as any) === s).length])
    );
  }, [allOrders, networkFilter]);

  const processingCount = statusCounts["processing"] ?? 0;

  // ── filtering + sorting ──
  const processedOrders = useMemo(() => {
    let src = allOrders ?? [];

    if (networkFilter !== "all") src = src.filter(o => (o.network ?? "") === networkFilter);
    if (statusTab !== "all") src = src.filter(o => platformPhase(o as any) === statusTab);
    if (phoneSearch.trim()) {
      const q = phoneSearch.trim();
      src = src.filter(o => o.phoneNumber.includes(q));
    }
    if (orderIdSearch.trim()) {
      const q = orderIdSearch.trim();
      src = src.filter(o => String(o.id).includes(q));
    }
    // Date range ALWAYS applies — including during phone/ID search — so the
    // table (and CSV export) never silently falls back to all-history results.
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
  }, [allOrders, networkFilter, statusTab, phoneSearch, orderIdSearch, dateFrom, dateTo, sortField, sortDir]);

  // When a phone/ID search finds nothing inside the current date range but
  // matches exist outside it, surface a one-click "widen dates" affordance.
  const outsideRangeMatches = useMemo(() => {
    const searching = !!(phoneSearch.trim() || orderIdSearch.trim());
    if (!searching || processedOrders.length > 0) return null;
    let src = allOrders ?? [];
    if (networkFilter !== "all") src = src.filter(o => (o.network ?? "") === networkFilter);
    if (statusTab !== "all") src = src.filter(o => platformPhase(o as any) === statusTab);
    if (phoneSearch.trim()) src = src.filter(o => o.phoneNumber.includes(phoneSearch.trim()));
    if (orderIdSearch.trim()) src = src.filter(o => String(o.id).includes(orderIdSearch.trim()));
    if (src.length === 0) return null;
    const times = src.map(o => new Date(o.createdAt).getTime());
    return {
      count: src.length,
      from: new Date(Math.min(...times)).toISOString().slice(0, 10),
      to:   new Date(Math.max(...times)).toISOString().slice(0, 10),
    };
  }, [processedOrders, allOrders, networkFilter, statusTab, phoneSearch, orderIdSearch]);

  const widenDatesToMatches = () => {
    if (!outsideRangeMatches) return;
    setDateFrom(prev => (prev && prev < outsideRangeMatches.from ? prev : outsideRangeMatches.from));
    setDateTo(prev => (prev && prev > outsideRangeMatches.to ? prev : outsideRangeMatches.to));
    setPage(1);
  };

  const totalPages  = Math.max(1, Math.ceil(processedOrders.length / pageSize));
  const pagedOrders = useMemo(() => processedOrders.slice((page - 1) * pageSize, page * pageSize), [processedOrders, page, pageSize]);

  const changeTab = (t: typeof ORDER_STATUSES[number]) => { setStatusTab(t); setPage(1); };

  // ── CSV export — columns mirror the on-screen table exactly (same rows,
  // same filters, same sort) ──
  const handleExport = () => {
    const headers = ["Date", "Agent", "Order ID", "Phone", "Data", "Amount (GHS)", "Status", "Delivered"];
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = processedOrders.map(o => [
      esc(fmtDate(o.createdAt)),
      esc((o as any).userName ?? ""),
      o.id,
      esc(o.phoneNumber),
      esc(o.bundleData ?? ""),
      Number(o.price).toFixed(2),
      o.status,
      (o as any).delivered ?? "",
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `orders-${dateFrom || new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast({ title: `Exported ${processedOrders.length} orders` });
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        {/* ─── Header ─── */}
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-3 sm:px-6 py-4 flex items-center gap-3 flex-wrap">
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
          <AdminFinancialSummary />
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
              {(storeOrders ?? []).filter((o: any) => o.delivered === "processing").length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-500 text-white text-[10px] font-bold">
                  {(storeOrders ?? []).filter((o: any) => o.delivered === "processing").length}
                </span>
              )}
            </button>
          </div>
        </header>

<main className="flex-1 p-3 sm:p-6 space-y-4">

          {/* ─── Date picker row + Stat cards (always visible) ─── */}
          <div className="space-y-3">
            {/* Date controls */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
                <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="h-7 text-xs w-36 border-0 p-0 focus-visible:ring-0" />
                <span className="text-muted-foreground text-xs">→</span>
                <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
                <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="h-7 text-xs w-36 border-0 p-0 focus-visible:ring-0" />
              </div>
              <button
                onClick={() => { setDateFrom(todayStr); setDateTo(todayStr); setPage(1); }}
                className="text-xs text-primary font-semibold hover:underline"
              >Today</button>
              <button
                onClick={() => { const d = new Date(); d.setDate(d.getDate() - 6); setDateFrom(d.toISOString().slice(0, 10)); setDateTo(todayStr); setPage(1); }}
                className="text-xs text-muted-foreground font-semibold hover:text-foreground"
              >Last 7 days</button>
              <button
                onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >All time</button>
              <Select value={networkFilter} onValueChange={v => { setNetworkFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 text-xs w-36" data-testid="select-network-filter">
                  <SelectValue placeholder="All networks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All networks</SelectItem>
                  {NETWORKS.map(n => (
                    <SelectItem key={n.value} value={n.value}>
                      <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${n.dot}`} />{n.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {statCards.map(({ icon: Icon, label, value, sub, colorClass, bgClass, accent, pulse }) => (
                <div key={label} className={`relative rounded-2xl border p-4 flex flex-col gap-2 ${accent ? "bg-primary text-primary-foreground border-primary/50" : "bg-card border-border"}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${accent ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{label}</span>
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${accent ? "bg-white/15" : bgClass}`}>
                      <Icon className={`w-3 h-3 ${accent ? "text-primary-foreground" : colorClass}`} />
                    </div>
                  </div>
                  <div>
                    <div className={`text-xl font-extrabold tracking-tight ${accent ? "text-primary-foreground" : "text-foreground"}`}>{value}</div>
                    <div className={`text-[10px] mt-0.5 flex items-center gap-1 ${accent ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                      {pulse && (
                        <span className="relative flex h-1.5 w-1.5 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
                        </span>
                      )}
                      {sub}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ─── Network pending buttons ─── */}
          <div className="flex flex-wrap gap-2 items-center bg-card border border-border rounded-xl px-3 py-2.5">
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
            {combinedProcessingCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCompleteAll}
                disabled={completing}
                className="ml-auto gap-1.5 text-xs"
              >
                {completing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Complete all processing ({combinedProcessingCount})
              </Button>
            )}
          </div>

          {/* ─── Action toolbar — sits directly above the orders table ─── */}
          <div className="flex items-center gap-2 flex-wrap">
            {pageView === "platform" ? (
              <>
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </Button>
                <Button variant="outline" size="sm" onClick={handleExport} disabled={processedOrders.length === 0} className="gap-1.5" data-testid="button-export-csv">
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </Button>
                <BulkCancelRefundDialog onDone={() => { invalidate(); refetch(); }} />
                {hasFilters && (
                  <button className="text-xs text-primary font-semibold hover:underline" onClick={clearFilters} data-testid="button-clear-filters">
                    Clear all filters
                  </button>
                )}
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => refetchStoreOrders()} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            )}
          </div>

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
                <>
                {/* Store-specific filters (dates + network are shared in the bar above) */}
                <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border bg-muted/20">
                  <Select value={storeStatusFilter} onValueChange={setStoreStatusFilter}>
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["all", "pending", "paid", "processing", "completed", "failed", "cancelled", "refunded"].map(s => (
                        <SelectItem key={s} value={s} className="capitalize">{s === "all" ? "All statuses" : s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input type="tel" inputMode="numeric" maxLength={10} value={storePhoneSearch}
                      onChange={e => setStorePhoneSearch(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      placeholder="Phone e.g. 0244..." className="h-8 pl-8 pr-2 rounded-md border border-border bg-background text-xs w-44" />
                  </div>
                  {(storeStatusFilter !== "all" || storePhoneSearch) && (
                    <button onClick={() => { setStoreStatusFilter("all"); setStorePhoneSearch(""); }}
                      className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md bg-background flex items-center gap-1">
                      <X className="w-3 h-3" /> Clear
                    </button>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">{filteredStoreOrders.length} result{filteredStoreOrders.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        {["#","Store","Agent","Data","Network","Phone","Revenue","Sys. Profit","Status","Date","Actions"].map((h,i) => (
                          <th key={h} className={`px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${[0,2,4,5,6,7,9].includes(i) ? "hidden sm:table-cell" : ""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredStoreOrders.map((o: any) => {
                        const phase = storePhase(o);
                        const statusColor = STATUS_COLORS[phase] ?? "bg-gray-100 text-gray-700";
                        const isActioning = actioningId === o.id;
                        const canAct = phase !== "completed" && phase !== "cancelled" && phase !== "refunded";
                        return (
                          <tr key={o.id} className="hover:bg-muted/30 transition-colors">
                            <td className="hidden sm:table-cell px-3 py-2.5 font-mono text-xs text-muted-foreground">#{o.id}</td>
                            <td className="px-3 py-2.5">
                              <div className="text-sm font-semibold text-foreground truncate max-w-[150px]" title={o.storeName}>{o.storeName}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">/{o.storeSlug}</div>
                            </td>
                            <td className="hidden sm:table-cell px-3 py-2.5 text-xs text-foreground max-w-[130px]"><span className="truncate block" title={o.ownerName ?? undefined}>{o.ownerName ?? "—"}</span></td>
                            <td className="px-3 py-2.5 font-bold text-foreground">{o.bundleData}</td>
                            <td className="hidden sm:table-cell px-3 py-2.5">
                              {NETWORKS.find(n => n.value === o.bundleNetwork)
                                ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${NETWORKS.find(n => n.value === o.bundleNetwork)!.badge}`}>{NETWORKS.find(n => n.value === o.bundleNetwork)!.label}</span>
                                : <span className="text-xs text-muted-foreground">{o.bundleNetwork}</span>}
                            </td>
                            <td className="hidden sm:table-cell px-3 py-2.5 font-mono text-xs">{o.customerPhone}</td>
                            <td className="hidden sm:table-cell px-3 py-2.5 font-semibold">GH₵{o.sellingPrice.toFixed(2)}</td>
                            <td className="hidden sm:table-cell px-3 py-2.5 text-emerald-600 font-semibold">{o.systemProfit != null ? `+GH₵${Number(o.systemProfit).toFixed(2)}` : "—"}</td>
                            <td className="px-3 py-2.5">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor}`}>{phase}</span>
                            </td>
                            <td className="hidden sm:table-cell px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                            <td className="px-3 py-2.5">
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
                                    onClick={() => handleStoreOrderCancel(o.id, o.status === "paid", o.sellingPrice)}
                                    disabled={isActioning}
                                    title={o.status === "paid" ? "Cancel this order and refund the full amount to the store owner's wallet" : "Cancel this unpaid order"}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-200 disabled:opacity-50 transition-colors whitespace-nowrap"
                                  >
                                    <XCircle className="w-3 h-3" />
                                    {isActioning ? "…" : o.status === "paid" ? "Cancel & Refund" : "Cancel"}
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
                </>
              )}
            </div>
          )}

          {/* ─── PLATFORM ORDERS VIEW ─── */}
          {pageView === "platform" && (
          <>

          {/* ─── Main table card ─── */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {/* Always-visible search filters (dates + network live in the bar above) */}
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border bg-muted/20" data-testid="filter-panel">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Phone e.g. 0244xxxxxx"
                  value={phoneSearch}
                  onChange={e => { setPhoneSearch(e.target.value); setPage(1); }}
                  className="pl-8 h-8 text-xs w-44"
                  data-testid="input-phone-search"
                />
                {phoneSearch && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setPhoneSearch(""); setPage(1); }}><X className="w-3 h-3 text-muted-foreground" /></button>}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Order ID"
                  value={orderIdSearch}
                  onChange={e => { setOrderIdSearch(e.target.value); setPage(1); }}
                  className="pl-8 h-8 text-xs w-32"
                  data-testid="input-orderid-search"
                />
                {orderIdSearch && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setOrderIdSearch(""); setPage(1); }}><X className="w-3 h-3 text-muted-foreground" /></button>}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</Label>
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
                {outsideRangeMatches && (
                  <div className="mt-2 text-xs" data-testid="hint-outside-range">
                    <span className="text-foreground font-medium">
                      {outsideRangeMatches.count} match{outsideRangeMatches.count !== 1 ? "es" : ""} outside this date range
                    </span>
                    {" — "}
                    <button
                      type="button"
                      className="text-primary font-semibold underline underline-offset-2"
                      onClick={widenDatesToMatches}
                      data-testid="button-widen-dates"
                    >
                      Widen dates to show {outsideRangeMatches.count !== 1 ? "them" : "it"}
                    </button>
                  </div>
                )}
                {hasFilters && (
                  <button className="mt-2 text-xs text-primary font-semibold" onClick={clearFilters}>Clear all filters</button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="hidden sm:table-cell text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <div className="flex items-center gap-1">Date <SortButton field="date" current={sortField} dir={sortDir} onToggle={handleSort} /></div>
                      </th>
                      <th className="hidden md:table-cell text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent</th>
                      <th className="hidden sm:table-cell text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <div className="flex items-center gap-1">ID <SortButton field="id" current={sortField} dir={sortDir} onToggle={handleSort} /></div>
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phone</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Data</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <div className="flex items-center gap-1">Amount <SortButton field="amount" current={sortField} dir={sortDir} onToggle={handleSort} /></div>
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                      <th className="hidden lg:table-cell text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Delivered</th>
                      <th className="hidden md:table-cell text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Update</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pagedOrders.map(order => (
                      <tr key={order.id} className="hover:bg-muted/20 transition-colors group" data-testid={`row-order-${order.id}`}>
                        <td className="hidden sm:table-cell px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(order.createdAt)}</td>
                        <td className="hidden md:table-cell px-3 py-2.5 text-xs text-foreground max-w-[130px]"><span className="truncate block" title={(order as any).userName ?? undefined}>{(order as any).userName ?? "—"}</span></td>
                        <td className="hidden sm:table-cell px-3 py-2.5 text-xs font-mono text-muted-foreground">#{order.id}</td>
                        <td className="px-3 py-2.5 font-mono text-sm text-muted-foreground">{order.phoneNumber}</td>
                        <td className="px-3 py-2.5 font-bold text-foreground text-xs">{order.bundleData ?? "—"}</td>
                        <td className="px-3 py-2.5 font-bold text-foreground text-xs">GH₵{Number(order.price).toFixed(2)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[order.status]}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[order.status]}`} />
                            {order.status}
                          </span>
                        </td>
                        <td className="hidden lg:table-cell px-3 py-2.5 text-xs whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            {(order as any).delivered ? (
                              <span className={`inline-flex w-fit items-center px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${STATUS_COLORS[(order as any).delivered] ?? "bg-gray-100 text-gray-700"}`}>
                                {(order as any).delivered}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                            {(order as any).delivery && ((order as any).delivery.date || (order as any).delivery.time) && (
                              <span className="text-muted-foreground">{[(order as any).delivery.date, (order as any).delivery.time].filter(Boolean).join(" ")}</span>
                            )}
                          </div>
                        </td>
                        <td className="hidden md:table-cell px-3 py-2.5">
                          <Select defaultValue={platformPhase(order as any)} onValueChange={v => handleStatusChange(order.id, v)}>
                            <SelectTrigger className="w-32 h-7 text-xs" data-testid={`select-status-${order.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="paid">Paid</SelectItem>
                              <SelectItem value="processing">Processing</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="failed">Failed</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2.5">
                          {order.status === "paid" && (!(order as any).delivered || (order as any).delivered === "processing" || (order as any).delivered === "failed") ? (
                            <div className="flex items-center gap-1.5">
                              {(order as any).delivered !== "failed" && (
                                <OrderDeliveryCheckButton
                                  orderId={order.id}
                                  scope="admin"
                                  invalidateKeys={[getAdminListOrdersQueryKey({})]}
                                />
                              )}
                              <button
                                onClick={() => handleRefund(order.id)}
                                disabled={refundingId === order.id}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-200 disabled:opacity-50 transition-colors"
                                data-testid={`button-refund-${order.id}`}
                              >
                                <Banknote className="w-3 h-3" />
                                {refundingId === order.id ? "…" : "Cancel & Refund"}
                              </button>
                            </div>
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
