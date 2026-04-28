import { useState, useMemo } from "react";
import { useAdminListUsers, useAdminUpdateUser, useAdminDeleteUser, getAdminListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Menu, Search, Users, Trash2, ShieldCheck, User, CheckCircle2, XCircle,
  RefreshCw, Download, ChevronLeft, ChevronRight, X, Filter, KeyRound, Wallet,
} from "lucide-react";

const PAGE_SIZES = [10, 25, 50];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });

export default function AdminUsers() {
  return <ProtectedRoute adminOnly><AdminUsersContent /></ProtectedRoute>;
}

function AdminUsersContent() {
  const [sidebarOpen, setSidebarOpen]  = useState(false);
  const [search, setSearch]            = useState("");
  const [roleFilter, setRoleFilter]    = useState<"all" | "user" | "admin">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [deleting, setDeleting]        = useState<{ id: number; name: string } | null>(null);
  const [resetResult, setResetResult]  = useState<{ name: string; tempPassword: string } | null>(null);
  const [page, setPage]                = useState(1);
  const [pageSize, setPageSize]        = useState(25);

  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const { data: allUsers, isLoading, refetch } = useAdminListUsers({});
  const updateUser = useAdminUpdateUser();
  const deleteUser = useAdminDeleteUser();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey({}) });

  const toggleActive = (u: { id: number; isActive: boolean; name: string }) => {
    updateUser.mutate({ id: u.id, data: { isActive: !u.isActive } }, {
      onSuccess: () => { toast({ title: `${u.name} ${u.isActive ? "deactivated" : "activated"}` }); invalidate(); },
    });
  };

  const toggleRole = (u: { id: number; role: string; name: string }) => {
    const newRole = u.role === "admin" ? "user" : "admin";
    updateUser.mutate({ id: u.id, data: { role: newRole } }, {
      onSuccess: () => { toast({ title: `${u.name} is now ${newRole}` }); invalidate(); },
    });
  };

  const handleResetPassword = async (u: { id: number; name: string }) => {
    try {
      const res = await fetch(`/api/admin/users/${u.id}/reset-password`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setResetResult({ name: u.name, tempPassword: json.tempPassword });
    } catch (e: unknown) {
      toast({ title: (e as Error).message || "Error resetting password", variant: "destructive" });
    }
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteUser.mutate({ id: deleting.id }, {
      onSuccess: () => { toast({ title: "User deleted" }); setDeleting(null); invalidate(); },
      onError:   () => toast({ title: "Error deleting user", variant: "destructive" }),
    });
  };

  // Counts
  const counts = useMemo(() => {
    const src = allUsers ?? [];
    return { total: src.length, admins: src.filter(u => u.role === "admin").length, active: src.filter(u => u.isActive).length };
  }, [allUsers]);

  // Filter
  const filtered = useMemo(() => {
    let src = allUsers ?? [];
    if (roleFilter !== "all")   src = src.filter(u => u.role === roleFilter);
    if (statusFilter === "active")   src = src.filter(u => u.isActive);
    if (statusFilter === "inactive") src = src.filter(u => !u.isActive);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      src = src.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.phone ?? "").includes(q));
    }
    return src;
  }, [allUsers, roleFilter, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged      = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  const hasFilters = search || roleFilter !== "all" || statusFilter !== "all";
  const clearFilters = () => { setSearch(""); setRoleFilter("all"); setStatusFilter("all"); setPage(1); };

  const handleExport = () => {
    const rows = filtered.map(u => [u.id, fmtDate(u.createdAt), `"${u.name}"`, u.email, u.phone ?? "", u.role, u.isActive ? "Active" : "Inactive", `GH₵${((u as { walletBalance?: number }).walletBalance ?? 0).toFixed(2)}`]);
    const csv  = [["ID", "Joined", "Name", "Email", "Phone", "Role", "Status", "Balance"].join(","), ...rows.map(r => r.join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "users.csv"; a.click();
    toast({ title: `Exported ${filtered.length} users` });
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-auto">
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-6 py-4 flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Users</h1>
            <p className="text-xs text-muted-foreground">{counts.total} total · {counts.admins} admin · {counts.active} active</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!filtered.length} className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6 space-y-4">

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Total Users", value: counts.total, color: "text-sky-600", bg: "bg-sky-100 dark:bg-sky-900/20", icon: Users },
              { label: "Active",      value: counts.active, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/20", icon: CheckCircle2 },
              { label: "Admins",      value: counts.admins, color: "text-violet-600", bg: "bg-violet-100 dark:bg-violet-900/20", icon: ShieldCheck },
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

          {/* Filter bar */}
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Name, email or phone…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="pl-8 h-8 text-xs w-56"
                  data-testid="input-search-users"
                />
                {search && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setSearch(""); setPage(1); }}><X className="w-3 h-3 text-muted-foreground" /></button>}
              </div>
              {/* Role */}
              <div className="flex items-center gap-1">
                {(["all", "user", "admin"] as const).map(r => (
                  <button key={r} onClick={() => { setRoleFilter(r); setPage(1); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${roleFilter === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                    {r === "all" ? "All Roles" : r === "admin" ? "Admins" : "Users"}
                  </button>
                ))}
              </div>
              {/* Status */}
              <div className="flex items-center gap-1 pl-2 border-l border-border">
                {(["all", "active", "inactive"] as const).map(s => (
                  <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                    {s === "all" ? "All Status" : s}
                  </button>
                ))}
              </div>
              {/* Page size */}
              <div className="flex items-center gap-1.5 ml-auto text-xs text-muted-foreground">
                <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
                  <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAGE_SIZES.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                </Select>
                <span>per page</span>
              </div>
              {hasFilters && <button className="text-xs text-primary font-semibold ml-1" onClick={clearFilters}>Clear</button>}
            </div>
          </div>

          {/* Table */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {isLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}</div>
            ) : paged.length === 0 ? (
              <div className="py-20 flex flex-col items-center text-muted-foreground">
                <Users className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm">No users match your filters</p>
                {hasFilters && <button className="mt-2 text-xs text-primary font-semibold" onClick={clearFilters}>Clear filters</button>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      {["Joined", "Name", "Email", "Phone", "Balance", "Role", "Status", "Actions"].map(h => (
                        <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paged.map(u => {
                      const walletBalance = (u as { walletBalance?: number }).walletBalance ?? 0;
                      return (
                        <tr key={u.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-user-${u.id}`}>
                          <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(u.createdAt)}</td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-bold text-primary">
                                {u.name.charAt(0).toUpperCase()}
                              </div>
                              <span className="font-semibold text-foreground whitespace-nowrap">{u.name}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-xs text-muted-foreground">{u.email}</td>
                          <td className="px-5 py-3.5 text-sm text-muted-foreground font-mono">
                            {u.phone ? (u.phone.startsWith("+233") ? "0" + u.phone.slice(4) : u.phone) : "—"}
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center gap-1 text-xs font-bold ${walletBalance > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                              <Wallet className="w-3 h-3" />
                              GH₵{walletBalance.toFixed(2)}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <button
                              onClick={() => toggleRole({ id: u.id, role: u.role, name: u.name })}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-colors cursor-pointer ${
                                u.role === "admin"
                                  ? "bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400 hover:bg-violet-200"
                                  : "bg-muted text-muted-foreground hover:bg-muted/80"
                              }`}
                              data-testid={`badge-role-${u.id}`}
                            >
                              {u.role === "admin" ? <ShieldCheck className="w-3 h-3" /> : <User className="w-3 h-3" />}
                              {u.role}
                            </button>
                          </td>
                          <td className="px-5 py-3.5">
                            <button
                              onClick={() => toggleActive({ id: u.id, isActive: u.isActive, name: u.name })}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                                u.isActive
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 hover:bg-emerald-200"
                                  : "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-200"
                              }`}
                              data-testid={`button-toggle-user-${u.id}`}
                            >
                              {u.isActive ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {u.isActive ? "Active" : "Inactive"}
                            </button>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                onClick={() => handleResetPassword({ id: u.id, name: u.name })}
                                title="Reset password"
                                data-testid={`button-reset-pw-${u.id}`}
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleting({ id: u.id, name: u.name })} data-testid={`button-delete-user-${u.id}`}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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

      <AlertDialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>Delete "{deleting?.name}"? All their orders will also be removed. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete} data-testid="button-confirm-delete-user">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Password Reset Result Dialog */}
      <Dialog open={!!resetResult} onOpenChange={v => !v && setResetResult(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Password Reset</DialogTitle>
            <DialogDescription>Share this temporary password with {resetResult?.name}. They should change it after logging in.</DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <div className="bg-muted rounded-xl px-4 py-3 font-mono text-lg font-bold text-center tracking-widest text-foreground select-all">
              {resetResult?.tempPassword}
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">Click the password above to select it, then copy</p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                navigator.clipboard.writeText(resetResult?.tempPassword ?? "");
                toast({ title: "Password copied to clipboard" });
              }}
              className="w-full"
            >
              Copy Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
