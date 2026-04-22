import { Link } from "wouter";
import { useListMyOrders, useGetMe } from "@workspace/api-client-react";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Package, ShoppingCart, User, ArrowRight, Wifi, Clock } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
};

export default function Dashboard() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}

function DashboardContent() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: orders, isLoading } = useListMyOrders();

  const recentOrders = orders?.slice(0, 3) ?? [];
  const totalSpent = orders?.filter(o => o.status === "completed").reduce((sum, o) => sum + o.price, 0) ?? 0;
  const activeOrders = orders?.filter(o => o.status === "processing" || o.status === "pending").length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Welcome back, {user?.name?.split(" ")[0]}</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your data bundles and orders</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
          <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4" data-testid="stat-total-orders">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <ShoppingCart className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{orders?.length ?? 0}</div>
              <div className="text-sm text-muted-foreground">Total Orders</div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4" data-testid="stat-active-orders">
            <div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
              <Wifi className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{activeOrders}</div>
              <div className="text-sm text-muted-foreground">Active Bundles</div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4" data-testid="stat-total-spent">
            <div className="w-11 h-11 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">${totalSpent.toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">Total Spent</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="font-semibold text-foreground">Recent Orders</h2>
                <Link href="/orders">
                  <Button variant="ghost" size="sm" className="gap-1 text-primary">
                    View all <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
              {isLoading ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
                  ))}
                </div>
              ) : recentOrders.length === 0 ? (
                <div className="p-10 text-center">
                  <ShoppingCart className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">No orders yet</p>
                  <Link href="/bundles">
                    <Button size="sm" className="mt-4" data-testid="button-browse-empty">Browse Plans</Button>
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {recentOrders.map(order => (
                    <div key={order.id} className="px-6 py-4 flex items-center justify-between gap-4" data-testid={`row-order-${order.id}`}>
                      <div className="min-w-0">
                        <div className="font-medium text-foreground text-sm truncate">{order.bundleName}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {new Date(order.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-semibold text-sm">${order.price}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[order.status]}`}>
                          {order.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Profile</h3>
              </div>
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-muted-foreground">Name</div>
                  <div className="text-sm font-medium text-foreground">{user?.name}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Email</div>
                  <div className="text-sm text-foreground truncate">{user?.email}</div>
                </div>
                {user?.phone && (
                  <div>
                    <div className="text-xs text-muted-foreground">Phone</div>
                    <div className="text-sm text-foreground">{user.phone}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground">Account type</div>
                  <Badge className="capitalize mt-1">{user?.role}</Badge>
                </div>
              </div>
            </div>

            <div className="bg-primary rounded-2xl p-5 text-primary-foreground">
              <Wifi className="w-7 h-7 mb-3 opacity-80" />
              <h3 className="font-semibold mb-1">Need more data?</h3>
              <p className="text-sm text-primary-foreground/70 mb-4">Browse our plans and stay connected.</p>
              <Link href="/bundles">
                <Button variant="secondary" size="sm" className="gap-1.5 w-full" data-testid="button-buy-more">
                  Browse Plans <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
