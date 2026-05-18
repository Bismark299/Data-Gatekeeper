import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { AdminFinancialSummary } from "@/components/AdminFinancialSummary";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Menu, RefreshCw, Loader2, Package2, Zap, CheckCircle2, AlertCircle,
  Clock, Send, Wifi, Info, ChevronDown, ChevronUp, AlertTriangle,
  BarChart3, PackageSearch, ArrowRight,
} from "lucide-react";

export default function AdminTopupgh() {
  return (
    <ProtectedRoute adminOnly>
      <AdminTopupghContent />
    </ProtectedRoute>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueOrder {
  id: number; phone: string; bundleName: string; bundleData: string;
  price: number; network: string; createdAt: string;
}

interface QueueData {
  enabled: boolean; minBatch: number; maxBatch: number;
  count: number; oldestMinutes: number | null; orders: QueueOrder[];
}

interface Product {
  id: number; name: string; price: string; data_size: string;
  network: "mtn" | "at" | "telecel"; in_stock: boolean;
}

interface Batch {
  id: number; topupghOrderId: number | null; status: string; network: string;
  itemCount: number; itemsAdded: number; itemsSkipped: number;
  totalAmount: number | null; walletDeducted: number | null;
  previousBalance: number | null; newBalance: number | null;
  errorMessage: string | null; dispatchedAt: string | null; createdAt: string;
}

interface BatchOrder {
  id: number; phone: string; bundleName: string; bundleData: string;
  price: number; status: string; createdAt: string;
}

interface BatchDetail { batch: Batch; orders: BatchOrder[] }
interface BatchesData { batches: Batch[]; total: number; page: number; pageSize: number }
interface BalanceData { success: boolean; balance: number; currency: string; today: { credit: number; debit: number } }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending:    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  completed:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  partial:    "bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400",
  failed:     "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function fmt(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    + " " + dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function timeSince(d: string) {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = "queue" | "products" | "batches" | "reconcile";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "queue",     label: "Queue",     icon: Clock },
  { id: "products",  label: "Products",  icon: PackageSearch },
  { id: "batches",   label: "Batches",   icon: BarChart3 },
  { id: "reconcile", label: "Reconcile", icon: ArrowRight },
];

// ─── Queue Tab ────────────────────────────────────────────────────────────────

function QueueTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery<QueueData>({
    queryKey: ["topupgh-queue"],
    queryFn: () => fetch("/api/admin/topupgh/queue", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 30_000,
  });

  const dispatchMut = useMutation({
    mutationFn: () =>
      fetch("/api/admin/topupgh/dispatch", { method: "POST", credentials: "include" }).then(r => r.json()),
    onSuccess: (d: { dispatched: boolean; reason?: string; ordersCount: number; batchId?: number }) => {
      if (d.dispatched) {
        toast({ title: `Batch dispatched — ${d.ordersCount} orders → batch #${d.batchId}` });
        queryClient.invalidateQueries({ queryKey: ["topupgh-queue"] });
        queryClient.invalidateQueries({ queryKey: ["topupgh-batches"] });
      } else {
        toast({ title: `Not dispatched: ${d.reason ?? "unknown"}`, variant: "destructive" });
      }
    },
    onError: (e: unknown) => toast({ title: e instanceof Error ? e.message : "Dispatch failed", variant: "destructive" }),
  });

  const q = data;

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Queued Orders",  value: isLoading ? "—" : String(q?.count ?? 0),                  sub: "pending MTN orders",       icon: Clock,      color: "text-yellow-500" },
          { label: "Min Batch Size", value: isLoading ? "—" : String(q?.minBatch ?? 5),                sub: "orders to auto-dispatch",  icon: Package2,   color: "text-blue-500" },
          { label: "Max Batch Size", value: isLoading ? "—" : String(q?.maxBatch ?? 50),               sub: "orders per dispatch",      icon: Send,       color: "text-purple-500" },
          { label: "Oldest Order",   value: isLoading ? "—" : q?.oldestMinutes != null ? `${q.oldestMinutes}m` : "—", sub: "waiting in queue", icon: AlertTriangle, color: (q?.oldestMinutes ?? 0) > 30 ? "text-red-500" : "text-emerald-500" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0`}>
              <s.icon className={`w-4.5 h-4.5 ${s.color}`} />
            </div>
            <div>
              <div className="text-xl font-bold text-foreground">{s.value}</div>
              <div className="text-[10px] text-muted-foreground font-medium leading-tight">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Queue info + dispatch */}
      {!isLoading && q && (
        <div className="bg-card border border-border rounded-2xl p-5 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {q.count === 0 ? "Queue is empty" : `${q.count} order${q.count === 1 ? "" : "s"} waiting`}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {q.enabled
                ? `Auto-dispatch fires when ${q.minBatch}+ orders are queued`
                : "TopUpGH is disabled — enable it in Settings to auto-dispatch"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 h-8 text-xs">
              <RefreshCw className="w-3 h-3" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => dispatchMut.mutate()}
              disabled={dispatchMut.isPending || !q.enabled || q.count === 0}
              className="gap-1.5 h-8 text-xs bg-orange-500 hover:bg-orange-600 text-white"
            >
              {dispatchMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Force Dispatch
            </Button>
          </div>
        </div>
      )}

      {/* Orders table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Queued Orders</h3>
          <span className="text-xs text-muted-foreground">{q?.count ?? 0} orders pending</span>
        </div>

        {isLoading ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !q?.orders.length ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No orders queued</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-[11px] text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-2.5 text-left font-semibold">Order</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Phone</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Bundle</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Price</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Queued</th>
                </tr>
              </thead>
              <tbody>
                {q.orders.map((o, i) => (
                  <tr key={o.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">#{o.id}</td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{o.phone}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground text-xs">{o.bundleName}</div>
                      <div className="text-[11px] text-muted-foreground">{o.bundleData}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-foreground">GH₵{o.price.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">{timeSince(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Products Tab ─────────────────────────────────────────────────────────────

function ProductsTab() {
  const [networkFilter, setNetworkFilter] = useState<"" | "mtn" | "at" | "telecel">("");
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<{ success: boolean; products: Product[]; total: number }>({
    queryKey: ["topupgh-products", networkFilter],
    queryFn: () => {
      const url = networkFilter ? `/api/admin/topupgh/products?network=${networkFilter}` : "/api/admin/topupgh/products";
      return fetch(url, { credentials: "include" }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error((d as { error?: string }).error ?? `HTTP ${r.status}`);
        return d;
      });
    },
    retry: false,
    onError: (e: unknown) => toast({ title: e instanceof Error ? e.message : "Failed to load products", variant: "destructive" }),
  } as Parameters<typeof useQuery>[0]);

  const NETWORK_BADGES = {
    mtn:    { label: "MTN",     color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400" },
    at:     { label: "AT",      color: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
    telecel:{ label: "Telecel", color: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
  };

  return (
    <div className="space-y-5">
      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["", "mtn", "at", "telecel"] as const).map(n => (
          <button
            key={n}
            onClick={() => setNetworkFilter(n)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              networkFilter === n
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-primary/40"
            }`}
          >
            {n === "" ? "All Networks" : n.toUpperCase()}
          </button>
        ))}
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 h-7 text-xs ml-auto">
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.products?.length ? (
        <div className="py-16 text-center bg-card border border-border rounded-2xl">
          <PackageSearch className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No products found</p>
          <p className="text-xs text-muted-foreground mt-1">Check your API credentials in Settings</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data.products.map(p => {
            const badge = NETWORK_BADGES[p.network];
            return (
              <div key={p.id} className={`bg-card border rounded-2xl p-4 space-y-2.5 transition-all ${p.in_stock ? "border-border" : "border-muted opacity-60"}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge?.color ?? "bg-muted text-muted-foreground"}`}>
                    {badge?.label ?? p.network.toUpperCase()}
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${p.in_stock ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                    {p.in_stock ? "IN STOCK" : "OUT"}
                  </span>
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground leading-tight">{p.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{p.data_size}</div>
                </div>
                <div className="text-lg font-bold text-foreground">GH₵{parseFloat(p.price).toFixed(2)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Batches Tab ──────────────────────────────────────────────────────────────

function ExpandedBatch({ batchId }: { batchId: number }) {
  const { data, isLoading } = useQuery<BatchDetail>({
    queryKey: ["topupgh-batch", batchId],
    queryFn: () => fetch(`/api/admin/topupgh/batches/${batchId}`, { credentials: "include" }).then(r => r.json()),
  });

  if (isLoading) return (
    <div className="py-4 flex items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  );

  const orders = data?.orders ?? [];
  return (
    <div className="px-4 pb-4">
      <div className="rounded-xl overflow-hidden border border-border/60">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/40 text-[10px] text-muted-foreground uppercase tracking-wide border-b border-border">
              <th className="px-3 py-2 text-left font-semibold">Order</th>
              <th className="px-3 py-2 text-left font-semibold">Phone</th>
              <th className="px-3 py-2 text-left font-semibold">Bundle</th>
              <th className="px-3 py-2 text-right font-semibold">Price</th>
              <th className="px-3 py-2 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2 font-mono text-muted-foreground">#{o.id}</td>
                <td className="px-3 py-2 font-medium text-foreground">{o.phone}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-foreground">{o.bundleName}</div>
                  <div className="text-muted-foreground">{o.bundleData}</div>
                </td>
                <td className="px-3 py-2 text-right font-semibold">GH₵{o.price.toFixed(2)}</td>
                <td className="px-3 py-2 text-right"><StatusBadge status={o.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BatchesTab() {
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery<BatchesData>({
    queryKey: ["topupgh-batches", page, statusFilter],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (statusFilter) p.set("status", statusFilter);
      return fetch(`/api/admin/topupgh/batches?${p}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const statuses = ["", "processing", "completed", "partial", "failed", "pending"];

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors capitalize ${
              statusFilter === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-primary/40"
            }`}
          >
            {s === "" ? "All" : s}
          </button>
        ))}
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 h-7 text-xs ml-auto">
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Batch History</h3>
          <span className="text-xs text-muted-foreground">{data?.total ?? 0} batches total</span>
        </div>

        {isLoading ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.batches.length ? (
          <div className="py-12 text-center">
            <BarChart3 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No batches yet</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-[11px] text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left font-semibold">Batch</th>
                    <th className="px-4 py-2.5 text-left font-semibold">TG Order ID</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Items</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Deducted</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Status</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Dispatched</th>
                    <th className="px-4 py-2.5 text-center font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.batches.map(b => (
                    <>
                      <tr
                        key={b.id}
                        className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                      >
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">#{b.id}</td>
                        <td className="px-4 py-2.5 text-foreground font-medium">
                          {b.topupghOrderId ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="text-foreground font-semibold">{b.itemsAdded}</span>
                          {b.itemsSkipped > 0 && (
                            <span className="text-muted-foreground text-xs ml-1">(+{b.itemsSkipped} skipped)</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                          {b.walletDeducted != null ? `GH₵${b.walletDeducted.toFixed(2)}` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center"><StatusBadge status={b.status} /></td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">
                          {b.dispatchedAt ? timeSince(b.dispatchedAt) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {expandedId === b.id
                            ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                        </td>
                      </tr>
                      {expandedId === b.id && (
                        <tr key={`${b.id}-detail`} className="bg-muted/10 border-b border-border/40">
                          <td colSpan={7} className="p-0">
                            {b.errorMessage && (
                              <div className="mx-4 mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
                                <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-red-700 dark:text-red-400">{b.errorMessage}</p>
                              </div>
                            )}
                            <ExpandedBatch batchId={b.id} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {(data.total > data.pageSize) && (
              <div className="px-4 py-3 border-t border-border flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Page {data.page} of {Math.ceil(data.total / data.pageSize)}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="h-7 text-xs">Prev</Button>
                  <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / data.pageSize)} onClick={() => setPage(p => p + 1)} className="h-7 text-xs">Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Reconcile Tab ────────────────────────────────────────────────────────────

interface TGOrder { id: number; status: string; total: number; date_created: string }

function ReconcileTab() {
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = useQuery<{
    success: boolean;
    pagination: { total: number; per_page: number; current_page: number; total_pages: number };
    orders?: TGOrder[];
  }>({
    queryKey: ["topupgh-all-orders", page],
    queryFn: () =>
      fetch(`/api/admin/topupgh/orders?page=${page}&per_page=20`, { credentials: "include" }).then(r => r.json()),
    retry: false,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800">
        <Info className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700 dark:text-blue-400">
          This shows orders directly from the TopUpGH API. Use it to cross-check your internal batches
          with what TopUpGH has on record.
        </p>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">TopUpGH Order History</h3>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 h-7 text-xs">
            <RefreshCw className="w-3 h-3" /> Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.orders?.length ? (
          <div className="py-12 text-center">
            <ArrowRight className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No orders found on TopUpGH</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-[11px] text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-2.5 text-left font-semibold">TG Order ID</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Status</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Total (GH₵)</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map(o => (
                    <tr key={o.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-foreground font-semibold">{o.id}</td>
                      <td className="px-4 py-2.5 text-center"><StatusBadge status={o.status} /></td>
                      <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                        {typeof o.total === "number" ? o.total.toFixed(2) : o.total}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">{o.date_created}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.pagination && data.pagination.total_pages > 1 && (
              <div className="px-4 py-3 border-t border-border flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Page {data.pagination.current_page} of {data.pagination.total_pages} ({data.pagination.total} total)
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="h-7 text-xs">Prev</Button>
                  <Button variant="outline" size="sm" disabled={page >= data.pagination.total_pages} onClick={() => setPage(p => p + 1)} className="h-7 text-xs">Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function AdminTopupghContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("queue");
  const { toast } = useToast();

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ["adminSettings"],
    queryFn: () => fetch("/api/admin/settings", { credentials: "include" }).then(r => r.json()),
  });

  const topupghEnabled = settings?.topupgh_enabled === "true";

  const { data: balanceData, isLoading: balanceLoading, refetch: refetchBalance } = useQuery<BalanceData>({
    queryKey: ["topupgh-balance"],
    queryFn: () =>
      fetch("/api/admin/topupgh/balance", { credentials: "include" }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error((d as { error?: string }).error ?? `HTTP ${r.status}`);
        return d;
      }),
    enabled: topupghEnabled,
    refetchInterval: topupghEnabled ? 60_000 : false,
    retry: false,
  });

  const { mutate: testConnection, isPending: testing } = useMutation({
    mutationFn: () =>
      fetch("/api/admin/topupgh/test", { credentials: "include" }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error((d as { error?: string }).error ?? `HTTP ${r.status}`);
        return d as { success: boolean; message: string; user_id?: number };
      }),
    onSuccess: d => toast({ title: d.success ? `Connected ✓ — ${d.message}` : `Test failed: ${d.message}` }),
    onError:   e => toast({ title: e instanceof Error ? e.message : "Connection test failed", variant: "destructive" }),
  });

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-auto">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-6 py-4 flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                <Package2 className="w-5 h-5 text-orange-500" /> TopUpGH Management
              </h1>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${topupghEnabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                {topupghEnabled ? "ENABLED" : "DISABLED"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Batch MTN order fulfillment via TopUpGH Reseller API</p>
          </div>
          <AdminFinancialSummary />
          <div className="flex items-center gap-2 flex-wrap">
            {/* Live balance */}
            {topupghEnabled && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card border border-border">
                <Wifi className="w-3.5 h-3.5 text-orange-500" />
                {balanceLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                ) : balanceData?.success ? (
                  <div className="text-right">
                    <div className="text-sm font-bold text-foreground">GH₵{balanceData.balance.toFixed(2)}</div>
                    <div className="text-[10px] text-muted-foreground">TG Wallet</div>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">Balance unavailable</span>
                )}
                <button onClick={() => refetchBalance()} className="p-0.5 hover:text-foreground text-muted-foreground transition-colors">
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => testConnection()}
              disabled={testing}
              className="gap-1.5 h-8 text-xs"
            >
              {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              Test Connection
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6 space-y-5 max-w-6xl mx-auto w-full">

          {/* Disabled notice */}
          {!topupghEnabled && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">TopUpGH is disabled</p>
                <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                  Go to <a href="/admin/settings" className="underline font-medium">Settings → TopUpGH</a> to enable it and configure your API credentials.
                </p>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-muted/40 rounded-xl w-fit border border-border">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === t.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === "queue"     && <QueueTab />}
          {activeTab === "products"  && <ProductsTab />}
          {activeTab === "batches"   && <BatchesTab />}
          {activeTab === "reconcile" && <ReconcileTab />}
        </main>
      </div>
    </div>
  );
}
