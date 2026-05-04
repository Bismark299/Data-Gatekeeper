import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { storeApi, type Store, type StoreBundle, type StoreStats } from "@/lib/storeApi";
import { useListBundles } from "@workspace/api-client-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "wouter";
import { NETWORK_STYLES, NETWORK_LABELS as BUNDLE_NETWORK_LABELS } from "@/components/BundleCard";
import {
  Store as StoreIcon, TrendingUp, ShoppingBag, Wallet, Copy, Check,
  Plus, Trash2, Edit2, ExternalLink, Loader2, X, Package, Settings,
  BarChart3, ListOrdered, ArrowDownToLine, CheckCircle2, Clock, AlertCircle,
  Sparkles, Globe, PiggyBank, Zap,
} from "lucide-react";

const COLOR_THEMES = [
  { value: "yellow",  label: "MTN Gold",    bg: "bg-yellow-400",  ring: "ring-yellow-400",  preview: "#FACC15" },
  { value: "red",     label: "Telecel Red", bg: "bg-red-600",     ring: "ring-red-500",     preview: "#DC2626" },
  { value: "blue",    label: "Ocean Blue",  bg: "bg-blue-600",    ring: "ring-blue-500",    preview: "#2563EB" },
  { value: "green",   label: "Forest Green",bg: "bg-green-600",   ring: "ring-green-500",   preview: "#16A34A" },
  { value: "purple",  label: "Royal Purple",bg: "bg-purple-600",  ring: "ring-purple-500",  preview: "#9333EA" },
  { value: "orange",  label: "Sunset",      bg: "bg-orange-500",  ring: "ring-orange-400",  preview: "#F97316" },
  { value: "teal",    label: "Teal",        bg: "bg-teal-600",    ring: "ring-teal-500",    preview: "#0D9488" },
];

const THEME_MAP: Record<string, { bg: string; text: string; light: string }> = {
  yellow: { bg: "bg-yellow-400", text: "text-gray-900", light: "bg-yellow-50 border-yellow-200" },
  red:    { bg: "bg-red-600",    text: "text-white",    light: "bg-red-50 border-red-200" },
  blue:   { bg: "bg-blue-600",   text: "text-white",    light: "bg-blue-50 border-blue-200" },
  green:  { bg: "bg-green-600",  text: "text-white",    light: "bg-green-50 border-green-200" },
  purple: { bg: "bg-purple-600", text: "text-white",    light: "bg-purple-50 border-purple-200" },
  orange: { bg: "bg-orange-500", text: "text-white",    light: "bg-orange-50 border-orange-200" },
  teal:   { bg: "bg-teal-600",   text: "text-white",    light: "bg-teal-50 border-teal-200" },
};

const NETWORK_LABELS: Record<string, string> = {
  mtn: "MTN", telecel: "Telecel", "at-ishare": "AT iShare", "at-bigtime": "AT Big-Time",
};
const NETWORK_COLORS: Record<string, string> = {
  mtn: "bg-yellow-100 text-yellow-800", telecel: "bg-red-100 text-red-800",
  "at-ishare": "bg-blue-100 text-blue-800", "at-bigtime": "bg-green-100 text-green-800",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800", processing: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800", failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-600",
};

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-5 flex items-start gap-3">
      <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-base sm:text-2xl font-bold text-foreground truncate">{value}</div>
        <div className="text-xs sm:text-sm font-medium text-muted-foreground truncate">{label}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Create Store Form ────────────────────────────────────────────────────────
