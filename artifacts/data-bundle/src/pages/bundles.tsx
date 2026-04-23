import { useState } from "react";
import { useListBundles } from "@workspace/api-client-react";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useLocation } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ShoppingCart, Wifi } from "lucide-react";
import { BundleCard, BundleCardMini, NETWORK_LABELS, NETWORK_STYLES, type NetworkKey } from "@/components/BundleCard";

type Network = NetworkKey;

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

export default function Bundles() {
  const { isAuthenticated } = useAuth();
  const { addItem } = useCart();
  const [, setLocation] = useLocation();
  const [activeNetwork, setActiveNetwork] = useState<Network>("mtn");
  const [selected, setSelected] = useState<Bundle | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [showDialog, setShowDialog] = useState(false);

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

        {/* Bundles grid */}
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
            <p className="text-muted-foreground mt-1">Try a different network.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
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
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                data-testid="input-phone-order"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={confirmAddToCart}
              disabled={!phoneNumber.trim() || phoneNumber.trim().length < 7}
              data-testid="button-confirm-add"
            >
              <ShoppingCart className="w-4 h-4 mr-1.5" /> Add to Cart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
