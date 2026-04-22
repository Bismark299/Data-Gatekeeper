import { useState } from "react";
import { useListBundles, useCreateBundle, useUpdateBundle, useDeleteBundle } from "@workspace/api-client-react";
import { getListBundlesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Menu, Package, ToggleLeft, ToggleRight } from "lucide-react";

const bundleSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(5),
  dataAmount: z.string().min(1),
  validityDays: z.coerce.number().int().positive(),
  price: z.coerce.number().positive(),
  category: z.string().min(1),
});

type BundleForm = z.infer<typeof bundleSchema>;

interface Bundle {
  id: number;
  name: string;
  description: string;
  dataAmount: string;
  validityDays: number;
  price: number;
  category: string;
  isActive: boolean;
}

export default function AdminBundles() {
  return (
    <ProtectedRoute adminOnly>
      <AdminBundlesContent />
    </ProtectedRoute>
  );
}

function AdminBundlesContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Bundle | null>(null);
  const [deleting, setDeleting] = useState<Bundle | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: bundles, isLoading } = useListBundles({});
  const createBundle = useCreateBundle();
  const updateBundle = useUpdateBundle();
  const deleteBundle = useDeleteBundle();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListBundlesQueryKey({}) });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<BundleForm>({
    resolver: zodResolver(bundleSchema),
  });

  const openCreate = () => { setEditing(null); reset({}); setShowForm(true); };
  const openEdit = (b: Bundle) => {
    setEditing(b);
    reset({ name: b.name, description: b.description, dataAmount: b.dataAmount, validityDays: b.validityDays, price: b.price, category: b.category });
    setShowForm(true);
  };

  const onSubmit = (data: BundleForm) => {
    if (editing) {
      updateBundle.mutate(
        { id: editing.id, data },
        {
          onSuccess: () => { toast({ title: "Bundle updated" }); setShowForm(false); invalidate(); },
          onError: () => toast({ title: "Error", variant: "destructive" }),
        }
      );
    } else {
      createBundle.mutate(
        { data },
        {
          onSuccess: () => { toast({ title: "Bundle created" }); setShowForm(false); invalidate(); },
          onError: () => toast({ title: "Error", variant: "destructive" }),
        }
      );
    }
  };

  const toggleActive = (b: Bundle) => {
    updateBundle.mutate(
      { id: b.id, data: { isActive: !b.isActive } },
      {
        onSuccess: () => { toast({ title: `Bundle ${b.isActive ? "deactivated" : "activated"}` }); invalidate(); },
      }
    );
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteBundle.mutate(
      { id: deleting.id },
      {
        onSuccess: () => { toast({ title: "Bundle deleted" }); setDeleting(null); invalidate(); },
        onError: () => toast({ title: "Error", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-auto">
        <header className="sticky top-0 z-10 bg-background border-b border-border px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">Bundles</h1>
              <p className="text-sm text-muted-foreground">Manage data bundle plans</p>
            </div>
          </div>
          <Button onClick={openCreate} className="gap-2" data-testid="button-create-bundle">
            <Plus className="w-4 h-4" />New Bundle
          </Button>
        </header>

        <main className="flex-1 p-6">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 rounded-2xl bg-muted animate-pulse" />)}
            </div>
          ) : !bundles?.length ? (
            <div className="bg-card border border-border rounded-2xl p-16 text-center">
              <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No bundles yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {bundles.map(bundle => (
                <div key={bundle.id} className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-3" data-testid={`card-bundle-${bundle.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="capitalize text-xs">{bundle.category}</Badge>
                        {!bundle.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                      </div>
                      <h3 className="font-semibold text-foreground">{bundle.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{bundle.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold text-foreground">${bundle.price}</div>
                      <div className="text-xs text-muted-foreground">{bundle.dataAmount}</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">Validity: {bundle.validityDays} days</div>
                  <div className="flex items-center gap-2 mt-auto pt-2 border-t border-border">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => toggleActive(bundle as Bundle)}
                      data-testid={`button-toggle-${bundle.id}`}
                    >
                      {bundle.isActive ? <ToggleRight className="w-4 h-4 text-green-500" /> : <ToggleLeft className="w-4 h-4 text-muted-foreground" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(bundle as Bundle)} data-testid={`button-edit-${bundle.id}`}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleting(bundle as Bundle)}
                      data-testid={`button-delete-${bundle.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Bundle" : "Create Bundle"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input {...register("name")} placeholder="Weekly Pro" data-testid="input-bundle-name" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input {...register("description")} placeholder="Power through your week" data-testid="input-bundle-desc" />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data Amount</Label>
                <Input {...register("dataAmount")} placeholder="5GB" data-testid="input-data-amount" />
                {errors.dataAmount && <p className="text-xs text-destructive">{errors.dataAmount.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Validity (days)</Label>
                <Input type="number" {...register("validityDays")} placeholder="7" data-testid="input-validity-days" />
                {errors.validityDays && <p className="text-xs text-destructive">{errors.validityDays.message}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Price ($)</Label>
                <Input type="number" step="0.01" {...register("price")} placeholder="9.99" data-testid="input-price" />
                {errors.price && <p className="text-xs text-destructive">{errors.price.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Input {...register("category")} placeholder="weekly" data-testid="input-category" />
                {errors.category && <p className="text-xs text-destructive">{errors.category.message}</p>}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={createBundle.isPending || updateBundle.isPending} data-testid="button-save-bundle">
                {editing ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={v => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Bundle</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleting?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