function CreateStoreForm({ onCreated }: { onCreated: (s: Store) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [colorTheme, setColorTheme] = useState("blue");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  function toSlug(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 40);
  }

  useEffect(() => {
    if (!slugEdited) setSlug(toSlug(name));
  }, [name, slugEdited]);

  const create = useMutation({
    mutationFn: () => storeApi.createStore({ name, description, colorTheme, slug: slug || undefined }),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["myStore"] }); onCreated(s); },
  });

  const theme = THEME_MAP[colorTheme] ?? THEME_MAP.blue;
  const isValid = name.trim().length >= 2 && slug.length >= 2;

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Icon + header */}
        <div className="text-center mb-8">
          <div className={`w-20 h-20 rounded-3xl ${theme.bg} flex items-center justify-center mx-auto mb-4 shadow-lg`}>
            <StoreIcon className={`w-10 h-10 ${theme.text}`} />
          </div>
          <h1 className="text-3xl font-bold text-foreground">Launch Your Store</h1>
          <p className="text-muted-foreground mt-2">Create your own branded data bundle store and start earning profits from every sale.</p>
        </div>

        <div className="bg-card border border-border rounded-3xl p-7 shadow-sm space-y-5">
          <div>
            <Label htmlFor="store-name" className="text-sm font-semibold mb-1.5 block">Store Name *</Label>
            <Input id="store-name" placeholder="e.g. Kwame's Data Hub" value={name} onChange={e => setName(e.target.value)} className="h-11" />
          </div>

          <div>
            <Label htmlFor="store-slug" className="text-sm font-semibold mb-1.5 block">Store Link</Label>
            <div className="flex items-center gap-0 rounded-lg border border-border overflow-hidden focus-within:ring-2 focus-within:ring-primary/40">
              <span className="px-3 h-11 flex items-center text-sm text-muted-foreground bg-muted border-r border-border shrink-0">/s/</span>
              <input
                id="store-slug"
                className="flex-1 h-11 px-3 bg-background text-sm outline-none font-mono"
                value={slug}
                onChange={e => { setSlug(toSlug(e.target.value)); setSlugEdited(true); }}
                placeholder="your-store-name"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">This is your unique shareable link — cannot be changed later.</p>
          </div>

          <div>
            <Label htmlFor="store-desc" className="text-sm font-semibold mb-1.5 block">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="store-desc" placeholder="Tell customers what makes your store special…" value={description} onChange={e => setDescription(e.target.value)} rows={2} className="resize-none" />
          </div>

          <div>
            <Label className="text-sm font-semibold mb-2.5 block">Store Color</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_THEMES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setColorTheme(t.value)}
                  title={t.label}
                  className={`w-9 h-9 rounded-xl ${t.bg} transition-all ring-offset-2 ring-offset-background ${colorTheme === t.value ? `ring-2 ${t.ring} scale-110` : "hover:scale-105"}`}
                />
              ))}
            </div>
          </div>

          {create.error && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-900/10 dark:border-red-800 dark:text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {(create.error as Error).message}
            </div>
          )}

          <Button onClick={() => create.mutate()} disabled={!isValid || create.isPending} className="w-full h-12 text-base gap-2">
            {create.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            {create.isPending ? "Creating…" : "Create My Store"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
function StoreDashboard({ store: initialStore }: { store: Store }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [tab, setTab] = useState<"overview" | "bundles" | "orders" | "settings" | "withdrawals">("overview");
  const [copied, setCopied] = useState(false);

  const { data: storeData } = useQuery<Store | null>({ queryKey: ["myStore"], queryFn: storeApi.getMyStore, initialData: initialStore });
  const store: Store = (storeData ?? initialStore)!;
  const { data: stats } = useQuery<StoreStats>({ queryKey: ["myStoreStats"], queryFn: storeApi.getStats, refetchInterval: 10000, staleTime: 0 });
  const { data: storeBundles = [] } = useQuery<StoreBundle[]>({ queryKey: ["myStoreBundles"], queryFn: storeApi.getBundles, refetchInterval: 30000 });
  const { data: orders = [] } = useQuery({ queryKey: ["myStoreOrders"], queryFn: storeApi.getOrders, refetchInterval: 10000, staleTime: 0 });
  const { data: withdrawals = [] } = useQuery({ queryKey: ["myStoreWithdrawals"], queryFn: storeApi.getWithdrawals, refetchInterval: 30000 });

  const storeUrl = `${window.location.origin}/s/${store.slug}`;
  const theme = THEME_MAP[store.colorTheme] ?? THEME_MAP.blue;

  const copyLink = async () => {
    await navigator.clipboard.writeText(storeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const TABS = [
    { id: "overview" as const, label: "Overview", icon: BarChart3 },
    { id: "bundles" as const, label: "Bundles", icon: Package },
    { id: "orders" as const, label: "Orders", icon: ListOrdered },
    { id: "withdrawals" as const, label: "Earnings", icon: PiggyBank },
    { id: "settings" as const, label: "Settings", icon: Settings },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Store header */}
      <div className={`rounded-3xl overflow-hidden mb-6 shadow-sm`}>
        <div className={`${theme.bg} px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center gap-5`}>
          <div className={`w-16 h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0`}>
            <StoreIcon className={`w-8 h-8 ${theme.text}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className={`text-3xl font-black ${theme.text} truncate`}>{store.name}</h1>
            {store.description && <p className={`${theme.text} opacity-80 text-sm mt-1 line-clamp-2`}>{store.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-white/15 backdrop-blur`}>
              <Globe className={`w-3.5 h-3.5 ${theme.text} opacity-80`} />
              <span className={`text-xs font-mono ${theme.text} opacity-90 max-w-[140px] truncate`}>/s/{store.slug}</span>
            </div>
            <button onClick={copyLink} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors ${theme.text} text-xs font-semibold`}>
              {copied ? <><Check className="w-3.5 h-3.5" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy Link</>}
            </button>
            <a href={storeUrl} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors ${theme.text} text-xs font-semibold`}>
              <ExternalLink className="w-3.5 h-3.5" /> View Store
            </a>
          </div>
        </div>
        {/* Profit balance pill */}
        <div className="bg-[#1e1e1e] px-6 py-3 flex items-center gap-2">
          <PiggyBank className="w-4 h-4 text-emerald-400" />
          <span className="text-xs text-gray-400">Profit Balance:</span>
          <span className="text-sm font-bold text-emerald-400">GH₵{(stats?.profitBalance ?? store.profitBalance).toFixed(2)}</span>
          <span className="ml-auto text-xs text-gray-500">{storeBundles.length} bundle{storeBundles.length !== 1 ? "s" : ""} listed</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-2xl p-1.5 mb-6 overflow-x-auto scrollbar-none">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm whitespace-nowrap transition-all shrink-0 justify-center ${
                tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab stats={stats} orders={orders} storeBundles={storeBundles} />}
      {tab === "bundles" && <BundlesTab storeBundles={storeBundles} store={store} userRole={user?.role ?? "user"} />}
      {tab === "orders" && <OrdersTab orders={orders} />}
      {tab === "withdrawals" && <WithdrawalsTab stats={stats} withdrawals={withdrawals} store={store} />}
      {tab === "settings" && <SettingsTab store={store} />}
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ stats, orders, storeBundles }: { stats?: StoreStats; orders: any[]; storeBundles: StoreBundle[] }) {
  const recentOrders = orders.slice(0, 5);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Sales" value={String(stats?.totalSales ?? 0)} icon={ShoppingBag} color="bg-blue-100 text-blue-600 dark:bg-blue-900/20" />
        <StatCard label="Total Revenue" value={`GH₵${(stats?.totalRevenue ?? 0).toFixed(2)}`} icon={TrendingUp} color="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20" />
        <StatCard label="Total Profit" value={`GH₵${(stats?.totalProfit ?? 0).toFixed(2)}`} icon={Zap} color="bg-purple-100 text-purple-600 dark:bg-purple-900/20" />
        <StatCard label="Withdrawable" value={`GH₵${(stats?.profitBalance ?? 0).toFixed(2)}`} sub="Available to withdraw" icon={Wallet} color="bg-amber-100 text-amber-600 dark:bg-amber-900/20" />
      </div>

      {recentOrders.length > 0 ? (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h3 className="font-bold text-foreground">Recent Orders</h3>
            <span className="text-xs text-muted-foreground">{orders.length} total</span>
          </div>
          <div className="divide-y divide-border">
            {recentOrders.map((o: any) => (
              <div key={o.id} className="px-5 py-3.5 flex items-center gap-3">
                <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${NETWORK_COLORS[o.bundleNetwork] ?? "bg-gray-100 text-gray-800"}`}>{NETWORK_LABELS[o.bundleNetwork] ?? o.bundleNetwork}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{o.bundleData} — {o.customerPhone}</div>
                  <div className="text-xs text-muted-foreground truncate">{new Date(o.createdAt).toLocaleString("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-foreground">GH₵{o.sellingPrice.toFixed(2)}</div>
                  <div className="text-xs text-emerald-600">+GH₵{o.profit.toFixed(2)}</div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[o.status] ?? "bg-gray-100 text-gray-700"}`}>{o.status}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <ShoppingBag className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-bold text-foreground mb-1">No sales yet</h3>
          <p className="text-sm text-muted-foreground">Share your store link to start getting customers.</p>
        </div>
      )}
    </div>
  );
}

// ─── Bundles Tab ──────────────────────────────────────────────────────────────
type Network = "mtn" | "telecel" | "at-ishare" | "at-bigtime";
const ALL_NETWORKS: Network[] = ["mtn", "telecel", "at-ishare", "at-bigtime"];

const parseMB = (s: string) => {
  if (/unlimited/i.test(s)) return Infinity;
  const m = s.match(/^([\d.]+)\s*(GB|MB|TB)?$/i);
  if (!m) return Infinity;
  const v = parseFloat(m[1]);
  const u = (m[2] ?? "GB").toUpperCase();
  return u === "MB" ? v : u === "TB" ? v * 1024 * 1024 : v * 1024;
};

function BundlesTab({ storeBundles, store: _store, userRole: _userRole }: { storeBundles: StoreBundle[]; store: Store; userRole: string }) {
  const qc = useQueryClient();
  const [editingBundleId, setEditingBundleId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState("");

  // Load ALL system bundles always — no network filter
  const { data: allBundles = [], isLoading } = useListBundles({}, { query: { staleTime: 60_000 } });

  // bundleId → storeBundle for O(1) lookup
  const storeBundleMap = new Map(storeBundles.map(sb => [sb.bundleId, sb]));

  const addBundle = useMutation({
    mutationFn: ({ bundleId, sellingPrice }: { bundleId: number; sellingPrice: number }) =>
      storeApi.addBundle({ bundleId, sellingPrice }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["myStoreBundles"] }); setEditingBundleId(null); },
  });

  const updateBundle = useMutation({
    mutationFn: ({ id, price }: { id: number; price: number }) =>
      storeApi.updateBundle(id, { sellingPrice: price }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["myStoreBundles"] }); setEditingBundleId(null); },
  });

  function openEdit(b: any) {
    const sb = storeBundleMap.get(b.id);
    setEditingBundleId(b.id);
    setEditPrice(sb ? sb.sellingPrice.toFixed(2) : b.price.toFixed(2));
  }

  function handleSave(b: any) {
    const price = parseFloat(editPrice);
    if (isNaN(price) || price < b.price) return;
    const sb = storeBundleMap.get(b.id);
    if (sb) {
      updateBundle.mutate({ id: sb.id, price });
    } else {
      addBundle.mutate({ bundleId: b.id, sellingPrice: price });
    }
  }

  const isSaving = addBundle.isPending || updateBundle.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-bold text-foreground text-lg">Your Packages</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Set your selling price for each bundle. Click <Edit2 className="inline w-3 h-3" /> to update. Profit = Sell Price − Cost.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {ALL_NETWORKS.map(network => {
            const networkBundles = (allBundles as any[])
              .filter(b => b.network === network)
              .sort((a, b) => parseMB(a.dataAmount) - parseMB(b.dataAmount));
            if (networkBundles.length === 0) return null;
            const ns = NETWORK_STYLES[network];
            return (
              <div key={network} className="bg-card border border-border rounded-2xl overflow-hidden">
                {/* Network header */}
                <div className={`px-4 py-3 flex items-center gap-2 ${ns?.gradient ?? "bg-gradient-to-r from-gray-600 to-gray-800"}`}>
                  <span className="text-sm font-extrabold text-white tracking-wide">
                    {BUNDLE_NETWORK_LABELS[network] ?? network.toUpperCase()}
                  </span>
                  <span className="text-xs text-white/60 ml-auto">
                    {networkBundles.filter((b: any) => storeBundleMap.has(b.id)).length}/{networkBundles.length} priced
                  </span>
                </div>
                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Bundle</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Data</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Cost</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Sell Price</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Profit</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {networkBundles.map((b: any) => {
                        const sb = storeBundleMap.get(b.id);
                        const cost: number = b.price; // already role-resolved by server
                        const sellPrice: number | null = sb?.sellingPrice ?? null;
                        const profit: number | null = sellPrice != null ? sellPrice - cost : null;
                        const isEditing = editingBundleId === b.id;
                        const editVal = parseFloat(editPrice);
                        const editProfit = !isNaN(editVal) ? editVal - cost : null;
                        const editValid = !isNaN(editVal) && editVal >= cost;
                        return (
                          <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-medium text-foreground">{b.name}</td>
                            <td className="px-4 py-3 text-muted-foreground font-mono">{b.dataAmount}</td>
                            <td className="px-4 py-3 font-mono text-orange-600">₵{cost.toFixed(2)}</td>
                            <td className="px-4 py-3">
                              {isEditing ? (
                                <Input
                                  type="number"
                                  step="0.01"
                                  min={cost}
                                  value={editPrice}
                                  onChange={e => setEditPrice(e.target.value)}
                                  className="h-7 w-28 text-xs font-mono"
                                  autoFocus
                                />
                              ) : (
                                <span className={`font-mono font-semibold ${sellPrice != null ? "text-foreground" : "text-muted-foreground"}`}>
                                  {sellPrice != null ? `₵${sellPrice.toFixed(2)}` : "—"}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {isEditing ? (
                                editProfit != null && editProfit >= 0
                                  ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">₵{editProfit.toFixed(2)}</span>
                                  : <span className="text-muted-foreground text-xs">—</span>
                              ) : profit != null
                                ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">₵{profit.toFixed(2)}</span>
                                : <span className="text-muted-foreground text-xs">—</span>
                              }
                            </td>
                            <td className="px-4 py-3">
                              {isEditing ? (
                                <div className="flex items-center gap-1.5">
                                  <Button size="sm" className="h-7 text-xs px-3"
                                    onClick={() => handleSave(b)}
                                    disabled={!editValid || isSaving}>
                                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs px-2"
                                    onClick={() => setEditingBundleId(null)}>✕</Button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 w-7 p-0 rounded-lg bg-emerald-500 border-emerald-500 hover:bg-emerald-600"
                                  onClick={() => openEdit(b)}
                                  title="Set selling price">
                                  <Edit2 className="w-3.5 h-3.5 text-white" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Orders Tab ───────────────────────────────────────────────────────────────
function OrdersTab({ orders }: { orders: any[] }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [phoneFilter, setPhoneFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState(todayStr);
  const [dateTo, setDateTo] = useState(todayStr);

  const filtered = orders.filter(o => {
    if (phoneFilter && !o.customerPhone.includes(phoneFilter.trim())) return false;
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (dateFrom && new Date(o.createdAt) < new Date(dateFrom)) return false;
    if (dateTo && new Date(o.createdAt) > new Date(dateTo + "T23:59:59")) return false;
    return true;
  });

  const isToday = dateFrom === todayStr && dateTo === todayStr;
  const hasFilters = phoneFilter || statusFilter !== "all" || !isToday;

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h3 className="font-bold text-foreground">Store Sales</h3>
          <p className="text-xs text-muted-foreground">
            {isToday ? "Showing today's transactions" : `${dateFrom} → ${dateTo}`}
            {" · "}{filtered.length} order{filtered.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Input placeholder="Filter by phone…" value={phoneFilter} onChange={e => setPhoneFilter(e.target.value)}
          className="h-8 w-full sm:w-40 text-sm font-mono" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-8 rounded-lg border border-border bg-background px-2 text-xs">
          <option value="all">All status</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="failed">Failed</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="h-8 w-full sm:w-auto rounded-lg border border-border bg-background px-2 text-xs" title="From date" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="h-8 w-full sm:w-auto rounded-lg border border-border bg-background px-2 text-xs" title="To date" />
        <div className="flex gap-1.5">
          {!isToday && (
            <button onClick={() => { setDateFrom(todayStr); setDateTo(todayStr); }}
              className="text-xs px-2 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 font-medium">Today</button>
          )}
          {hasFilters && (
            <button onClick={() => { setPhoneFilter(""); setStatusFilter("all"); setDateFrom(todayStr); setDateTo(todayStr); }}
              className="text-xs text-muted-foreground hover:text-foreground underline">Clear</button>
          )}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="p-12 text-center">
          <ListOrdered className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">{orders.length === 0 ? "No orders yet" : "No orders match your filters"}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["#", "Data", "Network", "Phone", "Revenue", "Profit", "Payment", "Status", "Date"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((o: any) => (
                <tr key={o.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{o.id}</td>
                  <td className="px-4 py-3 font-semibold text-foreground">{o.bundleData}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${NETWORK_COLORS[o.bundleNetwork] ?? "bg-gray-100 text-gray-700"}`}>{NETWORK_LABELS[o.bundleNetwork] ?? o.bundleNetwork}</span></td>
                  <td className="px-4 py-3 font-mono text-xs">{o.customerPhone}</td>
                  <td className="px-4 py-3 font-semibold">GH₵{o.sellingPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-emerald-600 font-semibold">+GH₵{o.profit.toFixed(2)}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">Paid</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[o.status] ?? "bg-gray-100"}`}>{o.status}</span></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(o.createdAt).toLocaleString("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const MOMO_NETWORKS = [
  { value: "MTN", label: "MTN MoMo" },
  { value: "VDF", label: "Vodafone Cash" },
  { value: "ATL", label: "AirtelTigo Money" },
];

const WITHDRAWAL_FEE = 1;
const MIN_WITHDRAWAL = 10;

// ─── Withdrawals Tab ──────────────────────────────────────────────────────────
function WithdrawalsTab({ stats, withdrawals, store }: { stats?: StoreStats; withdrawals: any[]; store: Store }) {
  const qc = useQueryClient();

  const hasSavedMomo = !!(store.momoNumber && store.momoName && store.momoNetwork);
  const [editing, setEditing] = useState(!hasSavedMomo);

  const [amount, setAmount] = useState("");
  const [accountNumber, setAccountNumber] = useState(store.momoNumber ?? "");
  const [accountName, setAccountName] = useState(store.momoName ?? "");
  const [accountVerified, setAccountVerified] = useState(hasSavedMomo);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [method, setMethod] = useState("mobile_money");
  const [bankCode, setBankCode] = useState(store.momoNetwork ?? "MTN");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    if (editing) {
      setAccountName("");
      setAccountVerified(false);
      setVerifyError("");
    }
  }, [accountNumber, bankCode, editing]);

  const verifyMomoAccount = async () => {
    if (!/^\d{10}$/.test(accountNumber)) {
      setVerifyError("Enter a valid 10-digit number"); return;
    }
    setVerifying(true);
    setVerifyError("");
    try {
      const res = await fetch("/api/stores/resolve-momo", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountNumber, bankCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setAccountName(data.accountName);
      setAccountVerified(true);
      await storeApi.saveMomoDetails({ momoNetwork: bankCode, momoNumber: accountNumber, momoName: data.accountName });
      qc.invalidateQueries({ queryKey: ["myStore"] });
      setEditing(false);
    } catch (e: unknown) {
      setVerifyError((e as Error).message);
      setAccountName("");
      setAccountVerified(false);
    } finally {
      setVerifying(false);
    }
  };

  const removeMomo = useMutation({
    mutationFn: storeApi.deleteMomoDetails,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myStore"] });
      setAccountNumber(""); setAccountName(""); setBankCode("MTN");
      setAccountVerified(false); setEditing(true);
    },
  });

  const withdraw = useMutation({
    mutationFn: () => storeApi.withdraw({ amount: parseFloat(amount), method, bankCode, accountNumber, accountName, note }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["myStoreStats"] });
      qc.invalidateQueries({ queryKey: ["myStoreWithdrawals"] });
      qc.invalidateQueries({ queryKey: ["myStore"] });
      const amt = parseFloat(amount).toFixed(2);
      if (result.autoMessage === "sent") {
        setSuccessMsg(`GH₵${amt} sent successfully! It's on its way to your MoMo.`);
      } else if (result.autoMessage === "processing") {
        setSuccessMsg(`GH₵${amt} is being processed — you'll receive it shortly.`);
      } else {
        setSuccessMsg(`GH₵${amt} withdrawal request queued — awaiting admin approval.`);
      }
      setAmount(""); setNote(""); setError("");
    },
    onError: (e) => setError((e as Error).message),
  });

  const profitBalance = stats?.profitBalance ?? store.profitBalance;
  const parsedAmount = parseFloat(amount) || 0;
  const totalDeduction = parsedAmount + WITHDRAWAL_FEE;
  const canWithdraw = parsedAmount >= MIN_WITHDRAWAL && totalDeduction <= profitBalance &&
    !!accountNumber && !!bankCode && accountVerified && !withdraw.isPending;

  const networkLabel = MOMO_NETWORKS.find(n => n.value === bankCode)?.label ?? bankCode;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Withdraw form */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4 h-fit">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/20 flex items-center justify-center">
            <ArrowDownToLine className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="font-bold text-foreground">Withdraw Profits</h3>
            <div className="text-xs text-muted-foreground">Available: <span className="font-bold text-emerald-600">GH₵{profitBalance.toFixed(2)}</span></div>
          </div>
        </div>

        {/* ── Saved MoMo account ── */}
        {!editing && accountVerified && accountName ? (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/10 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Saved MoMo Account</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setEditing(true)}
                  className="text-xs text-primary font-semibold hover:underline">Edit</button>
                <span className="text-muted-foreground text-xs">·</span>
                <button onClick={() => removeMomo.mutate()}
                  className="text-xs text-red-500 font-semibold hover:underline" disabled={removeMomo.isPending}>
                  {removeMomo.isPending ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div>
                <div className="font-bold text-foreground text-sm">{accountName}</div>
                <div className="text-xs text-muted-foreground">{accountNumber} · {networkLabel}</div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div>
              <Label className="text-sm font-semibold mb-1.5 block">Payment Method</Label>
              <select value={method} onChange={e => { setMethod(e.target.value); setBankCode(e.target.value === "mobile_money" ? "MTN" : ""); }}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm">
                <option value="mobile_money">Mobile Money</option>
                <option value="bank">Bank Transfer</option>
              </select>
            </div>

            {method === "mobile_money" && (
              <div>
                <Label className="text-sm font-semibold mb-1.5 block">Mobile Network</Label>
                <div className="flex gap-2">
                  {MOMO_NETWORKS.map(n => (
                    <button key={n.value} onClick={() => setBankCode(n.value)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${bankCode === n.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {method === "bank" && (
              <div>
                <Label className="text-sm font-semibold mb-1.5 block">Bank Code <span className="font-normal text-muted-foreground text-xs">(Paystack code)</span></Label>
                <Input placeholder="e.g. GCB, ADB…" value={bankCode} onChange={e => setBankCode(e.target.value)} className="h-10 font-mono" />
              </div>
            )}

            <div>
              <Label className="text-sm font-semibold mb-1.5 block">
                {method === "mobile_money" ? "MoMo Number" : "Account Number"}
              </Label>
              <div className="flex gap-2">
                <Input
                  placeholder={method === "mobile_money" ? "0244xxxxxx" : "Account number"}
                  value={accountNumber}
                  onChange={e => setAccountNumber(e.target.value)}
                  className="h-10 flex-1"
                  maxLength={method === "mobile_money" ? 10 : undefined}
                />
                {method === "mobile_money" && (
                  <Button type="button" variant="secondary"
                    className="h-10 px-4 shrink-0 text-xs font-semibold"
                    onClick={verifyMomoAccount}
                    disabled={verifying || accountNumber.length !== 10}>
                    {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Verify"}
                  </Button>
                )}
              </div>
              {verifyError && <p className="text-xs text-red-600 mt-1">{verifyError}</p>}
              {method === "mobile_money" && !accountVerified && accountNumber.length > 0 && (
                <p className="text-xs text-amber-600 flex items-center gap-1.5 mt-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Tap Verify to confirm the account name.
                </p>
              )}
            </div>

            {editing && hasSavedMomo && (
              <button onClick={() => { setAccountNumber(store.momoNumber!); setBankCode(store.momoNetwork!); setAccountName(store.momoName!); setAccountVerified(true); setEditing(false); }}
                className="text-xs text-primary font-semibold hover:underline">
                ← Use saved account
              </button>
            )}
          </>
        )}

        {/* ── Amount ── */}
        <div>
          <Label className="text-sm font-semibold mb-1.5 block">Amount (GH₵)</Label>
          <Input type="number" min={MIN_WITHDRAWAL} step="0.01" placeholder="0.00"
            value={amount} onChange={e => setAmount(e.target.value)} className="h-10 font-mono" />
          <div className="mt-1.5 space-y-0.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Transaction fee</span><span className="font-medium">GH₵{WITHDRAWAL_FEE}.00</span>
            </div>
            {parsedAmount >= MIN_WITHDRAWAL && (
              <div className="flex justify-between text-xs font-semibold text-foreground border-t border-border pt-1 mt-1">
                <span>Total deducted from balance</span>
                <span>GH₵{totalDeduction.toFixed(2)}</span>
              </div>
            )}
            {parsedAmount > 0 && parsedAmount < MIN_WITHDRAWAL && (
              <p className="text-xs text-red-500">Minimum withdrawal is GH₵{MIN_WITHDRAWAL}.00</p>
            )}
          </div>
        </div>

        <div>
          <Label className="text-sm font-semibold mb-1.5 block">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input placeholder="e.g. Weekly profits" value={note} onChange={e => setNote(e.target.value)} className="h-10" />
        </div>

        {successMsg && (
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/10 px-4 py-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{successMsg}</p>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button className="w-full gap-2" onClick={() => { setSuccessMsg(""); withdraw.mutate(); }} disabled={!canWithdraw}>
          {withdraw.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownToLine className="w-4 h-4" />}
          Withdraw via Paystack
        </Button>
        <p className="text-xs text-muted-foreground text-center">Funds sent to your MoMo or bank via Paystack. GH₵{WITHDRAWAL_FEE} fee applies per withdrawal.</p>
      </div>

      {/* History */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-bold text-foreground">Withdrawal History</h3>
        </div>
        {withdrawals.length === 0 ? (
          <div className="p-10 text-center"><PiggyBank className="w-10 h-10 text-muted-foreground mx-auto mb-2" /><p className="text-sm text-muted-foreground">No withdrawals yet</p></div>
        ) : (
          <div className="divide-y divide-border">
            {withdrawals.map((w: any) => (
              <div key={w.id} className="px-5 py-3.5 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${w.status === "completed" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20" : w.status === "pending" ? "bg-amber-100 text-amber-600 dark:bg-amber-900/20" : "bg-red-100 text-red-600 dark:bg-red-900/20"}`}>
                  {w.status === "completed" ? <CheckCircle2 className="w-4 h-4" /> : w.status === "pending" ? <Clock className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{w.accountName || w.accountNumber}</div>
                  <div className="text-xs text-muted-foreground truncate">{w.accountName ? w.accountNumber + " · " : ""}{new Date(w.createdAt).toLocaleString()} · {w.method.replace("_", " ")}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-foreground">GH₵{w.amount.toFixed(2)}</div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[w.status] ?? "bg-gray-100"}`}>{w.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
function SettingsTab({ store }: { store: Store }) {
  const qc = useQueryClient();
  const [name, setName] = useState(store.name);
  const [description, setDescription] = useState(store.description);
  const [colorTheme, setColorTheme] = useState(store.colorTheme);

  const update = useMutation({
    mutationFn: () => storeApi.updateStore({ name, description, colorTheme }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myStore"] }),
  });

  const storeUrl = `${window.location.origin}/s/${store.slug}`;

  return (
    <div className="max-w-lg space-y-6">
      <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
        <h3 className="font-bold text-foreground">Store Settings</h3>
        <div>
          <Label className="text-sm font-semibold mb-1.5 block">Store Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} className="h-10" />
        </div>
        <div>
          <Label className="text-sm font-semibold mb-1.5 block">Description</Label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="resize-none" />
        </div>
        <div>
          <Label className="text-sm font-semibold mb-2 block">Color Theme</Label>
          <div className="flex flex-wrap gap-2">
            {COLOR_THEMES.map(t => (
              <button key={t.value} onClick={() => setColorTheme(t.value)} title={t.label}
                className={`w-9 h-9 rounded-xl ${t.bg} ring-offset-2 ring-offset-background transition-all ${colorTheme === t.value ? `ring-2 ${t.ring} scale-110` : "hover:scale-105"}`} />
            ))}
          </div>
        </div>
        {update.isSuccess && <p className="text-sm text-emerald-600 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Saved!</p>}
        {update.error && <p className="text-sm text-red-600">{(update.error as Error).message}</p>}
        <Button onClick={() => update.mutate()} disabled={update.isPending} className="gap-2">
          {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save Changes
        </Button>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="font-semibold text-foreground mb-1">Your Store Link</h3>
        <p className="text-sm text-muted-foreground mb-3">Share this link with your customers.</p>
        <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2.5">
          <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-mono flex-1 truncate">{storeUrl}</span>
        </div>
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(storeUrl)} className="gap-1.5">
            <Copy className="w-3.5 h-3.5" /> Copy
          </Button>
          <a href={storeUrl} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="gap-1.5"><ExternalLink className="w-3.5 h-3.5" /> Open</Button>
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────
export default function StoreManager() {
  const { data: store, isLoading } = useQuery<Store | null>({
    queryKey: ["myStore"],
    queryFn: storeApi.getMyStore,
  });
  const [created, setCreated] = useState<Store | null>(null);
  const activeStore = created ?? store;

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background">
        <Navbar />
        {isLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : activeStore ? (
          <StoreDashboard store={activeStore} />
        ) : (
          <CreateStoreForm onCreated={setCreated} />
        )}
      </div>
    </ProtectedRoute>
  );
}
