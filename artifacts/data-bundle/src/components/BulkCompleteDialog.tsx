import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

type PreviewOrder = {
  type: "platform" | "store";
  id: number;
  phoneNumber: string;
  bundleName: string | null;
  bundleData: string | null;
  price: string;
  status: string;
  createdAt: string;
  storeName: string | null;
};

type PreviewResult = {
  completable: PreviewOrder[];
  skipped: (PreviewOrder & { reason: string })[];
  notFound: string[];
  invalid: string[];
  counts: { completable: number; skipped: number; notFound: number; invalid: number };
};

export function BulkCompleteDialog({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen]             = useState(false);
  const [text, setText]             = useState("");
  const [dateFrom, setDateFrom]     = useState("");
  const [dateTo, setDateTo]         = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview]       = useState<PreviewResult | null>(null);

  // One entry per non-empty line — each line must carry phone + size.
  const values = text.split("\n").map(l => l.trim()).filter(Boolean);

  const reset = () => { setText(""); setPreview(null); setDateFrom(""); setDateTo(""); };
  const clearPreview = () => setPreview(null);

  const handlePreview = async () => {
    if (values.length === 0) { toast({ title: "Paste at least one line", variant: "destructive" }); return; }
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await fetch("/api/admin/orders/bulk-complete-preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
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
    if (!preview || preview.completable.length === 0) return;
    setSubmitting(true);
    try {
      const orderIds      = preview.completable.filter(o => o.type === "platform").map(o => o.id);
      const storeOrderIds = preview.completable.filter(o => o.type === "store").map(o => o.id);
      const res = await fetch("/api/admin/orders/bulk-complete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, storeOrderIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Completion failed");
      const total = (json.completedPlatform ?? 0) + (json.completedStore ?? 0);
      toast({
        title: `Completed ${total} order${total !== 1 ? "s" : ""}`,
        description: `${json.completedPlatform} platform · ${json.completedStore} store${json.skipped?.length ? ` · ${json.skipped.length} skipped` : ""}`,
      });
      setOpen(false);
      reset();
      onDone();
    } catch (e) {
      toast({ title: (e as Error).message || "Completion failed", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
          data-testid="button-bulk-complete"
        >
          <CheckCircle2 className="w-3.5 h-3.5" /> Bulk Complete
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Complete (exact match)</DialogTitle>
          <DialogDescription>
            Paste delivered lines as <span className="font-mono">phone&nbsp;&nbsp;size</span> (e.g. <span className="font-mono">0551724560&nbsp;&nbsp;5GB</span>) — the same format the network copy buttons export. An order is completed only when BOTH the phone number and the data size match exactly, and only processing orders are eligible. If several processing orders match the same phone + size, they&apos;re skipped so nothing is guessed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Delivered lines (one per line: phone + size)</Label>
            <Textarea
              value={text}
              onChange={e => { setText(e.target.value); clearPreview(); }}
              rows={6}
              placeholder={"0551724560\t5GB\n0598061094\t10GB\n…"}
              className="font-mono text-xs"
              data-testid="textarea-bulk-complete-values"
            />
            <p className="text-[11px] text-muted-foreground">
              {values.length} line{values.length === 1 ? "" : "s"} detected.
            </p>
          </div>

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

          <Button onClick={handlePreview} disabled={previewing || values.length === 0} variant="secondary" className="w-full gap-1.5" data-testid="button-bulk-complete-preview">
            {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Preview
          </Button>

          {preview && (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                  <CheckCircle2 className="w-3.5 h-3.5" />{preview.counts.completable} to complete
                </span>
                <span className="text-muted-foreground">{preview.counts.skipped} skipped</span>
                <span className="text-muted-foreground">{preview.counts.notFound} not found</span>
                {preview.counts.invalid > 0 && (
                  <span className="text-amber-600 font-semibold">{preview.counts.invalid} invalid line{preview.counts.invalid === 1 ? "" : "s"}</span>
                )}
              </div>

              {preview.completable.length > 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="max-h-52 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 sticky top-0">
                        <tr>
                          {["#", "Type", "Phone", "Size", "GH₵", "Status"].map(h => (
                            <th key={h} className="px-2 py-1.5 text-left font-semibold text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {preview.completable.map(o => (
                          <tr key={`${o.type}-${o.id}`}>
                            <td className="px-2 py-1 font-mono text-muted-foreground">{o.id}</td>
                            <td className="px-2 py-1">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${o.type === "store" ? "bg-violet-100 text-violet-800 dark:bg-violet-900/20 dark:text-violet-400" : "bg-sky-100 text-sky-800 dark:bg-sky-900/20 dark:text-sky-400"}`}>
                                {o.type === "store" ? (o.storeName ?? "Store") : "Platform"}
                              </span>
                            </td>
                            <td className="px-2 py-1 font-mono">{o.phoneNumber}</td>
                            <td className="px-2 py-1">{o.bundleData || o.bundleName}</td>
                            <td className="px-2 py-1 font-semibold">{Number(o.price).toFixed(2)}</td>
                            <td className="px-2 py-1">
                              <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400">{o.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {preview.skipped.length > 0 && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="px-2 py-1.5 bg-muted/40 text-[11px] font-semibold text-muted-foreground">Skipped ({preview.skipped.length})</div>
                  <div className="max-h-40 overflow-y-auto">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-border">
                        {preview.skipped.map(o => (
                          <tr key={`${o.type}-${o.id}`}>
                            <td className="px-2 py-1 font-mono text-muted-foreground">{o.id}</td>
                            <td className="px-2 py-1 font-mono">{o.phoneNumber}</td>
                            <td className="px-2 py-1">{o.bundleData || o.bundleName}</td>
                            <td className="px-2 py-1 text-muted-foreground">{o.reason}</td>
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

              {preview.invalid.length > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  <span className="font-semibold text-amber-600 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />Invalid lines ({preview.invalid.length}):
                  </span>{" "}
                  {preview.invalid.slice(0, 10).join(" · ")}{preview.invalid.length > 10 ? ` +${preview.invalid.length - 10} more` : ""}
                </div>
              )}

              {preview.completable.length === 0 && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />Nothing to complete — no exact phone + size matches in processing.
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={submitting}>Cancel</Button>
          <Button
            onClick={handleConfirm}
            disabled={!preview || preview.completable.length === 0 || submitting}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            data-testid="button-bulk-complete-confirm"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {preview && preview.completable.length > 0
              ? `Complete ${preview.completable.length} order${preview.completable.length !== 1 ? "s" : ""}`
              : "Complete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
