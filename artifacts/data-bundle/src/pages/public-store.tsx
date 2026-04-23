import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { storeApi, type PublicStore, type StoreBundle } from "@/lib/storeApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Wifi, Zap, Loader2, XCircle, CheckCircle2, Clock, ShoppingBag,
  Phone, Mail, Globe, ArrowRight, RotateCcw,
} from "lucide-react";

// ─── Theme system ─────────────────────────────────────────────────────────────
const THEMES: Record<string, {
  bannerBg: string; bannerText: string; cardBg: string; cardText: string;
  badgeBorder: string; tabActive: string; btnBg: string; btnText: string;
  accentLight: string; accentBorder: string;
}> = {
  yellow: {
    bannerBg:   "bg-gradient-to-br from-yellow-400 to-amber-500",
    bannerText: "text-gray-900",
    cardBg:     "bg-yellow-400",
    cardText:   "text-gray-900",
    badgeBorder:"border-gray-900 text-gray-900",
    tabActive:  "bg-yellow-400 text-gray-900 border-yellow-400",
    btnBg:      "bg-yellow-400 hover:bg-yellow-500",
    btnText:    "text-gray-900",
    accentLight:"bg-yellow-50 dark:bg-yellow-900/10",
    accentBorder:"border-yellow-200 dark:border-yellow-800",
  },
  red: {
    bannerBg:   "bg-gradient-to-br from-red-500 to-red-700",
    bannerText: "text-white",
    cardBg:     "bg-red-600",
    cardText:   "text-white",
    badgeBorder:"border-white text-white",
    tabActive:  "bg-red-600 text-white border-red-600",
    btnBg:      "bg-red-600 hover:bg-red-700",
    btnText:    "text-white",
    accentLight:"bg-red-50 dark:bg-red-900/10",
    accentBorder:"border-red-200 dark:border-red-800",
  },
  blue: {
    bannerBg:   "bg-gradient-to-br from-blue-500 to-blue-700",
    bannerText: "text-white",
    cardBg:     "bg-blue-600",
    cardText:   "text-white",
    badgeBorder:"border-white text-white",
    tabActive:  "bg-blue-600 text-white border-blue-600",
    btnBg:      "bg-blue-600 hover:bg-blue-700",
    btnText:    "text-white",
    accentLight:"bg-blue-50 dark:bg-blue-900/10",
    accentBorder:"border-blue-200 dark:border-blue-800",
  },
  green: {
    bannerBg:   "bg-gradient-to-br from-green-500 to-green-700",
    bannerText: "text-white",
    cardBg:     "bg-green-600",
    cardText:   "text-white",
    badgeBorder:"border-white text-white",
    tabActive:  "bg-green-600 text-white border-green-600",
    btnBg:      "bg-green-600 hover:bg-green-700",
    btnText:    "text-white",
    accentLight:"bg-green-50 dark:bg-green-900/10",
    accentBorder:"border-green-200 dark:border-green-800",
  },
  purple: {
    bannerBg:   "bg-gradient-to-br from-purple-500 to-purple-700",
    bannerText: "text-white",
    cardBg:     "bg-purple-600",
    cardText:   "text-white",
    badgeBorder:"border-white text-white",
    tabActive:  "bg-purple-600 text-white border-purple-600",
    btnBg:      "bg-purple-600 hover:bg-purple-700",
    btnText:    "text-white",
    accentLight:"bg-purple-50 dark:bg-purple-900/10",
    accentBorder:"border-purple-200 dark:border-purple-800",
  },
  orange: {
    bannerBg:   "bg-gradient-to-br from-orange-400 to-orange-600",
    bannerText: "text-white",
    cardBg:     "bg-orange-500",
    cardText:   "text-white",
    badgeBorder:"border-white text-white",
    tabActive:  "bg-orange-500 text-white border-orange-500",
    btnBg:      "bg-orange-500 hover:bg-orange-600",
    btnText:    "text-white",
    accentLight:"bg-orange-50 dark:bg-orange-900/10",
    accentBorder:"border-orange-200 dark:border-orange-800",
  },
  teal: {
    bannerBg:   "bg-gradient-to-br from-teal-500 to-teal-700",
    bannerText: "text-white",
    cardBg:     "bg-teal-600",
    cardText:   "text-white",
    badgeBorder:"border-white text-white",
    tabActive:  "bg-teal-600 text-white border-teal-600",
    btnBg:      "bg-teal-600 hover:bg-teal-700",
    btnText:    "text-white",
    accentLight:"bg-teal-50 dark:bg-teal-900/10",
    accentBorder:"border-teal-200 dark:border-teal-800",
  },
};

