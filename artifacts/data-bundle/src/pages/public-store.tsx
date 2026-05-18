import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { storeApi, type PublicStore, type StoreBundle } from "@/lib/storeApi";
import { BundleCard, BundleCardMini, NETWORK_LABELS, NETWORK_STYLES } from "@/components/BundleCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Wifi, Zap, Loader2, XCircle, CheckCircle2, Clock, ShoppingBag,
  Phone, Mail, Globe, ArrowRight, RotateCcw, Search, PackageSearch,
} from "lucide-react";

// ─── Network gradient map (matches admin packages.html getNetworkGradient) ────
const NETWORK_GRADIENTS: Record<string, string> = {
  mtn:          "linear-gradient(135deg, #ffc107 0%, #ff9800 50%, #e65100 100%)",
  telecel:      "linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #991b1b 100%)",
  "at-ishare":  "linear-gradient(135deg, #3b82f6 0%, #2563eb 50%, #1e40af 100%)",
  "at-bigtime": "linear-gradient(135deg, #3b82f6 0%, #2563eb 50%, #1e40af 100%)",
  _default:     "linear-gradient(135deg, #6b7280 0%, #4b5563 50%, #374151 100%)",
};

// ─── Store Theme system ───────────────────────────────────────────────────────
const STORE_THEMES: Record<string, {
  bannerGradient: string; bannerText: string; accentLight: string; accentBorder: string;
  stepBg: string; stepText: string; dot: string;
}> = {
  yellow: {
    bannerGradient: "bg-gradient-to-br from-[#FFCC00] via-[#FFB800] to-[#E6A500]",
    bannerText: "text-gray-900",
    accentLight: "bg-yellow-50 dark:bg-yellow-900/10",
    accentBorder: "border-yellow-200 dark:border-yellow-800",
    stepBg: "bg-gray-900", stepText: "text-yellow-400", dot: "bg-yellow-400",
  },
  red: {
    bannerGradient: "bg-gradient-to-br from-[#F44336] via-[#C62828] to-[#7B0000]",
    bannerText: "text-white",
    accentLight: "bg-red-50 dark:bg-red-900/10",
    accentBorder: "border-red-200 dark:border-red-800",
    stepBg: "bg-red-600", stepText: "text-white", dot: "bg-red-400",
  },
  blue: {
    bannerGradient: "bg-gradient-to-br from-[#2196F3] via-[#1565C0] to-[#0D2E78]",
    bannerText: "text-white",
    accentLight: "bg-blue-50 dark:bg-blue-900/10",
    accentBorder: "border-blue-200 dark:border-blue-800",
    stepBg: "bg-blue-600", stepText: "text-white", dot: "bg-blue-400",
  },
  green: {
    bannerGradient: "bg-gradient-to-br from-[#4CAF50] via-[#2E7D32] to-[#1A3A1C]",
    bannerText: "text-white",
    accentLight: "bg-green-50 dark:bg-green-900/10",
    accentBorder: "border-green-200 dark:border-green-800",
    stepBg: "bg-green-600", stepText: "text-white", dot: "bg-green-400",
  },
  purple: {
    bannerGradient: "bg-gradient-to-br from-[#9C27B0] via-[#7B1FA2] to-[#4A0072]",
    bannerText: "text-white",
    accentLight: "bg-purple-50 dark:bg-purple-900/10",
    accentBorder: "border-purple-200 dark:border-purple-800",
    stepBg: "bg-purple-600", stepText: "text-white", dot: "bg-purple-400",
  },
  orange: {
    bannerGradient: "bg-gradient-to-br from-[#FF9800] via-[#F57C00] to-[#BF360C]",
    bannerText: "text-white",
    accentLight: "bg-orange-50 dark:bg-orange-900/10",
    accentBorder: "border-orange-200 dark:border-orange-800",
    stepBg: "bg-orange-500", stepText: "text-white", dot: "bg-orange-400",
  },
  teal: {
    bannerGradient: "bg-gradient-to-br from-[#26C6DA] via-[#0097A7] to-[#004D40]",
    bannerText: "text-white",
    accentLight: "bg-teal-50 dark:bg-teal-900/10",
    accentBorder: "border-teal-200 dark:border-teal-800",
    stepBg: "bg-teal-600", stepText: "text-white", dot: "bg-teal-400",
  },
};

