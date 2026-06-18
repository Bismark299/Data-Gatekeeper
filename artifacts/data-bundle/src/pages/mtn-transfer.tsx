import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { mtnApi, type MtnTransferInput } from "@/lib/mtnApi";
import {
  ArrowLeftRight, Send, Loader2, CheckCircle2, XCircle, Clock,
  Wifi, Phone, Plug, RefreshCw, ArrowLeft, Filter, HelpCircle,
} from "lucide-react";

const LS_SENDER = "mtn_transfer_sender";

export default function MtnTransferPage() {
  return (
    <ProtectedRoute adminOnly>
      <MtnTransferContent />
    </ProtectedRoute>
  );
}

function MtnTransferContent() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [sender, setSender] = useState(() => localStorage.getItem(LS_SENDER) ?? "");
  const [receiver, setReceiver] = useState("");
  const [transferType, setTransferType] = useState<"data" | "airtime">("data");
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [productCode, setProductCode] = useState("");

  const [statusFilter, setStatusFilter] = useState("all");
  const [phoneFilter, setPhoneFilter] = useState("");

  const statsQ = useQuery({ queryKey: ["mtn-stats"], queryFn: mtnApi.getStats });
  const transfersQ = useQuery({
    queryKey: ["mtn-transfers", statusFilter, phoneFilter],
    queryFn: () => mtnApi.getTransfers({ status: statusFilter, phone: phoneFilter, pageSize: 50 }),
  });

  const testM = useMutation({
    mutationFn: mtnApi.testConnection,
    onSuccess: () => toast({ title: "Connection OK", description: "MTN credentials authenticated successfully." }),
    onError: (e: Error) => toast({ title: "Connection failed", description: e.message, variant: "destructive" }),
  });

  const transferM = useMutation({
    mutationFn: (data: MtnTransferInput) => mtnApi.transfer(data),
    onSuccess: (res) => {
      toast({ title: "Transfer successful", description: `${transferType === "data" ? "Data" : "Airtime"} sent to ${res.transfer.receiverMsisdn}.` });
      setReceiver(""); setAmount(""); setPin(""); setProductCode("");
      qc.invalidateQueries({ queryKey: ["mtn-stats"] });
      qc.invalidateQueries({ queryKey: ["mtn-transfers"] });
    },
    onError: (e: Error) => {
      const outcome = (e as Error & { data?: { outcome?: string } }).data?.outcome;
      qc.invalidateQueries({ queryKey: ["mtn-stats"] });
      qc.invalidateQueries({ queryKey: ["mtn-transfers"] });
      if (outcome === "unknown") {
        toast({
          title: "Outcome unclear",
          description: e.message + " The transfer may have gone through — check before resending.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Transfer failed", description: e.message, variant: "destructive" });
      }
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem(LS_SENDER, sender.trim());
    transferM.mutate({
      senderMsisdn: sender.trim(),
      receiverMsisdn: receiver.trim(),
      transferType,
      amount: amount.trim(),
      pin: pin.trim(),
      productCode: productCode.trim() || undefined,
    });
  }

  const stats = statsQ.data;

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50/60 to-background dark:from-amber-950/10">
      {/* Header */}
      <header className="border-b bg-[#FFC107] text-black">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-black/10">
              <ArrowLeftRight className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-lg font-extrabold leading-tight">MTN Customer Transfer</h1>
              <p className="text-xs font-medium text-black/70">Send airtime &amp; data between MTN lines</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="secondary"
              className="bg-black/10 hover:bg-black/20 text-black border-0"
              onClick={() => testM.mutate()}
              disabled={testM.isPending}
            >
              {testM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              <span className="hidden sm:inline ml-1.5">Test connection</span>
            </Button>
            <Link href="/admin">
              <Button size="sm" variant="secondary" className="bg-black/10 hover:bg-black/20 text-black border-0">
                <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline ml-1">Back</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total" value={stats?.total ?? 0} icon={<ArrowLeftRight className="w-4 h-4" />} />
          <StatCard label="Successful" value={stats?.success ?? 0} icon={<CheckCircle2 className="w-4 h-4" />} tone="green" />
          <StatCard label="Failed" value={stats?.failed ?? 0} icon={<XCircle className="w-4 h-4" />} tone="red" />
          <StatCard label="Unknown" value={stats?.unknown ?? 0} icon={<HelpCircle className="w-4 h-4" />} tone="amber" />
          <StatCard label="Data sent" value={stats?.dataSent ?? 0} icon={<Wifi className="w-4 h-4" />} tone="blue" />
          <StatCard label="Airtime sent" value={stats?.airtimeSent ?? 0} icon={<Phone className="w-4 h-4" />} tone="amber" />
        </div>

        <div className="grid lg:grid-cols-[380px_1fr] gap-6">
          {/* Transfer form */}
          <div className="rounded-2xl border bg-card p-5 shadow-sm h-fit">
            <h2 className="font-bold text-base mb-4 flex items-center gap-2">
              <Send className="w-4 h-4 text-[#FFC107]" /> New transfer
            </h2>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sender">Sender MTN number</Label>
                <Input id="sender" inputMode="numeric" placeholder="0244000000"
                  value={sender} onChange={(e) => setSender(e.target.value)} required />
                <p className="text-[11px] text-muted-foreground">Remembered on this device for convenience.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="receiver">Receiver MTN number</Label>
                <Input id="receiver" inputMode="numeric" placeholder="0244111111"
                  value={receiver} onChange={(e) => setReceiver(e.target.value)} required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={transferType} onValueChange={(v) => setTransferType(v as "data" | "airtime")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="data">Data</SelectItem>
                      <SelectItem value="airtime">Airtime</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Amount</Label>
                  <Input id="amount" inputMode="decimal" placeholder="e.g. 5"
                    value={amount} onChange={(e) => setAmount(e.target.value)} required />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="product">Product code <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="product" placeholder="Leave blank unless required"
                  value={productCode} onChange={(e) => setProductCode(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pin">Sender PIN</Label>
                <Input id="pin" type="password" inputMode="numeric" placeholder="••••"
                  value={pin} onChange={(e) => setPin(e.target.value)} required autoComplete="off" />
                <p className="text-[11px] text-muted-foreground">Entered per transfer — never stored.</p>
              </div>

              <Button type="submit" className="w-full bg-[#FFC107] hover:bg-[#e6ad06] text-black font-bold"
                disabled={transferM.isPending}>
                {transferM.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sending…</> : <><Send className="w-4 h-4 mr-2" /> Send transfer</>}
              </Button>
            </form>
          </div>

          {/* History */}
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <h2 className="font-bold text-base">Transfer history</h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input className="h-9 pl-8 w-40" placeholder="Search number"
                    value={phoneFilter} onChange={(e) => setPhoneFilter(e.target.value)} />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All status</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-9 w-9"
                  onClick={() => transfersQ.refetch()} disabled={transfersQ.isFetching}>
                  <RefreshCw className={`w-4 h-4 ${transfersQ.isFetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {transfersQ.isLoading ? (
              <div className="py-16 grid place-items-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : !transfersQ.data || transfersQ.data.transfers.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">No transfers yet.</div>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 px-2 font-medium">Receiver</th>
                      <th className="py-2 px-2 font-medium">Type</th>
                      <th className="py-2 px-2 font-medium">Amount</th>
                      <th className="py-2 px-2 font-medium">Status</th>
                      <th className="py-2 px-2 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfersQ.data.transfers.map((t) => (
                      <tr key={t.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="py-2.5 px-2">
                          <div className="font-medium">{t.receiverMsisdn}</div>
                          <div className="text-[11px] text-muted-foreground">from {t.senderMsisdn}</div>
                        </td>
                        <td className="py-2.5 px-2 capitalize">{t.transferType}</td>
                        <td className="py-2.5 px-2 font-medium">{t.amount}</td>
                        <td className="py-2.5 px-2"><StatusBadge status={t.status} message={t.statusMessage} /></td>
                        <td className="py-2.5 px-2 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(t.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, icon, tone = "default" }: {
  label: string; value: number; icon: React.ReactNode;
  tone?: "default" | "green" | "red" | "blue" | "amber";
}) {
  const tones: Record<string, string> = {
    default: "text-foreground bg-muted",
    green: "text-green-600 bg-green-100 dark:bg-green-900/30",
    red: "text-red-600 bg-red-100 dark:bg-red-900/30",
    blue: "text-blue-600 bg-blue-100 dark:bg-blue-900/30",
    amber: "text-amber-600 bg-amber-100 dark:bg-amber-900/30",
  };
  return (
    <div className="rounded-xl border bg-card p-3.5 shadow-sm">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`grid place-items-center w-7 h-7 rounded-lg ${tones[tone]}`}>{icon}</span>
      </div>
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
    </div>
  );
}

function StatusBadge({ status, message }: { status: string; message: string }) {
  if (status === "success") {
    return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 gap-1"><CheckCircle2 className="w-3 h-3" /> Success</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive" className="gap-1" title={message}><XCircle className="w-3 h-3" /> Failed</Badge>;
  }
  if (status === "unknown") {
    return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 gap-1" title={message || "Outcome unclear — verify on MTN before resending"}><HelpCircle className="w-3 h-3" /> Unknown</Badge>;
  }
  return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" /> Pending</Badge>;
}
