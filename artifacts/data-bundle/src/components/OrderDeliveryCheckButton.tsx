import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw } from "lucide-react";

interface OrderDeliveryCheckResult {
  state: "not_dispatched" | "cooldown" | "checked";
  summary: { itemCount: number; delivered: number; failed: number; pending: number; unknown: number } | null;
  delivery: { status: string; date: string; time: string; ambiguous?: boolean } | null;
  orderStatus: string;
}

/**
 * Per-order live "Check delivery" button. Calls the authenticated re-fetch + settle endpoint
 * for a single order (the SAME safe path as the background poller) and surfaces the result as
 * a toast. `scope` picks the admin or owner endpoint; `invalidateKeys` refresh the order list
 * afterwards. The provider caps delivery-status at 1 check/min (shared with the auto-checker),
 * which the messaging makes clear.
 */
export function OrderDeliveryCheckButton({
  orderId,
  scope,
  compact = false,
  invalidateKeys = [],
}: {
  orderId: number;
  scope: "admin" | "user";
  compact?: boolean;
  invalidateKeys?: readonly (readonly unknown[])[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const url = scope === "admin"
    ? `/api/admin/orders/${orderId}/check-delivery`
    : `/api/orders/${orderId}/check-delivery`;

  const mutation = useMutation({
    mutationFn: () =>
      fetch(url, { method: "POST", credentials: "include" }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Delivery check failed");
        return d as OrderDeliveryCheckResult;
      }),
    onSuccess: d => {
      if (d.state === "not_dispatched") {
        toast({
          title: "Not sent to provider yet",
          description: "This order hasn't been dispatched to the delivery provider yet. Please check back shortly.",
        });
      } else if (d.delivery?.status && !d.delivery.ambiguous) {
        const when = [d.delivery.date, d.delivery.time].filter(Boolean).join(" ");
        toast({
          title: `Delivery status: ${d.delivery.status}`,
          description: when ? `Reported ${when} — order is now ${d.orderStatus}.` : `Order is now ${d.orderStatus}.`,
        });
      } else if (d.state === "cooldown") {
        toast({
          title: "Just checked moments ago",
          description: "Showing the latest known status. The provider allows 1 check per minute — please try again shortly.",
        });
      } else {
        toast({
          title: "No delivery update yet",
          description: "The provider has no new status for this order. It allows 1 check per minute (shared with the auto-checker) — try again shortly.",
        });
      }
      for (const key of invalidateKeys) queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e: unknown) =>
      toast({ title: e instanceof Error ? e.message : "Delivery check failed", variant: "destructive" }),
  });

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={(e) => { e.stopPropagation(); mutation.mutate(); }}
      disabled={mutation.isPending}
      title="Check delivery status"
      className={compact ? "h-7 w-7 p-0" : "gap-1.5 h-7 text-xs"}
      data-testid={`button-check-delivery-${orderId}`}
    >
      {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
      {!compact && "Check delivery"}
    </Button>
  );
}
