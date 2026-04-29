import { useState, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { useToast } from "@/hooks/use-toast";
import {
  Menu, ArrowLeft, User, Mail, Phone, Shield, CheckCircle2, XCircle,
  Wallet, ShoppingCart, TrendingUp, Clock, Store, Plus, Minus, X,
  RefreshCw, ChevronLeft, ChevronRight, ExternalLink, Package,
  CreditCard, Activity, Calendar,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface AgentProfile {
  user: {
    id: number; name: string; email: string; phone: string | null;
    role: string; isActive: boolean; createdAt: string; depositCode: string | null;
  };
  wallet: { balance: number; updatedAt: string | null };
  stats: {
    totalLoaded: number; totalOrderValue: number; totalOrders: number;
    completedOrders: number; pendingOrders: number;
  };
  recentOrders: {
    id: number; bundleName: string; bundleData: string; price: number;
    status: string; phoneNumber: string; createdAt: string;
  }[];
  recentDeposits: {
    id: number; amount: number; status: string; method: string;
    reference: string | null; note: string | null; createdAt: string;
  }[];
  store: { id: number; name: string; slug: string; isActive: boolean } | null;
}

type Tab = "overview" | "orders" | "deposits";

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });

const fmtDatetime = (iso: string) =>
  new Date(iso).toLocaleString("en-GH", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });

const fmtPhone = (phone: string | null) =>
  phone ? (phone.startsWith("+233") ? "0" + phone.slice(4) : phone) : "—";

const STATUS_COLORS: Record<string, string> = {
  completed:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  pending:    "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  failed:     "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  rejected:   "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  cancelled:  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const METHOD_COLORS: Record<string, string> = {
  paystack: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  momo:     "bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400",
  admin:    "bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400",
  manual:   "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const ROLE_COLORS: Record<string, string> = {
  admin:      "bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400",
  storeowner: "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  user:       "bg-sky-100 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400",
};

