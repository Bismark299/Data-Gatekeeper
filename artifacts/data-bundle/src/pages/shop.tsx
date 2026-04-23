import { useState, useEffect, useCallback } from "react";
import { useListBundles, useGetWalletBalance, usePurchaseBundle, useGetOrder } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useLocation, Link } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Zap, Wifi, Wallet, CheckCircle2, Clock, Loader2, XCircle,
  ArrowRight, RotateCcw, ListOrdered, ShoppingBag,
} from "lucide-react";

type Network = "mtn" | "telecel" | "at-ishare" | "at-bigtime";

interface Bundle {
  id: number; name: string; description: string; dataAmount: string;
  validityDays: number; price: number; category: string; network: string; isActive: boolean;
}

const NETWORKS: Record<Network, {
  label: string; shortLabel: string; tagline: string;
  cardBg: string; cardText: string; badgeBorder: string;
  tabActive: string; dot: string;
}> = {
  mtn:         { label: "MTN",        shortLabel: "MTN",     tagline: "Everywhere You Go",    cardBg: "bg-[#FFCC00]",  cardText: "text-gray-900", badgeBorder: "border-gray-900 text-gray-900", tabActive: "bg-yellow-400 text-gray-900 border-yellow-500",   dot: "bg-yellow-400" },
  telecel:     { label: "Telecel",    shortLabel: "TELECEL", tagline: "Advancing Lives",       cardBg: "bg-red-600",    cardText: "text-white",    badgeBorder: "border-white text-white",       tabActive: "bg-red-600 text-white border-red-600",            dot: "bg-red-500" },
  "at-ishare": { label: "AT iShare",  shortLabel: "AT",      tagline: "Share the Experience", cardBg: "bg-blue-600",   cardText: "text-white",    badgeBorder: "border-white text-white",       tabActive: "bg-blue-600 text-white border-blue-600",          dot: "bg-blue-500" },
  "at-bigtime":{ label: "AT Big-Time",shortLabel: "AT",      tagline: "Go Big or Go Home",    cardBg: "bg-green-700",  cardText: "text-white",    badgeBorder: "border-white text-white",       tabActive: "bg-green-700 text-white border-green-700",        dot: "bg-green-600" },
};

const NETWORK_ICONS: Record<Network, string> = {
  mtn: "🟡", telecel: "🔴", "at-ishare": "🔵", "at-bigtime": "🟢",
};

const STATUS_CONFIG = {
  pending: {
    icon: Clock,
    label: "Order Placed",
    sub: "Your bundle is being processed by the network",
    color: "text-amber-600",
    bg: "bg-amber-50 dark:bg-amber-900/10",
    border: "border-amber-200 dark:border-amber-800",
    dot: "bg-amber-400",
    animate: true,
  },
  processing: {
    icon: Loader2,
    label: "Processing",
    sub: "Activating your bundle on the network",
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-900/10",
    border: "border-blue-200 dark:border-blue-800",
    dot: "bg-blue-400",
    animate: true,
  },
  completed: {
    icon: CheckCircle2,
    label: "Bundle Activated",
    sub: "Your data bundle has been successfully activated",
    color: "text-emerald-600",
    bg: "bg-emerald-50 dark:bg-emerald-900/10",
    border: "border-emerald-200 dark:border-emerald-800",
    dot: "bg-emerald-400",
    animate: false,
  },
  failed: {
    icon: XCircle,
    label: "Activation Failed",
    sub: "Something went wrong. Please contact support.",
    color: "text-red-600",
    bg: "bg-red-50 dark:bg-red-900/10",
    border: "border-red-200 dark:border-red-800",
    dot: "bg-red-400",
    animate: false,
  },
};

function formatDuration(days: number | undefined | null) {
  if (!days) return "No Expiry";
  if (days === 1) return "1 Day";
  if (days === 7) return "7 Days";
  if (days === 30) return "30 Days";
  return `${days} Days`;
}

