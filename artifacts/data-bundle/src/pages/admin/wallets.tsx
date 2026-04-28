import { useState, useMemo, useRef, useEffect, Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { useToast } from "@/hooks/use-toast";
import {
  Menu, Wallet, Search, X, RefreshCw, Download, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, Users, Plus, Minus,
  ChevronDown, ChevronUp, Clock, CreditCard, History,
} from "lucide-react";

interface WalletRow {
  id: number; userId: number; balance: number;
  updatedAt: string | null;
  userName: string; userEmail: string;
  userPhone: string | null; userRole: string;
  totalLoaded: number; totalOrders: number;
}
interface Deposit {
  id: number; amount: number; method: string; reference: string | null;
  status: string; note: string | null; createdAt: string;
}

type SortField = "balance" | "name" | "totalLoaded" | "totalOrders" | "updated";
type SortDir   = "asc" | "desc";
type PageTab   = "wallets" | "transactions";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  pending:   "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  rejected:  "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  admin:     "bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400",
};

const METHOD_LABEL: Record<string, string> = {
  paystack: "Paystack", momo: "MoMo", admin: "Admin", manual: "Manual",
};

const ROLE_COLORS: Record<string, string> = {
  admin:      "bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400",
  user:       "bg-sky-100 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400",
  storeowner: "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });

const fmtDatetime = (iso: string) =>
  new Date(iso).toLocaleString("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });

const PAGE_SIZES = [10, 25, 50, 100];

async function fetchWallets(): Promise<WalletRow[]> {
  const res = await fetch("/api/admin/wallets", { credentials: "include" });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}
async function fetchDeposits(userId: number): Promise<Deposit[]> {
  const res = await fetch(`/api/admin/wallets/${userId}/deposits`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

function SortIcon({ field, active, dir }: { field: SortField; active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="w-3 h-3 opacity-30 ml-1 shrink-0" />;
  return dir === "asc" ? <ArrowUp className="w-3 h-3 ml-1 shrink-0 text-primary" /> : <ArrowDown className="w-3 h-3 ml-1 shrink-0 text-primary" />;
}

function UserAvatar({ name, role }: { name: string; role: string }) {
  const colors = role === "admin"
    ? "bg-violet-500 text-white"
    : role === "storeowner"
    ? "bg-amber-500 text-white"
    : "bg-primary text-primary-foreground";
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${colors}`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ── Top-Up / Debit inline action popup ────────────────────────────────────────
function WalletActionPopup({
  userId, userName, currentBalance, action,
  onClose, onSuccess,
}: {
  userId: number; userName: string; currentBalance: number;
  action: "topup" | "debit";
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote]     = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const isTopUp = action === "topup";
  const preset  = isTopUp ? [5, 10, 20, 50, 100] : [5, 10, 20, 50];

  const handleSubmit = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    if (!isTopUp && val > currentBalance) {
      toast({ title: `Insufficient balance (GH₵${currentBalance.toFixed(2)})`, variant: "destructive" }); return;
    }
    setLoading(true);
    try {
      const endpoint = isTopUp ? "topup" : "debit";
      const res = await fetch(`/api/admin/wallets/${userId}/${endpoint}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: val, note: note || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: json.message });
      onSuccess();
      onClose();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Action failed", variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isTopUp ? "bg-emerald-100 dark:bg-emerald-900/20" : "bg-red-100 dark:bg-red-900/20"}`}>
              {isTopUp ? <Plus className="w-5 h-5 text-emerald-600" /> : <Minus className="w-5 h-5 text-red-600" />}
            </div>
            <div>
              <div className="font-bold text-foreground">{isTopUp ? "Top Up Wallet" : "Debit Wallet"}</div>
              <div className="text-xs text-muted-foreground">{userName}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current balance */}
        <div className="bg-muted/40 rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Current Balance</span>
          <span className="font-bold text-foreground">GH₵{currentBalance.toFixed(2)}</span>
        </div>

        {/* Amount input */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount (GH₵)</label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₵</span>
            <input
              ref={inputRef}
              type="number" min="0.01" step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              placeholder="0.00"
              className="w-full pl-8 pr-4 h-11 rounded-xl border border-border bg-background text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {preset.map(p => (
              <button key={p} onClick={() => setAmount(String(p))}
                className="px-3 py-1 rounded-lg bg-muted hover:bg-muted/80 text-xs font-semibold transition-colors">
                +{p}
              </button>
            ))}
          </div>
        </div>

        {/* Note */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Note (optional)</label>
          <input
            type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder={isTopUp ? "e.g. Manual credit" : "e.g. Reversal"}
            className="w-full px-4 h-9 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-sm font-semibold hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit} disabled={loading || !amount}
            className={`flex-1 h-10 rounded-xl text-white text-sm font-bold transition-colors disabled:opacity-50 ${
              isTopUp ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {loading ? "Processing…" : isTopUp ? "Top Up" : "Debit"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Deposit history panel ──────────────────────────────────────────────────────
function DepositHistory({ userId }: { userId: number }) {
  const { data: deposits, isLoading } = useQuery({
    queryKey: ["admin-deposits", userId],
    queryFn:  () => fetchDeposits(userId),
  });

  if (isLoading) return (
    <div className="p-4 space-y-2">
      {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-8 rounded-lg bg-muted animate-pulse" />)}
    </div>
  );
  if (!deposits?.length) return (
    <div className="py-6 text-center text-xs text-muted-foreground">No deposit history</div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {["Date", "Amount", "Method", "Note", "Reference", "Status"].map(h => (
              <th key={h} className="text-left px-4 py-2 font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deposits.map(d => (
            <tr key={d.id} className="hover:bg-muted/10 transition-colors">
              <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{fmtDate(d.createdAt)}</td>
              <td className="px-4 py-2.5 font-bold text-emerald-600">+GH₵{d.amount.toFixed(2)}</td>
              <td className="px-4 py-2.5">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${STATUS_COLORS[d.method] ?? "bg-muted text-muted-foreground"}`}>
                  {METHOD_LABEL[d.method] ?? d.method}
                </span>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{d.note ?? "—"}</td>
              <td className="px-4 py-2.5 font-mono text-muted-foreground max-w-[120px] truncate">{d.reference ?? "—"}</td>
              <td className="px-4 py-2.5">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${STATUS_COLORS[d.status] ?? ""}`}>{d.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── All-Transactions view ──────────────────────────────────────────────────────
function AllTransactions() {
  const [search, setSearch]   = useState("");
  const [page, setPage]       = useState(1);
  const pageSize = 25;

  const { data: wallets } = useQuery({ queryKey: ["admin-wallets"], queryFn: fetchWallets });

  const userMap = useMemo(() => {
    const m = new Map<number, WalletRow>();
    (wallets ?? []).forEach(w => m.set(w.userId, w));
    return m;
  }, [wallets]);

  // We fetch all deposit records for each wallet — merged & sorted
  // For simplicity, we embed a "recent transactions" approach using
  // each wallet's deposit endpoint; here we use the deposit history
  // endpoint which already returns all records for each user.
  // A dedicated global endpoint would be ideal — for now we show
  // a summary and link to individual user histories.

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center gap-3">
        <History className="w-5 h-5 text-muted-foreground" />
        <div>
          <h3 className="font-bold text-foreground">Transaction History</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Click any wallet row to view individual deposit history</p>
        </div>
      </div>
      <div className="py-12 text-center space-y-3">
        <CreditCard className="w-12 h-12 mx-auto text-muted-foreground/20" />
        <p className="text-sm text-muted-foreground">Select a wallet below to view its full transaction history</p>
      </div>
    </div>
  );
}

export default function AdminWallets() {
  return <ProtectedRoute adminOnly><AdminWalletsContent /></ProtectedRoute>;
}

function AdminWalletsContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tab, setTab]                 = useState<PageTab>("wallets");
  const [search, setSearch]           = useState("");
  const [sortField, setSortField]     = useState<SortField>("balance");
  const [sortDir, setSortDir]         = useState<SortDir>("desc");
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(25);
  const [expandedId, setExpandedId]   = useState<number | null>(null);
  const [popup, setPopup]             = useState<{ userId: number; userName: string; balance: number; action: "topup" | "debit" } | null>(null);

  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: wallets, isLoading, refetch } = useQuery({
    queryKey: ["admin-wallets"],
    queryFn:  fetchWallets,
    refetchInterval: 30000,
  });

  const stats = useMemo(() => {
    const src = wallets ?? [];
    const total   = src.reduce((s, w) => s + w.balance, 0);
    const funded  = src.filter(w => w.balance > 0).length;
    const loaded  = src.reduce((s, w) => s + (w.totalLoaded ?? 0), 0);
    const spent   = src.reduce((s, w) => s + (w.totalOrders ?? 0), 0);
    return { total, funded, loaded, spent, count: src.length };
  }, [wallets]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
    setPage(1);
  };

  const filtered = useMemo(() => {
    let src = wallets ?? [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      src = src.filter(w =>
        w.userName.toLowerCase().includes(q) ||
        w.userEmail.toLowerCase().includes(q) ||
        String(w.userId).includes(q) ||
        (w.userPhone ?? "").includes(q)
      );
    }
    return [...src].sort((a, b) => {
      let diff = 0;
      if (sortField === "balance")     diff = a.balance - b.balance;
      if (sortField === "totalLoaded") diff = (a.totalLoaded ?? 0) - (b.totalLoaded ?? 0);
      if (sortField === "totalOrders") diff = (a.totalOrders ?? 0) - (b.totalOrders ?? 0);
      if (sortField === "name")        diff = a.userName.localeCompare(b.userName);
      if (sortField === "updated")     diff = new Date(a.updatedAt ?? 0).getTime() - new Date(b.updatedAt ?? 0).getTime();
      return sortDir === "asc" ? diff : -diff;
    });
  }, [wallets, search, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged      = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  const handleExport = () => {
    const header = ["User ID", "Name", "Email", "Phone", "Role", "Balance (GH₵)", "Total Loaded (GH₵)", "Total Orders (GH₵)", "Last Updated"];
    const rows   = filtered.map(w => [
      w.userId, `"${w.userName}"`, w.userEmail, w.userPhone ?? "", w.userRole,
      w.balance.toFixed(2), w.totalLoaded.toFixed(2), w.totalOrders.toFixed(2),
      w.updatedAt ? fmtDate(w.updatedAt) : "",
    ]);
    const csv = [header.join(","), ...rows.map(r => r.join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `wallets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const openPopup = (w: WalletRow, action: "topup" | "debit") => {
    setPopup({ userId: w.userId, userName: w.userName, balance: w.balance, action });
  };

  const handleSuccess = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ["admin-deposits"] });
  };

  const STAT_CARDS = [
    { label: "Total Users",      value: stats.count,                       icon: Users,     color: "text-sky-600",     bg: "bg-sky-100 dark:bg-sky-900/20" },
    { label: "Total Balance",    value: `GH₵${stats.total.toFixed(2)}`,    icon: Wallet,    color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/20" },
    { label: "Total Funded",     value: stats.funded,                       icon: TrendingUp,color: "text-violet-600",  bg: "bg-violet-100 dark:bg-violet-900/20" },
    { label: "Total Loaded",     value: `GH₵${stats.loaded.toFixed(2)}`,   icon: Plus,      color: "text-amber-600",   bg: "bg-amber-100 dark:bg-amber-900/20" },
    { label: "Total Orders",     value: `GH₵${stats.spent.toFixed(2)}`,    icon: Minus,     color: "text-red-600",     bg: "bg-red-100 dark:bg-red-900/20" },
  ];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:block w-64 shrink-0 border-r border-border">
        <AdminSidebar />
      </div>
      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64 z-50">
            <AdminSidebar open onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center gap-3 px-4 border-b border-border bg-background shrink-0">
          <button className="lg:hidden p-2 rounded-lg hover:bg-muted" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            <h1 className="font-bold text-lg">Wallets</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={handleExport} disabled={!filtered.length}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors disabled:opacity-40">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Tabs */}
          <div className="border-b border-border bg-background px-6">
            <div className="flex gap-0 -mb-px">
              {(["wallets", "transactions"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-5 py-3.5 text-sm font-semibold capitalize border-b-2 transition-colors ${
                    tab === t
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "wallets" ? "Dealer Wallet" : "Transactions"}
                </button>
              ))}
            </div>
          </div>

          <main className="p-6 space-y-5 max-w-[1400px] mx-auto">
            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {STAT_CARDS.map(c => (
                <div key={c.label} className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-2">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${c.bg}`}>
                    <c.icon className={`w-4 h-4 ${c.color}`} />
                  </div>
                  <div className="text-lg font-extrabold text-foreground leading-tight">{c.value}</div>
                  <div className="text-[11px] text-muted-foreground font-medium">{c.label}</div>
                </div>
              ))}
            </div>

            {tab === "transactions" ? (
              <AllTransactions />
            ) : (
              <>
                {/* Search + filters */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-[220px] max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      className="w-full pl-9 pr-9 h-9 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="Search by name, email, ID…"
                      value={search}
                      onChange={e => { setSearch(e.target.value); setPage(1); }}
                      data-testid="input-wallet-search"
                    />
                    {search && (
                      <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => { setSearch(""); setPage(1); }}>
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Show</span>
                    <select
                      value={pageSize}
                      onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                      className="h-9 rounded-xl border border-border bg-background px-2 text-sm focus:outline-none cursor-pointer"
                    >
                      {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <span>per page</span>
                  </div>
                  <div className="text-xs text-muted-foreground ml-auto">
                    {filtered.length} wallet{filtered.length !== 1 ? "s" : ""}
                    {search && ` (filtered from ${wallets?.length ?? 0})`}
                  </div>
                </div>

                {/* Table */}
                <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                  {isLoading ? (
                    <div className="p-6 space-y-3">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
                      ))}
                    </div>
                  ) : paged.length === 0 ? (
                    <div className="py-24 flex flex-col items-center gap-3 text-muted-foreground">
                      <Wallet className="w-12 h-12 opacity-20" />
                      <p className="text-sm">No wallets found</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/30 border-b border-border">
                            {[
                              { label: "User #", field: null },
                              { label: "Name", field: "name" as SortField },
                              { label: "Total Loads", field: "totalLoaded" as SortField },
                              { label: "Total Orders", field: "totalOrders" as SortField },
                              { label: "Current Balance", field: "balance" as SortField },
                              { label: "Role", field: null },
                              { label: "Last Active", field: "updated" as SortField },
                              { label: "Action", field: null },
                            ].map(({ label, field }) => (
                              <th key={label} className="text-left px-5 py-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                                {field ? (
                                  <button className="flex items-center hover:text-foreground transition-colors" onClick={() => handleSort(field)}>
                                    {label}
                                    <SortIcon field={field} active={sortField === field} dir={sortDir} />
                                  </button>
                                ) : label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {paged.map(w => (
                            <Fragment key={w.id}>
                              <tr
                                className="hover:bg-muted/20 transition-colors group"
                                data-testid={`row-wallet-${w.id}`}
                              >
                                <td className="px-5 py-4">
                                  <span className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded-lg">
                                    #{w.userId}
                                  </span>
                                </td>
                                <td className="px-5 py-4">
                                  <div className="flex items-center gap-3">
                                    <UserAvatar name={w.userName} role={w.userRole} />
                                    <div className="min-w-0">
                                      <div className="font-semibold text-foreground truncate">{w.userName}</div>
                                      <div className="text-xs text-muted-foreground truncate">{w.userEmail}</div>
                                      {w.userPhone && (
                                        <div className="text-[10px] text-muted-foreground/70 font-mono">
                                          {w.userPhone.startsWith("+233") ? "0" + w.userPhone.slice(4) : w.userPhone}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-5 py-4">
                                  <span className="text-sm font-semibold text-foreground">
                                    GH₵{(w.totalLoaded ?? 0).toFixed(2)}
                                  </span>
                                </td>
                                <td className="px-5 py-4">
                                  <span className="text-sm font-semibold text-foreground">
                                    GH₵{(w.totalOrders ?? 0).toFixed(2)}
                                  </span>
                                </td>
                                <td className="px-5 py-4">
                                  <span className={`text-lg font-extrabold ${w.balance > 0 ? "text-foreground" : "text-muted-foreground/50"}`}>
                                    GH₵{w.balance.toFixed(2)}
                                  </span>
                                </td>
                                <td className="px-5 py-4">
                                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${ROLE_COLORS[w.userRole] ?? "bg-muted text-muted-foreground"}`}>
                                    {w.userRole}
                                  </span>
                                </td>
                                <td className="px-5 py-4">
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock className="w-3 h-3" />
                                    {w.updatedAt ? fmtDate(w.updatedAt) : "—"}
                                  </div>
                                </td>
                                <td className="px-5 py-4">
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => openPopup(w, "topup")}
                                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-colors shadow-sm"
                                      data-testid={`btn-topup-${w.id}`}
                                    >
                                      <Plus className="w-3 h-3" /> Top Up
                                    </button>
                                    <button
                                      onClick={() => openPopup(w, "debit")}
                                      disabled={w.balance <= 0}
                                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-bold transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                                      data-testid={`btn-debit-${w.id}`}
                                    >
                                      <Minus className="w-3 h-3" /> Debit
                                    </button>
                                    <button
                                      onClick={() => setExpandedId(v => v === w.id ? null : w.id)}
                                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                                      title="View history"
                                    >
                                      {expandedId === w.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              {expandedId === w.id && (
                                <tr className="bg-muted/10">
                                  <td colSpan={8} className="py-2 px-2">
                                    <div className="rounded-xl border border-border overflow-hidden bg-card">
                                      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-muted/20">
                                        <History className="w-3.5 h-3.5 text-muted-foreground" />
                                        <span className="text-xs font-semibold text-muted-foreground">{w.userName} — Deposit History</span>
                                      </div>
                                      <DepositHistory userId={w.userId} />
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Pagination */}
                  {filtered.length > pageSize && (
                    <div className="flex items-center justify-between px-5 py-3.5 border-t border-border text-xs text-muted-foreground">
                      <span>
                        Showing {Math.min((page - 1) * pageSize + 1, filtered.length)}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
                      </span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                          className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                          .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                          .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                            if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
                            acc.push(p); return acc;
                          }, [])
                          .map((p, i) => p === "…"
                            ? <span key={`e${i}`} className="px-2">…</span>
                            : (
                              <button key={p} onClick={() => setPage(p as number)}
                                className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${page === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                                {p}
                              </button>
                            ))
                        }
                        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                          className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      {/* Top Up / Debit popup */}
      {popup && (
        <WalletActionPopup
          userId={popup.userId}
          userName={popup.userName}
          currentBalance={popup.balance}
          action={popup.action}
          onClose={() => setPopup(null)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
