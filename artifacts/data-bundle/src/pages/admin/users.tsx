import { useState } from "react";
import { useAdminListUsers, useAdminUpdateUser, useAdminDeleteUser } from "@workspace/api-client-react";
import { getAdminListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Menu, Search, Users, Trash2, ShieldCheck, User, ToggleLeft, ToggleRight } from "lucide-react";

export default function AdminUsers() {
  return (
    <ProtectedRoute adminOnly>
      <AdminUsersContent />
    </ProtectedRoute>
  );
}

function AdminUsersContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<{ id: number; name: string } | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useAdminListUsers(search ? { search } : {});
  const updateUser = useAdminUpdateUser();
  const deleteUser = useAdminDeleteUser();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey({}) });

  const toggleActive = (u: { id: number; isActive: boolean; name: string }) => {
    updateUser.mutate(
      { id: u.id, data: { isActive: !u.isActive } },
      { onSuccess: () => { toast({ title: `${u.name} ${u.isActive ? "deactivated" : "activated"}` }); invalidate(); } }
    );
  };

  const toggleRole = (u: { id: number; role: string; name: string }) => {
    const newRole = u.role === "admin" ? "user" : "admin";
    updateUser.mutate(
      { id: u.id, data: { role: newRole } },
      { onSuccess: () => { toast({ title: `${u.name} is now ${newRole}` }); invalidate(); } }
    );
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteUser.mutate(
      { id: deleting.id },
      {
        onSuccess: () => { toast({ title: "User deleted" }); setDeleting(null); invalidate(); },
        onError: () => toast({ title: "Error deleting user", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-auto">
        <header className="sticky top-0 z-10 bg-background border-b border-border px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">Users</h1>
            <p className="text-sm text-muted-foreground">Manage platform users</p>
          </div>
        </header>

        <main className="flex-1 p-6">
          <div className="mb-5 relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-search-users"
            />
          </div>

          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
              </div>
            ) : !users?.length ? (
              <div className="p-16 text-center">
                <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No users found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">User</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Phone</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Role</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Joined</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map(u => (
                      <tr key={u.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-user-${u.id}`}>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <span className="text-xs font-bold text-primary">{u.name.charAt(0).toUpperCase()}</span>
                            </div>
                            <div>
                              <div className="font-medium text-foreground">{u.name}</div>
                              <div className="text-xs text-muted-foreground">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-3 text-muted-foreground">{u.phone ?? "—"}</td>
                        <td className="px-6 py-3">
                          <Badge
                            variant={u.role === "admin" ? "default" : "secondary"}
                            className="capitalize cursor-pointer select-none"
                            onClick={() => toggleRole({ id: u.id, role: u.role, name: u.name })}
                            data-testid={`badge-role-${u.id}`}
                          >
                            {u.role === "admin" ? <ShieldCheck className="w-3 h-3 mr-1" /> : <User className="w-3 h-3 mr-1" />}
                            {u.role}
                          </Badge>
                        </td>
                        <td className="px-6 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`}>
                            {u.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => toggleActive({ id: u.id, isActive: u.isActive, name: u.name })}
                              data-testid={`button-toggle-user-${u.id}`}
                            >
                              {u.isActive ? <ToggleRight className="w-4 h-4 text-green-500" /> : <ToggleLeft className="w-4 h-4 text-muted-foreground" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleting({ id: u.id, name: u.name })}
                              data-testid={`button-delete-user-${u.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>

      <AlertDialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleting?.name}"? All their orders will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
              data-testid="button-confirm-delete-user"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
