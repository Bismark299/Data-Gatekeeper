import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { storeApi, type Store, type StoreBundle, type StoreStats } from "@/lib/storeApi";
import { useListBundles } from "@workspace/api-client-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "wouter";
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
};

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-5 flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-foreground">{value}</div>
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
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
  const [tab, setTab] = useState<"overview" | "bundles" | "orders" | "settings" | "withdrawals">("overview");
  const [copied, setCopied] = useState(false);

  const { data: storeData } = useQuery<Store | null>({ queryKey: ["myStore"], queryFn: storeApi.getMyStore, initialData: initialStore });
  const store: Store = (storeData ?? initialStore)!;
  const { data: stats } = useQuery<StoreStats>({ queryKey: ["myStoreStats"], queryFn: storeApi.getStats, refetchInterval: 30000 });
  const { data: storeBundles = [] } = useQuery<StoreBundle[]>({ queryKey: ["myStoreBundles"], queryFn: storeApi.getBundles });
  const { data: orders = [] } = useQuery({ queryKey: ["myStoreOrders"], queryFn: storeApi.getOrders });
  const { data: withdrawals = [] } = useQuery({ queryKey: ["myStoreWithdrawals"], queryFn: storeApi.getWithdrawals });

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
      <div className="flex gap-1 bg-muted rounded-2xl p-1.5 mb-6 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm whitespace-nowrap transition-all flex-1 justify-center ${
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
      {tab === "bundles" && <BundlesTab storeBundles={storeBundles} store={store} />}
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
                  <div className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString()}</div>
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

