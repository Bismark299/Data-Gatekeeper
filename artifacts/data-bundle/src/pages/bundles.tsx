import { useState } from "react";
import { useListBundles } from "@workspace/api-client-react";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useLocation } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ShoppingCart, Wifi } from "lucide-react";

type Network = "mtn" | "telecel" | "at-ishare" | "at-bigtime";

interface Bundle {
  id: number;
  name: string;
  description: string;
  dataAmount: string;
  validityDays: number;
  price: number;
  category: string;
  network: string;
  isActive: boolean;
}

const NETWORKS: Record<Network, {
  label: string;
  shortLabel: string;
  tagline: string;
  cardBg: string;
  cardText: string;
  badgeBorder: string;
  tabActive: string;
  btnClass: string;
}> = {
  mtn: {
    label: "MTN",
    shortLabel: "MTN",
    tagline: "Everywhere You Go",
    cardBg: "bg-[#FFCC00]",
    cardText: "text-gray-900",
    badgeBorder: "border-gray-900 text-gray-900",
    tabActive: "bg-yellow-400 text-gray-900 border-yellow-500",
    btnClass: "bg-yellow-500 hover:bg-yellow-600 text-gray-900",
  },
  telecel: {
    label: "Telecel",
    shortLabel: "TELECEL",
    tagline: "Advancing Lives",
    cardBg: "bg-red-600",
    cardText: "text-white",
    badgeBorder: "border-white text-white",
    tabActive: "bg-red-600 text-white border-red-600",
    btnClass: "bg-red-600 hover:bg-red-700 text-white",
  },
  "at-ishare": {
    label: "AT iShare",
    shortLabel: "AT",
    tagline: "Share the Experience",
    cardBg: "bg-blue-600",
    cardText: "text-white",
    badgeBorder: "border-white text-white",
    tabActive: "bg-blue-600 text-white border-blue-600",
    btnClass: "bg-blue-600 hover:bg-blue-700 text-white",
  },
  "at-bigtime": {
    label: "AT Big-Time",
    shortLabel: "AT",
    tagline: "Go Big or Go Home",
    cardBg: "bg-green-700",
    cardText: "text-white",
    badgeBorder: "border-white text-white",
    tabActive: "bg-green-700 text-white border-green-700",
    btnClass: "bg-green-700 hover:bg-green-800 text-white",
  },
};

const NETWORK_ICONS: Record<Network, string> = {
  mtn: "🟡",
  telecel: "🔴",
  "at-ishare": "🔵",
  "at-bigtime": "🟢",
};

export default function Bundles() {
  const { isAuthenticated } = useAuth();
  const { addItem } = useCart();
  const [, setLocation] = useLocation();
  const [activeNetwork, setActiveNetwork] = useState<Network>("mtn");
  const [selected, setSelected] = useState<Bundle | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [showDialog, setShowDialog] = useState(false);

  const { data: bundles, isLoading } = useListBundles({ network: activeNetwork });
  const filtered = bundles ?? [];
  const theme = NETWORKS[activeNetwork];

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

  const formatDuration = (days: number | undefined | null) => {
    if (!days) return "No Expiry";
    if (days === 1) return "1 Day";
    if (days === 7) return "7 Days";
    if (days === 30) return "30 Days";
    return `${days} Days`;
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground">Data Bundle Plans</h1>
          <p className="text-muted-foreground mt-1">Choose your network and pick a plan</p>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {(Object.keys(NETWORKS) as Network[]).map(net => (
            <button
              key={net}
              onClick={() => setActiveNetwork(net)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm border-2 transition-all ${
                activeNetwork === net
                  ? NETWORKS[net].tabActive
                  : "border-border bg-background text-muted-foreground hover:border-primary/40"
              }`}
              data-testid={`tab-${net}`}
            >
              <span className="text-base">{NETWORK_ICONS[net]}</span>
              {NETWORKS[net].label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-52 rounded-2xl bg-muted animate-pulse" />
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
              <div
                key={bundle.id}
                className="rounded-2xl overflow-hidden cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all duration-200 group"
                onClick={() => handleSelect(bundle as Bundle)}
                data-testid={`card-bundle-${bundle.id}`}
              >
                {/* Coloured top — network colour, centered data amount, badge top-left */}
                <div className={`${theme.cardBg} relative flex items-center justify-center`} style={{ height: "160px" }}>
                  {/* Network badge — top left */}
                  <div className={`absolute top-3 left-3 border-2 rounded-full px-2.5 py-0.5 text-xs font-extrabold tracking-widest select-none ${theme.badgeBorder}`}>
                    {theme.shortLabel}
                  </div>

                  {/* Large centred data amount */}
                  <span className={`text-5xl font-black tracking-tight ${theme.cardText}`}>
                    {bundle.dataAmount}
                  </span>
                </div>

                {/* Dark info bar — Price / Rollover / Duration */}
                <div className="bg-[#2b2b2b] grid grid-cols-3 divide-x divide-gray-600">
                  <div className="py-3 px-2 text-center">
                    <div className="text-sm font-bold text-white">GH₵{bundle.price}</div>
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
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to Cart</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {selected && (
              <div className={`${theme.cardBg} rounded-xl overflow-hidden`}>
                <div className={`relative flex items-center justify-center py-6`}>
                  <div className={`absolute top-2 left-3 border-2 rounded-full px-2.5 py-0.5 text-xs font-extrabold tracking-widest ${theme.badgeBorder}`}>
                    {theme.shortLabel}
                  </div>
                  <span className={`text-4xl font-black ${theme.cardText}`}>{selected.dataAmount}</span>
                </div>
                <div className="bg-[#2b2b2b] grid grid-cols-3 divide-x divide-gray-600">
                  <div className="py-2 text-center">
                    <div className="text-sm font-bold text-white">GH₵{selected.price}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5 uppercase">Price</div>
                  </div>
                  <div className="py-2 text-center">
                    <div className="text-sm font-bold text-white">N/A</div>
                    <div className="text-[10px] text-gray-400 mt-0.5 uppercase">Rollover</div>
                  </div>
                  <div className="py-2 text-center">
                    <div className="text-sm font-bold text-white">{formatDuration(selected.validityDays)}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5 uppercase">Duration</div>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone number to activate on</Label>
              <Input
                id="phone"
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
              disabled={!phoneNumber.trim()}
              data-testid="button-confirm-add"
            >
              <ShoppingCart className="w-4 h-4 mr-1.5" />
              Add to Cart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