const NETWORK_LABELS: Record<string, string> = {
  mtn: "MTN", telecel: "Telecel", "at-ishare": "AT iShare", "at-bigtime": "AT Big-Time",
};

function formatDuration(days: number) {
  if (!days) return "No Expiry";
  return `${days} Day${days !== 1 ? "s" : ""}`;
}

// ─── Checkout Dialog ──────────────────────────────────────────────────────────
function CheckoutDialog({
  open, bundle, slug, theme: t, onClose, onSuccess,
}: {
  open: boolean;
  bundle: StoreBundle | null;
  slug: string;
  theme: typeof THEMES[string];
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
          <DialogDescription>Complete your purchase securely via Paystack</DialogDescription>
        </DialogHeader>

        {bundle && (
          <div className="space-y-4 py-1">
            {/* Bundle preview */}
            <div className="rounded-xl overflow-hidden border border-border">
              <div className={`${t.cardBg} relative flex items-center justify-center py-7`}>
                <span className={`absolute top-2 left-3 text-[10px] font-extrabold border-2 rounded-full px-2 py-0.5 ${t.badgeBorder}`}>
                  {NETWORK_LABELS[bundle.network] ?? bundle.network}
                </span>
                <span className={`text-5xl font-black ${t.cardText}`}>{bundle.dataAmount}</span>
              </div>
              <div className="bg-[#2b2b2b] grid grid-cols-3 divide-x divide-gray-600">
                <div className="py-3 text-center"><div className="text-sm font-bold text-white">GH₵{bundle.sellingPrice.toFixed(2)}</div><div className="text-[10px] text-gray-400 uppercase">Price</div></div>
                <div className="py-3 text-center"><div className="text-sm font-bold text-white">N/A</div><div className="text-[10px] text-gray-400 uppercase">Rollover</div></div>
                <div className="py-3 text-center"><div className="text-sm font-bold text-white">{formatDuration(bundle.validityDays)}</div><div className="text-[10px] text-gray-400 uppercase">Duration</div></div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="co-phone" className="text-sm font-semibold mb-1.5 block flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> Phone to Activate On
                </Label>
                <Input id="co-phone" type="tel" placeholder="0244xxxxxx" value={phone} onChange={e => setPhone(e.target.value)} disabled={checkout.isPending} />
              </div>
              <div>
                <Label htmlFor="co-email" className="text-sm font-semibold mb-1.5 block flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> Email for Receipt
                </Label>
                <Input id="co-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={checkout.isPending} />
              </div>
            </div>

            {errMsg && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 dark:bg-red-900/10 dark:border-red-800">
                <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400">{errMsg}</p>
              </div>
            )}

            {/* Paystack badge */}
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
            disabled={!phone.trim() || phone.trim().length < 7 || !email.includes("@") || checkout.isPending}
            className="gap-2"
          >
            {checkout.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting…</>
            ) : (
              <><Zap className="w-4 h-4" /> Pay GH₵{bundle?.sellingPrice.toFixed(2)}</>
            )}
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
    setLoading(true);
    try {
      const o = await storeApi.verifyPayment(slug, reference);
      setOrder(o);
    } catch (e) {
      setError((e as Error).message ?? "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { verify(); }, [reference]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Verifying your payment…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <XCircle className="w-12 h-12 text-red-500" />
        <p className="font-semibold text-foreground">Payment could not be verified</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button onClick={verify} variant="outline" className="gap-2"><RotateCcw className="w-4 h-4" /> Try Again</Button>
      </div>
    );
  }

  const isSuccess = order?.status === "completed";

  return (
    <div className="max-w-md mx-auto py-12 px-4 text-center space-y-5">
      <div className={`w-20 h-20 rounded-3xl mx-auto flex items-center justify-center ${isSuccess ? "bg-emerald-100 dark:bg-emerald-900/20" : "bg-amber-100 dark:bg-amber-900/20"}`}>
        {isSuccess ? <CheckCircle2 className="w-10 h-10 text-emerald-600" /> : <Clock className="w-10 h-10 text-amber-600" />}
      </div>
      <div>
        <h2 className="text-2xl font-black text-foreground">{isSuccess ? "Bundle Activated!" : "Order Received"}</h2>
        <p className="text-muted-foreground mt-1">{isSuccess ? `Your ${order.bundleData} bundle has been activated on ${phone}.` : "Your payment was received. Bundle activation is in progress."}</p>
      </div>
      {order && (
        <div className="bg-muted rounded-2xl p-5 text-left space-y-2">
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Bundle</span><span className="font-semibold">{order.bundleData}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Phone</span><span className="font-semibold font-mono">{order.customerPhone}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Amount</span><span className="font-semibold">GH₵{order.sellingPrice.toFixed(2)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Reference</span><span className="font-mono text-xs text-muted-foreground">{order.paystackReference}</span></div>
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

  // Check for Paystack return
  const urlParams = new URLSearchParams(window.location.search);
  const paystackRef = urlParams.get("ref");
  const [returnRef, setReturnRef] = useState(paystackRef);
  const [returnPhone, setReturnPhone] = useState(urlParams.get("phone") ?? "");

  const [activeNetwork, setActiveNetwork] = useState<string | null>(null);
  const [selected, setSelected] = useState<StoreBundle | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, error } = useQuery<PublicStore>({
    queryKey: ["publicStore", slug],
    queryFn: () => storeApi.getPublicStore(slug),
    retry: false,
  });

  const networks = data ? [...new Set(data.bundles.map(b => b.network))].sort() : [];
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

  const theme = data ? (THEMES[data.store.colorTheme] ?? THEMES.blue) : THEMES.blue;

  const handleBuyAnother = () => {
    setReturnRef(null);
    // Remove query params from URL
    const url = new URL(window.location.href);
    url.searchParams.delete("ref");
    url.searchParams.delete("phone");
    window.history.replaceState({}, "", url.toString());
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading store…</p>
        </div>
      </div>
    );
  }

  // Not found
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center mx-auto">
            <Globe className="w-10 h-10 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Store Not Found</h1>
          <p className="text-muted-foreground">The store link you followed doesn't exist or may have been removed.</p>
          <Link href="/"><Button variant="outline" className="gap-2"><ArrowRight className="w-4 h-4 rotate-180" /> Go Home</Button></Link>
        </div>
      </div>
    );
  }

  // Post-payment return
  if (returnRef) {
    return (
      <div className="min-h-screen bg-background">
        <div className={`${theme.bannerBg} px-6 py-6 text-center`}>
          <h1 className={`text-xl font-black ${theme.bannerText}`}>{data.store.name}</h1>
        </div>
        <OrderStatusCard slug={slug} reference={returnRef} phone={returnPhone} onBuyAnother={handleBuyAnother} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Store Banner */}
      <div className={`${theme.bannerBg} relative overflow-hidden`}>
        {/* Decorative circles */}
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-white/10" />
        <div className="absolute -bottom-10 -left-10 w-36 h-36 rounded-full bg-white/10" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex flex-col sm:flex-row items-center sm:items-end gap-6">
          <div className="w-20 h-20 rounded-3xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0 shadow-lg">
            <ShoppingBag className={`w-10 h-10 ${theme.bannerText}`} />
          </div>
          <div className="text-center sm:text-left flex-1">
            <div className={`text-xs font-bold uppercase tracking-widest ${theme.bannerText} opacity-70 mb-1`}>Official Data Store</div>
            <h1 className={`text-4xl font-black ${theme.bannerText} leading-tight`}>{data.store.name}</h1>
            {data.store.description && (
              <p className={`${theme.bannerText} opacity-80 mt-2 max-w-md`}>{data.store.description}</p>
            )}
          </div>
          <div className={`px-4 py-2 rounded-xl bg-white/15 backdrop-blur flex items-center gap-2 shrink-0`}>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className={`text-xs font-semibold ${theme.bannerText}`}>{data.bundles.length} bundle{data.bundles.length !== 1 ? "s" : ""} available</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* How it works */}
        <div className={`mb-6 rounded-2xl border px-5 py-4 flex flex-wrap gap-4 items-center ${theme.accentLight} ${theme.accentBorder}`}>
          {[
            { n: "1", t: "Pick a bundle" },
            { n: "2", t: "Enter your details" },
            { n: "3", t: "Pay securely via Paystack" },
            { n: "4", t: "Bundle activated instantly" },
          ].map((s, i, arr) => (
            <div key={s.n} className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full ${theme.btnBg} ${theme.btnText} text-xs font-bold flex items-center justify-center shrink-0`}>{s.n}</span>
              <span className="text-sm font-medium text-foreground">{s.t}</span>
              {i < arr.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />}
            </div>
          ))}
        </div>

        {/* Network tabs */}
        {networks.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => setActiveNetwork(null)}
              className={`px-4 py-2.5 rounded-xl font-semibold text-sm border-2 transition-all ${
                activeNetwork === null ? `${theme.tabActive} border-current` : "border-border bg-background text-muted-foreground hover:border-primary/40"
              }`}
            >
              All
            </button>
            {networks.map(net => (
              <button key={net} onClick={() => setActiveNetwork(net)}
                className={`px-4 py-2.5 rounded-xl font-semibold text-sm border-2 transition-all ${
                  activeNetwork === net ? `${theme.tabActive} border-current` : "border-border bg-background text-muted-foreground hover:border-primary/40"
                }`}
              >
                {NETWORK_LABELS[net] ?? net}
              </button>
            ))}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {sorted.map(bundle => (
              <div
                key={bundle.id}
                className="rounded-2xl overflow-hidden cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all duration-200 group border border-border"
                onClick={() => { setSelected(bundle); setDialogOpen(true); }}
              >
                {/* Color band */}
                <div className={`${theme.cardBg} relative flex flex-col items-center justify-center`} style={{ height: 160 }}>
                  <span className={`absolute top-3 left-3 text-[10px] font-extrabold border-2 rounded-full px-2.5 py-0.5 ${theme.badgeBorder}`}>
                    {NETWORK_LABELS[bundle.network] ?? bundle.network}
                  </span>
                  {/* Buy Now hover pill */}
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
                    <div className="text-sm font-bold text-white">GH₵{bundle.sellingPrice.toFixed(2)}</div>
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

                {/* Buy CTA */}
                <div className={`${theme.btnBg} ${theme.btnText} py-2.5 text-center text-sm font-bold transition-all group-hover:brightness-110`}>
                  Buy Now · GH₵{bundle.sellingPrice.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}

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

      {/* Checkout dialog */}
      <CheckoutDialog
        open={dialogOpen}
        bundle={selected}
        slug={slug}
        theme={theme}
        onClose={() => setDialogOpen(false)}
        onSuccess={(ref, _id, phone) => {
          setReturnPhone(phone);
          setDialogOpen(false);
        }}
      />
    </div>
  );
}