// Order status tracker shown after purchase
function OrderStatusCard({
  orderId,
  bundle,
  network,
  phone,
  onBuyAnother,
}: {
  orderId: number;
  bundle: Bundle;
  network: Network;
  phone: string;
  onBuyAnother: () => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const queryClient = useQueryClient();

  const { data: order, refetch } = useGetOrder({ id: orderId }, {
    query: {
      enabled,
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        return s === "pending" || s === "processing" ? 3000 : false;
      },
      refetchIntervalInBackground: true,
    },
  });

  // Stop polling when terminal state
  useEffect(() => {
    if (order?.status === "completed" || order?.status === "failed") {
      setEnabled(false);
      // Refresh wallet balance
      queryClient.invalidateQueries({ queryKey: ["getWalletBalance"] });
    }
  }, [order?.status, queryClient]);

  const status = (order?.status ?? "pending") as keyof typeof STATUS_CONFIG;
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const theme = NETWORKS[network];
  const Icon = cfg.icon;

  return (
    <div className="space-y-5">
      {/* Bundle receipt */}
      <div className="rounded-2xl overflow-hidden border border-border shadow-sm">
        <div className={`${theme.cardBg} relative flex items-center justify-center py-8`}>
          <div className={`absolute top-3 left-3 border-2 rounded-full px-2.5 py-0.5 text-xs font-extrabold tracking-widest ${theme.badgeBorder}`}>
            {theme.shortLabel}
          </div>
          <span className={`text-5xl font-black ${theme.cardText}`}>{bundle.dataAmount}</span>
        </div>
        <div className="bg-[#2b2b2b] grid grid-cols-3 divide-x divide-gray-600">
          <div className="py-3 text-center"><div className="text-sm font-bold text-white">GH₵{bundle.price}</div><div className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wide">Price</div></div>
          <div className="py-3 text-center"><div className="text-sm font-bold text-white">{phone}</div><div className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wide">Number</div></div>
          <div className="py-3 text-center"><div className="text-sm font-bold text-white">{formatDuration(bundle.validityDays)}</div><div className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wide">Duration</div></div>
        </div>
      </div>

      {/* Order ID + status */}
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
            const isDone  = i < arr.indexOf(status === "failed" ? "completed" : status as any) || status === "completed";
            const isCur   = s === status && status !== "failed";
            return (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all ${
                  status === "failed" ? "border-red-400 bg-red-100 text-red-600 dark:bg-red-900/20"
                  : isDone ? "border-emerald-400 bg-emerald-400 text-white"
                  : isCur ? `border-current ${cfg.color}`
                  : "border-muted bg-muted"
                }`}>
                  {status === "failed" && i === 0 ? "!" : isDone ? "✓" : i + 1}
                </div>
                <span className={`text-[10px] font-semibold capitalize ${isCur ? cfg.color : isDone ? "text-emerald-600" : "text-muted-foreground"}`}>
                  {s}
                </span>
                {i < arr.length - 1 && <div className={`flex-1 h-0.5 rounded ${isDone ? "bg-emerald-400" : "bg-muted"}`} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
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

// Purchase confirmation dialog
function PurchaseDialog({
  open,
  bundle,
  network,
  walletBalance,
  onClose,
  onSuccess,
}: {
  open: boolean;
  bundle: Bundle | null;
  network: Network;
  walletBalance: number;
  onClose: () => void;
  onSuccess: (orderId: number, phone: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const purchase = usePurchaseBundle();
  const theme = NETWORKS[network];

  const price = bundle?.price ?? 0;
  const insufficient = walletBalance < price;

  const handlePurchase = () => {
    if (!bundle || !phone.trim() || insufficient) return;
    purchase.mutate(
      { data: { bundleId: bundle.id, phoneNumber: phone.trim() } },
      {
        onSuccess: (order) => {
          setPhone("");
          onSuccess(order.id, phone.trim());
        },
      }
    );
  };

  const errMsg = purchase.error
    ? (purchase.error as { message?: string })?.message ?? "Purchase failed. Try again."
    : null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); purchase.reset?.(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" /> Instant Purchase
          </DialogTitle>
          <DialogDescription>Bundle will be activated immediately after payment</DialogDescription>
        </DialogHeader>

        {bundle && (
          <div className="space-y-4 py-1">
            {/* Bundle preview */}
            <div className="rounded-xl overflow-hidden border border-border">
              <div className={`${theme.cardBg} relative flex items-center justify-center py-6`}>
                <div className={`absolute top-2 left-3 border-2 rounded-full px-2.5 py-0.5 text-xs font-extrabold tracking-widest ${theme.badgeBorder}`}>
                  {theme.shortLabel}
                </div>
                <span className={`text-4xl font-black ${theme.cardText}`}>{bundle.dataAmount}</span>
              </div>
              <div className="bg-[#2b2b2b] grid grid-cols-3 divide-x divide-gray-600">
                <div className="py-2 text-center"><div className="text-sm font-bold text-white">GH₵{bundle.price}</div><div className="text-[10px] text-gray-400 uppercase">Price</div></div>
                <div className="py-2 text-center"><div className="text-sm font-bold text-white">N/A</div><div className="text-[10px] text-gray-400 uppercase">Rollover</div></div>
                <div className="py-2 text-center"><div className="text-sm font-bold text-white">{formatDuration(bundle.validityDays)}</div><div className="text-[10px] text-gray-400 uppercase">Duration</div></div>
              </div>
            </div>

            {/* Wallet balance */}
            <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl border ${insufficient ? "bg-red-50 border-red-200 dark:bg-red-900/10 dark:border-red-800" : "bg-primary/5 border-primary/20"}`}>
              <div className="flex items-center gap-2">
                <Wallet className={`w-4 h-4 ${insufficient ? "text-red-500" : "text-primary"}`} />
                <span className={`text-sm font-medium ${insufficient ? "text-red-700 dark:text-red-400" : "text-foreground"}`}>
                  Wallet Balance
                </span>
              </div>
              <div className="text-right">
                <div className={`font-bold ${insufficient ? "text-red-600" : "text-foreground"}`}>
                  GH₵{walletBalance.toFixed(2)}
                </div>
                {insufficient && (
                  <div className="text-xs text-red-500">Need GH₵{(price - walletBalance).toFixed(2)} more</div>
                )}
              </div>
            </div>

            {/* Phone number */}
            <div className="space-y-1.5">
              <Label htmlFor="shop-phone">Phone number to activate on</Label>
              <Input
                id="shop-phone"
                type="tel"
                placeholder="0244xxxxxx"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                data-testid="input-shop-phone"
                disabled={purchase.isPending}
              />
            </div>

            {/* Error */}
            {errMsg && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 dark:bg-red-900/10 dark:border-red-800">
                <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400">{errMsg}</p>
              </div>
            )}

            {/* Insufficient — top up CTA */}
            {insufficient && (
              <Link href="/wallet">
                <Button variant="outline" size="sm" className="w-full gap-2 text-primary border-primary/30">
                  <Wallet className="w-3.5 h-3.5" /> Top up wallet to continue
                  <ArrowRight className="w-3.5 h-3.5 ml-auto" />
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
            className="gap-2"
            data-testid="button-confirm-purchase"
          >
            {purchase.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
            ) : (
              <><Zap className="w-4 h-4" /> Pay GH₵{bundle?.price}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Shop() {
  const { isAuthenticated } = useAuth();
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
  const theme = NETWORKS[activeNetwork];

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

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-2.5">
              <ShoppingBag className="w-8 h-8 text-primary" />
              Instant Shop
            </h1>
            <p className="text-muted-foreground mt-1">Buy a bundle instantly — deducted from your wallet</p>
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

        {/* Order status panel */}
        {completedOrder && selected && (
          <div className="mb-8 max-w-md mx-auto">
            <div className="mb-4 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <h2 className="font-bold text-foreground">Order Status</h2>
            </div>
            <OrderStatusCard
              orderId={completedOrder.id}
              bundle={selected}
              network={activeNetwork}
              phone={completedOrder.phone}
              onBuyAnother={handleBuyAnother}
            />
          </div>
        )}

        {!completedOrder && (
          <>
            {/* How it works banner */}
            <div className="mb-6 rounded-2xl bg-primary/5 border border-primary/10 px-5 py-4 flex flex-wrap gap-4 items-center">
              {[
                { icon: "1", text: "Pick a bundle below" },
                { icon: "2", text: "Enter your phone number" },
                { icon: "3", text: "Wallet is charged instantly" },
                { icon: "4", text: "Track activation live" },
              ].map(s => (
                <div key={s.icon} className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">{s.icon}</span>
                  <span className="text-sm font-medium text-foreground">{s.text}</span>
                  {s.icon !== "4" && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />}
                </div>
              ))}
            </div>

            {/* Network tabs */}
            <div className="flex flex-wrap gap-2 mb-6">
              {(Object.keys(NETWORKS) as Network[]).map(net => (
                <button
                  key={net}
                  onClick={() => setActiveNetwork(net)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm border-2 transition-all ${
                    activeNetwork === net ? NETWORKS[net].tabActive : "border-border bg-background text-muted-foreground hover:border-primary/40"
                  }`}
                  data-testid={`tab-${net}`}
                >
                  <span className="text-base">{NETWORK_ICONS[net]}</span>
                  {NETWORKS[net].label}
                </button>
              ))}
            </div>

            {/* Bundle grid */}
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-56 rounded-2xl bg-muted animate-pulse" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20">
                <Wifi className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold">No plans found</h3>
                <p className="text-muted-foreground mt-1">Try a different network.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {filtered.map(bundle => {
                  const insufficient = isAuthenticated && walletBalance < bundle.price;
                  return (
                    <div
                      key={bundle.id}
                      className="rounded-2xl overflow-hidden cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all duration-200 group relative"
                      onClick={() => handleSelect(bundle as Bundle)}
                      data-testid={`card-bundle-${bundle.id}`}
                    >
                      {/* Top colour band */}
                      <div className={`${theme.cardBg} relative flex flex-col items-center justify-center`} style={{ height: 160 }}>
                        <div className={`absolute top-3 left-3 border-2 rounded-full px-2.5 py-0.5 text-xs font-extrabold tracking-widest ${theme.badgeBorder}`}>
                          {theme.shortLabel}
                        </div>
                        {/* Buy Now pill — appears on hover */}
                        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="flex items-center gap-1 bg-white/20 backdrop-blur text-white text-[10px] font-bold px-2 py-1 rounded-full">
                            <Zap className="w-2.5 h-2.5" /> Buy Now
                          </span>
                        </div>
                        <span className={`text-5xl font-black tracking-tight ${theme.cardText}`}>{bundle.dataAmount}</span>
                      </div>

                      {/* Dark info bar */}
                      <div className="bg-[#2b2b2b] grid grid-cols-3 divide-x divide-gray-600">
                        <div className="py-3 px-2 text-center">
                          <div className={`text-sm font-bold ${insufficient ? "text-red-400" : "text-white"}`}>GH₵{bundle.price}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wide">Price</div>
                        </div>
                        <div className="py-3 px-2 text-center">
                          <div className="text-sm font-bold text-white">N/A</div>
                          <div className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wide">Rollover</div>
                        </div>
                        <div className="py-3 px-2 text-center">
                          <div className="text-sm font-bold text-white">{formatDuration(bundle.validityDays)}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wide">Duration</div>
                        </div>
                      </div>

                      {/* Insufficient balance indicator */}
                      {insufficient && (
                        <div className="bg-red-600/90 text-white text-center text-[10px] font-bold py-1 tracking-wide uppercase">
                          Insufficient Balance
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Not logged in CTA */}
            {!isAuthenticated && (
              <div className="mt-8 rounded-2xl border border-border bg-card p-8 text-center">
                <ShoppingBag className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-bold text-foreground mb-1">Sign in to purchase</h3>
                <p className="text-sm text-muted-foreground mb-4">Create a free account and top up your wallet to buy bundles instantly.</p>
                <div className="flex justify-center gap-3">
                  <Link href="/login"><Button variant="outline">Log In</Button></Link>
                  <Link href="/register"><Button>Get Started</Button></Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Purchase dialog */}
      <PurchaseDialog
        open={dialogOpen}
        bundle={selected}
        network={activeNetwork}
        walletBalance={walletBalance}
        onClose={() => setDialogOpen(false)}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
