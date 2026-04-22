import { useState } from "react";
import {
  useAdminGetStats,
  useAdminGetRevenue,
  useAdminGetTopBundles,
  useAdminListOrders
} from "@workspace/api-client-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu, Users, ShoppingCart, DollarSign, Package, Clock, TrendingUp } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
};

export default function AdminDashboard() {
  return (
    <ProtectedRoute adminOnly>
      <AdminDashboardContent />
    </ProtectedRoute>
  );
}

function AdminDashboardContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: stats, isLoading: statsLoading } = useAdminGetStats();
  const { data: revenue } = useAdminGetRevenue();
  const { data: topBundles } = useAdminGetTopBundles();
  const { data: recentOrders } = useAdminListOrders({});

  const statCards = stats ? [
    { icon: Users, label: "Total Users", value: stats.totalUsers, sub: `+${stats.recentUsers} this month`, color: "text-blue-500" },
    { icon: ShoppingCart, label: "Total Orders", value: stats.totalOrders, sub: `+${stats.recentOrders} this month`, color: "text-purple-500" },
    { icon: DollarSign, label: "Total Revenue", value: `$${stats.totalRevenue.toFixed(2)}`, sub: "From completed orders", color: "text-green-500" },
    { icon: Package, label: "Active Bundles", value: stats.activeBundles, sub: "Currently listed", color: "text-orange-500" },
    { icon: Clock, label: "Pending Orders", value: stats.pendingOrders, sub: "Awaiting processing", color: "text-yellow-500" },
    { icon: TrendingUp, label: "Completed", value: stats.completedOrders, sub: "Successfully fulfilled", color: "text-emerald-500" },
  ] : [];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-auto">
        <header className="sticky top-0 z-10 bg-background border-b border-border px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)} data-testid="button-sidebar-toggle">
            <Menu className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Platform overview</p>
          </div>
        </header>

        <main className="flex-1 p-6 space-y-6">
          {statsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-28 rounded-2xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {statCards.map(card => (
                <div key={card.label} className="bg-card border border-border rounded-2xl p-5" data-testid={`stat-${card.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <card.icon className={`w-4 h-4 ${card.color}`} />
                    <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
                  </div>
                  <div className="text-2xl font-bold text-foreground">{card.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{card.sub}</div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-card border border-border rounded-2xl p-5">
              <h2 className="font-semibold text-foreground mb-4">Revenue (Last 30 Days)</h2>
              {!revenue?.length ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={revenue}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(213,94%,52%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(213,94%,52%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="hsl(213,94%,52%)" fill="url(#revGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-card border border-border rounded-2xl p-5">
              <h2 className="font-semibold text-foreground mb-4">Top Bundles</h2>
              {!topBundles?.length ? (
                <div className="text-muted-foreground text-sm">No data yet</div>
              ) : (
                <div className="space-y-3">
                  {topBundles.map((b, i) => (
                    <div key={b.id} className="flex items-center gap-3" data-testid={`top-bundle-${b.id}`}>
                      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{b.name}</div>
                        <div className="text-xs text-muted-foreground">{b.orders} orders</div>
                      </div>
                      <div className="text-sm font-semibold shrink-0">${b.revenue.toFixed(0)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Recent Orders</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground">ID</th>
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground">Bundle</th>
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground">Phone</th>
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground">Amount</th>
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentOrders?.slice(0, 5).map(order => (
                    <tr key={order.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-order-${order.id}`}>
                      <td className="px-6 py-3 text-muted-foreground">#{order.id}</td>
                      <td className="px-6 py-3 font-medium">{order.bundleName}</td>
                      <td className="px-6 py-3 text-muted-foreground">{order.phoneNumber}</td>
                      <td className="px-6 py-3 font-semibold">${order.price}</td>
                      <td className="px-6 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[order.status]}`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">{new Date(order.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!recentOrders?.length && (
                <div className="py-10 text-center text-muted-foreground text-sm">No orders yet</div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