// ─── Checkout Dialog ──────────────────────────────────────────────────────────
function CheckoutDialog({
  open, bundle, slug, onClose, onSuccess,
}: {
  open: boolean; bundle: StoreBundle | null; slug: string;
  onClose: () => void;
  onSuccess: (ref: string, orderId: number, phone: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const checkout = useMutation({
    mutationFn: () => storeApi.checkout(slug, {
      storeBundleId: bundle!.id,
      customerPhone: phone.trim(),
      customerEmail: email.trim(),
    }),
    onSuccess: (data) => {
      onSuccess(data.reference, data.storeOrderId, phone.trim());
      window.location.href = data.authorizationUrl;
    },
  });

  const errMsg = checkout.error ? (checkout.error as { message?: string }).message ?? "Checkout failed" : null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" /> Buy Bundle
          </DialogTitle>
          <DialogDescription>Secure payment via Paystack</DialogDescription>
        </DialogHeader>

        {bundle && (
          <div className="space-y-4 py-1">
            <BundleCardMini
              dataAmount={bundle.dataAmount}
              network={bundle.network}
              price={bundle.sellingPrice}
              validityDays={bundle.validityDays}
            />

            <div className="space-y-3">
              <div>
                <Label htmlFor="co-phone" className="text-sm font-semibold mb-1.5 block flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> Phone to Activate On
                </Label>
                <Input id="co-phone" type="tel" placeholder="0244xxxxxx" value={phone}
                  onChange={e => setPhone(e.target.value)} disabled={checkout.isPending} />
              </div>
              <div>
                <Label htmlFor="co-email" className="text-sm font-semibold mb-1.5 block flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> Email for Receipt <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                </Label>
                <Input id="co-email" type="email" placeholder="you@example.com" value={email}
                  onChange={e => setEmail(e.target.value)} disabled={checkout.isPending} />
              </div>
            </div>

            {bundle && (() => {
              const fee = +(bundle.sellingPrice * 0.02).toFixed(2);
              const total = +(bundle.sellingPrice + fee).toFixed(2);
              return (
                <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 space-y-1 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Bundle price</span><span>GH₵{bundle.sellingPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Processing fee (2%)</span><span>GH₵{fee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-foreground border-t border-border pt-1 mt-1">
                    <span>Total charged</span><span>GH₵{total.toFixed(2)}</span>
                  </div>
                </div>
              );
            })()}

            {errMsg && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 dark:bg-red-900/10 dark:border-red-800">
                <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400">{errMsg}</p>
              </div>
            )}

            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              Secured by Paystack
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={checkout.isPending}>Cancel</Button>
          <Button
            onClick={() => checkout.mutate()}
            disabled={!phone.trim() || phone.trim().length < 7 || checkout.isPending}
            className="gap-2"
          >
            {checkout.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting…</>
              : <><Zap className="w-4 h-4" /> Pay GH₵{bundle ? (bundle.sellingPrice * 1.02).toFixed(2) : ""}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Post-payment status card ─────────────────────────────────────────────────
function OrderStatusCard({
  slug, reference, phone, onBuyAnother,
}: { slug: string; reference: string; phone: string; onBuyAnother: () => void }) {
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);
  const [error, setError] = useState("");

  const verify = async () => {
    setLoading(true); setError("");
    try { const o = await storeApi.verifyPayment(slug, reference); setOrder(o); }
    catch (e) { setError((e as Error).message ?? "Verification failed"); }
    finally { setLoading(false); }
  };

  useEffect(() => { verify(); }, [reference]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <Loader2 className="w-10 h-10 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Verifying your payment…</p>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <XCircle className="w-12 h-12 text-red-500" />
      <p className="font-semibold text-foreground">Payment could not be verified</p>
      <p className="text-sm text-muted-foreground">{error}</p>
      <Button onClick={verify} variant="outline" className="gap-2"><RotateCcw className="w-4 h-4" /> Retry</Button>
    </div>
  );

  const isSuccess = order?.status === "completed";
  return (
    <div className="max-w-md mx-auto py-12 px-4 text-center space-y-5">
      <div className={`w-20 h-20 rounded-3xl mx-auto flex items-center justify-center ${isSuccess ? "bg-emerald-100 dark:bg-emerald-900/20" : "bg-amber-100 dark:bg-amber-900/20"}`}>
        {isSuccess ? <CheckCircle2 className="w-10 h-10 text-emerald-600" /> : <Clock className="w-10 h-10 text-amber-600" />}
      </div>
      <div>
        <h2 className="text-2xl font-black text-foreground">{isSuccess ? "Bundle Activated!" : "Order Received"}</h2>
        <p className="text-muted-foreground mt-1">{isSuccess ? `Your ${order.bundleData} bundle is live on ${phone}.` : "Payment received. Activation in progress."}</p>
      </div>
      {order && (
        <div className="bg-muted rounded-2xl p-5 text-left space-y-2">
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Bundle</span><span className="font-semibold">{order.bundleData}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Phone</span><span className="font-semibold font-mono">{order.customerPhone}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Amount Paid</span><span className="font-semibold">GH₵{order.sellingPrice.toFixed(2)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Reference</span><span className="font-mono text-xs text-muted-foreground truncate max-w-[160px]">{order.paystackReference}</span></div>
        </div>
      )}
      <Button className="w-full gap-2" onClick={onBuyAnother}>
        <ShoppingBag className="w-4 h-4" /> Buy Another Bundle
      </Button>
    </div>
  );
}

// ─── Main Public Store ────────────────────────────────────────────────────────
export default function PublicStorePage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const urlParams = new URLSearchParams(window.location.search);
  const paystackRef = urlParams.get("ref");
  const [returnRef, setReturnRef] = useState(paystackRef);
  const [returnPhone, setReturnPhone] = useState(urlParams.get("phone") ?? "");

  const [activeNetwork, setActiveNetwork] = useState<string | null>(null);
  const [selected, setSelected] = useState<StoreBundle | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [trackPhone, setTrackPhone] = useState("");
  const [trackedOrders, setTrackedOrders] = useState<any[] | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState("");

  const handleTrack = async () => {
    if (!trackPhone.trim() || trackPhone.trim().length < 7) return;
    setTrackLoading(true); setTrackError(""); setTrackedOrders(null);
    try {
      const results = await storeApi.trackOrders(slug, trackPhone.trim());
      setTrackedOrders(results);
    } catch (e) {
      setTrackError((e as Error).message ?? "Could not find orders");
    } finally {
      setTrackLoading(false);
    }
  };

  const { data, isLoading, error } = useQuery<PublicStore>({
    queryKey: ["publicStore", slug],
    queryFn: () => storeApi.getPublicStore(slug),
    retry: false,
  });

  const { data: networkSettings } = useQuery<Record<string, boolean>>({
    queryKey: ["networkSettings"],
    queryFn: () => fetch("/api/settings/networks").then(r => r.json() as Promise<Record<string, boolean>>),
    staleTime: 60_000,
  });

  const networks = data
    ? [...new Set(data.bundles.map(b => b.network))]
        .filter(n => !networkSettings || networkSettings[n] !== false)
        .sort()
    : [];
  const displayNetwork = activeNetwork ?? networks[0] ?? null;
  const filtered = (data?.bundles ?? []).filter(b => !displayNetwork || b.network === displayNetwork);

  const parseDataMB = (str: string) => {
    const lower = str.toLowerCase().replace(/\s/g, "");
    if (lower.includes("unlimited")) return Infinity;
    const m = lower.match(/(\d+(?:\.\d+)?)(tb|gb|mb)/);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    return m[2] === "tb" ? n * 1024 * 1024 : m[2] === "gb" ? n * 1024 : n;
  };
  const sorted = [...filtered].sort((a, b) => parseDataMB(a.dataAmount) - parseDataMB(b.dataAmount));

  const storeTheme = data ? (STORE_THEMES[data.store.colorTheme] ?? STORE_THEMES.blue) : STORE_THEMES.blue;

  const handleBuyAnother = () => {
    setReturnRef(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("ref");
    url.searchParams.delete("phone");
    window.history.replaceState({}, "", url.toString());
  };

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">Loading store…</p>
      </div>
    </div>
  );

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center mx-auto">
          <Globe className="w-10 h-10 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Store Not Found</h1>
        <p className="text-muted-foreground">This store link doesn't exist or has been removed.</p>
        <Link href="/"><Button variant="outline" className="gap-2"><ArrowRight className="w-4 h-4 rotate-180" /> Go Home</Button></Link>
      </div>
    </div>
  );

  if (returnRef) return (
    <div className="min-h-screen bg-background">
      <div className={`${storeTheme.bannerGradient} px-6 py-6 text-center`}>
        <h1 className={`text-xl font-black ${storeTheme.bannerText}`}>{data.store.name}</h1>
      </div>
      <OrderStatusCard slug={slug} reference={returnRef} phone={returnPhone} onBuyAnother={handleBuyAnother} />
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Store Banner */}
      <div className={`${storeTheme.bannerGradient} relative overflow-hidden`}>
        <div className="absolute -top-20 -right-20 w-56 h-56 rounded-full bg-white/10" />
        <div className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full bg-black/10" />
        <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex flex-col sm:flex-row items-center sm:items-end gap-6">
          <div className="w-20 h-20 rounded-3xl bg-black/15 backdrop-blur-sm border border-white/20 flex items-center justify-center shrink-0 shadow-lg">
            <ShoppingBag className={`w-10 h-10 ${storeTheme.bannerText} opacity-90`} />
          </div>
          <div className="text-center sm:text-left flex-1">
            <div className={`text-xs font-bold uppercase tracking-[0.2em] ${storeTheme.bannerText} opacity-70 mb-1`}>Official Data Store</div>
            <h1 className={`text-4xl font-black ${storeTheme.bannerText} leading-tight`} style={{ textShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
              {data.store.name}
            </h1>
            {data.store.description && (
              <p className={`${storeTheme.bannerText} opacity-80 mt-2 max-w-md`}>{data.store.description}</p>
            )}
          </div>
          <div className="px-4 py-2 rounded-xl bg-black/15 backdrop-blur-sm border border-white/20 flex items-center gap-2 shrink-0">
            <div className={`w-2 h-2 rounded-full ${storeTheme.dot} animate-pulse`} />
            <span className={`text-xs font-semibold ${storeTheme.bannerText}`}>
              {data.bundles.length} bundle{data.bundles.length !== 1 ? "s" : ""} available
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* How it works */}
        <div className={`mb-6 rounded-2xl border px-5 py-4 flex flex-wrap gap-4 items-center ${storeTheme.accentLight} ${storeTheme.accentBorder}`}>
          {[
            { n: "1", t: "Pick a bundle" },
            { n: "2", t: "Enter your details" },
            { n: "3", t: "Pay via Paystack" },
            { n: "4", t: "Bundle activated instantly" },
          ].map((s, i, arr) => (
            <div key={s.n} className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full ${storeTheme.stepBg} ${storeTheme.stepText} text-xs font-bold flex items-center justify-center shrink-0`}>{s.n}</span>
              <span className="text-sm font-medium text-foreground">{s.t}</span>
              {i < arr.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />}
            </div>
          ))}
        </div>

        {/* Network cards */}
        {networks.length > 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* "All" card */}
            <button
              onClick={() => setActiveNetwork(null)}
              className={`relative rounded-xl overflow-hidden shadow-lg border transform hover:scale-105 transition-transform duration-300 ${
                activeNetwork === null ? "border-white ring-2 ring-white/60" : "border-gray-200"
              }`}
              style={{ height: "200px" }}
            >
              <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #7c3aed 100%)" }} />
              <div className="absolute inset-0 bg-black/10" />
              {activeNetwork === null && (
                <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-white/90 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                </div>
              )}
              <div className="absolute bottom-4 left-4 right-4">
                <h3 className="text-white font-bold text-lg drop-shadow-lg">All Networks</h3>
              </div>
            </button>
            {networks.map(net => {
              const isActive = activeNetwork === net;
              const gradient = NETWORK_GRADIENTS[net] ?? NETWORK_GRADIENTS._default;
              return (
                <button key={net} onClick={() => setActiveNetwork(net)}
                  className={`relative rounded-xl overflow-hidden shadow-lg border transform hover:scale-105 transition-transform duration-300 ${
                    isActive ? "border-white ring-2 ring-white/60" : "border-gray-200"
                  }`}
                  style={{ height: "200px" }}
                >
                  <div className="absolute inset-0" style={{ background: gradient }} />
                  <div className="absolute inset-0 bg-black/10" />
                  {isActive && (
                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-white/90 flex items-center justify-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                    </div>
                  )}
                  <div className="absolute bottom-4 left-4 right-4">
                    <h3 className="text-white font-bold text-lg drop-shadow-lg">{NETWORK_LABELS[net] ?? net}</h3>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Bundles grid */}
        {sorted.length === 0 ? (
          <div className="text-center py-20">
            <Wifi className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground">No bundles available</h3>
            <p className="text-muted-foreground mt-1">Check back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {sorted.map(bundle => (
              <BundleCard
                key={bundle.id}
                dataAmount={bundle.dataAmount}
                network={bundle.network}
                price={bundle.sellingPrice}
                validityDays={bundle.validityDays}
                ctaLabel={`Buy Now · GH₵${bundle.sellingPrice.toFixed(2)}`}
                showBuyHover
                onClick={() => { setSelected(bundle); setDialogOpen(true); }}
              />
            ))}
          </div>
        )}

        {/* Track My Order */}
        <div className="mt-10">
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className={`px-5 py-4 border-b border-border flex items-center gap-3 ${storeTheme.accentLight} ${storeTheme.accentBorder}`}>
              <PackageSearch className="w-5 h-5 text-muted-foreground" />
              <div>
                <h3 className="font-bold text-foreground">Track My Order</h3>
                <p className="text-xs text-muted-foreground">Enter the phone number you used to buy to see your orders</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="tel"
                    placeholder="e.g. 0244123456"
                    value={trackPhone}
                    onChange={e => { setTrackPhone(e.target.value); setTrackedOrders(null); setTrackError(""); }}
                    onKeyDown={e => e.key === "Enter" && handleTrack()}
                    className="pl-9 h-10"
                  />
                </div>
                <Button onClick={handleTrack} disabled={trackLoading || trackPhone.trim().length < 7} className="gap-2 shrink-0">
                  {trackLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {trackLoading ? "Searching…" : "Track"}
                </Button>
              </div>

              {trackError && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 dark:bg-red-900/10 dark:border-red-800">
                  <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-400">{trackError}</p>
                </div>
              )}

              {trackedOrders !== null && (
                trackedOrders.length === 0 ? (
                  <div className="text-center py-8 space-y-2">
                    <PackageSearch className="w-10 h-10 text-muted-foreground mx-auto" />
                    <p className="text-sm font-semibold text-foreground">No orders found</p>
                    <p className="text-xs text-muted-foreground">No orders were placed with this phone number.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                    {trackedOrders.map((o: any) => {
                      const statusColor = o.status === "completed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                        : o.status === "processing" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                        : o.status === "paid" ? "bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400"
                        : o.status === "pending" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                        : "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400";
                      const StatusIcon = o.status === "completed" ? CheckCircle2 : o.status === "cancelled" ? XCircle : Clock;
                      const nStyle = NETWORK_STYLES[o.bundleNetwork];
                      return (
                        <div key={o.id} className="flex items-center gap-3 px-4 py-3.5 bg-background hover:bg-muted/30 transition-colors">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${nStyle?.gradient ?? "bg-gradient-to-br from-gray-600 to-gray-800"}`}>
                            <span className={`text-xs font-black ${nStyle?.text ?? "text-white"}`}>{o.bundleData}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-foreground">{o.bundleData} — {NETWORK_LABELS[o.bundleNetwork] ?? o.bundleNetwork}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                              <Phone className="w-3 h-3" />
                              <span className="font-mono">{o.customerPhone}</span>
                              <span className="text-muted-foreground/50">·</span>
                              <span>{new Date(o.createdAt).toLocaleString("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0 space-y-1">
                            <div className="text-sm font-bold text-foreground">GH₵{o.sellingPrice.toFixed(2)}</div>
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColor}`}>
                              <StatusIcon className="w-2.5 h-2.5" />
                              {o.status}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-border text-center text-xs text-muted-foreground space-y-2">
          <div className="flex items-center justify-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Powered by DataBundle · Payments secured by Paystack</span>
          </div>
          <Link href="/" className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
            <Globe className="w-3 h-3" /> Visit DataBundle Platform
          </Link>
        </div>
      </div>

      <CheckoutDialog
        open={dialogOpen} bundle={selected} slug={slug}
        onClose={() => setDialogOpen(false)}
        onSuccess={(ref, _id, phone) => { setReturnPhone(phone); setDialogOpen(false); }}
      />
    </div>
  );
}
