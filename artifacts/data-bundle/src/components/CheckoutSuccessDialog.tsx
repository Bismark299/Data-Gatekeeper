import { Button } from "@/components/ui/button";
import { CheckCircle, ShoppingBag } from "lucide-react";
import { useLocation } from "wouter";

interface CheckoutResult {
  orders: { id: number; bundleData: string; phoneNumber: string; price: number }[];
  totalCharged: number;
  remainingBalance: number;
}

interface Props {
  result: CheckoutResult | null;
  onClose: () => void;
}

export function CheckoutSuccessDialog({ result, onClose }: Props) {
  const [, setLocation] = useLocation();

  if (!result) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background rounded-2xl shadow-2xl border border-border max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 px-6 py-8 text-center text-white">
          <CheckCircle className="w-14 h-14 mx-auto mb-3 opacity-90" />
          <h2 className="text-xl font-bold">Payment Successful!</h2>
          <p className="text-white/80 text-sm mt-1">Your bundles are being activated</p>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-2">
            {result.orders.map(order => (
              <div key={order.id} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="font-semibold text-sm text-foreground">{order.bundleData}</div>
                    <div className="text-xs text-muted-foreground">{order.phoneNumber}</div>
                  </div>
                </div>
                <div className="text-sm font-bold text-foreground shrink-0">GH₵{order.price.toFixed(2)}</div>
              </div>
            ))}
          </div>

          <div className="bg-muted/40 rounded-xl p-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total charged</span>
              <span className="font-bold text-foreground">GH₵{result.totalCharged.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Remaining balance</span>
              <span className="font-semibold text-foreground">GH₵{result.remainingBalance.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => { onClose(); setLocation("/orders"); }}
            >
              View Orders
            </Button>
            <Button className="flex-1" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