function BundlesTab({ storeBundles, store }: { storeBundles: StoreBundle[]; store: Store }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addNetwork, setAddNetwork] = useState<Network>("mtn");
  const [selectedBundleId, setSelectedBundleId] = useState<number | null>(null);
  const [sellingPrice, setSellingPrice] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [addError, setAddError] = useState("");

  const { data: availableBundles = [] } = useListBundles({ network: addNetwork }, { query: { enabled: showAdd } });
  const theme = THEME_MAP[store.colorTheme] ?? THEME_MAP.blue;

  const addBundle = useMutation({
    mutationFn: () => {
      if (!selectedBundleId || !sellingPrice) throw new Error("Fill all fields");
      return storeApi.addBundle({ bundleId: selectedBundleId, sellingPrice: parseFloat(sellingPrice) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myStoreBundles"] });
      setShowAdd(false); setSelectedBundleId(null); setSellingPrice(""); setAddError("");
    },
    onError: (e) => setAddError((e as Error).message),
  });

  const removeBundle = useMutation({
    mutationFn: (id: number) => storeApi.removeBundle(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myStoreBundles"] }),
  });

  const updateBundle = useMutation({
    mutationFn: ({ id, price }: { id: number; price: number }) => storeApi.updateBundle(id, { sellingPrice: price }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["myStoreBundles"] }); setEditingId(null); },
  });

  const storeBundleIds = new Set(storeBundles.map(sb => sb.bundleId));
  const notInStore = (availableBundles as any[]).filter(b => !storeBundleIds.has(b.id));

  const selectedBundle = (availableBundles as any[]).find(b => b.id === selectedBundleId);
  const basePrice = selectedBundle ? parseFloat(selectedBundle.price) : 0;
  const profit = sellingPrice && basePrice ? Math.max(0, parseFloat(sellingPrice) - basePrice) : 0;

  return (
    <div className="space-y-5">
      {/* Add bundle CTA */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-foreground text-lg">{storeBundles.length} Bundle{storeBundles.length !== 1 ? "s" : ""} in your store</h3>
        <Button onClick={() => setShowAdd(!showAdd)} className="gap-2">
          {showAdd ? <><X className="w-4 h-4" /> Cancel</> : <><Plus className="w-4 h-4" /> Add Bundle</>}
        </Button>
      </div>

      {/* Add bundle panel */}
      {showAdd && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <h4 className="font-semibold text-foreground">Add a Bundle to Your Store</h4>

          {/* Network selector */}
          <div className="flex flex-wrap gap-2">
            {ALL_NETWORKS.map(n => (
              <button key={n} onClick={() => { setAddNetwork(n); setSelectedBundleId(null); setSellingPrice(""); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${addNetwork === n ? `${theme.bg} ${theme.text} border-transparent` : "border-border text-muted-foreground hover:border-primary/40"}`}>
                {NETWORK_LABELS[n]}
              </button>
            ))}
          </div>

          {/* Bundle picker */}
          {notInStore.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-6">All {NETWORK_LABELS[addNetwork]} bundles already added</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {notInStore.map((b: any) => (
                <button key={b.id} onClick={() => { setSelectedBundleId(b.id); setSellingPrice(parseFloat(b.price).toFixed(2)); }}
                  className={`relative p-3 rounded-xl border-2 text-left transition-all ${selectedBundleId === b.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                  {selectedBundleId === b.id && <Check className="absolute top-2 right-2 w-4 h-4 text-primary" />}
                  <div className="text-xl font-black text-foreground">{b.dataAmount}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{b.validityDays}d · Base GH₵{b.price}</div>
                </button>
              ))}
            </div>
          )}

          {/* Selling price */}
          {selectedBundleId && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <div>
                <Label htmlFor="selling-price" className="text-sm font-semibold mb-1.5 block">Your Selling Price (GH₵)</Label>
                <Input id="selling-price" type="number" step="0.01" min={basePrice} value={sellingPrice}
                  onChange={e => setSellingPrice(e.target.value)} className="h-10 font-mono" />
                <p className="text-xs text-muted-foreground mt-1">Min: GH₵{basePrice.toFixed(2)} (base price)</p>
              </div>
              <div className={`p-3 rounded-xl border ${profit > 0 ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-800" : "bg-muted border-border"}`}>
                <div className="text-xs text-muted-foreground">Your profit per sale</div>
                <div className={`text-2xl font-black ${profit > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>GH₵{profit.toFixed(2)}</div>
              </div>
            </div>
          )}

          {addError && <p className="text-sm text-red-600">{addError}</p>}

          <Button onClick={() => addBundle.mutate()}
            disabled={!selectedBundleId || !sellingPrice || parseFloat(sellingPrice) < basePrice || addBundle.isPending}
            className="gap-2">
            {addBundle.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add to Store
          </Button>
        </div>
      )}

      {/* Current bundles */}
      {storeBundles.length === 0 && !showAdd ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-bold text-foreground mb-1">No bundles yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Add bundles from the admin's collection and set your selling prices.</p>
          <Button onClick={() => setShowAdd(true)} className="gap-2"><Plus className="w-4 h-4" /> Add Your First Bundle</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {storeBundles.map(sb => (
            <div key={sb.id} className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className={`${theme.bg} flex items-center justify-center relative`} style={{ height: 100 }}>
                <span className={`text-4xl font-black ${theme.text}`}>{sb.dataAmount}</span>
                <span className={`absolute top-2 left-2 text-[10px] font-extrabold border-2 rounded-full px-2 py-0.5 ${theme.text} border-current opacity-80`}>
                  {NETWORK_LABELS[sb.network] ?? sb.network}
                </span>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Base price</span>
                  <span className="font-semibold text-foreground">GH₵{sb.basePrice.toFixed(2)}</span>
                </div>
                {editingId === sb.id ? (
                  <div className="space-y-2">
                    <Input type="number" value={editPrice} onChange={e => setEditPrice(e.target.value)} className="h-9 font-mono" />
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1" onClick={() => updateBundle.mutate({ id: sb.id, price: parseFloat(editPrice) })}
                        disabled={!editPrice || parseFloat(editPrice) < sb.basePrice || updateBundle.isPending}>
                        {updateBundle.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground">Your price</div>
                      <div className="text-lg font-bold text-foreground">GH₵{sb.sellingPrice.toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Profit</div>
                      <div className="text-base font-bold text-emerald-600">+GH₵{(sb.sellingPrice - sb.basePrice).toFixed(2)}</div>
                    </div>
                  </div>
                )}
                {editingId !== sb.id && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 gap-1"
                      onClick={() => { setEditingId(sb.id); setEditPrice(sb.sellingPrice.toFixed(2)); }}>
                      <Edit2 className="w-3 h-3" /> Edit Price
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50"
                      onClick={() => removeBundle.mutate(sb.id)} disabled={removeBundle.isPending}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Orders Tab ───────────────────────────────────────────────────────────────
function OrdersTab({ orders }: { orders: any[] }) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="font-bold text-foreground">Store Sales</h3>
      </div>
      {orders.length === 0 ? (
        <div className="p-12 text-center">
          <ListOrdered className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No orders yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["#", "Bundle", "Network", "Phone", "Revenue", "Profit", "Status", "Date"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((o: any) => (
                <tr key={o.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{o.id}</td>
                  <td className="px-4 py-3 font-semibold text-foreground">{o.bundleData}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${NETWORK_COLORS[o.bundleNetwork] ?? "bg-gray-100 text-gray-700"}`}>{NETWORK_LABELS[o.bundleNetwork] ?? o.bundleNetwork}</span></td>
                  <td className="px-4 py-3 font-mono text-xs">{o.customerPhone}</td>
                  <td className="px-4 py-3 font-semibold">GH₵{o.sellingPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-emerald-600 font-semibold">+GH₵{o.profit.toFixed(2)}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[o.status] ?? "bg-gray-100"}`}>{o.status}</span></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Withdrawals Tab ──────────────────────────────────────────────────────────
function WithdrawalsTab({ stats, withdrawals, store }: { stats?: StoreStats; withdrawals: any[]; store: Store }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [method, setMethod] = useState("mobile_money");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const withdraw = useMutation({
    mutationFn: () => storeApi.withdraw({ amount: parseFloat(amount), method, accountNumber, note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myStoreStats"] });
      qc.invalidateQueries({ queryKey: ["myStoreWithdrawals"] });
      qc.invalidateQueries({ queryKey: ["myStore"] });
      setAmount(""); setAccountNumber(""); setNote(""); setError("");
    },
    onError: (e) => setError((e as Error).message),
  });

  const profitBalance = stats?.profitBalance ?? store.profitBalance;

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

        <div>
          <Label className="text-sm font-semibold mb-1.5 block">Amount (GH₵)</Label>
          <Input type="number" min="0.01" max={profitBalance} step="0.01" placeholder="0.00"
            value={amount} onChange={e => setAmount(e.target.value)} className="h-10 font-mono" />
        </div>
        <div>
          <Label className="text-sm font-semibold mb-1.5 block">Payment Method</Label>
          <select value={method} onChange={e => setMethod(e.target.value)} className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm">
            <option value="mobile_money">Mobile Money</option>
            <option value="bank">Bank Transfer</option>
          </select>
        </div>
        <div>
          <Label className="text-sm font-semibold mb-1.5 block">Account Number / Phone</Label>
          <Input placeholder="0244xxxxxx" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} className="h-10" />
        </div>
        <div>
          <Label className="text-sm font-semibold mb-1.5 block">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input placeholder="e.g. MTN MoMo" value={note} onChange={e => setNote(e.target.value)} className="h-10" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button className="w-full gap-2" onClick={() => withdraw.mutate()}
          disabled={!amount || !accountNumber || parseFloat(amount) <= 0 || parseFloat(amount) > profitBalance || withdraw.isPending}>
          {withdraw.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownToLine className="w-4 h-4" />}
          Request Withdrawal
        </Button>
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
                  <div className="text-sm font-semibold text-foreground">{w.accountNumber}</div>
                  <div className="text-xs text-muted-foreground">{new Date(w.createdAt).toLocaleString()} · {w.method.replace("_", " ")}</div>
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
