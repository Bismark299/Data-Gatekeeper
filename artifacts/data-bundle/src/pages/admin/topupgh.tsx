import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { AdminFinancialSummary } from "@/components/AdminFinancialSummary";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Menu, RefreshCw, Loader2, Package2, Zap, CheckCircle2, AlertCircle,
  Clock, Send, Wifi, Info, ChevronDown, ChevronUp, AlertTriangle,
  BarChart3, ArrowRight, Search, Hash, Phone, Filter, X,
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

interface DeliveryInfo { status: string; date: string; time: string }

interface BatchOrder {
  id: number; phone: string; bundleName: string; bundleData: string;
  price: number; status: string; createdAt: string;
  delivery?: DeliveryInfo | null;
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

type Tab = "queue" | "batches" | "reconcile" | "search";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "queue",     label: "Queue",     icon: Clock },
  { id: "batches",   label: "Batches",   icon: BarChart3 },
  { id: "reconcile", label: "Reconcile", icon: ArrowRight },
  { id: "search",    label: "Search",    icon: Search },
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

// ─── Batches Tab ──────────────────────────────────────────────────────────────

interface CheckDeliveryResponse {
  success: boolean;
  summary: { itemCount: number; delivered: number; failed: number; pending: number; unknown: number };
  batchStatus: string;
}

/**
 * Per-batch "Check delivery status" button. Calls the live TopUpGH delivery-status +
 * auto-settle endpoint for one batch, then refreshes the batch list and detail.
 * `compact` renders an icon-only button for the batch-row table cell.
 */
function CheckDeliveryButton({ batchId, compact = false }: { batchId: number; compact?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      fetch(`/api/admin/topupgh/batches/${batchId}/check-delivery`, {
        method: "POST",
        credentials: "include",
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Delivery check failed");
        return d as CheckDeliveryResponse;
      }),
    onSuccess: d => {
      const s = d.summary;
      if (s.itemCount === 0) {
        toast({
          title: "No delivery update yet",
          description: "TopUpGH has no new status for this batch. It allows 1 check per minute (shared with the auto-checker) — try again shortly.",
        });
      } else {
        const parts: string[] = [];
        if (s.delivered) parts.push(`${s.delivered} delivered`);
        if (s.failed)    parts.push(`${s.failed} failed`);
        if (s.pending)   parts.push(`${s.pending} pending`);
        if (s.unknown)   parts.push(`${s.unknown} unknown`);
        toast({
          title: `Checked ${s.itemCount} recipient${s.itemCount === 1 ? "" : "s"} — batch ${d.batchStatus}`,
          description: parts.join(", "),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["topupgh-batch", batchId] });
      queryClient.invalidateQueries({ queryKey: ["topupgh-batches"] });
    },
    onError: (e: unknown) =>
      toast({ title: e instanceof Error ? e.message : "Delivery check failed", variant: "destructive" }),
  });

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={(e) => { e.stopPropagation(); mutation.mutate(); }}
      disabled={mutation.isPending}
      title="Check delivery status"
      className={compact ? "h-7 w-7 p-0" : "gap-1.5 h-7 text-xs"}
    >
      {mutation.isPending
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : <RefreshCw className="w-3 h-3" />}
      {!compact && "Check delivery status"}
    </Button>
  );
}

interface CompleteBatchResponse {
  success: boolean; batchId: number; completed: number; batchStatus: string; note: string;
}

/**
 * Per-batch "Complete" button — a manual override for when TopUpGH never confirms delivery
 * but the admin has verified it on the TopUpGH dashboard. Force-completes every still-open
 * order in the batch on the admin's attestation (no TopUpGH call). The backend reuses the
 * canonical, idempotent settle path, so already completed/failed orders are never touched
 * and store profit is never double-credited. Gated behind a confirmation dialog.
 */
