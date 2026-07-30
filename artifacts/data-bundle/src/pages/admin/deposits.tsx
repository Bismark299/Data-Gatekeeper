import { useState, useMemo } from "react";
import {
  useAdminListDeposits, useAdminApproveDeposit, useAdminRejectDeposit,
  getAdminListDepositsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { AdminFinancialSummary } from "@/components/AdminFinancialSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, XCircle, Clock, Menu, RefreshCw, Search, X,
  ChevronLeft, ChevronRight, Download, Filter, CreditCard, Smartphone,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type StatusTab = "pending" | "completed" | "rejected" | "all";

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  rejected:  "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  pending:   "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
};

const STATUS_DOT: Record<string, string> = {
  completed: "bg-emerald-400", rejected: "bg-red-400", pending: "bg-amber-400",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const PAGE_SIZES = [10, 25, 50];

export default function AdminDepositsPage() {
  return <ProtectedRoute adminOnly><AdminDepositsContent /></ProtectedRoute>;
}

function AdminDepositsContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [statusTab, setStatusTab]     = useState<StatusTab>("pending");
  const [search, setSearch]           = useState("");
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(25);

  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const { data: allDeposits, isLoading, refetch } = useAdminListDeposits({});
  const approveMutation = useAdminApproveDeposit();
  const rejectMutation  = useAdminRejectDeposit();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getAdminListDepositsQueryKey({}) });

  const patchDeposit = (id: number, patch: Record<string, unknown>) =>
    queryClient.setQueryData(
      getAdminListDepositsQueryKey({}),
      (old: unknown) => Array.isArray(old) ? old.map((d: { id: number }) => d.id === id ? { ...d, ...patch } : d) : old
    );

  const handleApprove = (id: number) => {
    approveMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: "Deposit approved and wallet credited" }); patchDeposit(id, { status: "completed" }); },
      onError:   (e: unknown) => toast({ title: (e as { message?: string })?.message ?? "Approval failed", variant: "destructive" }),
    });
  };

  const handleReject = (id: number) => {
    rejectMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: "Deposit claim rejected" }); patchDeposit(id, { status: "rejected" }); },
      onError:   (e: unknown) => toast({ title: (e as { message?: string })?.message ?? "Rejection failed", variant: "destructive" }),
    });
  };

  // Counts per status
  const counts = useMemo(() => {
    const src = allDeposits ?? [];
    return {
      all: src.length,
      pending:   src.filter(d => d.status === "pending").length,
      completed: src.filter(d => d.status === "completed").length,
      rejected:  src.filter(d => d.status === "rejected").length,
    };
  }, [allDeposits]);

  // Filter
  const filtered = useMemo(() => {
    let src = allDeposits ?? [];
    if (statusTab !== "all") src = src.filter(d => d.status === statusTab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      src = src.filter(d =>
        d.userName.toLowerCase().includes(q) ||
        d.userEmail.toLowerCase().includes(q) ||
        (d.reference ?? "").toLowerCase().includes(q)
      );
    }
    return src;
  }, [allDeposits, statusTab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged      = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  const handleExport = () => {
    const rows = filtered.map(d => [d.id, `"${d.userName}"`, d.userEmail, d.amount.toFixed(2), d.method, d.reference ?? "", d.status, fmtDate(d.createdAt)]);
    const csv  = [["ID", "User", "Email", "Amount", "Method", "Reference", "Status", "Date"].join(","), ...rows.map(r => r.join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "deposits.csv"; a.click();
    toast({ title: `Exported ${filtered.length} deposits` });
  };

  const TABS: { key: StatusTab; label: string }[] = [
    { key: "pending",   label: "Pending" },
    { key: "completed", label: "Approved" },
    { key: "rejected",  label: "Rejected" },
    { key: "all",       label: "All" },
  ];

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-3 sm:px-6 py-4 flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Deposits</h1>
            <p className="text-xs text-muted-foreground">
              {counts.pending > 0 && <span className="text-amber-600 font-semibold">{counts.pending} pending · </span>}
              {filtered.length} shown
            </p>
          </div>
          <AdminFinancialSummary />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!filtered.length} className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export
            </Button>
          </div>
        </header>

<main className="flex-1 p-3 sm:p-6 space-y-4">

          {/* Summary mini cards */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Pending",  value: counts.pending,   color: "text-amber-600",   bg: "bg-amber-100 dark:bg-amber-900/20",   icon: Clock },
              { label: "Approved", value: counts.completed, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/20", icon: CheckCircle2 },
              { label: "Rejected", value: counts.rejected,  color: "text-red-600",     bg: "bg-red-100 dark:bg-red-900/20",       icon: XCircle },
            ].map(c => (
              <div key={c.label} className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.bg}`}>
                  <c.icon className={`w-4 h-4 ${c.color}`} />
                </div>
                <div>
                  <div className="text-2xl font-extrabold text-foreground">{c.value}</div>
                  <div className="text-xs text-muted-foreground">{c.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Table card */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {/* Tabs + search row */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-3 border-b border-border">
              <div className="flex items-center gap-1 overflow-x-auto">
                {TABS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => { setStatusTab(t.key); setPage(1); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                      statusTab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {t.key !== "all" && <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[t.key]}`} />}
                    {t.label} <span className="opacity-60">({counts[t.key]})</span>
                  </button>
                ))}
              </div>
              <div className="relative sm:ml-auto">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Name, email or reference…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="pl-8 h-8 text-xs w-full sm:w-60"
                  data-testid="input-deposit-search"
                />
                {search && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setSearch(""); setPage(1); }}><X className="w-3 h-3 text-muted-foreground" /></button>}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
                  <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAGE_SIZES.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {/* Table */}
            {isLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}</div>
            ) : paged.length === 0 ? (
              <div className="py-20 flex flex-col items-center text-muted-foreground">
                <CheckCircle2 className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm">{statusTab === "pending" ? "All caught up! No pending claims." : "No deposits match your filters."}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      {([["Date","hidden sm:table-cell"],["User",""],["Amount",""],["Method","hidden sm:table-cell"],["Reference","hidden sm:table-cell"],["Status",""],["Actions",""]] as [string,string][]).map(([h,cls]) => (
                        <th key={h} className={`text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${cls}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paged.map(d => (
                      <tr key={d.id} className="hover:bg-muted/20 transition-colors" data-testid={`deposit-claim-${d.id}`}>
                        <td className="hidden sm:table-cell px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(d.createdAt)}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-foreground truncate max-w-[160px]" title={d.userName}>{d.userName}</div>
                          <div className="text-xs text-muted-foreground">{d.userEmail}</div>
                        </td>
                        <td className="px-3 py-2.5 font-bold text-emerald-600">GH₵{d.amount.toFixed(2)}</td>
                        <td className="hidden sm:table-cell px-3 py-2.5">
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            {d.method === "paystack" ? <CreditCard className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
                            {d.method === "paystack" ? "Paystack" : "MoMo"}
                          </span>
                        </td>
                        <td className="hidden sm:table-cell px-3 py-2.5 font-mono text-xs text-muted-foreground truncate max-w-[130px]">{d.reference ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[d.status]}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[d.status]}`} />
                            {d.status === "completed" ? "Approved" : d.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {d.status === "pending" ? (
                            <div className="flex items-center gap-1.5">
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-red-200 text-red-600 hover:bg-red-50" onClick={() => handleReject(d.id)} disabled={rejectMutation.isPending} data-testid={`button-reject-${d.id}`}>
                                <XCircle className="w-3.5 h-3.5" /> Reject
                              </Button>
                              <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => handleApprove(d.id)} disabled={approveMutation.isPending} data-testid={`button-approve-${d.id}`}>
                                <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground" title={d.note ?? undefined}>
                              {d.note ? (d.note.length > 40 ? d.note.slice(0, 40) + "…" : d.note) : "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {filtered.length > 0 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs text-muted-foreground">
                <span>Showing {Math.min((page - 1) * pageSize + 1, filtered.length)}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                    .reduce<(number | "…")[]>((acc, p, idx, arr) => { if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…"); acc.push(p); return acc; }, [])
                    .map((p, i) => p === "…" ? <span key={`e${i}`} className="px-2">…</span> : (
                      <button key={p} onClick={() => setPage(p as number)} className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${page === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{p}</button>
                    ))}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
