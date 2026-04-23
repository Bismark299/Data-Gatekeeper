import { useState, useMemo, useCallback } from "react";
import {
  useAdminListOrders,
  useAdminUpdateOrderStatus,
  getAdminListOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
  ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, Filter,
} from "lucide-react";

// ─── constants ────────────────────────────────────────────────────────────────
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
const PAGE_SIZES = [10, 25, 50, 100];

type SortField = "date" | "amount" | "id";
type SortDir   = "asc" | "desc";

// ─── helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });

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
  const [statusTab, setStatusTab]     = useState<typeof ORDER_STATUSES[number]>("all");
  const [search, setSearch]           = useState("");
  const [dateFrom, setDateFrom]       = useState("");
  const [dateTo, setDateTo]           = useState("");
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(25);
  const [sortField, setSortField]     = useState<SortField>("date");
  const [sortDir, setSortDir]         = useState<SortDir>("desc");
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
    setPage(1);
  };

  const clearFilters = () => { setSearch(""); setDateFrom(""); setDateTo(""); setStatusTab("all"); setPage(1); };
  const hasFilters = search || dateFrom || dateTo || statusTab !== "all";

  // ── status counts ──
  const statusCounts = useMemo(() => {
    const src = allOrders ?? [];
    return Object.fromEntries(
      ORDER_STATUSES.map(s => [s, s === "all" ? src.length : src.filter(o => o.status === s).length])
    );
  }, [allOrders]);

  // ── filtering + sorting ──
  const processedOrders = useMemo(() => {
    let src = allOrders ?? [];

    if (statusTab !== "all") src = src.filter(o => o.status === statusTab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      src = src.filter(o =>
        o.bundleName.toLowerCase().includes(q) ||
        o.phoneNumber.includes(q) ||
        String(o.id).includes(q)
      );
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
  }, [allOrders, statusTab, search, dateFrom, dateTo, sortField, sortDir]);

  const totalPages  = Math.max(1, Math.ceil(processedOrders.length / pageSize));
  const pagedOrders = useMemo(() => processedOrders.slice((page - 1) * pageSize, page * pageSize), [processedOrders, page, pageSize]);

  const changeTab = (t: typeof ORDER_STATUSES[number]) => { setStatusTab(t); setPage(1); };

  // ── CSV export ──
  const handleExport = () => {
    const headers = ["ID", "Date", "Bundle", "Data", "Phone", "Amount", "Status"];
    const rows = processedOrders.map(o => [
      `#${o.id}`,
      fmtDate(o.createdAt),
      `"${o.bundleName}"`,
      `"${o.bundleData}"`,
      o.phoneNumber,
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
            <p className="text-xs text-muted-foreground">{processedOrders.length} order{processedOrders.length !== 1 ? "s" : ""} {hasFilters ? "(filtered)" : "total"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFiltersOpen(v => !v)} className="gap-1.5">
              <Filter className="w-3.5 h-3.5" /> Filters {hasFilters && <span className="w-2 h-2 rounded-full bg-primary" />}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={processedOrders.length === 0} className="gap-1.5" data-testid="button-export-csv">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6 space-y-4">

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
                {/* Search */}
                <div className="space-y-1">
                  <Label className="text-xs">Search</Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Bundle, phone, or ID…"
                      value={search}
                      onChange={e => { setSearch(e.target.value); setPage(1); }}
                      className="pl-8 h-8 text-xs"
                      data-testid="input-order-search"
                    />
                    {search && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setSearch(""); setPage(1); }}><X className="w-3 h-3 text-muted-foreground" /></button>}
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
                {/* Page size */}
                <div className="space-y-1">
                  <Label className="text-xs">Rows per page</Label>
                  <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-page-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZES.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
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
                        <div className="flex items-center gap-1">
                          Date <SortButton field="date" current={sortField} dir={sortDir} onToggle={handleSort} />
                        </div>
                      </th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <div className="flex items-center gap-1">
                          ID <SortButton field="id" current={sortField} dir={sortDir} onToggle={handleSort} />
                        </div>
                      </th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bundle</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phone</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <div className="flex items-center gap-1">
                          Amount <SortButton field="amount" current={sortField} dir={sortDir} onToggle={handleSort} />
                        </div>
                      </th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Update</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pagedOrders.map(order => (
                      <tr key={order.id} className="hover:bg-muted/20 transition-colors group" data-testid={`row-order-${order.id}`}>
                        <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(order.createdAt)}</td>
                        <td className="px-5 py-3.5 text-xs font-mono text-muted-foreground">#{order.id}</td>
                        <td className="px-5 py-3.5 max-w-[160px]">
                          <div className="font-medium text-foreground truncate">{order.bundleName}</div>
                          <div className="text-xs text-muted-foreground">{order.bundleData}</div>
                        </td>
                        <td className="px-5 py-3.5 font-mono text-sm text-muted-foreground">{order.phoneNumber}</td>
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
        </main>
      </div>
    </div>
  );
}
