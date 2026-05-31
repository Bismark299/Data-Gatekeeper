import { useState, useEffect, useCallback, useMemo } from "react";
import {
  useGetWalletBalance,
  useListDeposits,
  useInitializePaystackDeposit,
  useClaimMomoDeposit,
  useGetMomoInfo,
  getGetWalletBalanceQueryKey,
  getListDepositsQueryKey,
  verifyPaystackDeposit,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Wallet, ArrowDownCircle, Copy, CheckCircle2, Clock, XCircle,
  RefreshCw, Loader2, ChevronLeft, ChevronRight, CreditCard, Smartphone,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const QUICK_AMOUNTS = [5, 10, 20, 50, 100, 200];
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50];

export default function WalletPage() {
  return (
    <ProtectedRoute>
      <WalletContent />
    </ProtectedRoute>
  );
}

function WalletContent() {
  const [paystackAmount, setPaystackAmount] = useState("");
  const [claimTxId, setClaimTxId]           = useState("");
  const [pendingRef, setPendingRef]         = useState("");
  const [showVerifyDialog, setShowVerifyDialog] = useState(false);
  const [autoVerifying, setAutoVerifying]   = useState(false);
  const [manualVerifying, setManualVerifying] = useState(false);

  // Pagination
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: wallet, isLoading: balanceLoading } = useGetWalletBalance(
    { query: { refetchInterval: 12_000 } } as any,
  );
  const { data: deposits } = useListDeposits({ query: { refetchInterval: 15_000 } } as any);
  const { data: momoInfo }  = useGetMomoInfo();
  const initPaystack        = useInitializePaystackDeposit();
  const claimMomo           = useClaimMomoDeposit();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListDepositsQueryKey() });
  }, [queryClient]);

  // Auto-verify when Paystack redirects back with ?paystack_ref=...
  // Paystack (especially Mobile Money) often hasn't settled the charge to
  // "success" at the moment it redirects back, so a single verify call would
  // wrongly look like a failed transaction. We poll a few times — giving the
  // webhook + Paystack settlement time — before falling back to the manual dialog.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("paystack_ref");
    if (!ref) return;
    window.history.replaceState({}, "", window.location.pathname);
    setAutoVerifying(true);

    let cancelled = false;
    let attempt = 0;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const MAX_ATTEMPTS = 10;   // ~ up to 10 tries
    const DELAY_MS = 4000;     // 4s apart → ~40s settlement window

    const attemptVerify = () => {
      if (cancelled) return;
      verifyPaystackDeposit({ reference: ref })
        .then((w) => {
          if (cancelled) return;
          invalidate();
          toast({ title: "Payment confirmed!", description: `New balance: GH₵${Number(w.balance).toFixed(2)}` });
          setAutoVerifying(false);
        })
        .catch(() => {
          if (cancelled) return;
          attempt += 1;
          if (attempt < MAX_ATTEMPTS) {
            timeoutId = setTimeout(attemptVerify, DELAY_MS);
          } else {
            setAutoVerifying(false);
            setPendingRef(ref);
            setShowVerifyDialog(true);
          }
        });
    };
    attemptVerify();

    return () => { cancelled = true; if (timeoutId) clearTimeout(timeoutId); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePaystackPay = () => {
    const num = parseFloat(paystackAmount);
    if (!num || num < 1) {
      toast({ title: "Enter a valid amount (min GH₵1)", variant: "destructive" });
      return;
    }
    initPaystack.mutate({ data: { amount: num } }, {
      onSuccess: (data) => {
        setPendingRef(data.reference);
        const fee = data.feeGhs?.toFixed(2) ?? (num * 0.02).toFixed(2);
        const total = data.chargedGhs?.toFixed(2) ?? (num * 1.02).toFixed(2);
        toast({
          title: `Redirecting to Paystack…`,
          description: `You will be charged GH₵${total} (includes GH₵${fee} processing fee)`,
        });
        window.location.href = data.authorizationUrl;
      },
      onError: (e: unknown) => {
        toast({ title: (e as { message?: string })?.message ?? "Failed to initialise payment", variant: "destructive" });
      },
    });
  };

  const handleVerify = async () => {
    setManualVerifying(true);
    const MAX_ATTEMPTS = 6;
    const DELAY_MS = 4000;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const w = await verifyPaystackDeposit({ reference: pendingRef });
        toast({ title: "Payment confirmed!", description: `New balance: GH₵${Number(w.balance).toFixed(2)}` });
        invalidate();
        setShowVerifyDialog(false);
        setManualVerifying(false);
        return;
      } catch (e) {
        if (attempt === MAX_ATTEMPTS) {
          toast({ title: (e as { message?: string })?.message ?? "Not confirmed yet — please wait a moment and try again.", variant: "destructive" });
        } else {
          await new Promise((r) => setTimeout(r, DELAY_MS));
        }
      }
    }
    setManualVerifying(false);
  };

  const handleMomoClaim = () => {
    if (!claimTxId.trim()) { toast({ title: "Enter the transaction ID", variant: "destructive" }); return; }
    claimMomo.mutate({ data: { transactionId: claimTxId.trim() } }, {
      onSuccess: (res) => {
        toast({ title: "Claim submitted", description: res.message });
        invalidate();
        setClaimTxId("");
      },
      onError: (e: unknown) => toast({ title: (e as { message?: string })?.message ?? "Claim failed", variant: "destructive" }),
    });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast({ title: `${label} copied!` }));
  };

  // Pagination logic
  const totalDeposits = deposits?.length ?? 0;
  const totalPages    = Math.max(1, Math.ceil(totalDeposits / pageSize));
  const pagedDeposits = useMemo(() => {
    const start = (page - 1) * pageSize;
    return (deposits ?? []).slice(start, start + pageSize);
  }, [deposits, page, pageSize]);

  const statusIcon = (s: string) => {
    if (s === "completed") return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
    if (s === "rejected")  return <XCircle      className="w-3.5 h-3.5 text-red-500" />;
    return                        <Clock         className="w-3.5 h-3.5 text-yellow-500" />;
  };
  const statusColor = (s: string) => {
    if (s === "completed") return "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400";
    if (s === "rejected")  return "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400";
    return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400";
  };
  const methodLabel = (m: string) => m === "paystack" ? "Paystack" : m === "momo" ? "Mobile Money" : m.replace(/_/g, " ");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {autoVerifying && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-3 flex items-center justify-center gap-2 text-sm text-primary font-medium">
          <Loader2 className="w-4 h-4 animate-spin" />
          Verifying your Paystack payment…
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">

        {/* Balance card */}
        <div className="bg-gradient-to-br from-primary via-primary to-blue-800 rounded-2xl p-7 text-white shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2 opacity-80">
              <Wallet className="w-5 h-5" />
              <span className="text-sm font-medium">Available Balance</span>
            </div>
            {balanceLoading ? (
              <div className="h-12 w-36 bg-white/20 animate-pulse rounded-xl" />
            ) : (
              <div className="text-5xl font-extrabold tracking-tight">
                GH₵{Number(wallet?.balance ?? 0).toFixed(2)}
              </div>
            )}
          </div>
          <div className="text-sm text-white/70 sm:text-right">
            <div className="font-semibold text-white mb-1">Fund your wallet below</div>
            <div>Use Paystack or send MoMo directly</div>
          </div>
        </div>

        {/* ─── Deposit methods — inline, side by side ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Paystack card */}
          <div className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
                <CreditCard className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="font-bold text-foreground">Pay with Paystack</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Card · Bank transfer · Mobile money</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Amount (GH₵)</Label>
              <Input
                type="number"
                min="1"
                step="0.01"
                placeholder="Enter amount"
                value={paystackAmount}
                onChange={e => setPaystackAmount(e.target.value)}
                className="text-base font-semibold"
                data-testid="input-paystack-amount"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {QUICK_AMOUNTS.map(a => (
                  <button
                    key={a}
                    onClick={() => setPaystackAmount(String(a))}
                    className={`px-2.5 py-1 text-xs rounded-lg border font-semibold transition-colors ${
                      paystackAmount === String(a)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:border-primary hover:text-primary"
                    }`}
                    data-testid={`quick-amount-${a}`}
                  >
                    GH₵{a}
                  </button>
                ))}
              </div>
            </div>

            {paystackAmount && parseFloat(paystackAmount) >= 1 && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                2% processing fee applies · You will be charged{" "}
                <span className="font-semibold text-foreground">
                  GH₵{(parseFloat(paystackAmount) * 1.02).toFixed(2)}
                </span>
              </div>
            )}

            <Button
              className="w-full"
              onClick={handlePaystackPay}
              disabled={initPaystack.isPending || !paystackAmount}
              data-testid="button-paystack-pay"
            >
              {initPaystack.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Opening Paystack…</>
              ) : (
                `Pay GH₵${paystackAmount ? (parseFloat(paystackAmount) * 1.02).toFixed(2) : "0"} via Paystack`
              )}
            </Button>
          </div>

          {/* MoMo card */}
          <div className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-yellow-100 dark:bg-yellow-900/20 flex items-center justify-center shrink-0">
                <Smartphone className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <h2 className="font-bold text-foreground">Mobile Money (MoMo)</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Send directly — wallet credited automatically</p>
              </div>
            </div>

            {/* Payment details */}
            <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
              <div className="flex items-center justify-between px-4 py-3 bg-muted/40">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-0.5">Send MoMo to</div>
                  <div className="text-xl font-bold tracking-wider text-foreground">
                    {momoInfo?.momoNumber ?? "—"}
                  </div>
                  {momoInfo?.momoName && (
                    <div className="text-xs text-muted-foreground mt-0.5">{momoInfo.momoName}</div>
                  )}
                </div>
                <Button size="sm" variant="ghost" onClick={() => copyToClipboard(momoInfo?.momoNumber ?? "", "Number")}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="flex items-center justify-between px-4 py-3 bg-primary/5">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-0.5">Your reference code</div>
                  <div className="text-xl font-bold tracking-wider text-primary">
                    {momoInfo?.referenceCode ?? "—"}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => copyToClipboard(momoInfo?.referenceCode ?? "", "Reference")}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Step-by-step guidelines */}
            <div className="rounded-xl bg-muted/40 border border-border px-4 py-4 space-y-3">
              <div className="text-xs font-bold text-foreground uppercase tracking-wide">How to deposit via MoMo</div>
              <ol className="space-y-2.5 text-xs text-muted-foreground">
                <li className="flex gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0 mt-px">1</span>
                  <span>Open your MTN Mobile Money app or dial <strong className="text-foreground">*170#</strong>.</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0 mt-px">2</span>
                  <span>Select <strong className="text-foreground">Transfer Money → To MoMo Number</strong>, then enter the number above.</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0 mt-px">3</span>
                  <span>Enter the amount you wish to deposit.</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0 mt-px">4</span>
                  <span>When prompted for a reference / note, enter your code: <strong className="text-primary font-mono">{momoInfo?.referenceCode ?? "…"}</strong>. This ensures instant automatic crediting.</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0 mt-px">5</span>
                  <span>Confirm the transaction and your wallet will be credited <strong className="text-foreground">within minutes</strong>.</span>
                </li>
              </ol>
              <div className="flex items-start gap-2 pt-1 border-t border-border mt-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Deposits are processed automatically once your reference code is detected. If you are sending on behalf of a customer, always use your own reference code.
                </p>
              </div>
            </div>

            {/* Claim section — always visible */}
            <div className="rounded-xl border border-dashed border-border px-4 py-4 space-y-3">
              <div>
                <div className="text-xs font-bold text-foreground">Didn't include your reference code?</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Enter the MoMo transaction ID from your SMS receipt and we'll match the payment to your account.</div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Transaction ID</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. MP250507123456"
                    value={claimTxId}
                    onChange={e => setClaimTxId(e.target.value)}
                    className="h-9 text-sm font-mono"
                    data-testid="input-claim-txid"
                  />
                  <Button size="sm" className="shrink-0 h-9 px-4" onClick={handleMomoClaim} disabled={claimMomo.isPending || !claimTxId.trim()} data-testid="button-submit-claim">
                    {claimMomo.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Claim"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Transaction History ─── */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-foreground">Transaction History</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{totalDeposits} deposit{totalDeposits !== 1 ? "s" : ""} total</p>
            </div>
            {/* Per-page selector */}
            {totalDeposits > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Show</span>
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="border border-border rounded-lg px-2 py-1 text-xs bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {PAGE_SIZE_OPTIONS.map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <span>per page</span>
              </div>
            )}
          </div>

          {!deposits || deposits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-muted-foreground">
              <ArrowDownCircle className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">No transactions yet. Fund your wallet to get started.</p>
            </div>
          ) : (
            <>
              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Method</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Reference</th>
                      <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pagedDeposits.map(d => (
                      <tr key={d.id} className="hover:bg-muted/20 transition-colors" data-testid={`deposit-${d.id}`}>
                        <td className="px-5 py-3.5 text-muted-foreground text-xs whitespace-nowrap">
                          {new Date(d.createdAt).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-5 py-3.5 font-medium text-foreground capitalize">{methodLabel(d.method)}</td>
                        <td className="px-5 py-3.5 text-muted-foreground text-xs font-mono truncate max-w-[140px]">
                          {d.reference || "—"}
                        </td>
                        <td className="px-5 py-3.5 text-right font-bold text-green-600">+GH₵{Number(d.amount).toFixed(2)}</td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full capitalize font-medium ${statusColor(d.status)}`}>
                            {statusIcon(d.status)}
                            {d.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination footer */}
              <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs text-muted-foreground">
                <span>
                  Showing {Math.min((page - 1) * pageSize + 1, totalDeposits)}–{Math.min(page * pageSize, totalDeposits)} of {totalDeposits}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                    .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                      if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) =>
                      p === "…" ? (
                        <span key={`ellipsis-${i}`} className="px-2">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setPage(p as number)}
                          className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${
                            page === p
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-muted"
                          }`}
                        >
                          {p}
                        </button>
                      )
                    )}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

      </div>

      {/* Confirm payment dialog (only shown when auto-verify fails after Paystack redirect) */}
      <Dialog open={showVerifyDialog} onOpenChange={setShowVerifyDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Your Payment</DialogTitle>
            <DialogDescription>
              Your payment may still be processing. Click below to check and credit your wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted rounded-lg px-4 py-3 space-y-1">
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Reference</div>
            <div className="font-mono text-sm font-medium break-all">{pendingRef}</div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowVerifyDialog(false)}>Close</Button>
            <Button onClick={handleVerify} disabled={manualVerifying} data-testid="button-confirm-payment">
              {manualVerifying ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Checking…</> : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
