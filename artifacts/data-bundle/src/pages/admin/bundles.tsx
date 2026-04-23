import { useState, useMemo } from "react";
import { useListBundles, useCreateBundle, useUpdateBundle, useDeleteBundle } from "@workspace/api-client-react";
import { getListBundlesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Pencil, Trash2, Menu, Package, Search, X, RefreshCw,
  CheckCircle2, XCircle, Filter, Download,
} from "lucide-react";

const NETWORKS = [
  { value: "mtn",         label: "MTN",          dot: "bg-yellow-400" },
  { value: "telecel",     label: "Telecel",       dot: "bg-red-500" },
  { value: "at-ishare",   label: "AT iShare",     dot: "bg-blue-500" },
  { value: "at-bigtime",  label: "AT Big-Time",   dot: "bg-green-600" },
] as const;

const NETWORK_COLORS: Record<string, { bg: string; text: string; badge: string }> = {
  mtn:          { bg: "bg-yellow-400",  text: "text-gray-900",  badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400" },
  telecel:      { bg: "bg-red-600",     text: "text-white",     badge: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400" },
  "at-ishare":  { bg: "bg-blue-600",    text: "text-white",     badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400" },
  "at-bigtime": { bg: "bg-green-700",   text: "text-white",     badge: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400" },
};

const netLabel = (v: string) => NETWORKS.find(n => n.value === v)?.label ?? v;

const bundleSchema = z.object({
  name: z.string().min(2, "Name is required"),
  description: z.string().min(5, "Description too short"),
  dataAmount: z.string().min(1, "Data amount required"),
  validityDays: z.coerce.number().int().positive("Must be positive"),
  price: z.coerce.number().positive("Must be positive"),
  network: z.string().min(1, "Select a network"),
});

type BundleForm = z.infer<typeof bundleSchema>;

interface Bundle {
  id: number; name: string; description: string; dataAmount: string;
  validityDays: number; price: number; category: string; network: string; isActive: boolean;
}

const PAGE_SIZES = [10, 25, 50];

export default function AdminBundles() {
  return <ProtectedRoute adminOnly><AdminBundlesContent /></ProtectedRoute>;
}

function AdminBundlesContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showForm, setShowForm]       = useState(false);
  const [editing, setEditing]         = useState<Bundle | null>(null);
  const [deleting, setDeleting]       = useState<Bundle | null>(null);
  const [networkFilter, setNetworkFilter] = useState("all");
  const [statusFilter, setStatusFilter]   = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch]           = useState("");
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(10);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: bundles, isLoading, refetch } = useListBundles({});
  const createBundle = useCreateBundle();
  const updateBundle = useUpdateBundle();
  const deleteBundle = useDeleteBundle();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListBundlesQueryKey({}) });

  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<BundleForm>({
    resolver: zodResolver(bundleSchema),
  });

  const openCreate = () => { setEditing(null); reset({ network: "mtn" }); setShowForm(true); };
  const openEdit   = (b: Bundle) => { setEditing(b); reset({ name: b.name, description: b.description, dataAmount: b.dataAmount, validityDays: b.validityDays, price: b.price, network: b.network }); setShowForm(true); };

  const onSubmit = (data: BundleForm) => {
    const payload = { ...data, category: "standard" };
    if (editing) {
      updateBundle.mutate({ id: editing.id, data: payload }, {
        onSuccess: () => { toast({ title: "Bundle updated" }); setShowForm(false); invalidate(); },
        onError:   () => toast({ title: "Error", variant: "destructive" }),
      });
    } else {
      createBundle.mutate({ data: payload }, {
        onSuccess: () => { toast({ title: "Bundle created" }); setShowForm(false); invalidate(); },
        onError:   () => toast({ title: "Error", variant: "destructive" }),
      });
    }
  };

  const toggleActive = (b: Bundle) => {
    updateBundle.mutate({ id: b.id, data: { isActive: !b.isActive } }, {
      onSuccess: () => { toast({ title: `Bundle ${b.isActive ? "deactivated" : "activated"}` }); invalidate(); },
    });
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteBundle.mutate({ id: deleting.id }, {
      onSuccess: () => { toast({ title: "Bundle deleted" }); setDeleting(null); invalidate(); },
      onError:   () => toast({ title: "Error", variant: "destructive" }),
    });
  };

  // Filter + search
  const networkCounts = useMemo(() => {
    const src = bundles ?? [];
    return Object.fromEntries(NETWORKS.map(n => [n.value, src.filter(b => b.network === n.value).length]));
  }, [bundles]);

  const filtered = useMemo(() => {
    let src = bundles ?? [];
    if (networkFilter !== "all") src = src.filter(b => b.network === networkFilter);
    if (statusFilter === "active")   src = src.filter(b => b.isActive);
    if (statusFilter === "inactive") src = src.filter(b => !b.isActive);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      src = src.filter(b => b.name.toLowerCase().includes(q) || b.dataAmount.toLowerCase().includes(q));
    }
    return src;
  }, [bundles, networkFilter, statusFilter, search]);

  const totalPages  = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged       = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  const hasFilters = networkFilter !== "all" || statusFilter !== "all" || search;
  const clearFilters = () => { setNetworkFilter("all"); setStatusFilter("all"); setSearch(""); setPage(1); };

  const handleExport = () => {
    const rows = filtered.map(b => [b.id, `"${b.name}"`, b.network, b.dataAmount, b.price, b.validityDays, b.isActive ? "Active" : "Inactive"]);
    const csv  = [["ID", "Name", "Network", "Data", "Price", "Validity (days)", "Status"].join(","), ...rows.map(r => r.join(","))].join("\n");
    const a    = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "bundles.csv"; a.click();
    toast({ title: `Exported ${filtered.length} bundles` });
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
            <h1 className="text-xl font-bold text-foreground">Bundles</h1>
            <p className="text-xs text-muted-foreground">{filtered.length} of {bundles?.length ?? 0} bundles</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!filtered.length} className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export
            </Button>
            <Button size="sm" onClick={openCreate} className="gap-1.5" data-testid="button-create-bundle">
              <Plus className="w-4 h-4" /> New Bundle
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6 space-y-4">

          {/* Filter bar */}
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Filter className="w-3.5 h-3.5" />
                <span>Filters</span>
              </div>
              {hasFilters && (
                <button className="text-xs text-primary font-semibold" onClick={clearFilters}>Clear all</button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search bundles…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="pl-8 h-8 text-xs w-52"
                  data-testid="input-bundle-search"
                />
                {search && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setSearch(""); setPage(1); }}><X className="w-3 h-3 text-muted-foreground" /></button>}
              </div>
              {/* Network tabs */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setNetworkFilter("all"); setPage(1); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${networkFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                >All ({bundles?.length ?? 0})</button>
                {NETWORKS.map(n => (
                  <button
                    key={n.value}
                    onClick={() => { setNetworkFilter(n.value); setPage(1); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${networkFilter === n.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${n.dot}`} />
                    {n.label} ({networkCounts[n.value] ?? 0})
                  </button>
                ))}
              </div>
              {/* Status */}
              <div className="flex items-center gap-1 ml-2 pl-2 border-l border-border">
                {(["all", "active", "inactive"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => { setStatusFilter(s); setPage(1); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                  >{s}</button>
                ))}
              </div>
              {/* Page size */}
              <div className="flex items-center gap-1.5 ml-auto text-xs text-muted-foreground">
                <span>Show</span>
                <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
                  <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAGE_SIZES.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {isLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}</div>
            ) : paged.length === 0 ? (
              <div className="py-20 flex flex-col items-center text-muted-foreground">
                <Package className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm">No bundles match your filters</p>
                {hasFilters && <button className="mt-2 text-xs text-primary font-semibold" onClick={clearFilters}>Clear filters</button>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      {["Network", "Bundle Name", "Data", "Validity", "Price", "Status", "Actions"].map(h => (
                        <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paged.map(bundle => {
                      const nc = NETWORK_COLORS[bundle.network ?? ""] ?? { badge: "bg-muted text-muted-foreground" };
                      return (
                        <tr key={bundle.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-bundle-${bundle.id}`}>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${nc.badge}`}>
                              <span className={`w-2 h-2 rounded-full ${NETWORKS.find(n => n.value === bundle.network)?.dot}`} />
                              {netLabel(bundle.network ?? "")}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="font-semibold text-foreground">{bundle.name}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">{bundle.description}</div>
                          </td>
                          <td className="px-5 py-3.5 font-bold text-foreground">{bundle.dataAmount}</td>
                          <td className="px-5 py-3.5 text-muted-foreground text-sm">{bundle.validityDays}d</td>
                          <td className="px-5 py-3.5 font-bold text-foreground">GH₵{Number(bundle.price).toFixed(2)}</td>
                          <td className="px-5 py-3.5">
                            <button
                              onClick={() => toggleActive(bundle as Bundle)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                                bundle.isActive
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 hover:bg-emerald-200"
                                  : "bg-muted text-muted-foreground hover:bg-muted/80"
                              }`}
                              data-testid={`button-toggle-${bundle.id}`}
                            >
                              {bundle.isActive ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {bundle.isActive ? "Active" : "Inactive"}
                            </button>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(bundle as Bundle)} data-testid={`button-edit-${bundle.id}`}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleting(bundle as Bundle)} data-testid={`button-delete-${bundle.id}`}>
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
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"><X className="w-3 h-3 rotate-90 opacity-0" /><ChevronLeftIcon /></button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                    .reduce<(number | "…")[]>((acc, p, idx, arr) => { if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…"); acc.push(p); return acc; }, [])
                    .map((p, i) => p === "…" ? <span key={`e${i}`} className="px-2">…</span> : (
                      <button key={p} onClick={() => setPage(p as number)} className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${page === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{p}</button>
                    ))}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRightIcon /></button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Bundle" : "New Bundle"}</DialogTitle>
            <DialogDescription>{editing ? "Update the bundle details below." : "Fill in the details to create a new bundle."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Network</Label>
              <Controller name="network" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger data-testid="input-network"><SelectValue placeholder="Select network" /></SelectTrigger>
                  <SelectContent>
                    {NETWORKS.map(n => (
                      <SelectItem key={n.value} value={n.value}>
                        <span className="flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full ${n.dot}`} />{n.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
              {errors.network && <p className="text-xs text-destructive">{errors.network.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Bundle Name</Label>
              <Input {...register("name")} placeholder="e.g. MTN 5GB Bundle" data-testid="input-bundle-name" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input {...register("description")} placeholder="Brief description" data-testid="input-bundle-desc" />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input {...register("dataAmount")} placeholder="5GB" data-testid="input-data-amount" />
                {errors.dataAmount && <p className="text-xs text-destructive">{errors.dataAmount.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Validity (days)</Label>
                <Input type="number" {...register("validityDays")} placeholder="7" data-testid="input-validity-days" />
                {errors.validityDays && <p className="text-xs text-destructive">{errors.validityDays.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Price (GH₵)</Label>
                <Input type="number" step="0.01" {...register("price")} placeholder="9.99" data-testid="input-price" />
                {errors.price && <p className="text-xs text-destructive">{errors.price.message}</p>}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={createBundle.isPending || updateBundle.isPending} data-testid="button-save-bundle">
                {editing ? "Update Bundle" : "Create Bundle"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Bundle</AlertDialogTitle>
            <AlertDialogDescription>Delete "{deleting?.name}"? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete} data-testid="button-confirm-delete">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChevronLeftIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ChevronRightIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
