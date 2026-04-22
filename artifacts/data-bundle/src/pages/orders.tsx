import { useListMyOrders } from "@workspace/api-client-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Clock, Wifi, Phone } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400",
  processing: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400",
  completed: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400",
  failed: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400",
};

export default function Orders() {
  return (
    <ProtectedRoute>
      <OrdersContent />
    </ProtectedRoute>
  );
}

function OrdersContent() {
  const { data: orders, isLoading } = useListMyOrders();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">My Orders</h1>
          <p className="text-muted-foreground text-sm mt-1">Track all your data bundle purchases</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : !orders?.length ? (
          <div className="bg-card border border-border rounded-2xl p-16 text-center">
            <ShoppingCart className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-foreground mb-2">No orders yet</h2>
            <p className="text-muted-foreground text-sm mb-6">Purchase your first data bundle to get started.</p>
            <Link href="/bundles">
              <Button data-testid="button-shop-now">Browse Data Plans</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map(order => (
              <div
                key={order.id}
                className="bg-card border border-border rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-sm transition-shadow"
                data-testid={`row-order-${order.id}`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Wifi className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">{order.bundleName}</div>
                    <div className="text-sm text-muted-foreground">{order.bundleData}</div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{order.phoneNumber}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(order.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-xl font-bold text-foreground">${order.price}</span>
                  <Badge className={`capitalize border ${STATUS_COLORS[order.status]}`} data-testid={`status-order-${order.id}`}>
                    {order.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
