import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  KeyRound, Copy, RefreshCw, Trash2, Menu, CheckCircle, XCircle,
  UserPlus, ExternalLink, ChevronDown, ChevronUp,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiUser {
  id:         number;
  name:       string;
  email:      string;
  role:       string;
  isActive:   boolean;
  keyDisplay: string | null;
  lastUsedAt: string | null;
  createdAt:  string;
}

interface AllUser {
  id:     number;
  name:   string;
  email:  string;
  role:   string;
  hasKey: boolean;
}

interface UserOrder {
  id:          number;
  bundleName:  string;
  bundleData:  string;
  network:     string | null;
  phoneNumber: string;
  price:       string;
  status:      string;
  createdAt:   string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roleBadge(role: string) {
  const map: Record<string, string> = {
    admin:  "bg-red-100 text-red-700",
    dealer: "bg-purple-100 text-purple-700",
    agent:  "bg-blue-100 text-blue-700",
    user:   "bg-gray-100 text-gray-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[role] ?? map.user}`}>
      {role}
    </span>
  );
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending:    "bg-yellow-100 text-yellow-700",
    processing: "bg-blue-100 text-blue-700",
    completed:  "bg-green-100 text-green-700",
    failed:     "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-700"}`}>
      {status}
    </span>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Key reveal dialog ────────────────────────────────────────────────────────

function KeyRevealDialog({
  open, onClose, apiKey, name,
}: { open: boolean; onClose: () => void; apiKey: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Copy the key manually.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-yellow-500" />
            API Key for {name}
          </DialogTitle>
          <DialogDescription>
            Copy this key now — it will <strong>never be shown again</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 rounded-lg border bg-gray-50 p-3 font-mono text-sm break-all select-all">
          {apiKey}
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={copy} className="gap-2">
            {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy key"}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Orders expandable row ────────────────────────────────────────────────────

function UserOrdersRow({ userId }: { userId: number }) {
  const { data, isLoading } = useQuery<{ orders: UserOrder[]; total: number }>({
    queryKey: ["admin-api-user-orders", userId],
    queryFn: () => fetch(`/api/admin/api-clients/${userId}/orders?pageSize=10`).then(r => r.json()),
  });

  if (isLoading) return (
    <TableRow><TableCell colSpan={7} className="py-4 text-center text-sm text-gray-500">Loading orders…</TableCell></TableRow>
  );

  const orders = data?.orders ?? [];
  if (orders.length === 0) return (
    <TableRow><TableCell colSpan={7} className="py-3 pl-10 text-sm text-gray-400 italic">No orders yet.</TableCell></TableRow>
  );

  return (
    <>
      {orders.map(o => (
        <TableRow key={o.id} className="bg-gray-50 text-sm">
          <TableCell className="pl-10 text-gray-500">#{o.id}</TableCell>
          <TableCell>{o.bundleName} ({o.bundleData})</TableCell>
          <TableCell className="capitalize">{o.network ?? "—"}</TableCell>
          <TableCell>{o.phoneNumber}</TableCell>
          <TableCell>GH₵{o.price}</TableCell>
          <TableCell>{statusBadge(o.status)}</TableCell>
          <TableCell className="text-gray-400">{fmtDate(o.createdAt)}</TableCell>
        </TableRow>
      ))}
      {(data?.total ?? 0) > orders.length && (
        <TableRow className="bg-gray-50">
          <TableCell colSpan={7} className="py-2 pl-10 text-xs text-blue-500">
            {data!.total} total orders — view all in Orders admin
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ApiClientsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiUser | null>(null);
  const [revealed, setRevealed] = useState<{ apiKey: string; name: string } | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [userSearch, setUserSearch] = useState("");

  // Users with API keys
  const { data: apiData, isLoading } = useQuery<{ users: ApiUser[] }>({
    queryKey: ["admin-api-clients"],
    queryFn: () => fetch("/api/admin/api-clients").then(r => r.json()),
  });

  // All users (for grant-access dropdown)
  const { data: allData } = useQuery<{ users: AllUser[] }>({
    queryKey: ["admin-all-users-for-api"],
    queryFn: () => fetch("/api/admin/api-clients/all-users").then(r => r.json()),
  });

  const apiUsers = apiData?.users ?? [];

  const filteredAllUsers = useMemo(() => {
    const q = userSearch.toLowerCase();
    return (allData?.users ?? []).filter(
      u => !u.hasKey && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
    );
  }, [allData, userSearch]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-api-clients"] });
    qc.invalidateQueries({ queryKey: ["admin-all-users-for-api"] });
  };

  // Generate new key
  const generateMutation = useMutation({
    mutationFn: (userId: number) =>
      fetch("/api/admin/api-clients/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Failed");
        return d as { name: string; apiKey: string };
      }),
    onSuccess: (data) => {
      invalidate();
      setSelectedUserId("");
      setUserSearch("");
      setRevealed({ apiKey: data.apiKey, name: data.name });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Refresh key
  const refreshMutation = useMutation({
    mutationFn: (userId: number) =>
      fetch(`/api/admin/api-clients/${userId}/refresh-key`, { method: "POST" }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Failed");
        return d as { name: string; apiKey: string };
      }),
    onSuccess: (data) => {
      invalidate();
      setRevealed({ apiKey: data.apiKey, name: data.name });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Revoke key
  const revokeMutation = useMutation({
    mutationFn: (userId: number) =>
      fetch(`/api/admin/api-clients/${userId}/revoke`, { method: "DELETE" }).then(async r => {
        if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? "Failed"); }
      }),
    onSuccess: () => {
      invalidate();
      setRevokeTarget(null);
      toast({ title: "API key revoked" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleGenerate = () => {
    const id = parseInt(selectedUserId, 10);
    if (!id) return;
    generateMutation.mutate(id);
  };

  return (
    <ProtectedRoute adminOnly>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-gray-500" />
                API Keys
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Grant and manage programmatic API access for existing users.{" "}
                <a
                  href="/api/v1/docs"
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  View API Docs <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">

            {/* Grant API Access */}
            <div className="bg-white rounded-xl border p-5">
              <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-gray-500" />
                Grant API Access
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Select an existing user to generate an API key for them. Their key will use their wallet and their role's pricing.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 space-y-2">
                  <Input
                    placeholder="Search users by name or email…"
                    value={userSearch}
                    onChange={e => { setUserSearch(e.target.value); setSelectedUserId(""); }}
                    className="w-full"
                  />
                  {userSearch && filteredAllUsers.length > 0 && (
                    <div className="border rounded-lg bg-white shadow-sm divide-y max-h-48 overflow-y-auto">
                      {filteredAllUsers.map(u => (
                        <button
                          key={u.id}
                          onClick={() => { setSelectedUserId(String(u.id)); setUserSearch(`${u.name} (${u.email})`); }}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between"
                        >
                          <div>
                            <div className="text-sm font-medium text-gray-900">{u.name}</div>
                            <div className="text-xs text-gray-500">{u.email}</div>
                          </div>
                          {roleBadge(u.role)}
                        </button>
                      ))}
                    </div>
                  )}
                  {userSearch && filteredAllUsers.length === 0 && !selectedUserId && (
                    <p className="text-sm text-gray-400 italic px-1">No matching users without a key.</p>
                  )}
                </div>

                <Button
                  onClick={handleGenerate}
                  disabled={!selectedUserId || generateMutation.isPending}
                  className="sm:self-start gap-2"
                >
                  <KeyRound className="h-4 w-4" />
                  {generateMutation.isPending ? "Generating…" : "Generate Key"}
                </Button>
              </div>
            </div>

            {/* Active API Keys table */}
            <div className="bg-white rounded-xl border">
              <div className="px-5 py-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">
                  Active API Keys
                  <span className="ml-2 text-sm font-normal text-gray-500">({apiUsers.length})</span>
                </h2>
              </div>

              {isLoading ? (
                <div className="py-12 text-center text-gray-400">Loading…</div>
              ) : apiUsers.length === 0 ? (
                <div className="py-12 text-center">
                  <KeyRound className="h-10 w-10 mx-auto text-gray-300 mb-3" />
                  <p className="text-gray-500 font-medium">No API keys issued yet</p>
                  <p className="text-sm text-gray-400 mt-1">Use the form above to grant a user API access.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs uppercase text-gray-500">
                        <TableHead>User</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>API Key</TableHead>
                        <TableHead>Last Used</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Since</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {apiUsers.map(u => (
                        <React.Fragment key={u.id}>
                          <TableRow className="group">
                            {/* User */}
                            <TableCell>
                              <div className="font-medium text-sm text-gray-900">{u.name}</div>
                              <div className="text-xs text-gray-400">{u.email}</div>
                            </TableCell>

                            {/* Role */}
                            <TableCell>{roleBadge(u.role)}</TableCell>

                            {/* Key */}
                            <TableCell>
                              <span className="font-mono text-xs text-gray-600 tracking-wide">
                                {u.keyDisplay ?? "—"}
                              </span>
                            </TableCell>

                            {/* Last used */}
                            <TableCell className="text-sm text-gray-500">
                              {u.lastUsedAt ? fmtDate(u.lastUsedAt) : <span className="italic text-gray-300">Never</span>}
                            </TableCell>

                            {/* Active */}
                            <TableCell>
                              {u.isActive
                                ? <span className="flex items-center gap-1 text-green-600 text-sm"><CheckCircle className="h-4 w-4" />Active</span>
                                : <span className="flex items-center gap-1 text-red-500 text-sm"><XCircle className="h-4 w-4" />Inactive</span>
                              }
                            </TableCell>

                            {/* Created */}
                            <TableCell className="text-sm text-gray-400">{fmtDate(u.createdAt)}</TableCell>

                            {/* Actions */}
                            <TableCell>
                              <div className="flex items-center justify-end gap-1">
                                {/* Expand orders */}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="View orders"
                                  onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                                >
                                  {expandedId === u.id
                                    ? <ChevronUp className="h-4 w-4" />
                                    : <ChevronDown className="h-4 w-4" />
                                  }
                                </Button>

                                {/* Refresh key */}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Refresh key"
                                  disabled={refreshMutation.isPending}
                                  onClick={() => {
                                    if (confirm(`Refresh API key for ${u.name}? Their current key will stop working immediately.`)) {
                                      refreshMutation.mutate(u.id);
                                    }
                                  }}
                                >
                                  <RefreshCw className="h-4 w-4 text-blue-500" />
                                </Button>

                                {/* Revoke */}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Revoke key"
                                  onClick={() => setRevokeTarget(u)}
                                >
                                  <Trash2 className="h-4 w-4 text-red-400" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>

                          {/* Expanded orders */}
                          {expandedId === u.id && (
                            <UserOrdersRow userId={u.id} />
                          )}
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* Key reveal dialog */}
      {revealed && (
        <KeyRevealDialog
          open={!!revealed}
          onClose={() => setRevealed(null)}
          apiKey={revealed.apiKey}
          name={revealed.name}
        />
      )}

      {/* Revoke confirm */}
      <AlertDialog open={!!revokeTarget} onOpenChange={v => { if (!v) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately invalidate <strong>{revokeTarget?.name}</strong>'s API key.
              Any integrations using it will stop working. This cannot be undone — you'll need to generate a new key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
            >
              Revoke Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProtectedRoute>
  );
}
