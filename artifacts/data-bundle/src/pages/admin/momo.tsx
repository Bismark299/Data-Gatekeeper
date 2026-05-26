import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Menu, CheckCircle2, Clock, HelpCircle, Wallet, Search,
  ChevronLeft, ChevronRight, UserCheck, RefreshCw, Ban,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MomoDeposit {
  id: number;
  userId: number | null;
  txId: string;
  amount: number;
  status: string;
  sender: string;
  agentCode: string | null;
  userName: string | null;
  userEmail: string | null;
  depositCode: string | null;
  note: string | null;
  createdAt: string;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
  depositCode: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  unmatched: "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  pending:   "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  rejected:  "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  voided:    "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
};

const statusIcon = (s: string) => {
  if (s === "completed") return <CheckCircle2 className="w-3 h-3" />;
  if (s === "unmatched") return <HelpCircle className="w-3 h-3" />;
  if (s === "voided") return <Ban className="w-3 h-3" />;
  return <Clock className="w-3 h-3" />;
};

type DatePreset = "today" | "yesterday" | "week" | "month" | "all";

function getPresetRange(preset: DatePreset): { from: Date | null; to: Date | null } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (preset === "today") return { from: startOfDay(now), to: null };
  if (preset === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return { from: startOfDay(y), to: startOfDay(now) };
  }
  if (preset === "week") {
    const w = new Date(now); w.setDate(w.getDate() - 7);
    return { from: startOfDay(w), to: null };
  }
  if (preset === "month") {
    const m = new Date(now); m.setDate(1); m.setHours(0, 0, 0, 0);
    return { from: m, to: null };
  }
  return { from: null, to: null };
}

const PAGE_SIZE = 20;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminMomoPage() {
  return <ProtectedRoute adminOnly><AdminMomoContent /></ProtectedRoute>;
}

function AdminMomoContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [preset, setPreset]           = useState<DatePreset>("all");
  const [dateFrom, setDateFrom]       = useState("");
  const [dateTo, setDateTo]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch]           = useState("");
  const [page, setPage]               = useState(1);

  // Assign dialog
  const [assignTarget, setAssignTarget] = useState<MomoDeposit | null>(null);
  const [assignUserId, setAssignUserId] = useState("");
  const [userSearch, setUserSearch]     = useState("");

  // Claim (void) confirmation
  const [claimTarget, setClaimTarget] = useState<MomoDeposit | null>(null);

  // Reverse confirmation
  const [reverseTarget, setReverseTarget] = useState<MomoDeposit | null>(null);

  const { toast }   = useToast();
  const queryClient = useQueryClient();

  // Fetch momo deposits
  const { data: deposits = [], isLoading, refetch } = useQuery<MomoDeposit[]>({
    queryKey: ["admin-momo-deposits"],
    queryFn: async () => {
      const r = await fetch("/api/admin/momo-deposits", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json() as Promise<MomoDeposit[]>;
    },
  });

  // Fetch users for assign dialog
  const { data: users = [] } = useQuery<UserRow[]>({
    queryKey: ["admin-users-list"],
    queryFn: async () => {
      const r = await fetch("/api/admin/users", { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<UserRow[]>;
    },
    enabled: !!assignTarget,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ depositId, userId }: { depositId: number; userId: number }) => {
      const r = await fetch(`/api/admin/momo-deposits/${depositId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId }),
      });
      const d = await r.json() as { success?: boolean; message?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Failed");
      return d;
    },
    onSuccess: (d) => {
      toast({ title: "Credited", description: d.message });
      queryClient.invalidateQueries({ queryKey: ["admin-momo-deposits"] });
      setAssignTarget(null);
      setAssignUserId("");
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const reverseMutation = useMutation({
    mutationFn: async (depositId: number) => {
      const r = await fetch(`/api/admin/momo-deposits/${depositId}/reverse`, {
        method: "POST",
        credentials: "include",
      });
      const d = await r.json() as { success?: boolean; message?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Failed");
      return d;
    },
    onSuccess: (d) => {
      toast({ title: "Reversed", description: d.message });
      queryClient.invalidateQueries({ queryKey: ["admin-momo-deposits"] });
      setReverseTarget(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const claimMutation = useMutation({
    mutationFn: async (depositId: number) => {
      const r = await fetch(`/api/admin/momo-deposits/${depositId}/void`, {
        method: "POST",
        credentials: "include",
      });
      const d = await r.json() as { success?: boolean; message?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Failed");
      return d;
    },
    onSuccess: (d) => {
      toast({ title: "Transaction claimed", description: d.message ?? "No user can claim this transaction." });
      queryClient.invalidateQueries({ queryKey: ["admin-momo-deposits"] });
      setClaimTarget(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // ── Filtering ────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const { from: presetFrom, to: presetTo } = getPresetRange(preset);
    const from = dateFrom ? new Date(dateFrom) : presetFrom;
    const to   = dateTo   ? (() => { const d = new Date(dateTo); d.setHours(23, 59, 59, 999); return d; })() : presetTo;
    const q    = search.toLowerCase();

    return deposits.filter(d => {
      const date = new Date(d.createdAt);
      if (from && date < from) return false;
      if (to   && date > to)   return false;
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (q && !(
        d.txId.toLowerCase().includes(q) ||
        (d.sender ?? "").toLowerCase().includes(q) ||
        (d.userName ?? "").toLowerCase().includes(q) ||
        (d.agentCode ?? "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [deposits, preset, dateFrom, dateTo, statusFilter, search]);

  // ── Stats ────────────────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total:     filtered.length,
    credited:  filtered.filter(d => d.status === "completed").length,
    unmatched: filtered.filter(d => d.status === "unmatched").length,
    amount:    filtered.reduce((s, d) => s + d.amount, 0),
  }), [filtered]);

  // ── Pagination ───────────────────────────────────────────────────────────────

  const totalPages   = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedRows    = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const setPresetAndClear = (p: DatePreset) => {
    setPreset(p); setDateFrom(""); setDateTo(""); setPage(1);
  };

  // ── Assign dialog users ───────────────────────────────────────────────────────

  const filteredUsers = useMemo(() =>
    users.filter(u => {
      if (!userSearch) return true;
      const q = userSearch.toLowerCase();
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) ||
             (u.depositCode ?? "").toLowerCase().includes(q);
    }).slice(0, 50)
  , [users, userSearch]);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 sm:px-6 py-4 flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-1.5 rounded-lg hover:bg-muted">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">MoMo Transactions</h1>
            <p className="text-xs text-muted-foreground">SMS-received MoMo deposits via Android listener</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Refresh
          </Button>
        </header>

        <main className="flex-1 px-4 sm:px-6 py-6 space-y-5">

          {/* ── Stats ────────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Total Deposits", value: stats.total,     color: "border-l-blue-500",    icon: <Wallet className="w-5 h-5 text-blue-500" /> },
              { label: "Credited",       value: stats.credited,  color: "border-l-emerald-500", icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" /> },
              { label: "Unmatched",      value: stats.unmatched, color: "border-l-amber-500",   icon: <HelpCircle className="w-5 h-5 text-amber-500" /> },
              { label: "Total Amount",   value: `GH₵${stats.amount.toFixed(2)}`, color: "border-l-purple-500", icon: <Wallet className="w-5 h-5 text-purple-500" /> },
            ].map(s => (
              <div key={s.label} className={`bg-card rounded-xl border border-border border-l-4 ${s.color} px-5 py-4 flex items-center gap-4`}>
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">{s.icon}</div>
                <div>
                  <div className="text-xs text-muted-foreground font-medium">{s.label}</div>
                  <div className="text-2xl font-bold text-foreground mt-0.5">{s.value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Filters ────────────────────────────────────────────────────────── */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            {/* Date presets */}
            <div className="flex flex-wrap gap-2">
              {(["today", "yesterday", "week", "month", "all"] as DatePreset[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPresetAndClear(p)}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    preset === p && !dateFrom && !dateTo
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:border-primary hover:text-primary"
                  }`}
                >
                  {p === "today" ? "Today" : p === "yesterday" ? "Yesterday" : p === "week" ? "This Week" : p === "month" ? "This Month" : "All Time"}
                </button>
              ))}
            </div>

            {/* Date range + status + search */}
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>From:</span>
                <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPreset("all"); setPage(1); }} className="w-36 h-8 text-xs" />
                <span>To:</span>
                <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPreset("all"); setPage(1); }} className="w-36 h-8 text-xs" />
              </div>
              <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Credited</SelectItem>
                  <SelectItem value="unmatched">Unmatched</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search by transaction ID, phone..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* ── Table ─────────────────────────────────────────────────────────── */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {([["DATE","hidden sm:table-cell"],["TRANSACTION ID","hidden sm:table-cell"],["AMOUNT",""],["SENDER",""],["REFERENCE","hidden sm:table-cell"],["USER","hidden sm:table-cell"],["STATUS",""],["ACTIONS",""]] as [string,string][]).map(([h,cls]) => (
                      <th key={h} className={`text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap ${cls}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    <tr><td colSpan={8} className="text-center py-12 text-muted-foreground text-sm">Loading…</td></tr>
                  ) : pagedRows.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-muted-foreground text-sm">No transactions found</td></tr>
                  ) : pagedRows.map(d => (
                    <tr key={d.id} className="hover:bg-muted/20 transition-colors">
                      <td className="hidden sm:table-cell px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(d.createdAt)}</td>
                      <td className="hidden sm:table-cell px-4 py-3 font-mono font-semibold text-foreground text-xs">{d.txId}</td>
                      <td className="px-4 py-3 font-bold text-emerald-600 whitespace-nowrap">GH₵{d.amount.toFixed(2)}</td>
                      <td className="px-4 py-3 text-foreground text-xs">{d.sender || <span className="text-muted-foreground">—</span>}</td>
                      <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-muted-foreground">{d.agentCode || <span className="text-muted-foreground">—</span>}</td>
                      <td className="hidden sm:table-cell px-4 py-3 text-xs">
                        {d.userName
                          ? <div><div className="font-medium text-foreground">{d.userName}</div><div className="text-muted-foreground">{d.depositCode}</div></div>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_STYLE[d.status] ?? "bg-muted text-muted-foreground"}`}>
                          {statusIcon(d.status)}
                          {d.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {d.status !== "completed" && d.status !== "voided" && d.status !== "reversed" && (
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs gap-1.5"
                              onClick={() => { setAssignTarget(d); setAssignUserId(""); setUserSearch(""); }}
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              Assign
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200 dark:border-red-900/40"
                              onClick={() => setClaimTarget(d)}
                              data-testid={`button-claim-${d.id}`}
                            >
                              <Ban className="w-3.5 h-3.5" />
                              Claim
                            </Button>
                          </div>
                        )}
                        {d.status === "completed" && d.userId != null && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200 dark:border-red-900/40"
                            onClick={() => setReverseTarget(d)}
                            data-testid={`button-reverse-${d.id}`}
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Reverse
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {filtered.length > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
                <span>Page {page} of {totalPages} — {filtered.length} total</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="p-1.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="p-1.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

        </main>
      </div>

      {/* ── Assign Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={!!assignTarget} onOpenChange={open => { if (!open) setAssignTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Deposit to Agent</DialogTitle>
            <DialogDescription>
              Select the agent this MoMo payment belongs to. Their wallet will be credited
              immediately with <strong>GH₵{assignTarget?.amount.toFixed(2)}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Deposit summary */}
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs space-y-1.5">
              <div className="flex justify-between"><span className="text-muted-foreground">Transaction ID</span><span className="font-mono font-semibold">{assignTarget?.txId}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-bold text-emerald-600">GH₵{assignTarget?.amount.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Sender</span><span>{assignTarget?.sender || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Reference Code</span><span className="font-mono">{assignTarget?.agentCode || "—"}</span></div>
            </div>

            {/* User search */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search agent by name, email or code…"
                  value={userSearch}
                  onChange={e => { setUserSearch(e.target.value); setAssignUserId(""); }}
                  className="pl-8 h-9 text-sm"
                  autoFocus
                />
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {filteredUsers.length === 0 ? (
                  <div className="text-center py-4 text-xs text-muted-foreground">No users found</div>
                ) : filteredUsers.map(u => (
                  <button
                    key={u.id}
                    onClick={() => setAssignUserId(String(u.id))}
                    className={`w-full text-left px-3 py-2.5 text-xs hover:bg-muted transition-colors flex items-center justify-between ${assignUserId === String(u.id) ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                  >
                    <div>
                      <div className="font-semibold text-foreground">{u.name}</div>
                      <div className="text-muted-foreground">{u.email}</div>
                    </div>
                    <span className="font-mono text-primary font-semibold">{u.depositCode ?? "—"}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button
              disabled={!assignUserId || assignMutation.isPending}
              onClick={() => {
                if (!assignTarget || !assignUserId) return;
                assignMutation.mutate({ depositId: assignTarget.id, userId: parseInt(assignUserId) });
              }}
            >
              {assignMutation.isPending ? "Crediting…" : "Confirm & Credit Wallet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reverse Confirmation Dialog ──────────────────────────────────────── */}
      <Dialog open={!!reverseTarget} onOpenChange={open => { if (!open) setReverseTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reverse Credit</DialogTitle>
            <DialogDescription>
              This <strong>debits the user's wallet</strong> by the deposit amount and marks the deposit as reversed. Use for duplicate credits or mistaken assignments. Fails if the user has already spent the funds.
            </DialogDescription>
          </DialogHeader>

          {reverseTarget && (
            <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Transaction ID</span><span className="font-mono font-semibold">{reverseTarget.txId}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Amount to debit</span><span className="font-bold text-red-600">−GH₵{reverseTarget.amount.toFixed(2)}</span></div>
              {reverseTarget.userName && <div className="flex justify-between"><span className="text-muted-foreground">From user</span><span className="font-semibold">{reverseTarget.userName}</span></div>}
              {reverseTarget.sender && <div className="flex justify-between"><span className="text-muted-foreground">Original sender</span><span className="font-semibold">{reverseTarget.sender}</span></div>}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReverseTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={reverseMutation.isPending}
              onClick={() => { if (reverseTarget) reverseMutation.mutate(reverseTarget.id); }}
              data-testid="button-confirm-reverse"
            >
              {reverseMutation.isPending ? "Reversing…" : "Confirm Reverse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Claim (Void) Confirmation Dialog ─────────────────────────────────── */}
      <Dialog open={!!claimTarget} onOpenChange={open => { if (!open) setClaimTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Claim Transaction</DialogTitle>
            <DialogDescription>
              This locks the transaction so <strong>no user can claim it</strong>. Use this when the deposit doesn't belong to any user (e.g. wrong number, test transaction, fraudulent claim).
            </DialogDescription>
          </DialogHeader>

          {claimTarget && (
            <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Transaction ID</span><span className="font-mono font-semibold">{claimTarget.txId}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-bold text-emerald-600">GH₵{claimTarget.amount.toFixed(2)}</span></div>
              {claimTarget.sender && <div className="flex justify-between"><span className="text-muted-foreground">Sender</span><span className="font-semibold">{claimTarget.sender}</span></div>}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setClaimTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={claimMutation.isPending}
              onClick={() => { if (claimTarget) claimMutation.mutate(claimTarget.id); }}
              data-testid="button-confirm-claim"
            >
              {claimMutation.isPending ? "Claiming…" : "Confirm Claim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
