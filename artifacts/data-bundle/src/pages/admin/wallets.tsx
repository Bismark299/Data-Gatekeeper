import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Menu, Wallet, ChevronDown, ChevronUp, Search, X, RefreshCw,
  ChevronLeft, ChevronRight, Download, ArrowUpDown, ArrowUp, ArrowDown,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface WalletRow {
  id: number; userId: number; balance: number;
  updatedAt: string | null; userName: string; userEmail: string;
}
interface Deposit {
  id: number; amount: number; method: string; reference: string | null;
  status: string; createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  pending:   "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  rejected:  "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });

const PAGE_SIZES = [10, 25, 50];
type SortField = "balance" | "name" | "updated";
type SortDir   = "asc" | "desc";

async function fetchWallets(): Promise<WalletRow[]> {
  const res = await fetch("/api/admin/wallets", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch wallets");
  return res.json();
}
async function fetchDeposits(userId: number): Promise<Deposit[]> {
  const res = await fetch(`/api/admin/wallets/${userId}/deposits`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

export default function AdminWallets() {
  return <ProtectedRoute adminOnly><AdminWalletsContent /></ProtectedRoute>;
}

function DepositHistory({ userId }: { userId: number }) {
  const { data: deposits, isLoading } = useQuery({
    queryKey: ["admin-deposits", userId],
    queryFn:  () => fetchDeposits(userId),
  });

  if (isLoading) return <div className="py-4 text-xs text-muted-foreground px-5">Loading…</div>;
  if (!deposits?.length) return <div className="py-4 text-xs text-muted-foreground px-5">No deposits yet</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {["Date", "Amount", "Method", "Reference", "Status"].map(h => (
              <th key={h} className="text-left px-5 py-2 font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deposits.map(d => (
            <tr key={d.id} className="hover:bg-muted/10">
              <td className="px-5 py-2 text-muted-foreground">{fmtDate(d.createdAt)}</td>
              <td className="px-5 py-2 font-bold text-emerald-600">+GH₵{d.amount.toFixed(2)}</td>
              <td className="px-5 py-2 capitalize text-muted-foreground">{d.method === "paystack" ? "Paystack" : "MoMo"}</td>
              <td className="px-5 py-2 font-mono text-muted-foreground">{d.reference ?? "—"}</td>
              <td className="px-5 py-2">
                <span className={`px-2 py-0.5 rounded-full capitalize font-medium text-[10px] ${STATUS_COLORS[d.status] ?? ""}`}>{d.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WalletTableRow({ wallet, expanded, onToggle }: { wallet: WalletRow; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        className="hover:bg-muted/20 transition-colors cursor-pointer"
        onClick={onToggle}
        data-testid={`row-wallet-${wallet.id}`}
      >
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-bold text-primary">
              {wallet.userName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-semibold text-foreground">{wallet.userName}</div>
              <div className="text-xs text-muted-foreground">{wallet.userEmail}</div>
            </div>
          </div>
        </td>
        <td className="px-5 py-3.5">
          <span className="text-xl font-extrabold text-foreground">GH₵{wallet.balance.toFixed(2)}</span>
        </td>
        <td className="px-5 py-3.5 text-xs text-muted-foreground">
          {wallet.updatedAt ? fmtDate(wallet.updatedAt) : "—"}
        </td>
        <td className="px-5 py-3.5">
          <Button variant="ghost" size="sm" className="gap-1 text-xs h-7">
            History {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/10">
          <td colSpan={4} className="py-2">
            <DepositHistory userId={wallet.userId} />
          </td>
        </tr>
      )}
    </>
  );
}

function AdminWalletsContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch]           = useState("");
  const [sortField, setSortField]     = useState<SortField>("balance");
  const [sortDir, setSortDir]         = useState<SortDir>("desc");
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(25);
  const [expandedId, setExpandedId]   = useState<number | null>(null);

  const { data: wallets, isLoading, refetch } = useQuery({
    queryKey: ["admin-wallets"],
    queryFn:  fetchWallets,
  });

  const totalBalance = wallets?.reduce((s, w) => s + w.balance, 0) ?? 0;
  const nonZero      = wallets?.filter(w => w.balance > 0).length ?? 0;

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
    setPage(1);
  };

  const filtered = useMemo(() => {
    let src = wallets ?? [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      src = src.filter(w => w.userName.toLowerCase().includes(q) || w.userEmail.toLowerCase().includes(q));
    }
    return [...src].sort((a, b) => {
      let diff = 0;
      if (sortField === "balance") diff = a.balance - b.balance;
      if (sortField === "name")    diff = a.userName.localeCompare(b.userName);
      if (sortField === "updated") diff = new Date(a.updatedAt ?? 0).getTime() - new Date(b.updatedAt ?? 0).getTime();
      return sortDir === "asc" ? diff : -diff;
    });
  }, [wallets, search, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged      = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  const handleExport = () => {
    const rows = filtered.map(w => [w.userId, `"${w.userName}"`, w.userEmail, w.balance.toFixed(2), w.updatedAt ? fmtDate(w.updatedAt) : ""]);
    const csv  = [["User ID", "Name", "Email", "Balance", "Last Updated"].join(","), ...rows.map(r => r.join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "wallets.csv"; a.click();
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
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
            <h1 className="text-xl font-bold text-foreground">Wallets</h1>
            <p className="text-xs text-muted-foreground">{wallets?.length ?? 0} wallets · {nonZero} with funds</p>
          </div>
          <div className="flex items-center gap-2">
            {wallets && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-xl">
                <Wallet className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-bold text-primary">Total: GH₵{totalBalance.toFixed(2)}</span>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!filtered.length} className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6 space-y-4">

          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Total Wallets", value: wallets?.length ?? 0 },
              { label: "Total Balance", value: `GH₵${totalBalance.toFixed(2)}` },
              { label: "Funded Users",  value: nonZero },
            ].map(c => (
              <div key={c.label} className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-1">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{c.label}</div>
                <div className="text-2xl font-extrabold text-foreground">{c.value}</div>
              </div>
            ))}
          </div>

          {/* Search + controls */}
          <div className="bg-card border border-border rounded-2xl p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by name or email…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="pl-8 h-8 text-xs"
                data-testid="input-wallet-search"
              />
              {search && <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setSearch(""); setPage(1); }}><X className="w-3 h-3 text-muted-foreground" /></button>}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{PAGE_SIZES.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
              <span>per page</span>
            </div>
          </div>

          {/* Table */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {isLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
            ) : paged.length === 0 ? (
              <div className="py-20 flex flex-col items-center text-muted-foreground">
                <Wallet className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm">No wallets found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <button className="flex items-center gap-1 hover:text-foreground" onClick={() => handleSort("name")}>
                          User <SortIcon field="name" />
                        </button>
                      </th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <button className="flex items-center gap-1 hover:text-foreground" onClick={() => handleSort("balance")}>
                          Balance <SortIcon field="balance" />
                        </button>
                      </th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        <button className="flex items-center gap-1 hover:text-foreground" onClick={() => handleSort("updated")}>
                          Last Updated <SortIcon field="updated" />
                        </button>
                      </th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">History</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paged.map(w => (
                      <WalletTableRow
                        key={w.id}
                        wallet={w}
                        expanded={expandedId === w.id}
                        onToggle={() => setExpandedId(v => v === w.id ? null : w.id)}
                      />
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
