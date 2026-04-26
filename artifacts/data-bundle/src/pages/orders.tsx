import { useState, useMemo } from "react";
import { useListMyOrders } from "@workspace/api-client-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ShoppingCart, Search, CheckCircle2, Clock, AlertCircle, Wifi,
} from "lucide-react";
import React from "react";

const STATUS_TABS = [
  { key: "all",        label: "All" },
  { key: "pending",    label: "Pending" },
  { key: "processing", label: "Processing" },
  { key: "completed",  label: "Completed" },
  { key: "failed",     label: "Failed" },
] as const;

type StatusKey = (typeof STATUS_TABS)[number]["key"];

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

const NETWORK_LABELS: Record<string, string> = {
  mtn:          "MTN",
  telecel:      "Telecel",
  "at-ishare":  "AT iShare",
  "at-bigtime": "AT Big-Time",
};

const NETWORK_COLORS: Record<string, string> = {
  mtn:          "bg-yellow-400 text-gray-900",
  telecel:      "bg-red-600 text-white",
  "at-ishare":  "bg-blue-600 text-white",
  "at-bigtime": "bg-green-700 text-white",
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

  const [activeStatus, setActiveStatus] = useState<StatusKey>("all");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [dateFrom, setDateFrom]       = useState("");
  const [dateTo, setDateTo]           = useState("");

  const counts = useMemo(() => {
    const all = orders ?? [];
    return {
      all:        all.length,
      pending:    all.filter(o => o.status === "pending").length,
      processing: all.filter(o => o.status === "processing").length,
      completed:  all.filter(o => o.status === "completed").length,
      failed:     all.filter(o => o.status === "failed").length,
    };
  }, [orders]);

  const filtered = useMemo(() => {
    let list = orders ?? [];

    if (activeStatus !== "all") {
      list = list.filter(o => o.status === activeStatus);
    }

    if (phoneSearch.trim()) {
      const q = phoneSearch.trim().toLowerCase();
      list = list.filter(o => o.phoneNumber?.toLowerCase().includes(q));
    }

    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      list = list.filter(o => new Date(o.createdAt) >= from);
    }

    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter(o => new Date(o.createdAt) <= to);
    }

    return list;
  }, [orders, activeStatus, phoneSearch, dateFrom, dateTo]);

  const totalSpent = useMemo(
    () => (orders ?? []).filter(o => o.status === "completed").reduce((s, o) => s + o.price, 0),
    [orders]
  );

  const clearFilters = () => {
    setActiveStatus("all");
    setPhoneSearch("");
    setDateFrom("");
    setDateTo("");
  };

  const hasActiveFilters = activeStatus !== "all" || phoneSearch || dateFrom || dateTo;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Orders</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {(orders?.length ?? 0)} total orders · GH₵{totalSpent.toFixed(2)} spent
            </p>
          </div>
          <Link href="/bundles">
            <Button size="sm" className="gap-1.5">
              <ShoppingCart className="w-4 h-4" /> Buy Bundle
            </Button>
          </Link>
        </div>

        {/* Filters panel */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
          {/* Status tabs */}
          <div className="flex flex-wrap gap-2">
            {STATUS_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveStatus(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  activeStatus === tab.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
                data-testid={`filter-${tab.key}`}
              >
                {tab.label}
                <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                  activeStatus === tab.key ? "bg-white/20" : "bg-muted"
                }`}>
                  {counts[tab.key]}
                </span>
              </button>
            ))}
          </div>

          {/* Secondary filters row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Phone filter */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Phone Number</Label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="e.g. 0244xxxxxx"
                  className="pl-8 h-8 text-xs rounded-xl"
                  value={phoneSearch}
                  onChange={e => setPhoneSearch(e.target.value)}
                  data-testid="input-filter-phone"
                />
              </div>
            </div>

            {/* Date from */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Date From</Label>
              <Input
                type="date"
                className="h-8 text-xs rounded-xl"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                data-testid="input-filter-date-from"
              />
            </div>

            {/* Date to */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Date To</Label>
              <Input
                type="date"
                className="h-8 text-xs rounded-xl"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                data-testid="input-filter-date-to"
              />
            </div>
          </div>

          {hasActiveFilters && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">
                Showing {filtered.length} of {orders?.length ?? 0} orders
              </span>
              <button
                className="text-xs text-primary font-semibold hover:underline"
                onClick={clearFilters}
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ShoppingCart className="w-10 h-10 mb-3 opacity-20" />
              {(orders?.length ?? 0) === 0 ? (
                <>
                  <p className="text-sm font-medium mb-1">No orders yet</p>
                  <p className="text-xs mb-4">Purchase your first data bundle to get started</p>
                  <Link href="/bundles">
                    <Button size="sm" data-testid="button-shop-now">Browse Plans</Button>
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium mb-1">No orders match your filters</p>
                  <button className="text-xs text-primary mt-1 font-semibold" onClick={clearFilters}>
                    Clear filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Date</th>
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Order ID</th>
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Phone</th>
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Network</th>
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Amount</th>
                    <th className="text-left px-5 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map(order => {
                    const netColor = NETWORK_COLORS[order.network ?? ""] ?? "bg-muted text-foreground";
                    const netLabel = NETWORK_LABELS[order.network ?? ""] ?? (order.network ?? "—");
                    return (
                      <tr
                        key={order.id}
                        className="hover:bg-muted/20 transition-colors"
                        data-testid={`row-order-${order.id}`}
                      >
                        <td className="px-5 py-3.5 text-muted-foreground text-xs whitespace-nowrap">
                          {new Date(order.createdAt).toLocaleString("en-GH", {
                            day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
                          })}
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground text-xs font-mono">#{order.id}</td>
                        <td className="px-5 py-3.5 text-foreground font-mono text-xs">{order.phoneNumber}</td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-extrabold ${netColor}`}>
                            {netLabel}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 font-bold text-foreground">GH₵{order.price}</td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[order.status]}`}
                            data-testid={`status-order-${order.id}`}
                          >
                            {STATUS_ICONS[order.status]}
                            {order.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
