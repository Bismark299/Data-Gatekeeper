import { useState } from "react";
import {
  useAdminGetStats,
  useAdminGetRevenue,
  useAdminGetTopBundles,
  useAdminListOrders,
} from "@workspace/api-client-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { AdminFinancialSummary } from "@/components/AdminFinancialSummary";
import { Button } from "@/components/ui/button";
import { Menu, RefreshCw, TrendingUp, BarChart3, PieChart, Wifi } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, PieChart as RechartsPie, Pie, Legend,
} from "recharts";

const PIE_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444"];

export default function AdminStats() {
  return (
    <ProtectedRoute adminOnly>
      <AdminStatsContent />
    </ProtectedRoute>
  );
}

function AdminStatsContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: stats, refetch: refetchStats } = useAdminGetStats();
  const { data: revenue, refetch: refetchRevenue } = useAdminGetRevenue();
  const { data: topBundles } = useAdminGetTopBundles();
  const { data: orders } = useAdminListOrders({});

  const handleRefresh = () => { refetchStats(); refetchRevenue(); };

  const orderStatusData = stats ? [
    { name: "Pending",    value: stats.pendingOrders },
    { name: "Completed",  value: stats.completedOrders },
    { name: "Processing", value: stats.totalOrders - stats.pendingOrders - stats.completedOrders - (orders?.filter(o => o.status === "failed").length ?? 0) },
    { name: "Failed",     value: orders?.filter(o => o.status === "failed").length ?? 0 },
  ].filter(d => d.value > 0) : [];

  const networkData = (() => {
    if (!orders) return [];
    const map: Record<string, number> = {};
    orders.forEach(o => {
      const net = (o.bundleName ?? "").split(" ")[0];
      map[net] = (map[net] ?? 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 4);
  })();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-auto">
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-6 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Statistics</h1>
            <p className="text-xs text-muted-foreground">Platform analytics and revenue trends</p>
          </div>
          <AdminFinancialSummary />
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </header>

        <main className="flex-1 p-6 space-y-6">

          {/* Revenue trend */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-bold text-foreground">Revenue Trend (Last 30 Days)</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Daily completed order revenue in GH₵</p>
              </div>
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
            </div>
            {!revenue?.length ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                <div className="text-center"><Wifi className="w-8 h-8 mx-auto mb-2 opacity-20" /><p>No revenue data yet</p></div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={revenue} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(220,55%,40%)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="hsl(220,55%,40%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }}
                    formatter={(v: number) => [`GH₵${v.toFixed(2)}`, "Revenue"]}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(220,55%,45%)" strokeWidth={2.5} fill="url(#revGrad)" dot={false} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Charts grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Top bundles bar */}
            <div className="bg-card border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="font-bold text-foreground">Top Bundles</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">By order volume</p>
                </div>
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
              </div>
              {!topBundles?.length ? (
                <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={topBundles.map(b => ({ name: b.name.slice(0, 16), orders: b.orders }))} margin={{ top: 0, right: 5, left: -20, bottom: 0 }} barSize={18}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 11 }} />
                      <Bar dataKey="orders" radius={[4, 4, 0, 0]}>
                        {topBundles.map((_, i) => <Cell key={i} fill={`hsl(${220 + i * 15},55%,${45 + i * 4}%)`} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-4 space-y-2">
                    {topBundles.map((b, i) => (
                      <div key={b.id} className="flex items-center gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{b.name}</div>
                          <div className="w-full h-1 rounded-full bg-muted mt-1">
                            <div className="h-1 rounded-full bg-primary" style={{ width: `${Math.min(100, (b.orders / (topBundles[0]?.orders || 1)) * 100)}%` }} />
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0">{b.orders} orders · GH₵{b.revenue.toFixed(0)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Order status pie */}
            <div className="bg-card border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="font-bold text-foreground">Order Status Breakdown</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Distribution of all orders</p>
                </div>
                <PieChart className="w-4 h-4 text-muted-foreground" />
              </div>
              {!orderStatusData.length ? (
                <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <RechartsPie>
                    <Pie data={orderStatusData} cx="50%" cy="45%" innerRadius={60} outerRadius={95} paddingAngle={3} dataKey="value">
                      {orderStatusData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  </RechartsPie>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Daily orders trend */}
          {revenue && revenue.length > 0 && (
            <div className="bg-card border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="font-bold text-foreground">Daily Order Volume (Last 30 Days)</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Number of orders per day</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={revenue} margin={{ top: 0, right: 5, left: -20, bottom: 0 }} barSize={10}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }} formatter={(v: number) => [v, "Orders"]} />
                  <Bar dataKey="orders" fill="hsl(220,55%,55%)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Network breakdown */}
          {networkData.length > 0 && (
            <div className="bg-card border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="font-bold text-foreground">Orders by Network</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Breakdown of orders across networks</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {networkData.map((n, i) => (
                  <div key={n.name} className="rounded-xl border border-border p-4 text-center">
                    <div className="text-2xl font-extrabold text-foreground">{n.value}</div>
                    <div className="text-xs text-muted-foreground mt-1">{n.name}</div>
                    <div className="w-full h-1 rounded-full bg-muted mt-2">
                      <div className="h-1 rounded-full" style={{ width: `${(n.value / (networkData[0]?.value || 1)) * 100}%`, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