// ── Wallet Action Popup ─────────────────────────────────────────────────────
function WalletActionPopup({
  userId, userName, currentBalance, action, onClose, onSuccess,
}: {
  userId: number; userName: string; currentBalance: number;
  action: "topup" | "debit"; onClose: () => void; onSuccess: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote]     = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const isTopUp = action === "topup";
  const preset = isTopUp ? [5, 10, 20, 50, 100, 200] : [5, 10, 20, 50];

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
      toast({ title: json.message ?? (isTopUp ? "Wallet credited" : "Wallet debited") });
      onSuccess(); onClose();
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Action failed", variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isTopUp ? "bg-emerald-100 dark:bg-emerald-900/20" : "bg-red-100 dark:bg-red-900/20"}`}>
              {isTopUp ? <Plus className="w-5 h-5 text-emerald-600" /> : <Minus className="w-5 h-5 text-red-600" />}
            </div>
            <div>
              <div className="font-bold">{isTopUp ? "Top Up Wallet" : "Debit Wallet"}</div>
              <div className="text-xs text-muted-foreground">{userName}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="bg-muted/40 rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Current Balance</span>
          <span className="font-bold">GH₵{currentBalance.toFixed(2)}</span>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount (GH₵)</label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₵</span>
            <input
              autoFocus type="number" min="0.01" step="0.01" value={amount}
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
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Note (optional)</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder={isTopUp ? "e.g. Manual credit" : "e.g. Reversal"}
            className="w-full px-4 h-9 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-sm font-semibold hover:bg-muted transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={loading || !amount}
            className={`flex-1 h-10 rounded-xl text-white text-sm font-bold transition-colors disabled:opacity-50 ${isTopUp ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}>
            {loading ? "Processing…" : isTopUp ? "Top Up" : "Debit"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AdminAgentDetail() {
  return <ProtectedRoute adminOnly><AdminAgentDetailContent /></ProtectedRoute>;
}

function AdminAgentDetailContent() {
  const [, params] = useRoute("/admin/agents/:userId");
  const userId = params ? parseInt(params.userId, 10) : NaN;
  const [, navigate] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [ordPage, setOrdPage] = useState(1);
  const [depPage, setDepPage] = useState(1);
  const PAGE = 15;
  const [popup, setPopup] = useState<"topup" | "debit" | null>(null);
  const qc = useQueryClient();

  const { data: profile, isLoading, refetch } = useQuery<AgentProfile>({
    queryKey: ["admin-agent", userId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/agents/${userId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load agent");
      return r.json();
    },
    enabled: !isNaN(userId),
  });

  const handleWalletSuccess = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ["admin-wallets"] });
  };

  const ordPaged = useMemo(() => {
    const src = profile?.recentOrders ?? [];
    return src.slice((ordPage - 1) * PAGE, ordPage * PAGE);
  }, [profile, ordPage]);
  const ordPages = Math.max(1, Math.ceil((profile?.recentOrders.length ?? 0) / PAGE));

  const depPaged = useMemo(() => {
    const src = profile?.recentDeposits ?? [];
    return src.slice((depPage - 1) * PAGE, depPage * PAGE);
  }, [profile, depPage]);
  const depPages = Math.max(1, Math.ceil((profile?.recentDeposits.length ?? 0) / PAGE));

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="space-y-3 w-80">
          <div className="h-20 rounded-2xl bg-muted animate-pulse" />
          <div className="h-40 rounded-2xl bg-muted animate-pulse" />
          <div className="h-32 rounded-2xl bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-4">
        <User className="w-16 h-16 text-muted-foreground/20" />
        <p className="text-muted-foreground">Agent not found</p>
        <button onClick={() => navigate("/admin/users")}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
          Back to Users
        </button>
      </div>
    );
  }

  const { user, wallet, stats, store } = profile;
  const agentCode = user.depositCode ?? `BT-${String(user.id).padStart(4, "0")}`;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center gap-3 px-4 border-b border-border bg-background shrink-0">
          <button className="lg:hidden p-2 rounded-lg hover:bg-muted" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <button onClick={() => navigate("/admin/users")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="h-4 w-px bg-border" />
          <span className="font-semibold text-sm truncate">{user.name}</span>
          <span className="text-xs text-muted-foreground font-mono">{agentCode}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => refetch()} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <main className="p-6 space-y-5 max-w-[1200px] mx-auto">

            {/* Agent header card */}
            <div className="bg-card border border-border rounded-2xl p-6">
              <div className="flex flex-col sm:flex-row gap-5 items-start sm:items-center">
                {/* Avatar */}
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-extrabold text-white shrink-0 shadow-lg ${
                  user.role === "admin" ? "bg-violet-500" : user.role === "storeowner" ? "bg-amber-500" : "bg-primary"
                }`}>
                  {user.name.charAt(0).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-extrabold text-foreground">{user.name}</h1>
                    <span className="font-mono text-xs font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-lg" title="MoMo deposit reference code">{agentCode}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${ROLE_COLORS[user.role] ?? ""}`}>{user.role}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${user.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`}>
                      {user.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{user.email}</span>
                    <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{fmtPhone(user.phone)}</span>
                    <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Joined {fmtDate(user.createdAt)}</span>
                    {store && (
                      <a href={`/s/${store.slug}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-primary hover:underline">
                        <Store className="w-3.5 h-3.5" />{store.name} <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Wallet quick actions */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <div className="text-right">
                    <div className="text-2xl font-extrabold text-foreground">GH₵{wallet.balance.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">Current Balance</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setPopup("topup")}
                      className="flex items-center gap-1.5 px-3 h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors">
                      <Plus className="w-3.5 h-3.5" /> Top Up
                    </button>
                    <button onClick={() => setPopup("debit")} disabled={wallet.balance <= 0}
                      className="flex items-center gap-1.5 px-3 h-8 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      <Minus className="w-3.5 h-3.5" /> Debit
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { icon: Wallet, label: "Wallet Balance", value: `GH₵${wallet.balance.toFixed(2)}`, bg: "bg-emerald-50 dark:bg-emerald-900/10", color: "text-emerald-600" },
                { icon: TrendingUp, label: "Total Loaded", value: `GH₵${stats.totalLoaded.toFixed(2)}`, bg: "bg-blue-50 dark:bg-blue-900/10", color: "text-blue-600" },
                { icon: ShoppingCart, label: "Total Orders Value", value: `GH₵${stats.totalOrderValue.toFixed(2)}`, bg: "bg-violet-50 dark:bg-violet-900/10", color: "text-violet-600" },
                { icon: CheckCircle2, label: "Completed Orders", value: String(stats.completedOrders), bg: "bg-emerald-50 dark:bg-emerald-900/10", color: "text-emerald-600" },
                { icon: Clock, label: "Pending Orders", value: String(stats.pendingOrders), bg: "bg-amber-50 dark:bg-amber-900/10", color: "text-amber-600" },
              ].map(c => (
                <div key={c.label} className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-2">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${c.bg}`}>
                    <c.icon className={`w-4 h-4 ${c.color}`} />
                  </div>
                  <div className="text-lg font-extrabold text-foreground leading-tight">{c.value}</div>
                  <div className="text-[11px] text-muted-foreground font-medium">{c.label}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="border-b border-border -mb-1">
              <div className="flex gap-0">
                {([
                  { id: "overview", label: "Overview", icon: Activity },
                  { id: "orders",   label: `Orders (${stats.totalOrders})`, icon: Package },
                  { id: "deposits", label: `Deposits (${profile.recentDeposits.length})`, icon: CreditCard },
                ] as { id: Tab; label: string; icon: React.ElementType }[]).map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
                      tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}>
                    <t.icon className="w-4 h-4" />{t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Overview Tab */}
            {tab === "overview" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Recent Orders */}
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                    <h3 className="font-bold text-sm flex items-center gap-2"><Package className="w-4 h-4 text-muted-foreground" />Recent Orders</h3>
                    <button onClick={() => setTab("orders")} className="text-xs text-primary font-semibold hover:underline">View all</button>
                  </div>
                  {profile.recentOrders.length === 0 ? (
                    <div className="py-10 text-center text-xs text-muted-foreground">No orders yet</div>
                  ) : (
                    <div className="divide-y divide-border">
                      {profile.recentOrders.slice(0, 5).map(o => (
                        <div key={o.id} className="px-5 py-3.5 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm truncate">{o.bundleName}</div>
                            <div className="text-xs text-muted-foreground">{o.phoneNumber} · {fmtDate(o.createdAt)}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold">GH₵{o.price.toFixed(2)}</div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${STATUS_COLORS[o.status] ?? ""}`}>{o.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Deposits */}
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                    <h3 className="font-bold text-sm flex items-center gap-2"><CreditCard className="w-4 h-4 text-muted-foreground" />Recent Deposits</h3>
                    <button onClick={() => setTab("deposits")} className="text-xs text-primary font-semibold hover:underline">View all</button>
                  </div>
                  {profile.recentDeposits.length === 0 ? (
                    <div className="py-10 text-center text-xs text-muted-foreground">No deposits yet</div>
                  ) : (
                    <div className="divide-y divide-border">
                      {profile.recentDeposits.slice(0, 5).map(d => (
                        <div key={d.id} className="px-5 py-3.5 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold capitalize ${METHOD_COLORS[d.method] ?? "bg-muted text-muted-foreground"}`}>{d.method}</span>
                              {d.note && <span className="text-xs text-muted-foreground truncate">{d.note}</span>}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">{fmtDate(d.createdAt)}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-emerald-600">+GH₵{d.amount.toFixed(2)}</div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${STATUS_COLORS[d.status] ?? ""}`}>{d.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Store card */}
                {store && (
                  <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4 lg:col-span-2">
                    <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center shrink-0">
                      <Store className="w-6 h-6 text-amber-600" />
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-foreground">{store.name}</div>
                      <div className="text-xs text-muted-foreground">Store slug: <span className="font-mono">{store.slug}</span></div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${store.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                        {store.isActive ? "Active" : "Inactive"}
                      </span>
                      <a href={`/admin/stores`}
                        className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
                        View in Stores <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Orders Tab */}
            {tab === "orders" && (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="font-bold text-sm">Order History ({profile.recentOrders.length})</h3>
                </div>
                {profile.recentOrders.length === 0 ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">No orders yet</div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/30 border-b border-border">
                            {["#", "Bundle", "Phone", "Amount", "Status", "Date"].map(h => (
                              <th key={h} className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {ordPaged.map(o => (
                            <tr key={o.id} className="hover:bg-muted/20 transition-colors">
                              <td className="px-5 py-3.5 text-xs font-mono text-muted-foreground">#{o.id}</td>
                              <td className="px-5 py-3.5">
                                <div className="font-semibold text-foreground">{o.bundleName}</div>
                                <div className="text-xs text-muted-foreground">{o.bundleData}</div>
                              </td>
                              <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{o.phoneNumber}</td>
                              <td className="px-5 py-3.5 font-bold text-foreground">GH₵{o.price.toFixed(2)}</td>
                              <td className="px-5 py-3.5">
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${STATUS_COLORS[o.status] ?? ""}`}>{o.status}</span>
                              </td>
                              <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDatetime(o.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {ordPages > 1 && <PaginationBar page={ordPage} total={ordPages} onChange={setOrdPage} />}
                  </>
                )}
              </div>
            )}

            {/* Deposits Tab */}
            {tab === "deposits" && (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="font-bold text-sm">Deposit History ({profile.recentDeposits.length})</h3>
                </div>
                {profile.recentDeposits.length === 0 ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">No deposits yet</div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/30 border-b border-border">
                            {["#", "Amount", "Method", "Note", "Reference", "Status", "Date"].map(h => (
                              <th key={h} className="text-left px-5 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {depPaged.map(d => (
                            <tr key={d.id} className="hover:bg-muted/20 transition-colors">
                              <td className="px-5 py-3.5 text-xs font-mono text-muted-foreground">#{d.id}</td>
                              <td className="px-5 py-3.5 font-bold text-emerald-600">+GH₵{d.amount.toFixed(2)}</td>
                              <td className="px-5 py-3.5">
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${METHOD_COLORS[d.method] ?? "bg-muted text-muted-foreground"}`}>{d.method}</span>
                              </td>
                              <td className="px-5 py-3.5 text-xs text-muted-foreground">{d.note ?? "—"}</td>
                              <td className="px-5 py-3.5 text-xs font-mono text-muted-foreground max-w-[140px] truncate" title={d.reference ?? ""}>{d.reference ?? "—"}</td>
                              <td className="px-5 py-3.5">
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${STATUS_COLORS[d.status] ?? ""}`}>{d.status}</span>
                              </td>
                              <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDatetime(d.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {depPages > 1 && <PaginationBar page={depPage} total={depPages} onChange={setDepPage} />}
                  </>
                )}
              </div>
            )}

          </main>
        </div>
      </div>

      {/* Wallet popup */}
      {popup && (
        <WalletActionPopup
          userId={user.id} userName={user.name} currentBalance={wallet.balance}
          action={popup} onClose={() => setPopup(null)} onSuccess={handleWalletSuccess}
        />
      )}
    </div>
  );
}

function PaginationBar({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-t border-border text-xs text-muted-foreground">
      <span>Page {page} of {total}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1}
          className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {Array.from({ length: total }, (_, i) => i + 1)
          .filter(p => p === 1 || p === total || Math.abs(p - page) <= 1)
          .reduce<(number | "…")[]>((acc, p, idx, arr) => {
            if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
            acc.push(p); return acc;
          }, [])
          .map((p, i) => p === "…"
            ? <span key={`e${i}`} className="px-2">…</span>
            : <button key={p} onClick={() => onChange(p as number)}
                className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${page === (p as number) ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                {p}
              </button>
          )}
        <button onClick={() => onChange(Math.min(total, page + 1))} disabled={page === total}
          className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
