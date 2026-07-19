import { useState, useEffect, useCallback } from "react";
import { useListBundles, useGetWalletBalance, usePurchaseBundle, useGetOrder } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { BundleCard, BundleCardMini, NETWORK_STYLES, NETWORK_LABELS, type NetworkKey } from "@/components/BundleCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { platformPhase } from "@/lib/orderPhase";
import { useLocation, Link } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Zap, Wifi, Wallet, CheckCircle2, Clock, Loader2, XCircle,
  ArrowRight, RotateCcw, ListOrdered, ShoppingBag,
} from "lucide-react";

type Network = NetworkKey;

interface Bundle {
  id: number; name: string; description: string; dataAmount: string;
  validityDays: number; price: number; dealerPrice: number | null; agentPrice: number | null;
  category: string; network: string; isActive: boolean;
}

function getEffectivePrice(bundle: Bundle, role?: string | null): number {
  if (role === "dealer" && bundle.dealerPrice != null) return bundle.dealerPrice;
  if (role === "agent"  && bundle.agentPrice  != null) return bundle.agentPrice;
  return bundle.price;
}

const NETWORK_TABS: { key: Network; dot: string }[] = [
  { key: "mtn",         dot: "bg-yellow-400" },
  { key: "telecel",     dot: "bg-red-500" },
  { key: "at-ishare",   dot: "bg-blue-500" },
  { key: "at-bigtime",  dot: "bg-green-500" },
];

const STATUS_CONFIG = {
  pending: {
    icon: Clock, label: "Order Placed", sub: "Being processed by the network",
    color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/10",
    border: "border-amber-200 dark:border-amber-800", dot: "bg-amber-400", animate: true,
  },
  processing: {
    icon: Loader2, label: "Processing", sub: "Activating on the network",
    color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/10",
    border: "border-blue-200 dark:border-blue-800", dot: "bg-blue-400", animate: true,
  },
  completed: {
    icon: CheckCircle2, label: "Bundle Activated", sub: "Successfully activated on your line",
    color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/10",
    border: "border-emerald-200 dark:border-emerald-800", dot: "bg-emerald-400", animate: false,
  },
  failed: {
    icon: XCircle, label: "Activation Failed", sub: "Please contact support",
    color: "text-red-600", bg: "bg-red-50 dark:bg-red-900/10",
    border: "border-red-200 dark:border-red-800", dot: "bg-red-400", animate: false,
  },
  refunded: {
    icon: XCircle, label: "Order Refunded", sub: "The amount was returned to your wallet",
    color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-900/10",
    border: "border-rose-200 dark:border-rose-800", dot: "bg-rose-400", animate: false,
  },
};

