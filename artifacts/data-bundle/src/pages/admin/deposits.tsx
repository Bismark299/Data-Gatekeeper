import { useState } from "react";
import {
  useAdminListDeposits,
  useAdminApproveDeposit,
  useAdminRejectDeposit,
  getAdminListDepositsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "wouter";
import {
  CheckCircle2, XCircle, Clock, Menu, RefreshCw,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type StatusFilter = "all" | "pending" | "completed" | "rejected";

export default function AdminDepositsPage() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    setLocation("/login");
    return null;
  }

  return <AdminDepositsContent />;
}

function AdminDepositsContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const params = statusFilter === "all" ? {} : { status: statusFilter };
  const { data: deposits, isLoading, refetch } = useAdminListDeposits({ params });
  const approveMutation = useAdminApproveDeposit();
  const rejectMutation = useAdminRejectDeposit();

  const handleApprove = (id: number) => {
    approveMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Deposit approved and wallet credited" });
          queryClient.invalidateQueries({ queryKey: getAdminListDepositsQueryKey() });
        },
        onError: (e: unknown) => {
          const msg = (e as { message?: string })?.message ?? "Approval failed";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleReject = (id: number) => {
    rejectMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Deposit claim rejected" });
          queryClient.invalidateQueries({ queryKey: getAdminListDepositsQueryKey() });
        },
        onError: (e: unknown) => {
          const msg = (e as { message?: string })?.message ?? "Rejection failed";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  };

  const statusBadge = (status: string) => {
    if (status === "completed") {
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">
          <CheckCircle2 className="w-3 h-3" /> Approved
        </span>
      );
    }
    if (status === "rejected") {
      return (
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400">
          <XCircle className="w-3 h-3" /> Rejected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
        <Clock className="w-3 h-3" /> Pending
      </span>
    );
  };

  const methodLabel = (method: string) => {
    if (method === "paystack") return "💳 Paystack";
    if (method === "momo") return "📱 MoMo Claim";
    return method.replace(/_/g, " ");
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 overflow-auto">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-1.5 rounded-md hover:bg-muted"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-foreground">Deposit Claims</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Review and approve MoMo deposit claims
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              className="h-8"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !deposits || deposits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <CheckCircle2 className="w-12 h-12 opacity-20 mb-3" />
              <p className="text-sm font-medium">No {statusFilter !== "all" ? statusFilter : ""} deposits</p>
              <p className="text-xs mt-1">
                {statusFilter === "pending" ? "All caught up! No pending claims." : "Nothing to show here."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {deposits.map((d) => (
                <div
                  key={d.id}
                  className="bg-card border border-border rounded-xl p-4 sm:p-5"
                  data-testid={`deposit-claim-${d.id}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground text-sm">{d.userName}</span>
                        <span className="text-muted-foreground text-xs">{d.userEmail}</span>
                        {statusBadge(d.status)}
                      </div>
                      <div className="flex items-center gap-3 flex-wrap text-sm">
                        <span className="text-2xl font-bold text-green-600">GH₵{d.amount.toFixed(2)}</span>
                        <span className="text-muted-foreground text-xs">{methodLabel(d.method)}</span>
                      </div>
                      {d.reference && (
                        <div className="text-xs text-muted-foreground font-mono">
                          Ref: {d.reference}
                        </div>
                      )}
                      {d.note && (
                        <div className="text-xs text-muted-foreground italic">{d.note}</div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {new Date(d.createdAt).toLocaleString("en-GH", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>

                    {d.status === "pending" && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleReject(d.id)}
                          disabled={rejectMutation.isPending}
                          data-testid={`button-reject-${d.id}`}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleApprove(d.id)}
                          disabled={approveMutation.isPending}
                          className="bg-green-600 hover:bg-green-700"
                          data-testid={`button-approve-${d.id}`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                          Approve
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
