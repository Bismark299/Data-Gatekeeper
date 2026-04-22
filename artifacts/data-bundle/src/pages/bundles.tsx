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
  tagline: string;
  headerBg: string;
  headerText: string;
  accentBg: string;
  accentText: string;
  badgeBg: string;
  checkColor: string;
  btnClass: string;
  tabActive: string;
}> = {
  mtn: {
    label: "MTN",
    tagline: "Everywhere You Go",
    headerBg: "bg-gradient-to-br from-yellow-400 to-amber-500",
    headerText: "text-gray-900",
    accentBg: "bg-yellow-50 dark:bg-yellow-900/20",
    accentText: "text-yellow-700 dark:text-yellow-300",
    badgeBg: "bg-yellow-500",
    checkColor: "text-yellow-600",
    btnClass: "bg-yellow-500 hover:bg-yellow-600 text-gray-900 border-yellow-500",
    tabActive: "bg-yellow-400 text-gray-900 border-yellow-500",
  },
  telecel: {
    label: "Telecel",
    tagline: "Advancing Lives",
    headerBg: "bg-gradient-to-br from-red-600 to-rose-700",
    headerText: "text-white",
    accentBg: "bg-red-50 dark:bg-red-900/20",
    accentText: "text-red-700 dark:text-red-300",
    badgeBg: "bg-red-600",
    checkColor: "text-red-600",
    btnClass: "bg-red-600 hover:bg-red-700 text-white border-red-600",
    tabActive: "bg-red-600 text-white border-red-600",
  },
  "at-ishare": {
    label: "AT iShare",
    tagline: "Share the Experience",
    headerBg: "bg-gradient-to-br from-blue-600 to-blue-800",
    headerText: "text-white",
    accentBg: "bg-blue-50 dark:bg-blue-900/20",
    accentText: "text-blue-700 dark:text-blue-300",
    badgeBg: "bg-blue-600",
    checkColor: "text-blue-600",
    btnClass: "bg-blue-600 hover:bg-blue-700 text-white border-blue-600",
    tabActive: "bg-blue-600 text-white border-blue-600",
  },
  "at-bigtime": {
    label: "AT Big-Time",
    tagline: "Go Big or Go Home",
    headerBg: "bg-gradient-to-br from-green-700 to-emerald-800",
    headerText: "text-white",
    accentBg: "bg-green-50 dark:bg-green-900/20",
    accentText: "text-green-700 dark:text-green-300",
    badgeBg: "bg-green-700",
    checkColor: "text-green-600",
    btnClass: "bg-green-700 hover:bg-green-800 text-white border-green-700",
    tabActive: "bg-green-700 text-white border-green-700",
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

  const handleAddToCart = (bundle: Bundle) => {
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

        <div className={`${theme.headerBg} rounded-2xl p-5 mb-6 flex items-center justify-between`}>
          <div>
            <div className={`text-2xl font-extrabold ${theme.headerText} tracking-tight`}>{theme.label}</div>
            <div className={`text-sm font-medium mt-0.5 ${theme.headerText} opacity-80`}>{theme.tagline}</div>
          </div>
          <div className={`text-4xl font-black ${theme.headerText} opacity-20 uppercase tracking-tighter select-none`}>
            {theme.label.split(" ")[0]}
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-64 rounded-2xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Wifi className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold">No plans found</h3>
            <p className="text-muted-foreground mt-1">Try a different search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map(bundle => (
              <div
                key={bundle.id}
                className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col hover:shadow-lg hover:-translate-y-0.5 transition-all"
                data-testid={`card-bundle-${bundle.id}`}
              >
                <div className={`${theme.headerBg} px-4 py-3`}>
                  <div className={`text-xs font-bold uppercase tracking-widest ${theme.headerText} opacity-70 mb-1`}>
                    {theme.label}
                  </div>
                  <div className={`text-2xl font-extrabold ${theme.headerText}`}>{bundle.dataAmount}</div>
                </div>

                <div className="p-4 flex flex-col flex-1">
                  <div className="mt-auto pt-3 border-t border-border flex items-center justify-between">
                    <div>
                      <span className="text-xl font-extrabold text-foreground">GH₵{bundle.price}</span>
                    </div>
                    <button
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${theme.btnClass}`}
                      onClick={() => handleAddToCart(bundle as Bundle)}
                      data-testid={`button-add-${bundle.id}`}
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      Add
                    </button>
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
              <div className={`${theme.headerBg} rounded-xl p-4 flex items-center justify-between`}>
                <div>
                  <div className={`font-bold ${theme.headerText}`}>{selected.name}</div>
                  <div className={`text-sm ${theme.headerText} opacity-75`}>{selected.validityDays}-day validity</div>
                </div>
                <div className={`text-2xl font-extrabold ${theme.headerText}`}>GH₵{selected.price}</div>
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
