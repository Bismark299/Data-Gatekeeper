import { Link } from "wouter";
import {
  useListMyOrders,
  useGetMe,
  useGetWalletBalance,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import {
  ShoppingCart, Wallet, CheckCircle2, Clock, TrendingUp,
  Phone, ArrowRight, Wifi, Package, AlertCircle,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending:    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
  completed:  "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
  failed:     "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending:    <Clock className="w-3 h-3" />,
  processing: <Wifi className="w-3 h-3" />,
  completed:  <CheckCircle2 className="w-3 h-3" />,
  failed:     <AlertCircle className="w-3 h-3" />,
};

const NETWORK_COLORS: Record<string, string> = {
  mtn:          "bg-yellow-400 text-gray-900",
  telecel:      "bg-red-600 text-white",
  "at-ishare":  "bg-blue-600 text-white",
  "at-bigtime": "bg-green-700 text-white",
};

import React from "react";

export default function Dashboard() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}

function DashboardContent() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: orders, isLoading } = useListMyOrders({ refetchInterval: 10000, staleTime: 0 } as any);
  const { data: wallet } = useGetWalletBalance();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayOrders   = orders?.filter(o => new Date(o.createdAt) >= todayStart) ?? [];
  const completed     = todayOrders.filter(o => o.status === "completed");
  const pending       = todayOrders.filter(o => o.status === "pending" || o.status === "processing");
  const failed        = todayOrders.filter(o => o.status === "failed");
  const totalSpent    = completed.reduce((s, o) => s + o.price, 0);
  const lastOrder     = orders?.[0];
  const recentOrders  = orders?.slice(0, 5) ?? [];

  const initials = user?.name
    ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  const summaryCards = [
    {
      label: "Wallet Balance",
      value: `GH₵${(wallet?.balance ?? 0).toFixed(2)}`,
      icon: Wallet,
      color: "bg-primary/10 text-primary",
      sub: "Available to spend",
      href: "/wallet",
    },
    {
      label: "Today's Orders",
      value: todayOrders.length,
      icon: ShoppingCart,
      color: "bg-blue-500/10 text-blue-600",
      sub: "Placed today",
      href: "/orders",
    },
    {
      label: "Completed",
      value: completed.length,
      icon: CheckCircle2,
      color: "bg-green-500/10 text-green-600",
      sub: "Today",
      href: "/orders",
    },
    {
      label: "Pending / Active",
      value: pending.length,
      icon: Clock,
      color: "bg-yellow-500/10 text-yellow-600",
      sub: "In progress today",
      href: "/orders",
    },
    {
      label: "Spent Today",
      value: `GH₵${totalSpent.toFixed(2)}`,
      icon: TrendingUp,
      color: "bg-purple-500/10 text-purple-600",
      sub: "On completed orders",
      href: "/orders",
    },
    {
      label: "Failed Today",
      value: failed.length,
      icon: AlertCircle,
      color: "bg-red-500/10 text-red-500",
      sub: "Needs attention",
      href: "/orders",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground text-xl font-extrabold shrink-0 shadow-md">
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground">
                  Welcome back, {user?.name?.split(" ")[0] ?? "there"}
                </h1>
                {user?.role && user.role !== "user" && (
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${
                    user.role === "admin"  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                    user.role === "dealer" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" :
                    user.role === "agent"  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {user.role}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground text-sm mt-0.5">{user?.email}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/wallet">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Wallet className="w-4 h-4" /> Fund Wallet
              </Button>
            </Link>
            <Link href="/bundles">
              <Button size="sm" className="gap-1.5">
                <Package className="w-4 h-4" /> Buy Bundle
              </Button>
            </Link>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {summaryCards.map(card => (
            <Link href={card.href} key={card.label}>
              <div className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-3 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer h-full">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${card.color}`}>
                  <card.icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-lg font-extrabold text-foreground leading-tight">
                    {isLoading && card.label !== "Wallet Balance" ? (
                      <div className="h-6 w-12 bg-muted animate-pulse rounded" />
                    ) : (
                      card.value
                    )}
                  </div>
                  <div className="text-xs font-semibold text-foreground mt-0.5">{card.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{card.sub}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Last order highlight */}
        {lastOrder && (
          <div className="bg-card border border-border rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${NETWORK_COLORS[lastOrder.network ?? ""] ?? "bg-muted text-foreground"}`}>
                {(lastOrder.network ?? "?")[0].toUpperCase()}
              </div>
              <div>
                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Most Recent Order</div>
                <div className="font-bold text-foreground">{lastOrder.bundleData}</div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{lastOrder.phoneNumber}</span>
                  <span>{new Date(lastOrder.createdAt).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <span className="text-xl font-extrabold text-foreground">GH₵{lastOrder.price}</span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[lastOrder.status]}`}>
                {STATUS_ICONS[lastOrder.status]}
                {lastOrder.status}
              </span>
            </div>
          </div>
        )}

        {/* Recent orders table */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Recent Orders</h2>
            <Link href="/orders">
              <Button variant="ghost" size="sm" className="gap-1 text-primary text-xs">
                View all <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>

          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />)}
            </div>
          ) : recentOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
              <ShoppingCart className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm mb-4">No orders yet</p>
              <Link href="/bundles">
                <Button size="sm" data-testid="button-browse-empty">Packages</Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Bundle</th>
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Phone</th>
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Amount</th>
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentOrders.map(order => (
                    <tr key={order.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-order-${order.id}`}>
                      <td className="px-6 py-3 font-medium text-foreground">{order.bundleData}</td>
                      <td className="px-6 py-3 text-muted-foreground">{order.phoneNumber}</td>
                      <td className="px-6 py-3 font-bold text-foreground">GH₵{order.price}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[order.status]}`}>
                          {STATUS_ICONS[order.status]}
                          {order.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-muted-foreground text-xs">
                        {new Date(order.createdAt).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
