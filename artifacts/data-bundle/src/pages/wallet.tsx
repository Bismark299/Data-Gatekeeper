import { useState, useEffect, useCallback } from "react";
import {
  useGetWalletBalance,
  useListDeposits,
  useInitializePaystackDeposit,
  useVerifyPaystackDeposit,
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
  Wallet, ArrowDownCircle, ExternalLink, Copy, CheckCircle2, Clock, XCircle, RefreshCw, Loader2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const QUICK_AMOUNTS = [5, 10, 20, 50, 100, 200];

type DepositView = "select" | "paystack" | "momo" | "momo-claim" | "paystack-pending";

export default function WalletPage() {
  return (
    <ProtectedRoute>
      <WalletContent />
    </ProtectedRoute>
  );
}

function WalletContent() {
  const [showDeposit, setShowDeposit] = useState(false);
  const [view, setView] = useState<DepositView>("select");
  const [amount, setAmount] = useState("");
  const [claimAmount, setClaimAmount] = useState("");
  const [claimTxId, setClaimTxId] = useState("");
  const [pendingRef, setPendingRef] = useState("");
  const [autoVerifying, setAutoVerifying] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: wallet, isLoading } = useGetWalletBalance();
  const { data: deposits } = useListDeposits();
  const { data: momoInfo } = useGetMomoInfo();
  const initPaystack = useInitializePaystackDeposit();
  const verifyPaystackMutation = useVerifyPaystackDeposit();
  const claimMomo = useClaimMomoDeposit();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListDepositsQueryKey() });
  }, [queryClient]);

  // Auto-verify when Paystack redirects back with ?paystack_ref=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("paystack_ref");
    if (!ref) return;

    // Clean the URL immediately so refresh doesn't re-trigger
    window.history.replaceState({}, "", window.location.pathname);

    setAutoVerifying(true);

    verifyPaystackDeposit({ data: { reference: ref } })
      .then((w) => {
        invalidate();
        toast({
          title: "Payment confirmed!",
          description: `GH₵${w.balance.toFixed(2)} is your new wallet balance.`,
        });
      })
      .catch(() => {
        // Webhook hasn't processed yet — let the user confirm manually
        setPendingRef(ref);
        setView("paystack-pending");
        setShowDeposit(true);
      })
      .finally(() => {
        setAutoVerifying(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openDeposit = () => {
    setView("select");
    setAmount("");
    setClaimAmount("");
    setClaimTxId("");
    setPendingRef("");
    setShowDeposit(true);
  };

  const handlePaystackPay = () => {
    const num = parseFloat(amount);
    if (!num || num < 1) {
      toast({ title: "Enter a valid amount (min GH₵1)", variant: "destructive" });
      return;
    }
    initPaystack.mutate(
      { data: { amount: num } },
      {
        onSuccess: (data) => {
          setPendingRef(data.reference);
          // Redirect in same tab — Paystack will redirect back via callback_url
          window.location.href = data.authorizationUrl;
        },
        onError: (e: unknown) => {
          const msg = (e as { message?: string })?.message ?? "Failed to initialize payment";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleVerify = () => {
    verifyPaystackMutation.mutate(
      { data: { reference: pendingRef } },
      {
        onSuccess: (w) => {
          toast({
            title: "Payment confirmed!",
            description: `New balance: GH₵${w.balance.toFixed(2)}`,
          });
          invalidate();
          setShowDeposit(false);
        },
        onError: (e: unknown) => {
          const msg = (e as { message?: string })?.message ?? "Payment not confirmed yet. Please wait a moment.";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  };

  const handleMomoClaim = () => {
    const num = parseFloat(claimAmount);
    if (!num || num < 1) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (!claimTxId.trim()) {
      toast({ title: "Enter the MoMo transaction ID", variant: "destructive" });
      return;
    }
    claimMomo.mutate(
      { data: { amount: num, transactionId: claimTxId.trim() } },
      {
        onSuccess: (res) => {
          toast({ title: "Claim submitted", description: res.message });
          invalidate();
          setShowDeposit(false);
        },
        onError: (e: unknown) => {
          const msg = (e as { message?: string })?.message ?? "Claim failed";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: `${label} copied!` });
    });
  };

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
    if (status === "rejected") return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    return <Clock className="w-3.5 h-3.5 text-yellow-500" />;
  };

  const statusColor = (status: string) => {
    if (status === "completed") return "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400";
    if (status === "rejected") return "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400";
    return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400";
  };

  const methodLabel = (method: string) => {
    if (method === "paystack") return "Paystack";
    if (method === "momo") return "Mobile Money";
    return method.replace(/_/g, " ");
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Auto-verifying Paystack payment banner */}
      {autoVerifying && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-3 flex items-center justify-center gap-2 text-sm text-primary font-medium">
          <Loader2 className="w-4 h-4 animate-spin" />
          Verifying your Paystack payment...
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">My Wallet</h1>
          <p className="text-muted-foreground text-sm mt-1">Fund your wallet to purchase data bundles</p>
        </div>

        <div className="bg-gradient-to-br from-primary to-blue-700 rounded-2xl p-6 mb-6 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-4">
            <Wallet className="w-5 h-5 opacity-80" />
            <span className="text-sm font-medium opacity-80">Available Balance</span>
          </div>
          {isLoading ? (
            <div className="h-10 w-32 bg-white/20 animate-pulse rounded-lg" />
          ) : (
            <div className="text-4xl font-extrabold tracking-tight">
              GH₵{(wallet?.balance ?? 0).toFixed(2)}
            </div>
          )}
          <div className="mt-6">
            <Button
              className="bg-white text-primary hover:bg-white/90 font-semibold"
              onClick={openDeposit}
              disabled={autoVerifying}
              data-testid="button-fund-wallet"
            >
              Fund Wallet
            </Button>
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Deposit History</h2>
          </div>
          {!deposits || deposits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <ArrowDownCircle className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">No deposits yet. Fund your wallet to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {deposits.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between px-5 py-4"
                  data-testid={`deposit-${d.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center shrink-0">
                      <ArrowDownCircle className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground capitalize">
                        {methodLabel(d.method)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(d.createdAt).toLocaleDateString("en-GH", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        {d.reference && ` · ${d.reference}`}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-green-600">+GH₵{d.amount.toFixed(2)}</div>
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full capitalize ${statusColor(d.status)}`}>
                      {statusIcon(d.status)}
                      {d.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={showDeposit} onOpenChange={(open) => { if (!open) setShowDeposit(false); }}>
        <DialogContent className="max-w-md">

          {view === "select" && (
            <>
              <DialogHeader>
                <DialogTitle>Fund Wallet</DialogTitle>
                <DialogDescription>
                  Choose how you want to add money to your wallet.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <button
                  className="flex items-start gap-4 p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left group"
                  onClick={() => setView("paystack")}
                  data-testid="option-paystack"
                >
                  <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
                    <span className="text-lg">💳</span>
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">Pay with Paystack</div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      Card, bank transfer, or mobile money via Paystack secure checkout
                    </div>
                  </div>
                </button>

                <button
                  className="flex items-start gap-4 p-4 rounded-xl border-2 border-border hover:border-yellow-500 hover:bg-yellow-500/5 transition-all text-left group"
                  onClick={() => setView("momo")}
                  data-testid="option-momo"
                >
                  <div className="w-10 h-10 rounded-lg bg-yellow-100 dark:bg-yellow-900/20 flex items-center justify-center shrink-0">
                    <span className="text-lg">📱</span>
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">Send MoMo Directly</div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      Send mobile money to our number and get auto-credited instantly
                    </div>
                  </div>
                </button>
              </div>
            </>
          )}

          {view === "paystack" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span>💳</span> Pay with Paystack
                </DialogTitle>
                <DialogDescription>
                  Enter the amount to deposit. You&apos;ll be taken to Paystack to complete payment, then automatically returned here.
                </DialogDescription>
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
                    onChange={(e) => setAmount(e.target.value)}
                    data-testid="input-paystack-amount"
                  />
                  <div className="flex gap-2 flex-wrap mt-1">
                    {QUICK_AMOUNTS.map((a) => (
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
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg px-4 py-3 text-sm text-blue-700 dark:text-blue-300 flex items-start gap-2">
                  <ExternalLink className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    You&apos;ll be redirected to Paystack to pay. After payment is complete, Paystack will bring you straight back and your wallet will be credited automatically.
                  </span>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setView("select")}>Back</Button>
                <Button
                  onClick={handlePaystackPay}
                  disabled={initPaystack.isPending || !amount}
                  data-testid="button-paystack-pay"
                >
                  {initPaystack.isPending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Opening Paystack...
                    </>
                  ) : (
                    `Pay GH₵${amount || "0"}`
                  )}
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Shown only when auto-verify after redirect fails */}
          {view === "paystack-pending" && (
            <>
              <DialogHeader>
                <DialogTitle>Confirm Your Payment</DialogTitle>
                <DialogDescription>
                  Your payment may still be processing. Click below to check and credit your wallet.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="bg-muted rounded-lg px-4 py-3 space-y-1">
                  <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Payment Reference</div>
                  <div className="font-mono text-sm font-medium text-foreground break-all">{pendingRef}</div>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-950/30 rounded-lg px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300">
                  If you completed payment on Paystack, click &ldquo;Confirm Payment&rdquo; to credit your wallet. If payment is still processing, wait a moment and try again.
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setShowDeposit(false)}>Close</Button>
                <Button
                  onClick={handleVerify}
                  disabled={verifyPaystackMutation.isPending}
                  data-testid="button-confirm-payment"
                >
                  {verifyPaystackMutation.isPending ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    "Confirm Payment"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}

          {view === "momo" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span>📱</span> Send Mobile Money
                </DialogTitle>
                <DialogDescription>
                  Send MoMo to the number below using your reference code and your wallet will be credited automatically.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/40">
                    <div>
                      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Send MoMo to</div>
                      <div className="text-xl font-bold tracking-wider text-foreground">
                        {momoInfo?.momoNumber ?? "Loading..."}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyToClipboard(momoInfo?.momoNumber ?? "", "Number")}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 bg-primary/5">
                    <div>
                      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Your reference code</div>
                      <div className="text-xl font-bold tracking-wider text-primary">
                        {momoInfo?.referenceCode ?? "Loading..."}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyToClipboard(momoInfo?.referenceCode ?? "", "Reference code")}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="bg-green-50 dark:bg-green-950/20 rounded-xl px-4 py-3 space-y-1.5">
                  <div className="text-sm font-semibold text-green-800 dark:text-green-300">How it works</div>
                  <ol className="text-sm text-green-700 dark:text-green-400 space-y-1 list-decimal list-inside">
                    <li>Send any amount to the MoMo number above</li>
                    <li>Use <strong>{momoInfo?.referenceCode ?? "your code"}</strong> as the reference/description</li>
                    <li>Your wallet is credited automatically within minutes</li>
                  </ol>
                </div>

                <div className="text-center text-sm text-muted-foreground">
                  Forgot to include the reference?{" "}
                  <button
                    className="text-primary font-semibold underline underline-offset-2"
                    onClick={() => setView("momo-claim")}
                    data-testid="button-claim-manually"
                  >
                    Claim with transaction ID
                  </button>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setView("select")}>Back</Button>
                <Button onClick={() => setShowDeposit(false)}>Done</Button>
              </DialogFooter>
            </>
          )}

          {view === "momo-claim" && (
            <>
              <DialogHeader>
                <DialogTitle>Claim MoMo Deposit</DialogTitle>
                <DialogDescription>
                  Submit your MoMo transaction ID for admin review. Your wallet will be credited once verified.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label>Amount Sent (GH₵)</Label>
                  <Input
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="e.g. 50"
                    value={claimAmount}
                    onChange={(e) => setClaimAmount(e.target.value)}
                    data-testid="input-claim-amount"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>MoMo Transaction ID</Label>
                  <Input
                    placeholder="e.g. MP240112.1234.R567890"
                    value={claimTxId}
                    onChange={(e) => setClaimTxId(e.target.value)}
                    data-testid="input-claim-txid"
                  />
                  <p className="text-xs text-muted-foreground">
                    Check the SMS confirmation you received after sending MoMo.
                  </p>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-950/30 rounded-lg px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300">
                  Claims are typically reviewed within 30 minutes during business hours.
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setView("momo")}>Back</Button>
                <Button
                  onClick={handleMomoClaim}
                  disabled={claimMomo.isPending}
                  data-testid="button-submit-claim"
                >
                  {claimMomo.isPending ? "Submitting..." : "Submit Claim"}
                </Button>
              </DialogFooter>
            </>
          )}

        </DialogContent>
      </Dialog>
    </div>
  );
}
