import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  KeyRound, Plus, Copy, RefreshCw, Trash2, Menu, ExternalLink,
  CheckCircle, XCircle, Pencil, PlusCircle, ChevronDown, ChevronUp,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiClient {
  id:            number;
  name:          string;
  email:         string;
  keyDisplay:    string;
  creditBalance: string;
  isActive:      boolean;
  notes:         string | null;
  lastUsedAt:    string | null;
  createdAt:     string;
  apiKey?:       string;
}

interface ApiOrder {
  id:            number;
  reference:     string;
  bundleName:    string;
  bundleData:    string;
  bundleNetwork: string;
  phoneNumber:   string;
  price:         string;
  status:        string;
  mcbisReference: string | null;
  createdAt:     string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const api = {
  list:       () => fetch("/api/admin/api-clients", { credentials: "include" }).then(r => r.json() as Promise<{ clients: ApiClient[] }>),
  create:     (body: object) => fetch("/api/admin/api-clients", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  update:     (id: number, body: object) => fetch(`/api/admin/api-clients/${id}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  refreshKey: (id: number) => fetch(`/api/admin/api-clients/${id}/refresh-key`, { method: "POST", credentials: "include" }),
  addCredit:  (id: number, amount: number) => fetch(`/api/admin/api-clients/${id}/credit`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount }) }),
  delete:     (id: number) => fetch(`/api/admin/api-clients/${id}`, { method: "DELETE", credentials: "include" }),
  orders:     (id: number) => fetch(`/api/admin/api-clients/${id}/orders?pageSize=20`, { credentials: "include" }).then(r => r.json() as Promise<{ orders: ApiOrder[]; total: number }>),
};

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed:  "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    pending:    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    failed:     "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

// ─── Key Reveal Dialog ────────────────────────────────────────────────────────

function KeyRevealDialog({
  open, onClose, apiKey, clientName, isRefresh,
}: { open: boolean; onClose: () => void; apiKey: string; clientName: string; isRefresh?: boolean }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copy = () => {
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true);
      toast({ title: "Copied!", description: "API key copied to clipboard." });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-amber-500" />
            {isRefresh ? "New API Key Generated" : "API Key Created"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-4">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">
              Copy this key now — it will never be shown again.
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Send it securely to <strong>{clientName}</strong>. The admin panel only stores a masked version.
            </p>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">API Key</Label>
            <div className="flex gap-2">
              <code className="flex-1 bg-muted rounded-md px-3 py-2 text-sm font-mono break-all leading-relaxed">
                {apiKey}
              </code>
              <Button variant="outline" size="icon" onClick={copy} className="shrink-0">
                {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Your API partner should include this in every request as:
            <code className="ml-1 bg-muted px-1 py-0.5 rounded text-xs">X-API-Key: {apiKey.substring(0, 16)}…</code>
          </p>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>I've saved the key</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Dialog ────────────────────────────────────────────────────────────

function CreateDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void;
  onCreated: (client: ApiClient) => void;
}) {
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => api.create({ name, email, notes: notes || undefined }),
    onSuccess: async (res) => {
      if (!res.ok) {
        const d = await res.json() as { error: string };
        toast({ variant: "destructive", title: "Error", description: d.error });
        return;
      }
      const client = await res.json() as ApiClient;
      onCreated(client);
      setName(""); setEmail(""); setNotes("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New API Client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Client / Business Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Corp" className="mt-1.5" />
          </div>
          <div>
            <Label>Contact Email *</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="dev@acme.com" className="mt-1.5" />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any internal notes about this client…" rows={3} className="mt-1.5 resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!name || !email || mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create & Generate Key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Dialog ──────────────────────────────────────────────────────────────

function EditDialog({ client, open, onClose }: {
  client: ApiClient; open: boolean; onClose: () => void;
}) {
  const [name, setName]   = useState(client.name);
  const [email, setEmail] = useState(client.email);
  const [notes, setNotes] = useState(client.notes ?? "");
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.update(client.id, { name, email, notes: notes || null }),
    onSuccess: async (res) => {
      if (!res.ok) {
        const d = await res.json() as { error: string };
        toast({ variant: "destructive", title: "Error", description: d.error });
        return;
      }
      toast({ title: "Updated", description: "Client details saved." });
      await qc.invalidateQueries({ queryKey: ["admin-api-clients"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {client.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="mt-1.5 resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Credit Dialog ────────────────────────────────────────────────────────────

function CreditDialog({ client, open, onClose }: {
  client: ApiClient; open: boolean; onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [mode, setMode]     = useState<"add" | "set">("add");
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const num = parseFloat(amount);
      if (mode === "add") {
        return api.addCredit(client.id, num);
      } else {
        return api.update(client.id, { creditBalance: num.toFixed(2) });
      }
    },
    onSuccess: async (res) => {
      if (!res.ok) {
        const d = await res.json() as { error: string };
        toast({ variant: "destructive", title: "Error", description: d.error });
        return;
      }
      toast({ title: "Credit updated", description: `Balance updated for ${client.name}.` });
      await qc.invalidateQueries({ queryKey: ["admin-api-clients"] });
      setAmount("");
      onClose();
    },
  });

  const num = parseFloat(amount);
  const preview = !isNaN(num) && num >= 0
    ? mode === "add"
      ? (parseFloat(client.creditBalance) + num).toFixed(2)
      : num.toFixed(2)
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setAmount(""); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Manage Credit — {client.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant={mode === "add" ? "default" : "outline"} size="sm" onClick={() => setMode("add")} className="flex-1">
              Add Credit
            </Button>
            <Button variant={mode === "set" ? "default" : "outline"} size="sm" onClick={() => setMode("set")} className="flex-1">
              Set Balance
            </Button>
          </div>

          <div>
            <Label>Current balance: <strong>GH₵{parseFloat(client.creditBalance).toFixed(2)}</strong></Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={mode === "add" ? "Amount to add (GH₵)" : "New balance (GH₵)"}
              className="mt-1.5"
            />
          </div>

          {preview && (
            <p className="text-sm text-muted-foreground">
              New balance will be: <strong className="text-foreground">GH₵{preview}</strong>
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setAmount(""); onClose(); }}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={isNaN(num) || num < 0 || mutation.isPending}
          >
            {mutation.isPending ? "Updating…" : "Update Credit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Orders Drawer ────────────────────────────────────────────────────────────

function OrdersRow({ client }: { client: ApiClient }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-api-orders", client.id],
    queryFn:  () => api.orders(client.id),
    enabled:  open,
    staleTime: 30_000,
  });

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setOpen(o => !o)}
      >
        <TableCell>
          <div className="font-medium">{client.name}</div>
          <div className="text-xs text-muted-foreground">{client.email}</div>
        </TableCell>
        <TableCell>
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
            {client.keyDisplay}
          </code>
        </TableCell>
        <TableCell className="text-right font-semibold">
          GH₵{parseFloat(client.creditBalance).toFixed(2)}
        </TableCell>
        <TableCell>
          {client.isActive
            ? <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-900/20"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>
            : <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 dark:bg-red-900/20"><XCircle className="w-3 h-3 mr-1" />Inactive</Badge>
          }
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleDateString() : "Never"}
        </TableCell>
        <TableCell className="text-right">
          {open
            ? <ChevronUp className="w-4 h-4 ml-auto text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 ml-auto text-muted-foreground" />
          }
        </TableCell>
      </TableRow>

      {open && (
        <TableRow>
          <TableCell colSpan={6} className="p-0 bg-muted/30">
            <div className="px-6 py-4 space-y-3">
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Recent Orders {data?.total ? `(${data.total} total)` : ""}
              </div>
              {isLoading && <div className="text-sm text-muted-foreground">Loading orders…</div>}
              {data?.orders.length === 0 && <div className="text-sm text-muted-foreground">No orders yet.</div>}
              {data?.orders.map(o => (
                <div key={o.id} className="flex items-center gap-4 text-sm py-2 border-b border-border/50 last:border-0">
                  <code className="text-xs text-muted-foreground font-mono shrink-0">{o.reference}</code>
                  <div className="flex-1">
                    <span className="font-medium">{o.bundleName}</span>
                    <span className="text-muted-foreground ml-2">→ {o.phoneNumber}</span>
                  </div>
                  <span className="text-muted-foreground text-xs">{o.bundleNetwork.toUpperCase()}</span>
                  <span className="font-semibold">GH₵{o.price}</span>
                  <StatusBadge status={o.status} />
                  <span className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function ApiClientsContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [createOpen, setCreateOpen]   = useState(false);
  const [revealKey, setRevealKey]     = useState<{ key: string; name: string; isRefresh?: boolean } | null>(null);
  const [editClient, setEditClient]   = useState<ApiClient | null>(null);
  const [creditClient, setCreditClient] = useState<ApiClient | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiClient | null>(null);
  const [refreshTarget, setRefreshTarget] = useState<ApiClient | null>(null);

  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-api-clients"],
    queryFn:  api.list,
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(id),
    onSuccess: async () => {
      toast({ title: "Deleted", description: "API client removed." });
      await qc.invalidateQueries({ queryKey: ["admin-api-clients"] });
      setDeleteTarget(null);
    },
  });

  const refreshMutation = useMutation({
    mutationFn: (id: number) => api.refreshKey(id),
    onSuccess: async (res, id) => {
      if (!res.ok) {
        toast({ variant: "destructive", title: "Error", description: "Failed to refresh key." });
        return;
      }
      const client = await res.json() as ApiClient;
      await qc.invalidateQueries({ queryKey: ["admin-api-clients"] });
      setRefreshTarget(null);
      setRevealKey({ key: client.apiKey!, name: client.name, isRefresh: true });
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.update(id, { isActive: !isActive }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-api-clients"] });
    },
  });

  const clients = data?.clients ?? [];
  const docsUrl = "/api/v1/docs";

  return (
    <div className="flex h-screen bg-background">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 overflow-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border px-4 sm:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-1.5 rounded hover:bg-muted" onClick={() => setSidebarOpen(true)}>
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <KeyRound className="w-5 h-5" />
                API Clients
              </h1>
              <p className="text-sm text-muted-foreground">Manage partner API keys and credit balances</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={docsUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="w-4 h-4 mr-1.5" />
                API Docs
              </Button>
            </a>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              New Client
            </Button>
          </div>
        </div>

        <div className="px-4 sm:px-8 py-6 space-y-6">
          {/* Info banner */}
          <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-4 flex gap-3">
            <KeyRound className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
            <div className="text-sm text-blue-800 dark:text-blue-300">
              <p className="font-semibold mb-1">How API keys work</p>
              <p>
                Each client gets a unique key (<code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded text-xs">dk_live_…</code>) that they send in the <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded text-xs">X-API-Key</code> header.
                The full key is only shown once — after creation or key refresh. You copy it and send it to the client.
                Add credit to their account so they can place orders. The{" "}
                <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium">interactive API docs</a>{" "}
                let them try all endpoints directly in the browser.
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Clients",  value: clients.length },
              { label: "Active",         value: clients.filter(c => c.isActive).length },
              { label: "Total Credit",   value: `GH₵${clients.reduce((s, c) => s + parseFloat(c.creditBalance), 0).toFixed(2)}` },
              { label: "Used Today",     value: clients.filter(c => c.lastUsedAt && new Date(c.lastUsedAt).toDateString() === new Date().toDateString()).length },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</p>
                <p className="text-2xl font-bold mt-1">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Client</TableHead>
                  <TableHead>API Key</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-12">Loading…</TableCell>
                  </TableRow>
                )}
                {!isLoading && clients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12">
                      <KeyRound className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-muted-foreground">No API clients yet.</p>
                      <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
                        <Plus className="w-4 h-4 mr-1.5" />Create first client
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
                {clients.map(client => (
                  <OrdersRow key={client.id} client={client} />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Per-client action bar (shown below the table) */}
          {clients.length > 0 && (
            <div className="rounded-xl border border-border bg-card divide-y divide-border">
              <div className="px-4 py-3 bg-muted/30">
                <p className="text-sm font-semibold text-muted-foreground">Actions</p>
              </div>
              {clients.map(client => (
                <div key={client.id} className="px-4 py-3 flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm">{client.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{client.email}</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setEditClient(client)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" />Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setCreditClient(client)}>
                    <PlusCircle className="w-3.5 h-3.5 mr-1" />Credit
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => toggleActive.mutate({ id: client.id, isActive: client.isActive })}
                    disabled={toggleActive.isPending}
                  >
                    {client.isActive ? <XCircle className="w-3.5 h-3.5 mr-1" /> : <CheckCircle className="w-3.5 h-3.5 mr-1" />}
                    {client.isActive ? "Deactivate" : "Activate"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setRefreshTarget(client)}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh Key
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => setDeleteTarget(client)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(client) => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ["admin-api-clients"] });
          setRevealKey({ key: client.apiKey!, name: client.name });
        }}
      />

      {revealKey && (
        <KeyRevealDialog
          open
          onClose={() => setRevealKey(null)}
          apiKey={revealKey.key}
          clientName={revealKey.name}
          isRefresh={revealKey.isRefresh}
        />
      )}

      {editClient && (
        <EditDialog
          client={editClient}
          open
          onClose={() => setEditClient(null)}
        />
      )}

      {creditClient && (
        <CreditDialog
          client={creditClient}
          open
          onClose={() => setCreditClient(null)}
        />
      )}

      {/* Refresh key confirm */}
      <AlertDialog open={!!refreshTarget} onOpenChange={(o) => { if (!o) setRefreshTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refresh API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately invalidate the current API key for <strong>{refreshTarget?.name}</strong>.
              Any integration using the old key will break instantly. A new key will be shown once — you'll need to send it to the client.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => refreshTarget && refreshMutation.mutate(refreshTarget.id)}
              className="bg-amber-500 hover:bg-amber-600"
            >
              Yes, Generate New Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API Client?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and revoke their API key.
              Their order history will also be deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function AdminApiClients() {
  return (
    <ProtectedRoute adminOnly>
      <ApiClientsContent />
    </ProtectedRoute>
  );
}
