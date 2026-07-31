import { useGetCart, useGetWalletBalance, getGetCartQueryKey, getGetWalletBalanceQueryKey } from "@workspace/api-client-react";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { X, ShoppingCart, Trash2, Wallet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const NETWORK_COLORS: Record<string, { bg: string; text: string }> = {
  mtn:        { bg: "bg-yellow-400", text: "text-gray-900" },
  telecel:    { bg: "bg-red-600",    text: "text-white" },
  "at-ishare":  { bg: "bg-blue-600",   text: "text-white" },
  "at-bigtime": { bg: "bg-green-700",  text: "text-white" },
};

export function CartDrawer() {
  const { open, setOpen, removeItem, clearItems, checkout, isCheckingOut } = useCart();
  const { isAuthenticated } = useAuth();
  const { data: cart } = useGetCart({ query: { queryKey: getGetCartQueryKey(), enabled: isAuthenticated } });
  const { data: wallet } = useGetWalletBalance({ query: { queryKey: getGetWalletBalanceQueryKey(), enabled: isAuthenticated } });

  const total = cart?.reduce((s, i) => s + i.price, 0) ?? 0;
  const balance = Number(wallet?.balance ?? 0);
  const canCheckout = balance >= total && (cart?.length ?? 0) > 0;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      <div
        className={`fixed top-0 right-0 h-full w-full max-w-sm bg-background border-l border-border z-50 flex flex-col shadow-2xl transform transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary" />
            <span className="font-bold text-foreground">My Cart</span>
            {(cart?.length ?? 0) > 0 && (
              <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">{cart?.length}</span>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {wallet && (
          <div className="px-5 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" />
            <span className="text-sm text-muted-foreground">Wallet Balance:</span>
            <span className="text-sm font-bold text-foreground">GH₵{balance.toFixed(2)}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {!cart?.length ? (
            <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
              <ShoppingCart className="w-10 h-10 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">Your cart is empty</p>
            </div>
          ) : (
            cart.map(item => {
              const colors = NETWORK_COLORS[item.bundleNetwork] ?? { bg: "bg-primary", text: "text-white" };
              return (
                <div key={item.id} className="bg-card border border-border rounded-xl overflow-hidden" data-testid={`cart-item-${item.id}`}>
                  <div className={`${colors.bg} ${colors.text} px-3 py-1.5 flex items-center justify-between`}>
                    <span className="text-xs font-bold uppercase tracking-wide">{item.bundleNetwork.replaceAll("-", " ")}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-6 w-6 ${colors.text} hover:bg-black/10`}
                      onClick={() => removeItem(item.id)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="p-3 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-sm text-foreground">{item.bundleData}</div>
                      <div className="text-xs text-muted-foreground">{item.phoneNumber}</div>
                    </div>
                    <div className="text-base font-bold text-foreground">GH₵{item.price.toFixed(2)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {(cart?.length ?? 0) > 0 && (
          <div className="p-5 border-t border-border space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="font-bold text-foreground">GH₵{total.toFixed(2)}</span>
            </div>
            {balance < total && (
              <p className="text-xs text-destructive">
                Insufficient balance. You need GH₵{(total - balance).toFixed(2)} more.
              </p>
            )}
            <Button
              className="w-full"
              disabled={!canCheckout || isCheckingOut}
              onClick={checkout}
              data-testid="button-checkout"
            >
              {isCheckingOut ? "Processing..." : `Pay GH₵${total.toFixed(2)} from Wallet`}
            </Button>
            <Button variant="ghost" size="sm" className="w-full text-destructive hover:text-destructive text-xs" onClick={clearItems}>
              <Trash2 className="w-3 h-3 mr-1" />
              Clear cart
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
