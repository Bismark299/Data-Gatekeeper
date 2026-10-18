import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { BadgeCheck, Upload, ClipboardList, Phone, Clock3, Check, X, ArrowUpRight, FileSpreadsheet, LoaderCircle } from "lucide-react";

type Verification = {
  id: number;
  agentId: number;
  agentName: string;
  phoneNumber: string;
  status: "pending" | "verified" | "rejected";
  submittedAt: string;
  note?: string | null;
};

const fmtDate = (date: string) => new Date(date).toLocaleString("en-GH", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const statusTone: Record<Verification["status"], string> = {
  pending: "bg-[#fff2d6] text-[#946414]",
  verified: "bg-[#e2f3eb] text-[#28634a]",
  rejected: "bg-[#fbe9e4] text-[#a24734]",
};
const normalizeNumbers = (value: string) => [...new Set(value.split(/[\n,;\t ]+/).map(n => n.trim()).filter(Boolean))];

export default function VerifyNumbersPage() {
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useQuery<Verification[]>({
    queryKey: ["number-verifications", "my"],
    queryFn: async () => {
      const res = await fetch("/api/number-verifications/my", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load your submissions.");
      const result = await res.json();
      return result.submissions.map((row: any) => ({
        ...row, agentId: row.userId, agentName: user?.name, submittedAt: row.createdAt, note: row.adminNote,
      })) as Verification[];
    },
  });
  const numbers = useMemo(() => normalizeNumbers(input), [input]);
  const counts = useMemo(() => ({
    pending: data?.filter(item => item.status === "pending").length ?? 0,
    verified: data?.filter(item => item.status === "verified").length ?? 0,
    rejected: data?.filter(item => item.status === "rejected").length ?? 0,
  }), [data]);

  const onFile = async (file?: File) => {
    if (!file) return;
    setSelectedFile(file);
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension === "csv" || extension === "tsv" || file.type.startsWith("text/")) {
      try {
        const text = await file.text();
        const found = normalizeNumbers(text).filter(token => /\d/.test(token));
        if (found.length) setInput(previous => [previous.trim(), found.join("\n")].filter(Boolean).join("\n"));
        else toast({ title: "No numbers found", description: "Check the file and paste numbers into the list." });
      } catch {
        toast({ title: "Could not read this file", variant: "destructive" });
      }
    } else if (extension === "xlsx" || extension === "xls") {
      try {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const values = workbook.SheetNames.flatMap(name =>
          XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: false }).flat()
        );
        const found = [...new Set(values.flatMap(value => {
          const text = String(value ?? "");
          return (text.match(/(?:\+?\d[\d\s().-]{8,}\d)/g) ?? [])
            .map(candidate => candidate.replace(/\D/g, ""))
            .filter(candidate => /^\d{10,15}$/.test(candidate));
        }))];
        if (found.length) {
          setInput(previous => [previous.trim(), found.join("\n")].filter(Boolean).join("\n"));
          toast({ title: `${found.length} phone numbers imported`, description: "Review the list before submitting." });
        } else toast({ title: "No phone numbers found", description: "The workbook did not contain cells with 10–15 digit numbers." });
      } catch {
        toast({ title: "Could not read workbook", description: "Try saving it as .xlsx or .csv.", variant: "destructive" });
      }
    } else {
      toast({ title: "Unsupported file", description: "Choose an Excel workbook, CSV or TSV file.", variant: "destructive" });
    }
  };

  const submit = async () => {
    if (!numbers.length || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/number-verifications", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "Submission failed. Please try again.");
      const submittedCount = result.submissions?.length ?? numbers.length;
      toast({ title: `${submittedCount} number${submittedCount === 1 ? "" : "s"} sent for review` });
      setInput("");
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["number-verifications", "my"] });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Submission failed", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#f5f3ec] text-[#182c34]">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-7 sm:px-7 lg:pt-11">
        <div className="mb-9 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#d8dfd9] bg-[#eaf0e9] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.15em] text-[#45685a]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#548268]" /> Agent workspace
            </div>
            <h1 className="font-semibold tracking-[-.045em] text-3xl sm:text-[42px]">Number verification</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#687779]">Send customer numbers to the team for a quick check. Every request stays here, with its latest status.</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-[#e1dfd5] bg-[#fbfaf6] px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#edf1e7] text-[#4b6955] font-bold">{user?.name?.charAt(0)?.toUpperCase() ?? "A"}</div>
            <div><p className="text-[11px] uppercase tracking-wider text-[#8a9692]">Submitting as</p><p className="text-sm font-semibold">{user?.name ?? "Agent"}</p></div>
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.12fr_.88fr]">
          <section className="overflow-hidden rounded-2xl border border-[#e1dfd5] bg-[#fbfaf6] shadow-[0_12px_34px_rgba(33,52,44,.04)]">
            <div className="flex items-start justify-between border-b border-[#eeece4] px-5 py-5 sm:px-7">
              <div><div className="flex items-center gap-2 text-sm font-semibold"><Phone className="h-4 w-4 text-[#667d68]" /> New request</div><p className="mt-1 text-xs text-[#87918e]">Add one number per line, or separate with commas.</p></div>
              <div className="rounded-lg bg-[#f0efe7] px-2.5 py-1.5 font-mono text-xs text-[#6d7874]">GH · {numbers.length}</div>
            </div>
            <div className="p-5 sm:p-7">
              <label htmlFor="number-list" className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-[#707e79]">Phone numbers</label>
              <textarea id="number-list" value={input} onChange={event => setInput(event.target.value)} placeholder={"024 123 4567\n055 987 6543"} rows={7} className="w-full resize-y rounded-xl border border-[#dfe3dc] bg-[#f7f7f1] px-4 py-3 font-mono text-sm leading-7 text-[#263c3e] outline-none transition focus:border-[#66816c] focus:ring-2 focus:ring-[#66816c]/15" aria-describedby="number-help" />
              <div id="number-help" className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-[#929b95]"><span>Numbers are sent securely to your admin team.</span><span>{numbers.length} unique {numbers.length === 1 ? "number" : "numbers"}</span></div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv" className="sr-only" aria-label="Choose Excel workbook or CSV file" onChange={event => void onFile(event.target.files?.[0])} />
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} className="h-11 justify-center gap-2 border-[#d8ded6] bg-transparent text-[#425954] hover:bg-[#f0f2eb]"><Upload className="h-4 w-4" /> Import workbook</Button>
                <span className="min-w-0 flex-1 truncate text-xs text-[#89948e]" title={selectedFile?.name}>{selectedFile ? `${selectedFile.name} · selected` : "Excel or CSV · paste workbook column if needed"}</span>
                <Button type="button" disabled={numbers.length === 0 || submitting} onClick={() => void submit()} className="h-11 gap-2 bg-[#234c3d] px-5 text-[#f8f6ed] hover:bg-[#193d31] disabled:opacity-45">
                  {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />} Send for review
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3 border-t border-[#eeece4] bg-[#f6f5ef] px-5 py-4 sm:px-7">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-[#83917e]" />
              <p className="text-xs leading-5 text-[#75827d]">CSV/TSV files are read automatically. For Excel workbooks, choose your file and paste the phone-number column above.</p>
            </div>
          </section>
          <aside className="rounded-2xl bg-[#214638] p-6 text-[#f4f2e8] sm:p-7">
            <div className="flex items-center justify-between">
              <div><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#b8c9b8]">Your activity</div><div className="mt-1 text-sm text-[#dce4d8]">A clear view of every request.</div></div>
              <ClipboardList className="h-5 w-5 text-[#d7c77a]" />
            </div>
            <div className="mt-8 grid grid-cols-3 divide-x divide-white/15">
              {[["pending", counts.pending], ["verified", counts.verified], ["rejected", counts.rejected]].map(([label, count]) => (
                <div key={String(label)} className="px-3 first:pl-0"><p className="font-mono text-2xl font-semibold">{count}</p><p className="mt-1 text-[10px] uppercase tracking-[.14em] text-[#b9c8bb]">{label}</p></div>
              ))}
            </div>
            <div className="mt-8 border-t border-white/15 pt-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#e4ddaf]"><Clock3 className="h-4 w-4" /> What happens next?</div>
              <p className="mt-2 text-xs leading-5 text-[#c5d2c7]">Your admin reviews each number. Once checked, the result and any note will appear in your submission history.</p>
            </div>
          </aside>
        </div>

        <section className="mt-10">
          <div className="mb-4 flex items-end justify-between">
            <div><p className="text-[11px] font-bold uppercase tracking-[.16em] text-[#788680]">Record book</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Submission history</h2></div>
            <span className="font-mono text-xs text-[#88918b]">{data?.length ?? 0} records</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[#e1dfd5] bg-[#fbfaf6]">
            {isLoading ? <div className="space-y-3 p-5" aria-label="Loading history">{[1, 2, 3].map(i => <div key={i} className="h-14 animate-pulse rounded-lg bg-[#efefe8]" />)}</div>
            : isError ? <div className="p-10 text-center"><p className="font-semibold">History did not load.</p><p className="mt-1 text-sm text-[#7b8780]">Check your connection, then try again.</p><Button variant="outline" onClick={() => void refetch()} className="mt-4">Try again</Button></div>
            : !data?.length ? <div className="px-5 py-14 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#eef0e8] text-[#74836f]"><BadgeCheck className="h-5 w-5" /></div><h3 className="mt-4 font-semibold">No requests yet</h3><p className="mt-1 text-sm text-[#818d85]">Numbers you send for review will show up here.</p></div>
            : <div className="divide-y divide-[#eeece4]">
              {data.map(item => <div key={item.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-center sm:px-6">
                <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eef1e9] text-[#61745e]"><Phone className="h-4 w-4" /></div><div><p className="font-mono text-sm font-semibold">{item.phoneNumber}</p><p className="mt-0.5 text-xs text-[#919b94]">Request #{item.id}</p></div></div>
                <div><p className="text-xs text-[#6f7d76]">{fmtDate(item.submittedAt)}</p>{item.note && <p className="mt-1 text-xs text-[#9a7950]">{item.note}</p>}</div>
                <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${statusTone[item.status]}`}>{item.status === "verified" ? <Check className="h-3 w-3" /> : item.status === "rejected" ? <X className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}{item.status}</span>
              </div>)}
            </div>}
          </div>
        </section>
      </main>
    </div>
  );
}
