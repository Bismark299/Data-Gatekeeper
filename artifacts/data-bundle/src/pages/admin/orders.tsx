import { useState } from "react";
import { useAdminListOrders, useAdminUpdateOrderStatus } from "@workspace/api-client-react";
import { getAdminListOrdersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Menu, ShoppingCart } from "lucide-react";

const STATUSES = ["all", "pending", "processing", "completed", "failed"];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
};

export default function AdminOrders() {
  return (
    <ProtectedRoute adminOnly>
      <AdminOrdersContent />
    </ProtectedRoute>
  );
}

function AdminOrdersContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: orders, isLoading } = useAdminListOrders(
    statusFilter !== "all" ? { status: statusFilter } : {}
  );
  const updateStatus = useAdminUpdateOrderStatus();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getAdminListOrdersQueryKey({}) });

  const handleStatusChange = (orderId: number, status: string) => {
    updateStatus.mutate(
      { id: orderId, data: { status } },
      {
        onSuccess: () => { toast({ title: `Order status updated to ${status}` }); invalidate(); },
        onError: () => toast({ title: "Error updating status", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-auto">
        <header className="sticky top-0 z-10 bg-background border-b border-border px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">Orders</h1>
            <p className="text-sm text-muted-foreground">Manage all customer orders</p>
          </div>
        </header>

        <main className="flex-1 p-6">
          <div className="mb-5 flex gap-2 flex-wrap">
            {STATUSES.map(s => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? "default" : "outline"}
                onClick={() => setStatusFilter(s)}
                className="capitalize"
                data-testid={`filter-${s}`}
              >
                {s}
              </Button>
            ))}
          </div>

          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
              </div>
            ) : !orders?.length ? (
              <div className="p-16 text-center">
                <ShoppingCart className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No orders found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">ID</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Bundle</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">User ID</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Phone</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Amount</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Date</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Update</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {orders.map(order => (
                      <tr key={order.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-order-${order.id}`}>
                        <td className="px-6 py-3 text-muted-foreground">#{order.id}</td>
                        <td className="px-6 py-3">
                          <div className="font-medium">{order.bundleName}</div>
                          <div className="text-xs text-muted-foreground">{order.bundleData}</div>
                        </td>
                        <td className="px-6 py-3 text-muted-foreground">#{order.userId}</td>
                        <td className="px-6 py-3 text-muted-foreground">{order.phoneNumber}</td>
                        <td className="px-6 py-3 font-semibold">${order.price}</td>
                        <td className="px-6 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[order.status]}`}>
                            {order.status}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-muted-foreground">{new Date(order.createdAt).toLocaleDateString()}</td>
                        <td className="px-6 py-3">
                          <Select
                            defaultValue={order.status}
                            onValueChange={v => handleStatusChange(order.id, v)}
                          >
                            <SelectTrigger className="w-32 h-7 text-xs" data-testid={`select-status-${order.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="processing">Processing</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="failed">Failed</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
