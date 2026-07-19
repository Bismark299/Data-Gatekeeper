import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Ban, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

type PreviewOrder = {
  id: number;
  phoneNumber: string;
  bundleName: string | null;
  bundleData: string | null;
  price: string;
  status: string;
  createdAt: string;
};

type PreviewResult = {
  refundable: PreviewOrder[];
  skipped: (PreviewOrder & { reason: string })[];
  notFound: string[];
  totalRefund: number;
  counts: { refundable: number; skipped: number; notFound: number };
};

type Mode = "phone" | "id";

export function BulkCancelRefundDialog({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen]             = useState(false);
  const [mode, setMode]             = useState<Mode>("phone");
  const [text, setText]             = useState("");
  const [dateFrom, setDateFrom]     = useState("");
  const [dateTo, setDateTo]         = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview]       = useState<PreviewResult | null>(null);

  // First token of every non-empty line (so pasted "phone<TAB>size" rows work).
  const values = text.split(/[\n,]/).map(l => l.trim().split(/\s+/)[0]).filter(Boolean);

  const reset = () => { setText(""); setPreview(null); setDateFrom(""); setDateTo(""); };
  const clearPreview = () => setPreview(null);

  const handlePreview = async () => {
    if (values.length === 0) { toast({ title: "Paste at least one entry", variant: "destructive" }); return; }
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await fetch("/api/admin/orders/bulk-refund-preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, values, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Preview failed");
      setPreview(json);
    } catch (e) {
      toast({ title: (e as Error).message || "Preview failed", variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview || preview.refundable.length === 0) return;
    setSubmitting(true);
    try {
      const ids = preview.refundable.map(o => o.id);
      const res = await fetch("/api/admin/orders/bulk-refund", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Refund failed");
      toast({
        title: `Cancelled & refunded ${json.refundedCount} order${json.refundedCount !== 1 ? "s" : ""}`,
        description: `GH₵${Number(json.totalRefunded).toFixed(2)} refunded to wallets${json.skipped?.length ? ` · ${json.skipped.length} skipped` : ""}`,
      });
      setOpen(false);
      reset();
      onDone();
    } catch (e) {
      toast({ title: (e as Error).message || "Refund failed", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-bulk-cancel">
          <Ban className="w-3.5 h-3.5" /> Bulk Cancel &amp; Refund
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Cancel &amp; Refund</DialogTitle>
          <DialogDescription>
            Paste phone numbers or order IDs. Preview first to see exactly which orders will be cancelled and refunded to each customer&apos;s wallet. Pending and processing orders are eligible and are refunded the same way. A pending order that&apos;s already been handed to a provider is skipped (to avoid refund + delivery) — cancel those individually after a delivery check.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* mode toggle */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Match by:</span>
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {(["phone", "id"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); clearPreview(); }}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m === "phone" ? "Phone number" : "Order ID"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">{mode === "phone" ? "Phone numbers" : "Order IDs"} (one per line)</Label>
            <Textarea
              value={text}
              onChange={e => { setText(e.target.value); clearPreview(); }}
              rows={6}
              placeholder={mode === "phone" ? "0551724560\n0598061094\n…" : "1526\n1528\n…"}
              className="font-mono text-xs"
              data-testid="textarea-bulk-values"
            />
            <p className="text-[11px] text-muted-foreground">
              {values.length} entr{values.length === 1 ? "y" : "ies"} detected. Extra columns (e.g. bundle size) are ignored.
            </p>
          </div>

          {/* optional date range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">From date (optional)</Label>
              <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); clearPreview(); }} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To date (optional)</Label>
              <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); clearPreview(); }} className="h-8 text-xs" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-2">
            Leave dates blank to match any date. Narrow the range to avoid touching unrelated orders.
          </p>

          <Button onClick={handlePreview} disabled={previewing || values.length === 0} variant="secondary" className="w-full gap-1.5" data-testid="button-bulk-preview">
            {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Preview
          </Button>

          {/* preview result */}
          {preview && (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1 font-semibold text-red-600">
                  <Ban className="w-3.5 h-3.5" />{preview.counts.refundable} to cancel &amp; refund
                </span>
                <span className="text-muted-foreground">{preview.counts.skipped} skipped</span>
                <span className="text-muted-foreground">{preview.counts.notFound} not found</span>
                <span className="ml-auto font-bold text-foreground">Total refund: GH₵{Number(preview.totalRefund).toFixed(2)}</span>
              </div>

              {preview.refundable.length > 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="max-h-52 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 sticky top-0">
                        <tr>
                          {["#", "Phone", "Bundle", "GH₵", "Status"].map(h => (
                            <th key={h} className="px-2 py-1.5 text-left font-semibold text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {preview.refundable.map(o => (
                          <tr key={o.id}>
                            <td className="px-2 py-1 font-mono text-muted-foreground">{o.id}</td>
                            <td className="px-2 py-1 font-mono">{o.phoneNumber}</td>
                            <td className="px-2 py-1">{o.bundleData || o.bundleName}</td>
                            <td className="px-2 py-1 font-semibold">{Number(o.price).toFixed(2)}</td>
                            <td className="px-2 py-1">
                              <span className={`px-1.5 py-0.5 rounded ${(o as any).delivered === "processing" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400" : "bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400"}`}>{(o as any).delivered === "processing" ? "processing" : o.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {preview.notFound.length > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  <span className="font-semibold text-amber-600 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />Not found ({preview.notFound.length}):
                  </span>{" "}
                  {preview.notFound.slice(0, 30).join(", ")}{preview.notFound.length > 30 ? ` +${preview.notFound.length - 30} more` : ""}
                </div>
              )}

              {preview.refundable.length === 0 && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />Nothing to cancel — no matching open orders.
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={submitting}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!preview || preview.refundable.length === 0 || submitting}
            className="gap-1.5"
            data-testid="button-bulk-confirm"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
            {preview && preview.refundable.length > 0
              ? `Cancel & Refund ${preview.refundable.length} (GH₵${Number(preview.totalRefund).toFixed(2)})`
              : "Cancel & Refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
