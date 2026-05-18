import React, { useState, useEffect } from "react";
import { useListBundles, getGetWalletBalanceQueryKey } from "@workspace/api-client-react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useLocation } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ShoppingCart, Wifi, List, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { BundleCard, BundleCardMini, NETWORK_LABELS, NETWORK_STYLES, type NetworkKey } from "@/components/BundleCard";
import { storeApi } from "@/lib/storeApi";

type Network = NetworkKey;

// Ghana network prefix map
const GHANA_PREFIXES: Record<string, string[]> = {
  mtn:          ["024", "054", "055", "025", "059", "053"],
  telecel:      ["020", "050"],
  "at-ishare":  ["026", "056", "027", "057"],
  "at-bigtime": ["026", "056", "027", "057"],
};
function detectGhanaNetwork(phone: string): string | null {
  for (const [net, prefixes] of Object.entries(GHANA_PREFIXES)) {
    if (prefixes.some(p => phone.startsWith(p))) return net;
  }
  return null;
}

// ─── Bulk Order Modal ────────────────────────────────────────────────────────
function BulkOrderModal({ network, onClose }: { network: Network; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ processed: number; skipped: { phone: string; gb: number; reason: string }[]; totalCost: number } | null>(null);
  const [error, setError] = useState("");

  const { data: adminBundles = [] } = useListBundles({ network });

  // Build available GB options from admin bundles for this network
  const gbOptions: number[] = [...new Set(
    adminBundles
      .map(b => { const m = b.dataAmount.match(/^(\d+)\s*GB$/i); return m ? parseInt(m[1], 10) : null; })
      .filter((n): n is number => n !== null)
  )].sort((a, b) => a - b);

  type ParsedLine = { phone: string; gb: number; valid: boolean; reason?: string; warn?: boolean };
  const lines: ParsedLine[] = text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => {
      const parts = l.split(/\s+/);
      if (parts.length < 2) return { phone: l, gb: 0, valid: false, reason: "Missing GB size" };
      const phone = parts[0];
      const gb = parseInt(parts[1], 10);
      if (!/^\d{10}$/.test(phone)) return { phone, gb, valid: false, reason: "Phone must be exactly 10 digits" };
      if (isNaN(gb) || gb <= 0) return { phone, gb, valid: false, reason: "Invalid GB size" };
      if (gbOptions.length > 0 && !gbOptions.includes(gb)) return { phone, gb, valid: false, reason: `No ${gb}GB bundle available` };
      const detectedNet = detectGhanaNetwork(phone);
      const warn = detectedNet !== null && detectedNet !== network;
      return { phone, gb, valid: true, warn };
    });

  const validLines = lines.filter(l => l.valid);
  const invalidLines = lines.filter(l => !l.valid);

  const previewTotal = validLines.reduce((sum, line) => {
    const bundle = adminBundles.find(b => {
      const m = b.dataAmount.match(/^(\d+)\s*GB$/i);
      return m ? parseInt(m[1], 10) === line.gb : false;
    });
    return sum + (bundle ? Number(bundle.price) : 0);
  }, 0);

  const bulk = useMutation({
    mutationFn: () => storeApi.bulkOrder({ network, items: validLines.map(l => ({ phone: l.phone, gb: l.gb })) }),
    onSuccess: (data) => {
      // Instantly subtract cost — no waiting for a network refetch
      const prev = qc.getQueryData<{ balance: number }>(getGetWalletBalanceQueryKey());
      if (prev != null) {
        qc.setQueryData(getGetWalletBalanceQueryKey(), { ...prev, balance: prev.balance - data.totalCost });
      }
      qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
      qc.invalidateQueries({ queryKey: ["myStoreOrders"] });
      qc.invalidateQueries({ queryKey: ["myStoreStats"] });
      setResult({ processed: data.processed, skipped: data.skipped, totalCost: data.totalCost });
      setError("");
    },
    onError: (e) => setError((e as Error).message),
  });

  const networkLabel = NETWORK_LABELS[network] ?? network.toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-bold text-foreground text-base">Bulk Order — {networkLabel}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">One per line: <span className="font-mono">phone  GB</span></p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {!result ? (
            <>
              <div className="bg-muted/50 rounded-xl px-3 py-2 text-xs text-muted-foreground font-mono space-y-0.5">
                <div>0244123456 1</div>
                <div>0277987654 2</div>
                <div>0555546229 5</div>
              </div>
              <Textarea
                placeholder={"0244123456 1\n0277987654 2\n0555546229 5"}
                value={text}
                onChange={e => { setText(e.target.value); setError(""); }}
                rows={8}
                className="font-mono text-sm resize-none"
              />
              {lines.length > 0 && (
                <div className="rounded-xl border border-border divide-y divide-border overflow-hidden text-xs">
                  {lines.map((l, i) => (
                    <div key={i} className={`flex items-center gap-2 px-3 py-2 ${
                      !l.valid ? "bg-red-50/50 dark:bg-red-900/10"
                      : l.warn ? "bg-amber-50/50 dark:bg-amber-900/10"
                      : "bg-emerald-50/50 dark:bg-emerald-900/10"
                    }`}>
                      {!l.valid
                        ? <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        : l.warn
                          ? <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                      <span className="font-mono flex-1">{l.phone}</span>
                      <span className="font-mono text-muted-foreground">{l.gb > 0 ? `${l.gb}GB` : "—"}</span>
                      {!l.valid && <span className="text-red-500 ml-1">{l.reason}</span>}
                      {l.valid && l.warn && <span className="text-amber-600 ml-1">Wrong network?</span>}
                    </div>
                  ))}
                </div>
              )}
              {validLines.length > 0 && (
                <div className="flex items-center justify-between bg-muted rounded-xl px-4 py-2.5 text-sm">
                  <span className="text-muted-foreground">
                    <span className="font-bold text-foreground">{validLines.length}</span> valid
                    {invalidLines.length > 0 && <> · <span className="text-red-500 font-bold">{invalidLines.length}</span> skipped</>}
                  </span>
                  <span className="font-bold text-foreground">GH₵{previewTotal.toFixed(2)}</span>
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm dark:bg-red-900/10 dark:border-red-800 dark:text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/10 p-4 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="font-bold text-emerald-700 dark:text-emerald-400 text-lg">{result.processed} order{result.processed !== 1 ? "s" : ""} submitted</p>
                <p className="text-xs text-emerald-600 mt-1">GH₵{result.totalCost.toFixed(2)} deducted from wallet balance</p>
              </div>
              {result.skipped.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/10 p-4">
                  <p className="text-xs font-bold text-amber-700 mb-2">{result.skipped.length} line{result.skipped.length !== 1 ? "s" : ""} skipped:</p>
                  <div className="space-y-1">
                    {result.skipped.map((s, i) => (
                      <div key={i} className="text-xs font-mono text-amber-700">{s.phone} {s.gb}GB — {s.reason}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border shrink-0 flex gap-2">
          {!result ? (
            <>
              <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
              <Button onClick={() => bulk.mutate()} disabled={validLines.length === 0 || bulk.isPending} className="flex-1 gap-2">
                {bulk.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <List className="w-4 h-4" />}
                {bulk.isPending ? "Submitting…" : `Submit ${validLines.length} Order${validLines.length !== 1 ? "s" : ""} — GH₵${previewTotal.toFixed(2)}`}
              </Button>
            </>
          ) : (
            <Button onClick={onClose} className="flex-1">Done</Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface Bundle {
  id: number; name: string; description: string; dataAmount: string;
  validityDays: number; price: number; category: string; network: string; isActive: boolean;
}

const NETWORK_TABS: { key: Network; dot: string }[] = [
  { key: "mtn",         dot: "bg-yellow-400" },
  { key: "telecel",     dot: "bg-red-500" },
  { key: "at-ishare",   dot: "bg-blue-500" },
  { key: "at-bigtime",  dot: "bg-green-500" },
];

// Active tab colours — matches network-card-designs.txt sections 8-9
const NETWORK_TAB_ACTIVE: Record<string, React.CSSProperties> = {
  mtn:          { backgroundColor: "rgb(245,197,24)", color: "#000", fontWeight: 600 },
  telecel:      { backgroundColor: "rgb(229,57,53)",  color: "#fff", fontWeight: 600 },
  "at-ishare":  { backgroundColor: "rgb(0,51,160)",   color: "#fff", fontWeight: 600 },
  "at-bigtime": { backgroundColor: "rgb(0,51,160)",   color: "#fff", fontWeight: 600 },
};

export default function Bundles() {
  const { isAuthenticated, user } = useAuth();
  const { addItem } = useCart();
  const [, setLocation] = useLocation();
  const [activeNetwork, setActiveNetwork] = useState<Network>("mtn");
  const [selected, setSelected] = useState<Bundle | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const isAgent = user?.role === "agent" || user?.role === "dealer";

  const { data: networkSettings } = useQuery<Record<string, boolean>>({
    queryKey: ["networkSettings"],
    queryFn: () => fetch("/api/settings/networks").then(r => r.json() as Promise<Record<string, boolean>>),
    staleTime: 60_000,
  });

  const enabledTabs = NETWORK_TABS.filter(t => !networkSettings || networkSettings[t.key] !== false);

  // If the active network gets disabled, switch to the first enabled one
  useEffect(() => {
    if (networkSettings && networkSettings[activeNetwork] === false) {
      const first = NETWORK_TABS.find(t => networkSettings[t.key] !== false);
      if (first) setActiveNetwork(first.key);
    }
  }, [networkSettings, activeNetwork]);

  const { data: bundles, isLoading } = useListBundles({ network: activeNetwork });

  const parseDataMB = (str: string) => {
    const lower = str.toLowerCase().replace(/\s/g, "");
    if (lower.includes("unlimited")) return Infinity;
    const match = lower.match(/(\d+(?:\.\d+)?)(tb|gb|mb)/);
    if (!match) return 0;
    const n = parseFloat(match[1]);
    return match[2] === "tb" ? n * 1024 * 1024 : match[2] === "gb" ? n * 1024 : n;
  };

  const filtered = [...(bundles ?? [])].sort((a, b) => parseDataMB(a.dataAmount) - parseDataMB(b.dataAmount));

  const handleSelect = (bundle: Bundle) => {
    if (!isAuthenticated) { setLocation("/login"); return; }
    setSelected(bundle);
    setShowDialog(true);
  };

  const confirmAddToCart = () => {
    if (!selected || !phoneNumber.trim()) return;
    addItem(selected.id, phoneNumber.trim());
    setShowDialog(false);
    setPhoneNumber("");
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground">Data Bundle Plans</h1>
          <p className="text-muted-foreground mt-1">Choose your network and pick a plan</p>
        </div>

        {/* Network selector */}
        <div className="flex justify-center gap-2 mb-4 flex-wrap items-center">
          {enabledTabs.map(({ key }) => {
            const isActive = activeNetwork === key;
            const activeStyle = NETWORK_TAB_ACTIVE[key];
            return (
              <button
                key={key}
                onClick={() => setActiveNetwork(key)}
                data-testid={`tab-${key}`}
                className={`network-tab px-4 sm:px-6 py-2 rounded-lg font-medium transition text-sm sm:text-base ${
                  isActive ? "" : "bg-gray-700 text-gray-400 hover:opacity-90"
                }`}
                style={isActive ? activeStyle : undefined}
              >
                {NETWORK_LABELS[key]}
              </button>
            );
          })}
        </div>
        {isAuthenticated && (
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setShowBulk(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm border border-gray-600 text-gray-400 hover:opacity-90 transition bg-gray-700"
            >
              <List className="w-4 h-4" />
              Bulk Order
            </button>
          </div>
        )}

        {/* Bundles grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-36 rounded-2xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Wifi className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold">No plans found</h3>
            <p className="text-muted-foreground mt-1">Try a different network.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filtered.map(bundle => (
                <BundleCard
                  key={bundle.id}
                  dataAmount={bundle.dataAmount}
                  network={activeNetwork}
                  price={parseFloat(String(bundle.price))}
                  validityDays={bundle.validityDays}
                  showBuyHover
                  onClick={() => handleSelect(bundle as Bundle)}
                  data-testid={`card-bundle-${bundle.id}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Add-to-cart dialog */}
      <Dialog open={showDialog} onOpenChange={v => { setShowDialog(v); if (!v) setPhoneNumber(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" /> Add to Cart
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {selected && (
              <BundleCardMini
                dataAmount={selected.dataAmount}
                network={activeNetwork}
                price={parseFloat(String(selected.price))}
                validityDays={selected.validityDays}
              />
            )}
            <div className="space-y-1.5">
              <Label htmlFor="phone-bundles">Phone number to activate on</Label>
              <Input
                id="phone-bundles"
                type="tel"
                placeholder="0244xxxxxx"
                maxLength={10}
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                data-testid="input-phone-order"
              />
              {phoneNumber.length === 10 && (() => {
                const det = detectGhanaNetwork(phoneNumber);
                const ok = det === null || det === activeNetwork || det === activeNetwork.replace("at-bigtime", "at-ishare").replace("at-ishare", "at-bigtime");
                return det !== null && det !== activeNetwork ? (
                  <p className="text-xs text-amber-600 mt-1">This looks like a {NETWORK_LABELS[det as NetworkKey] ?? det} number</p>
                ) : null;
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={confirmAddToCart}
              disabled={!phoneNumber.trim() || phoneNumber.trim().length !== 10}
              data-testid="button-confirm-add"
            >
              <ShoppingCart className="w-4 h-4 mr-1.5" /> Add to Cart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showBulk && (
        <BulkOrderModal network={activeNetwork} onClose={() => setShowBulk(false)} />
      )}
    </div>
  );
}
