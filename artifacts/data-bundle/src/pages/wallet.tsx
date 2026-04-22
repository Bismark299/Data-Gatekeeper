import { useState } from "react";
import { useGetWalletBalance, useDepositToWallet, useListDeposits, getGetWalletBalanceQueryKey, getListDepositsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Wallet, Plus, ArrowDownCircle, Clock } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";

const METHODS = [
  { id: "mobile_money", label: "Mobile Money", icon: "📱" },
  { id: "bank_transfer", label: "Bank Transfer", icon: "🏦" },
  { id: "card", label: "Credit / Debit Card", icon: "💳" },
];

const QUICK_AMOUNTS = [5, 10, 20, 50, 100];

export default function WalletPage() {
  return (
    <ProtectedRoute>
      <WalletContent />
    </ProtectedRoute>
  );
}

function WalletContent() {
  const [showDeposit, setShowDeposit] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("mobile_money");
  const [reference, setReference] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: wallet, isLoading } = useGetWalletBalance();
  const { data: deposits } = useListDeposits();
  const deposit = useDepositToWallet();

  const handleDeposit = () => {
    const num = parseFloat(amount);
    if (!num || num <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }

    deposit.mutate(
      { data: { amount: num, method, reference: reference || undefined } },
      {
        onSuccess: (wallet) => {
          toast({ title: `GH₵${num.toFixed(2)} added to wallet`, description: `New balance: GH₵${wallet.balance.toFixed(2)}` });
          queryClient.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListDepositsQueryKey() });
          setShowDeposit(false);
          setAmount("");
          setReference("");
        },
        onError: () => toast({ title: "Deposit failed", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">My Wallet</h1>
          <p className="text-muted-foreground text-sm mt-1">Fund your wallet to purchase data bundles</p>
        </div>

        <div className="bg-gradient-to-br from-primary to-blue-700 rounded-2xl p-6 mb-6 text-white">
          <div className="flex items-center gap-2 mb-4">
            <Wallet className="w-5 h-5 opacity-80" />
            <span className="text-sm font-medium opacity-80">Available Balance</span>
          </div>
          {isLoading ? (
            <div className="h-10 w-32 bg-white/20 animate-pulse rounded-lg" />
          ) : (
            <div className="text-4xl font-extrabold tracking-tight">GH₵{(wallet?.balance ?? 0).toFixed(2)}</div>
          )}
          <Button
            className="mt-5 bg-white/20 hover:bg-white/30 text-white border-0 gap-2"
            onClick={() => setShowDeposit(true)}
            data-testid="button-fund-wallet"
          >
            <Plus className="w-4 h-4" />
            Fund Wallet
          </Button>
        </div>

        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Deposit History</h2>
          </div>
          {!deposits?.length ? (
            <div className="py-12 text-center">
              <ArrowDownCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No deposits yet. Fund your wallet to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {deposits.map(d => (
                <div key={d.id} className="flex items-center justify-between px-5 py-4" data-testid={`deposit-${d.id}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                      <ArrowDownCircle className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground capitalize">{d.method.replace(/_/g, " ")}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(d.createdAt).toLocaleDateString()} · {d.reference ?? "No ref"}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-green-600">+GH₵{d.amount.toFixed(2)}</div>
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${d.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400" : "bg-yellow-100 text-yellow-700"}`}>
                      {d.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={showDeposit} onOpenChange={setShowDeposit}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Fund Wallet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Amount (GH₵)</Label>
              <Input
                type="number"
                min="1"
                step="0.01"
                placeholder="Enter amount"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                data-testid="input-deposit-amount"
              />
              <div className="flex gap-2 flex-wrap mt-1">
                {QUICK_AMOUNTS.map(a => (
                  <button
                    key={a}
                    className="px-3 py-1 text-xs rounded-lg border border-border hover:border-primary hover:text-primary font-medium transition-colors"
                    onClick={() => setAmount(String(a))}
                    data-testid={`quick-amount-${a}`}
                  >
                    GH₵{a}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <div className="grid grid-cols-1 gap-2">
                {METHODS.map(m => (
                  <button
                    key={m.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-sm font-medium text-left transition-all ${method === m.id ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"}`}
                    onClick={() => setMethod(m.id)}
                    data-testid={`method-${m.id}`}
                  >
                    <span className="text-base">{m.icon}</span>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Reference (optional)</Label>
              <Input
                placeholder="Transaction ID or reference"
                value={reference}
                onChange={e => setReference(e.target.value)}
                data-testid="input-reference"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeposit(false)}>Cancel</Button>
            <Button
              onClick={handleDeposit}
              disabled={deposit.isPending || !amount}
              data-testid="button-confirm-deposit"
            >
              {deposit.isPending ? "Processing..." : `Add GH₵${amount || "0"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
