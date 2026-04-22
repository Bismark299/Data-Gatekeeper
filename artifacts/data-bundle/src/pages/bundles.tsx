import { useState } from "react";
import { useListBundles, useCreateOrder } from "@workspace/api-client-react";
import { getListMyOrdersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Wifi, Search, Check, ShoppingCart } from "lucide-react";

const CATEGORIES = ["all", "daily", "weekly", "monthly", "social"];

interface Bundle {
  id: number;
  name: string;
  description: string;
  dataAmount: string;
  validityDays: number;
  price: number;
  category: string;
  isActive: boolean;
}

export default function Bundles() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Bundle | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [showOrder, setShowOrder] = useState(false);

  const { data: bundles, isLoading } = useListBundles(
    category !== "all" ? { category } : {}
  );

  const createOrder = useCreateOrder();

  const filtered = bundles?.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    b.description.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const handleBuy = (bundle: Bundle) => {
    if (!isAuthenticated) {
      setLocation("/login");
      return;
    }
    setSelected(bundle);
    setShowOrder(true);
  };

  const handleOrder = () => {
    if (!selected || !phoneNumber.trim()) return;

    createOrder.mutate(
      { data: { bundleId: selected.id, phoneNumber: phoneNumber.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMyOrdersQueryKey() });
          toast({ title: "Order placed!", description: `${selected.name} will be activated shortly.` });
          setShowOrder(false);
          setPhoneNumber("");
          setLocation("/orders");
        },
        onError: () => {
          toast({ title: "Order failed", description: "Please try again.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Data Bundle Plans</h1>
          <p className="text-muted-foreground">Choose the perfect plan for your needs</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search plans..."
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-search-bundles"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map(cat => (
              <Button
                key={cat}
                size="sm"
                variant={category === cat ? "default" : "outline"}
                onClick={() => setCategory(cat)}
                className="capitalize"
                data-testid={`filter-${cat}`}
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-64 rounded-2xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Wifi className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground">No plans found</h3>
            <p className="text-muted-foreground mt-1">Try a different category or search term.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map(bundle => (
              <div
                key={bundle.id}
                className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-4 hover:shadow-md hover:border-primary/40 transition-all"
                data-testid={`card-bundle-${bundle.id}`}
              >
                <div>
                  <Badge variant="outline" className="capitalize text-xs mb-2">{bundle.category}</Badge>
                  <h3 className="font-semibold text-foreground text-lg leading-tight">{bundle.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{bundle.description}</p>
                </div>
                <div className="bg-muted/50 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-primary">{bundle.dataAmount}</div>
                  <div className="text-xs text-muted-foreground">{bundle.validityDays}-day validity</div>
                </div>
                <ul className="space-y-1.5">
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />Instant activation
                  </li>
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />24/7 support
                  </li>
                </ul>
                <div className="flex items-center justify-between mt-auto pt-2 border-t border-border">
                  <span className="text-xl font-extrabold text-foreground">${bundle.price}</span>
                  <Button
                    size="sm"
                    onClick={() => handleBuy(bundle as Bundle)}
                    className="gap-1.5"
                    data-testid={`button-buy-${bundle.id}`}
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    Buy Now
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showOrder} onOpenChange={setShowOrder}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purchase {selected?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-muted/50 rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold">{selected?.dataAmount}</div>
                <div className="text-sm text-muted-foreground">{selected?.validityDays}-day validity</div>
              </div>
              <div className="text-2xl font-bold text-primary">${selected?.price}</div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone number to activate on</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+1234567890"
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                data-testid="input-phone-order"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOrder(false)}>Cancel</Button>
            <Button
              onClick={handleOrder}
              disabled={createOrder.isPending || !phoneNumber.trim()}
              data-testid="button-confirm-order"
            >
              {createOrder.isPending ? "Processing..." : "Confirm Purchase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