// ─── Order Status Card ────────────────────────────────────────────────────────
function OrderStatusCard({
  orderId, bundle, network, phone, onBuyAnother,
}: { orderId: number; bundle: Bundle; network: Network; phone: string; onBuyAnother: () => void }) {
  const [enabled, setEnabled] = useState(true);
  const qc = useQueryClient();
  const { user } = useAuth();

  const { data: order, refetch } = useGetOrder({ id: orderId }, {
    query: {
      enabled,
      refetchInterval: (q) => {
        const d = q.state.data;
        if (!d) return 3000;
        const p = platformPhase(d);
        return p === "pending" || p === "processing" ? 3000 : false;
      },
    },
  });

  const phase = order ? platformPhase(order) : "pending";

  useEffect(() => {
    if (phase === "completed" || phase === "failed" || phase === "refunded") {
      setEnabled(false);
      qc.invalidateQueries({ queryKey: ["getWalletBalance"] });
    }
  }, [phase, qc]);

  const status = phase as keyof typeof STATUS_CONFIG;
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;

  return (
    <div className="space-y-4">
      <BundleCardMini
        dataAmount={bundle.dataAmount}
        network={network}
        price={order?.price ?? getEffectivePrice(bundle, user?.role)}
        validityDays={bundle.validityDays}
        phone={phone}
      />

      <div className={`rounded-2xl border p-5 ${cfg.bg} ${cfg.border}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-mono text-muted-foreground">Order #{orderId}</div>
          <button onClick={() => refetch()} className="p-1 rounded-lg hover:bg-black/5">
            <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cfg.bg} border ${cfg.border}`}>
            <Icon className={`w-5 h-5 ${cfg.color} ${cfg.animate && status === "processing" ? "animate-spin" : ""}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className={`font-bold text-base ${cfg.color}`}>{cfg.label}</div>
            <div className="text-sm text-muted-foreground mt-0.5">{cfg.sub}</div>
          </div>
          {(status === "pending" || status === "processing") && (
            <div className="flex items-center gap-1 shrink-0">
              <span className={`w-2 h-2 rounded-full ${cfg.dot} animate-pulse`} />
              <span className="text-xs text-muted-foreground">Live</span>
            </div>
          )}
        </div>

        {/* Progress steps */}
        <div className="flex items-center gap-2 mt-4">
          {(["pending", "processing", "completed"] as const).map((s, i, arr) => {
            const isEnded = status === "failed" || status === "refunded";
            const isDone = (!isEnded && i < arr.indexOf(status as (typeof arr)[number])) || status === "completed";
            const isCur = s === status && !isEnded;
            return (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${
                  isEnded && i === 0 ? "border-red-400 bg-red-100 text-red-600"
                  : isDone ? "border-emerald-400 bg-emerald-400 text-white"
                  : isCur ? `border-current ${cfg.color}` : "border-muted bg-muted"
                }`}>
                  {isEnded && i === 0 ? "!" : isDone ? "✓" : i + 1}
                </div>
                <span className={`text-[10px] font-semibold capitalize ${isCur ? cfg.color : isDone ? "text-emerald-600" : "text-muted-foreground"}`}>{s}</span>
                {i < arr.length - 1 && <div className={`flex-1 h-0.5 rounded ${isDone ? "bg-emerald-400" : "bg-muted"}`} />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 gap-2" onClick={onBuyAnother}>
          <ShoppingBag className="w-4 h-4" /> Buy Another
        </Button>
        <Link href="/orders" className="flex-1">
          <Button variant="secondary" className="w-full gap-2">
            <ListOrdered className="w-4 h-4" /> All Orders
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ─── Purchase Dialog ──────────────────────────────────────────────────────────
function PurchaseDialog({
  open, bundle, network, walletBalance, onClose, onSuccess,
}: {
  open: boolean; bundle: Bundle | null; network: Network;
  walletBalance: number; onClose: () => void;
  onSuccess: (orderId: number, phone: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const purchase = usePurchaseBundle();
  const { user } = useAuth();
  const price = bundle ? getEffectivePrice(bundle, user?.role) : 0;
  const insufficient = walletBalance < price;

  const handlePurchase = () => {
    if (!bundle || !phone.trim() || insufficient) return;
    purchase.mutate(
      { data: { bundleId: bundle.id, phoneNumber: phone.trim() } },
      { onSuccess: (order) => { setPhone(""); onSuccess(order.id, phone.trim()); } }
    );
  };

  const errMsg = purchase.error ? (purchase.error as { message?: string })?.message ?? "Purchase failed" : null;
  const style = NETWORK_STYLES[network] ?? NETWORK_STYLES["at-ishare"];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); purchase.reset?.(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" /> Instant Purchase
          </DialogTitle>
          <DialogDescription>Deducted from your wallet immediately</DialogDescription>
        </DialogHeader>

        {bundle && (
          <div className="space-y-4 py-1">
            <BundleCardMini
              dataAmount={bundle.dataAmount}
              network={network}
              price={price}
              validityDays={bundle.validityDays}
            />

            {/* Wallet balance */}
            <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl border ${insufficient ? "bg-red-50 border-red-200 dark:bg-red-900/10 dark:border-red-800" : "bg-primary/5 border-primary/20"}`}>
              <div className="flex items-center gap-2">
                <Wallet className={`w-4 h-4 ${insufficient ? "text-red-500" : "text-primary"}`} />
                <span className={`text-sm font-medium ${insufficient ? "text-red-700 dark:text-red-400" : "text-foreground"}`}>Wallet Balance</span>
              </div>
              <div className="text-right">
                <div className={`font-bold ${insufficient ? "text-red-600" : "text-foreground"}`}>GH₵{walletBalance.toFixed(2)}</div>
                {insufficient && <div className="text-xs text-red-500">Need GH₵{(price - walletBalance).toFixed(2)} more</div>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="shop-phone">Phone to activate on</Label>
              <Input id="shop-phone" type="tel" inputMode="numeric" placeholder="0244xxxxxx" maxLength={10} value={phone}
                onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} disabled={purchase.isPending} data-testid="input-shop-phone" />
            </div>

            {errMsg && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 dark:bg-red-900/10 dark:border-red-800">
                <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400">{errMsg}</p>
              </div>
            )}
            {insufficient && (
              <Link href="/wallet">
                <Button variant="outline" size="sm" className="w-full gap-2 text-primary border-primary/30">
                  <Wallet className="w-3.5 h-3.5" /> Top up wallet <ArrowRight className="w-3.5 h-3.5 ml-auto" />
                </Button>
              </Link>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={purchase.isPending}>Cancel</Button>
          <Button
            onClick={handlePurchase}
            disabled={!phone.trim() || phone.trim().length < 7 || insufficient || purchase.isPending}
            className="gap-2" data-testid="button-confirm-purchase"
          >
            {purchase.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</> : <><Zap className="w-4 h-4" /> Pay GH₵{price.toFixed(2)}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Shop() {
  const { isAuthenticated, user } = useAuth();
  const [, setLocation] = useLocation();
  const [activeNetwork, setActiveNetwork] = useState<Network>("mtn");
  const [selected, setSelected] = useState<Bundle | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<{ id: number; phone: string } | null>(null);

  const { data: bundles, isLoading } = useListBundles({ network: activeNetwork });
  const { data: walletData } = useGetWalletBalance({ query: { enabled: isAuthenticated } });
  const walletBalance = walletData?.balance ?? 0;

  const parseDataMB = (str: string) => {
    const lower = str.toLowerCase().replace(/\s/g, "");
    if (lower.includes("unlimited")) return Infinity;
    const m = lower.match(/(\d+(?:\.\d+)?)(tb|gb|mb)/);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    return m[2] === "tb" ? n * 1024 * 1024 : m[2] === "gb" ? n * 1024 : n;
  };

  const filtered = [...(bundles ?? [])].sort((a, b) => parseDataMB(a.dataAmount) - parseDataMB(b.dataAmount));

  const handleSelect = (bundle: Bundle) => {
    if (!isAuthenticated) { setLocation("/login"); return; }
    setSelected(bundle);
    setDialogOpen(true);
  };

  const handleSuccess = useCallback((orderId: number, phone: string) => {
    setDialogOpen(false);
    setCompletedOrder({ id: orderId, phone });
  }, []);

  const handleBuyAnother = useCallback(() => {
    setCompletedOrder(null);
    setSelected(null);
  }, []);

  const activeStyle = NETWORK_STYLES[activeNetwork] ?? NETWORK_STYLES.mtn;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-2.5">
              <ShoppingBag className="w-8 h-8 text-primary" /> Instant Shop
            </h1>
            <p className="text-muted-foreground mt-1">Buy instantly — deducted from your wallet</p>
          </div>
          {isAuthenticated && (
            <Link href="/wallet">
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 hover:bg-primary/15 transition-colors cursor-pointer">
                <Wallet className="w-4 h-4 text-primary" />
                <div>
                  <div className="text-xs text-muted-foreground">Wallet Balance</div>
                  <div className="font-bold text-primary">GH₵{walletBalance.toFixed(2)}</div>
                </div>
              </div>
            </Link>
          )}
        </div>

        {/* Order Status */}
        {completedOrder && selected && (
          <div className="mb-8 max-w-md mx-auto">
            <div className="mb-4 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <h2 className="font-bold text-foreground">Order Status</h2>
            </div>
            <OrderStatusCard
              orderId={completedOrder.id} bundle={selected}
              network={activeNetwork} phone={completedOrder.phone}
              onBuyAnother={handleBuyAnother}
            />
          </div>
        )}

        {!completedOrder && (
          <>
            {/* How it works */}
            <div className="mb-6 rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4 flex flex-wrap gap-4 items-center">
              {[
                { n: "1", t: "Pick a bundle" },
                { n: "2", t: "Enter your phone" },
                { n: "3", t: "Wallet charged instantly" },
                { n: "4", t: "Track activation live" },
              ].map((s, i, arr) => (
                <div key={s.n} className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">{s.n}</span>
                  <span className="text-sm font-medium text-foreground">{s.t}</span>
                  {i < arr.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />}
                </div>
              ))}
            </div>

            {/* Network tabs */}
            <div className="flex flex-wrap gap-2 mb-6">
              {NETWORK_TABS.map(({ key, dot }) => {
                const style = NETWORK_STYLES[key];
                const isActive = activeNetwork === key;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveNetwork(key)}
                    data-testid={`tab-${key}`}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm border-2 transition-all ${
                      isActive
                        ? `border-transparent ${style.gradient} ${style.text} shadow-md`
                        : "border-border bg-background text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                    {NETWORK_LABELS[key]}
                  </button>
                );
              })}
            </div>

            {/* Bundle grid */}
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-56 rounded-2xl bg-muted animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20">
                <Wifi className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold">No plans found</h3>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {filtered.map(bundle => (
                  <BundleCard
                    key={bundle.id}
                    dataAmount={bundle.dataAmount}
                    network={activeNetwork}
                    price={getEffectivePrice(bundle as unknown as Bundle, user?.role)}
                    validityDays={bundle.validityDays}
                    insufficient={isAuthenticated && walletBalance < getEffectivePrice(bundle as unknown as Bundle, user?.role)}
                    showBuyHover
                    onClick={() => handleSelect(bundle as unknown as Bundle)}
                    data-testid={`card-bundle-${bundle.id}`}
                  />
                ))}
              </div>
            )}

            {!isAuthenticated && (
              <div className="mt-8 rounded-2xl border border-border bg-card p-8 text-center">
                <ShoppingBag className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-bold text-foreground mb-1">Sign in to purchase</h3>
                <p className="text-sm text-muted-foreground mb-4">Create a free account and top up your wallet.</p>
                <div className="flex justify-center gap-3">
                  <Link href="/login"><Button variant="outline">Log In</Button></Link>
                  <Link href="/register"><Button>Get Started</Button></Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <PurchaseDialog
        open={dialogOpen} bundle={selected} network={activeNetwork}
        walletBalance={walletBalance} onClose={() => setDialogOpen(false)}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