function CompleteBatchButton({ batchId, compact = false }: { batchId: number; compact?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      fetch(`/api/admin/topupgh/batches/${batchId}/complete`, {
        method: "POST",
        credentials: "include",
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Complete failed");
        return d as CompleteBatchResponse;
      }),
    onSuccess: d => {
      toast({
        title: d.completed > 0
          ? `Batch #${batchId} completed — ${d.completed} order${d.completed === 1 ? "" : "s"} settled`
          : `Nothing to complete in batch #${batchId}`,
        description: d.note,
      });
      queryClient.invalidateQueries({ queryKey: ["topupgh-batch", batchId] });
      queryClient.invalidateQueries({ queryKey: ["topupgh-batches"] });
      queryClient.invalidateQueries({ queryKey: ["topupgh-all-orders"] });
      setOpen(false);
    },
    onError: (e: unknown) => {
      toast({ title: e instanceof Error ? e.message : "Complete failed", variant: "destructive" });
      setOpen(false);
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!mutation.isPending) setOpen(o); }}>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => e.stopPropagation()}
          disabled={mutation.isPending}
          title="Manually complete this batch (admin attestation)"
          className={compact
            ? "h-7 w-7 p-0 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:border-emerald-400 hover:text-emerald-700"
            : "gap-1.5 h-7 text-xs text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:border-emerald-400"}
        >
          {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
          {!compact && "Complete"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Force-complete batch #{batchId}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                This marks every still-open order in this batch as{" "}
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">delivered / completed</span>{" "}
                without asking TopUpGH — it settles on <span className="font-semibold">your attestation</span> that
                the bundles actually reached the customers. Any linked agent-store orders will have their profit credited.
              </p>
              <p className="text-amber-600 dark:text-amber-400 font-medium">
                Only do this after confirming delivery on the TopUpGH dashboard. Orders already completed or failed are
                left untouched — nothing is double-credited.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); mutation.mutate(); }}
            disabled={mutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {mutation.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Completing…</>
              : "Yes, complete batch"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="text-[11px] text-muted-foreground">
          Live status reflects TopUpGH's latest report. Delivered orders auto-complete. (1 check/min)
        </span>
        <CheckDeliveryButton batchId={batchId} />
      </div>
      <div className="rounded-xl overflow-hidden border border-border/60">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/40 text-[10px] text-muted-foreground uppercase tracking-wide border-b border-border">
              <th className="px-3 py-2 text-left font-semibold">Order</th>
              <th className="px-3 py-2 text-left font-semibold">Phone</th>
              <th className="px-3 py-2 text-left font-semibold">Bundle</th>
              <th className="px-3 py-2 text-right font-semibold">Price</th>
              <th className="px-3 py-2 text-right font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Delivered</th>
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
                <td className="px-3 py-2 text-right">
                  {o.delivery && (o.delivery.date || o.delivery.time || o.delivery.status) ? (
                    <div className="flex flex-col items-end gap-0.5">
                      {o.delivery.status && <LiveStatusBadge status={o.delivery.status} />}
                      {(o.delivery.date || o.delivery.time) && (
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {[o.delivery.date, o.delivery.time].filter(Boolean).join(" ")}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
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
  const [dateFrom, setDateFrom]         = useState("");
  const [dateTo, setDateTo]             = useState("");
  const [phoneFilter, setPhoneFilter]   = useState("");
  const [phoneInput, setPhoneInput]     = useState("");
  const [page, setPage]                 = useState(1);
  const [expandedId, setExpandedId]     = useState<number | null>(null);

  const hasDateOrPhone = dateFrom || dateTo || phoneFilter;

  const applyPhone = () => {
    setPhoneFilter(phoneInput.trim());
    setPage(1);
  };

  const clearAll = () => {
    setStatusFilter(""); setDateFrom(""); setDateTo("");
    setPhoneFilter(""); setPhoneInput(""); setPage(1);
  };

  const { data, isLoading, refetch } = useQuery<BatchesData>({
    queryKey: ["topupgh-batches", page, statusFilter, dateFrom, dateTo, phoneFilter],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (statusFilter) p.set("status", statusFilter);
      if (dateFrom)     p.set("from", dateFrom);
      if (dateTo)       p.set("to", dateTo);
      if (phoneFilter)  p.set("phone", phoneFilter);
      return fetch(`/api/admin/topupgh/batches?${p}`, { credentials: "include" }).then(r => r.json());
    },
  });

  const statuses = ["", "processing", "completed", "partial", "failed", "pending"];

  return (
    <div className="space-y-5">
      {/* Status filter pills */}
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

      {/* Date + phone filters */}
      <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Filters</span>
          {hasDateOrPhone && (
            <button
              onClick={clearAll}
              className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          {/* Date from */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-muted-foreground">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {/* Date to */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-muted-foreground">To</label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={e => { setDateTo(e.target.value); setPage(1); }}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {/* Phone number */}
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label className="text-[11px] font-semibold text-muted-foreground">Phone Number</label>
            <div className="flex gap-1.5">
              <Input
                placeholder="e.g. 0241234567"
                value={phoneInput}
                onChange={e => setPhoneInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && applyPhone()}
                className="h-8 text-xs font-mono"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={applyPhone}
                disabled={!phoneInput.trim()}
                className="h-8 px-3 text-xs gap-1"
              >
                <Search className="w-3 h-3" />
              </Button>
              {phoneFilter && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setPhoneFilter(""); setPhoneInput(""); setPage(1); }}
                  className="h-8 px-2 text-xs text-muted-foreground"
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>
        </div>
        {/* Active filter badges */}
        {hasDateOrPhone && (
          <div className="flex items-center gap-2 flex-wrap pt-0.5">
            <span className="text-[11px] text-muted-foreground">Active:</span>
            {dateFrom && <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">From {dateFrom}</span>}
            {dateTo   && <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">To {dateTo}</span>}
            {phoneFilter && <span className="text-[11px] bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400 px-2 py-0.5 rounded-full font-mono font-medium">{phoneFilter}</span>}
          </div>
        )}
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
                          <div className="flex items-center justify-center gap-1.5">
                            {b.topupghOrderId && <CheckDeliveryButton batchId={b.id} compact />}
                            {b.topupghOrderId && b.status === "processing" && <CompleteBatchButton batchId={b.id} compact />}
                            {expandedId === b.id
                              ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                              : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                          </div>
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

interface RangeReconcileResult {
  batchId: number; topupghOrderId: number | null; orderLevelStatus: string;
  httpStatus: number | null; confirmed: boolean; completed: number;
  batchStatus: string; note: string;
}
interface RangeReconcileResponse {
  success: boolean; range: { minOrderId: number; maxOrderId: number }; force: boolean;
  batchesScanned: number; batchesCompleted: number; ordersCompleted: number;
  results: RangeReconcileResult[];
}

function RangeReconcilePanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [minId, setMinId] = useState("");
  const [maxId, setMaxId] = useState("");
  const [force, setForce] = useState(false);
  const [report, setReport] = useState<RangeReconcileResponse | null>(null);

  const { mutate: run, isPending } = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/topupgh/reconcile-range", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minOrderId: Number(minId), maxOrderId: Number(maxId), force }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      return d as RangeReconcileResponse;
    },
    onSuccess: (d) => {
      setReport(d);
      toast({ title: `Reconcile done — ${d.batchesCompleted}/${d.batchesScanned} batches completed, ${d.ordersCompleted} orders settled` });
      queryClient.invalidateQueries({ queryKey: ["topupgh-batches"] });
      queryClient.invalidateQueries({ queryKey: ["topupgh-all-orders"] });
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "Reconcile failed", variant: "destructive" }),
  });

  const valid = Number(minId) > 0 && Number(maxId) >= Number(minId);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-orange-500" /> Complete stuck range
        </h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          For batches stuck in <span className="font-semibold">processing</span> whose TopUpGH order id falls in this range,
          confirm delivery via TopUpGH order-level status and complete them (credits agent profit). Tick <span className="font-semibold">Force</span>
          only when TopUpGH's API doesn't report but you've verified delivery on the TopUpGH dashboard.
        </p>
      </div>
      <div className="p-5 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Min TG order id</label>
            <input
              type="number" value={minId} onChange={(e) => setMinId(e.target.value)} placeholder="1921879"
              className="w-36 px-3 py-1.5 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-orange-500/40"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Max TG order id</label>
            <input
              type="number" value={maxId} onChange={(e) => setMaxId(e.target.value)} placeholder="1922140"
              className="w-36 px-3 py-1.5 text-sm rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-orange-500/40"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-foreground select-none cursor-pointer pb-2">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="accent-orange-500" />
            Force (admin attestation)
          </label>
          <Button onClick={() => run()} disabled={!valid || isPending} size="sm" className="gap-1.5 h-8 text-xs pb-0">
            {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            {force ? "Force complete range" : "Check & complete range"}
          </Button>
        </div>

        {force && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Force skips the TopUpGH delivery check and marks every open order in range as delivered, crediting agent profit.
              Only use after confirming delivery on the TopUpGH dashboard.
            </p>
          </div>
        )}

        {report && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Scanned <span className="font-semibold text-foreground">{report.batchesScanned}</span> · completed{" "}
              <span className="font-semibold text-emerald-600">{report.batchesCompleted}</span> batches ·{" "}
              <span className="font-semibold text-foreground">{report.ordersCompleted}</span> orders settled
            </div>
            {report.results.length > 0 && (
              <div className="overflow-x-auto border border-border rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-[10px] text-muted-foreground uppercase tracking-wide">
                      <th className="px-3 py-2 text-left font-semibold">Batch</th>
                      <th className="px-3 py-2 text-left font-semibold">TG order</th>
                      <th className="px-3 py-2 text-left font-semibold">Order-level</th>
                      <th className="px-3 py-2 text-left font-semibold">Final</th>
                      <th className="px-3 py-2 text-left font-semibold">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.results.map((r) => (
                      <tr key={r.batchId} className="border-b border-border/50">
                        <td className="px-3 py-2 font-mono">#{r.batchId}</td>
                        <td className="px-3 py-2 font-mono text-orange-500">{r.topupghOrderId ?? "—"}</td>
                        <td className="px-3 py-2">{r.orderLevelStatus || (r.confirmed ? "forced" : "—")}</td>
                        <td className="px-3 py-2"><StatusBadge status={r.batchStatus} /></td>
                        <td className="px-3 py-2 text-muted-foreground">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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

      <RangeReconcilePanel />

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

// ─── Search Tab ───────────────────────────────────────────────────────────────

type SearchMode = "order" | "phones";

interface PhoneResult {
  orderId: number; phone: string; bundleName: string; bundleData: string;
  price: number; localStatus: string; batchId: number; topupghOrderId: number | null;
  batchStatus: string; dispatchedAt: string | null; createdAt: string;
  liveDelivery: { status: string; date: string; time: string } | null;
}

interface OrderSearchResult {
  mode: "order"; topupghOrderId: number; batch: Batch | null;
  delivery: { success: boolean; order_id: number; delivery_status: Record<string, { delivery_status?: string; delivery_date?: string; delivery_time?: string }> };
  localOrders: { id: number; phone: string; bundleName: string; status: string; createdAt: string }[];
  liveSkipped?: boolean; liveNotFound?: boolean; message?: string | null;
}

interface PhonesSearchResult {
  mode: "phones"; phones: string[]; results: PhoneResult[];
  notFound: string[]; apiCallsMade: number; truncated: boolean; message: string | null;
}

type SearchResult = OrderSearchResult | PhonesSearchResult;

const LIVE_STATUS_COLORS: Record<string, string> = {
  delivered:     "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed:        "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  "not delivered": "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  unsuccessful:  "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  pending:       "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
  processing:    "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  unknown:       "bg-muted text-muted-foreground",
};

function LiveStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${LIVE_STATUS_COLORS[s] ?? LIVE_STATUS_COLORS.unknown}`}>
      {status}
    </span>
  );
}

function SearchTab() {
  const [mode, setMode] = useState<SearchMode>("phones");
  const [orderIdInput, setOrderIdInput] = useState("");
  const [phonesInput, setPhonesInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const parsePhones = (raw: string) =>
    raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);

  const doSearch = async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      let body: object;
      if (mode === "order") {
        const id = parseInt(orderIdInput.trim(), 10);
        if (isNaN(id)) { setError("Enter a valid TopUpGH order ID (number)"); setLoading(false); return; }
        body = { topupghOrderId: id };
      } else {
        const phones = parsePhones(phonesInput);
        if (phones.length === 0) { setError("Enter at least one phone number"); setLoading(false); return; }
        body = { phones };
      }

      const res = await fetch("/api/admin/topupgh/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json() as SearchResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Search failed";
      setError(msg);
      toast({ title: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Mode + input */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-orange-500" />
          <h3 className="text-sm font-semibold text-foreground">Delivery Status Lookup</h3>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 p-1 bg-muted/40 rounded-xl w-fit border border-border">
          {([
            { id: "phones" as SearchMode, label: "By Phone Number(s)", icon: Phone },
            { id: "order"  as SearchMode, label: "By TopUpGH Order ID", icon: Hash },
          ] as const).map(m => (
            <button
              key={m.id}
              onClick={() => { setMode(m.id); setResult(null); setError(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                mode === m.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <m.icon className="w-3.5 h-3.5" />
              {m.label}
            </button>
          ))}
        </div>

        {/* Input area */}
        {mode === "order" ? (
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">TopUpGH Order ID</label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. 1448326"
                value={orderIdInput}
                onChange={e => setOrderIdInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch()}
                className="h-9 text-sm max-w-xs font-mono"
              />
              <Button size="sm" onClick={doSearch} disabled={loading} className="h-9 gap-1.5 bg-orange-500 hover:bg-orange-600 text-white">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Search
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">This calls TopUpGH's delivery-status API directly (1 req/min limit)</p>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground">Phone Numbers</label>
              <span className="text-[11px] text-muted-foreground">{parsePhones(phonesInput).length} number{parsePhones(phonesInput).length !== 1 ? "s" : ""}</span>
            </div>
            <textarea
              placeholder={"0241234567\n0551234567\n0201234567\n\nOr paste comma-separated: 0241234567, 0551234567"}
              value={phonesInput}
              onChange={e => setPhonesInput(e.target.value)}
              rows={5}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-mono resize-y placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">One phone per line, or comma-separated. Up to 100 numbers. Results span max 5 batches per search.</p>
              <Button size="sm" onClick={doSearch} disabled={loading} className="h-8 gap-1.5 bg-orange-500 hover:bg-orange-600 text-white">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Search
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Results */}
      {result && result.mode === "order" && (
        <div className="space-y-4">
          {/* Notice: rate-limit fallback, order-not-found, or no-data-yet */}
          {result.message && (
            <div className={`flex items-start gap-2 px-3 py-2 rounded-xl border ${
              result.liveNotFound
                ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800"
                : "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800"
            }`}>
              <AlertTriangle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${result.liveNotFound ? "text-red-500" : "text-amber-500"}`} />
              <p className={`text-[11px] ${result.liveNotFound ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>{result.message}</p>
            </div>
          )}
          {/* Batch summary */}
          {result.batch && (
            <div className="bg-card border border-border rounded-2xl p-4 flex flex-wrap gap-4 text-sm">
              <div><span className="text-muted-foreground text-xs">Batch #</span><div className="font-bold">{result.batch.id}</div></div>
              <div><span className="text-muted-foreground text-xs">TopUpGH Order</span><div className="font-mono font-bold">#{result.topupghOrderId}</div></div>
              <div><span className="text-muted-foreground text-xs">Batch Status</span><div className="mt-0.5"><StatusBadge status={result.batch.status} /></div></div>
              <div><span className="text-muted-foreground text-xs">Items</span><div className="font-bold">{result.batch.itemCount}</div></div>
              {result.batch.dispatchedAt && <div><span className="text-muted-foreground text-xs">Dispatched</span><div className="font-medium text-xs">{fmt(result.batch.dispatchedAt)}</div></div>}
            </div>
          )}

          {/* Delivery status table */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Live Delivery Status</h3>
              <span className="text-xs text-muted-foreground">{Object.keys(result.delivery.delivery_status ?? {}).length} items</span>
            </div>
            {Object.keys(result.delivery.delivery_status ?? {}).length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No delivery data returned</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-[11px] text-muted-foreground uppercase tracking-wide">
                      <th className="px-4 py-2.5 text-left font-semibold">Phone</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Local Status</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Live Status</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Bundle</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Date / Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.delivery.delivery_status).map(([phone, info], i) => {
                      const localOrder = result.localOrders.find(o => o.phone === phone);
                      return (
                        <tr key={phone} className={`border-b border-border/50 hover:bg-muted/20 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                          <td className="px-4 py-2.5 font-mono font-medium text-foreground text-xs">{phone}</td>
                          <td className="px-4 py-2.5"><StatusBadge status={localOrder?.status ?? "—"} /></td>
                          <td className="px-4 py-2.5"><LiveStatusBadge status={info.delivery_status ?? "unknown"} /></td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{localOrder?.bundleName ?? "—"}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {info.delivery_date ? `${info.delivery_date} ${info.delivery_time ?? ""}`.trim() : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {result && result.mode === "phones" && (
        <div className="space-y-4">
          {/* Summary row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Searched",    value: String(result.phones.length),      icon: Phone,        color: "text-blue-500" },
              { label: "Found",       value: String(result.results.length),      icon: CheckCircle2, color: "text-emerald-500" },
              { label: "Not Found",   value: String(result.notFound.length),     icon: AlertCircle,  color: result.notFound.length > 0 ? "text-red-500" : "text-muted-foreground" },
              { label: "API Calls",   value: String(result.apiCallsMade),        icon: Zap,          color: "text-orange-500" },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border rounded-2xl p-3 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center shrink-0">
                  <s.icon className={`w-4 h-4 ${s.color}`} />
                </div>
                <div>
                  <div className="text-lg font-bold text-foreground">{s.value}</div>
                  <div className="text-[10px] text-muted-foreground font-medium">{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Rate-limit warning */}
          {result.truncated && result.message && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 dark:text-amber-400">{result.message}</p>
            </div>
          )}

          {/* Not found notice */}
          {result.notFound.length > 0 && (
            <div className="px-4 py-3 rounded-xl bg-muted/40 border border-border">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Not found in TopUpGH orders ({result.notFound.length})</p>
              <p className="text-[11px] text-muted-foreground font-mono">{result.notFound.join(", ")}</p>
            </div>
          )}

          {/* Results table */}
          {result.results.length > 0 && (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">{result.results.length} result{result.results.length !== 1 ? "s" : ""}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-[11px] text-muted-foreground uppercase tracking-wide">
                      <th className="px-4 py-2.5 text-left font-semibold">Phone</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Bundle</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Local</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Live Delivery</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Delivery Date</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Batch / TG Order</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((r, i) => (
                      <tr key={`${r.orderId}-${i}`} className={`border-b border-border/50 hover:bg-muted/20 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                        <td className="px-4 py-2.5 font-mono font-medium text-foreground text-xs">{r.phone}</td>
                        <td className="px-4 py-2.5">
                          <div className="text-xs font-medium text-foreground">{r.bundleName}</div>
                          <div className="text-[11px] text-muted-foreground">{r.bundleData}</div>
                        </td>
                        <td className="px-4 py-2.5"><StatusBadge status={r.localStatus} /></td>
                        <td className="px-4 py-2.5">
                          {r.liveDelivery ? <LiveStatusBadge status={r.liveDelivery.status} /> : <span className="text-[10px] text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {r.liveDelivery?.date ? `${r.liveDelivery.date} ${r.liveDelivery.time ?? ""}`.trim() : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          <span className="font-mono">#{r.batchId}</span>
                          {r.topupghOrderId && <span className="text-[11px] ml-1 text-orange-500">TG#{r.topupghOrderId}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-foreground text-xs">GH₵{r.price.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.results.length === 0 && result.message && (
            <div className="py-10 text-center">
              <Search className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{result.message}</p>
            </div>
          )}
        </div>
      )}
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
          {activeTab === "batches"   && <BatchesTab />}
          {activeTab === "reconcile" && <ReconcileTab />}
          {activeTab === "search"    && <SearchTab />}
        </main>
      </div>
    </div>
  );
}
