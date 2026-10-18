import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { BadgeCheck, Search, Download, Copy, Check, X, Clock3, RefreshCw, Menu, XCircle, Phone, Users, ListFilter } from "lucide-react";

type Verification = {
  id: number;
  agentId: number;
  agentName: string;
  phoneNumber: string;
  status: "pending" | "verified" | "rejected";
  submittedAt: string;
  note?: string | null;
};
const statuses = ["all", "pending", "verified", "rejected"] as const;
const statusStyle: Record<Verification["status"], string> = {
  pending: "bg-[#fff1d4] text-[#8f6314]", verified: "bg-[#e1f2e9] text-[#28634a]", rejected: "bg-[#f8e8e3] text-[#a24734]",
};
const localDate = (value: string) => new Date(value).toLocaleString("en-GH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function AdminNumberVerificationsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filter, setFilter] = useState<(typeof statuses)[number]>("pending");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState<number | null>(null);
  const { toast } = useToast();
  const client = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<Verification[]>({
    queryKey: ["admin-number-verifications"],
    queryFn: async () => {
      const response = await fetch("/api/admin/number-verifications", { credentials: "include" });
      if (!response.ok) throw new Error("Could not load verification requests.");
      const result = await response.json();
      return result.submissions.map((row: any) => ({
        ...row, agentId: row.userId, submittedAt: row.createdAt, note: row.adminNote,
      })) as Verification[];
    },
  });
  const list = useMemo(() => {
    let result = data ?? [];
    if (filter !== "all") result = result.filter(row => row.status === filter);
    const query = search.trim().toLowerCase();
    if (query) result = result.filter(row => row.phoneNumber.toLowerCase().includes(query) || row.agentName.toLowerCase().includes(query) || String(row.agentId).includes(query));
    return [...result].sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }, [data, filter, search]);
  const summary = useMemo(() => ({
    total: data?.length ?? 0,
    pending: data?.filter(row => row.status === "pending").length ?? 0,
    agents: new Set(data?.map(row => row.agentId) ?? []).size,
  }), [data]);

  const update = async (row: Verification, status: "verified" | "rejected") => {
    setBusyId(row.id);
    try {
      const response = await fetch(`/api/admin/number-verifications/${row.id}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: notes[row.id] ?? row.note ?? "" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not update this request.");
      client.setQueryData<Verification[]>(["admin-number-verifications"], old => old?.map(item => item.id === row.id ? { ...item, ...result, status, note: notes[row.id] ?? row.note } : item));
      toast({ title: `Request #${row.id} marked ${status}` });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Update failed", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };
  const copyNumber = async (row: Verification) => {
    try {
      await navigator.clipboard.writeText(row.phoneNumber);
      setCopied(row.id);
      window.setTimeout(() => setCopied(current => current === row.id ? null : current), 1600);
    } catch { toast({ title: "Could not copy number", variant: "destructive" }); }
  };
  const exportCsv = () => {
    const rows = [["Request ID", "Agent", "Agent ID", "Phone number", "Status", "Submitted at", "Admin note"], ...list.map(row => [String(row.id), row.agentName, String(row.agentId), row.phoneNumber, row.status, row.submittedAt, row.note ?? ""])];
    const csv = "\uFEFF" + rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `number-verifications-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast({ title: `Downloaded ${list.length} request${list.length === 1 ? "" : "s"}` });
  };

  return (
    <div className="flex min-h-[100dvh] bg-[#f5f3ec] text-[#182c34]">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Navbar />
        <main className="mx-auto max-w-[1400px] px-4 pb-12 pt-7 sm:px-7 lg:px-9 lg:pt-10">
          <header className="mb-8 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex items-start gap-3">
              <Button variant="outline" size="icon" onClick={() => setSidebarOpen(true)} className="mt-1 shrink-0 border-[#dfe2d9] bg-transparent lg:hidden" aria-label="Open admin menu"><Menu className="h-4 w-4" /></Button>
              <div>
                <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-[#647b68]"><BadgeCheck className="h-4 w-4" /> Operations · Customer checks</div>
                <h1 className="text-3xl font-semibold tracking-[-.04em] sm:text-[40px]">Number verifications</h1>
                <p className="mt-2 text-sm text-[#76847c]">Review agent submissions, record outcomes, and keep every decision traceable.</p>
              </div>
            </div>
            <Button variant="outline" onClick={exportCsv} disabled={!list.length} className="h-10 gap-2 border-[#d9ded6] bg-[#fbfaf6] text-[#405850] hover:bg-[#eef1e9]"><Download className="h-4 w-4" /> Download {list.length ? `(${list.length})` : ""}</Button>
          </header>

          <div className="mb-7 grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-xl border border-[#e3e0d7] bg-[#fbfaf6] px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#85918a]">All submissions</p><p className="mt-1 font-mono text-2xl font-semibold">{summary.total}</p></div><ListFilter className="h-5 w-5 text-[#879786]" /></div>
            <div className="flex items-center justify-between rounded-xl border border-[#eadfc8] bg-[#faf4e7] px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#957343]">Awaiting review</p><p className="mt-1 font-mono text-2xl font-semibold text-[#79521a]">{summary.pending}</p></div><Clock3 className="h-5 w-5 text-[#a47a37]" /></div>
            <div className="flex items-center justify-between rounded-xl border border-[#e3e0d7] bg-[#fbfaf6] px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#85918a]">Agents represented</p><p className="mt-1 font-mono text-2xl font-semibold">{summary.agents}</p></div><Users className="h-5 w-5 text-[#879786]" /></div>
          </div>

          <section className="overflow-hidden rounded-2xl border border-[#e2dfd5] bg-[#fbfaf6]">
            <div className="flex flex-col gap-4 border-b border-[#eeece4] p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-1 rounded-lg bg-[#f0f0e9] p-1" role="tablist" aria-label="Filter requests by status">
                {statuses.map(status => <button key={status} role="tab" aria-selected={filter === status} onClick={() => setFilter(status)} className={`rounded-md px-3 py-2 text-xs font-semibold capitalize transition-colors ${filter === status ? "bg-[#fbfaf6] text-[#294b3c] shadow-sm" : "text-[#7b8980] hover:text-[#344d40]"}`}>{status}{status === "pending" && summary.pending > 0 ? ` · ${summary.pending}` : ""}</button>)}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c9890]" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search number or agent" className="h-10 border-[#e1e3db] bg-[#f8f8f2] pl-9 text-sm focus-visible:ring-[#65836e]" /></div>
                <Button variant="outline" size="icon" onClick={() => void refetch()} aria-label="Refresh requests" className="h-10 w-10 shrink-0 border-[#e1e3db] bg-transparent"><RefreshCw className="h-4 w-4" /></Button>
              </div>
            </div>
            {isLoading ? <div className="space-y-3 p-5">{[1, 2, 3, 4].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-[#efefe8]" />)}</div>
            : isError ? <div className="p-14 text-center"><XCircle className="mx-auto h-8 w-8 text-[#b5644d]" /><h2 className="mt-3 font-semibold">Could not load requests</h2><p className="mt-1 text-sm text-[#829087]">Please retry in a moment.</p><Button onClick={() => void refetch()} className="mt-4 bg-[#234c3d]">Try again</Button></div>
            : list.length === 0 ? <div className="px-5 py-16 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#eef0e8] text-[#74836f]"><Phone className="h-5 w-5" /></div><h2 className="mt-4 font-semibold">{search ? "No matching requests" : "Nothing in this queue"}</h2><p className="mt-1 text-sm text-[#87928b]">{search ? "Try another phone number or agent name." : "New agent submissions will appear here."}</p></div>
            : <div className="divide-y divide-[#eeece4]">
              {list.map(row => <article key={row.id} className="grid gap-x-6 gap-y-4 px-4 py-5 sm:px-6 xl:grid-cols-[minmax(180px,.85fr)_minmax(140px,.65fr)_minmax(200px,1fr)_minmax(245px,1.2fr)] xl:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#edf0e8] text-sm font-bold text-[#59715b]">{row.agentName?.slice(0, 1)?.toUpperCase() || "A"}</div>
                  <div className="min-w-0"><p className="truncate text-sm font-semibold">{row.agentName}</p><p className="mt-0.5 text-xs text-[#8c9790]">Agent #{row.agentId} · Request #{row.id}</p><p className="mt-1 text-[11px] text-[#9aa39b]">{localDate(row.submittedAt)}</p></div>
                </div>
                <div className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0 text-[#859484]" /><span className="font-mono text-sm font-semibold tracking-wide">{row.phoneNumber}</span><Button variant="ghost" size="icon" onClick={() => void copyNumber(row)} aria-label={`Copy ${row.phoneNumber}`} className="h-8 w-8 text-[#75847a] hover:bg-[#eff1e9]">{copied === row.id ? <Check className="h-4 w-4 text-[#3f7958]" /> : <Copy className="h-3.5 w-3.5" />}</Button></div>
                <div className="flex flex-col gap-2">
                  <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${statusStyle[row.status]}`}>{row.status === "verified" ? <Check className="h-3 w-3" /> : row.status === "rejected" ? <X className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}{row.status}</span>
                  {row.status !== "pending" && <p className="line-clamp-2 text-xs text-[#8b968f]">{row.note || "No admin note"}</p>}
                </div>
                {row.status === "pending" ? <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
                  <Input value={notes[row.id] ?? ""} onChange={event => setNotes(previous => ({ ...previous, [row.id]: event.target.value }))} aria-label={`Admin note for request ${row.id}`} placeholder="Add a note (optional)" className="h-9 min-w-0 border-[#e1e3db] bg-[#f8f8f2] text-xs" />
                  <div className="flex shrink-0 gap-2">
                    <Button disabled={busyId === row.id} onClick={() => void update(row, "verified")} className="h-9 flex-1 gap-1.5 bg-[#2c6248] px-3 text-xs text-white hover:bg-[#214e39]"><Check className="h-3.5 w-3.5" /> Verify</Button>
                    <Button disabled={busyId === row.id} onClick={() => void update(row, "rejected")} variant="outline" className="h-9 flex-1 gap-1.5 border-[#e5d5ce] bg-transparent px-3 text-xs text-[#9d4d3c] hover:bg-[#f9eeea]"><X className="h-3.5 w-3.5" /> Reject</Button>
                  </div>
                </div> : <div className="text-right text-[10px] uppercase tracking-widest text-[#a1a9a1]">Closed</div>}
              </article>)}
            </div>}
            {!isLoading && !isError && list.length > 0 && <div className="flex items-center justify-between border-t border-[#eeece4] px-5 py-3 text-xs text-[#8c9790]"><span>Showing {list.length} of {data?.length ?? 0} submissions</span><span className="hidden sm:inline">Latest requests first</span></div>}
          </section>
        </main>
      </div>
    </div>
  );
}
