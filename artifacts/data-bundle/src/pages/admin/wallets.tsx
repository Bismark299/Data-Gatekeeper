import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Menu, Wallet, ChevronDown, ChevronUp } from "lucide-react";

interface WalletRow {
  id: number;
  userId: number;
  balance: number;
  updatedAt: string | null;
  userName: string;
  userEmail: string;
}

interface Deposit {
  id: number;
  amount: number;
  method: string;
  reference: string | null;
  status: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400",
  pending:   "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
  failed:    "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
};

async function fetchWallets(): Promise<WalletRow[]> {
  const res = await fetch("/api/admin/wallets", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch wallets");
  return res.json();
}

async function fetchDeposits(userId: number): Promise<Deposit[]> {
  const res = await fetch(`/api/admin/wallets/${userId}/deposits`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch deposits");
  return res.json();
}

export default function AdminWallets() {
  return (
    <ProtectedRoute adminOnly>
      <AdminWalletsContent />
    </ProtectedRoute>
  );
}

function WalletRow({ wallet }: { wallet: WalletRow }) {
  const [expanded, setExpanded] = useState(false);

  const { data: deposits, isLoading } = useQuery({
    queryKey: ["admin-deposits", wallet.userId],
    queryFn: () => fetchDeposits(wallet.userId),
    enabled: expanded,
  });

  return (
    <>
      <tr className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setExpanded(v => !v)} data-testid={`row-wallet-${wallet.id}`}>
        <td className="px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-primary">{wallet.userName.charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <div className="font-medium text-foreground">{wallet.userName}</div>
              <div className="text-xs text-muted-foreground">{wallet.userEmail}</div>
            </div>
          </div>
        </td>
        <td className="px-6 py-4">
          <span className="text-lg font-bold text-foreground">GH₵{wallet.balance.toFixed(2)}</span>
        </td>
        <td className="px-6 py-4 text-muted-foreground text-sm">
          {wallet.updatedAt ? new Date(wallet.updatedAt).toLocaleDateString() : "—"}
        </td>
        <td className="px-6 py-4">
          <Button variant="ghost" size="sm" className="gap-1 text-xs">
            Deposits {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="px-6 pb-4 bg-muted/20">
            {isLoading ? (
              <div className="py-4 text-sm text-muted-foreground">Loading deposits...</div>
            ) : !deposits?.length ? (
              <div className="py-4 text-sm text-muted-foreground">No deposits yet</div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden mt-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border">
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Amount</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Method</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Reference</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {deposits.map(d => (
                      <tr key={d.id}>
                        <td className="px-4 py-2 font-semibold">GH₵{d.amount.toFixed(2)}</td>
                        <td className="px-4 py-2 capitalize text-muted-foreground">{d.method.replace("-", " ")}</td>
                        <td className="px-4 py-2 font-mono text-muted-foreground">{d.reference ?? "—"}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded-full capitalize font-medium ${STATUS_COLORS[d.status] ?? ""}`}>{d.status}</span>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function AdminWalletsContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: wallets, isLoading } = useQuery({
    queryKey: ["admin-wallets"],
    queryFn: fetchWallets,
  });

  const totalBalance = wallets?.reduce((s, w) => s + w.balance, 0) ?? 0;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-auto">
        <header className="sticky top-0 z-10 bg-background border-b border-border px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Wallets</h1>
            <p className="text-sm text-muted-foreground">User wallet balances and deposit history</p>
          </div>
          {wallets && (
            <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-xl">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold text-primary">Total: GH₵{totalBalance.toFixed(2)}</span>
            </div>
          )}
        </header>

        <main className="flex-1 p-6">
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
              </div>
            ) : !wallets?.length ? (
              <div className="p-16 text-center">
                <Wallet className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No wallets yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">User</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Balance</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Last Updated</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">History</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {wallets.map(w => <WalletRow key={w.id} wallet={w} />)}
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
