import { useState } from "react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { User, Lock, Save } from "lucide-react";

async function patchMe(body: Record<string, string>) {
  const res = await fetch("/api/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to update profile");
  return data;
}

export default function Profile() {
  return (
    <ProtectedRoute>
      <ProfileContent />
    </ProtectedRoute>
  );
}

function ProfileContent() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const handleSaveInfo = async () => {
    if (!name.trim() && phone === "") return;
    setSavingInfo(true);
    try {
      const body: Record<string, string> = {};
      if (name.trim()) body.name = name.trim();
      if (phone !== "") body.phone = phone;
      await patchMe(body);
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "Profile updated" });
      setName("");
      setPhone("");
    } catch (e: unknown) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingInfo(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) return;
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setSavingPassword(true);
    try {
      await patchMe({ currentPassword, newPassword });
      toast({ title: "Password updated successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e: unknown) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingPassword(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-12 space-y-4">
          <div className="h-48 rounded-2xl bg-muted animate-pulse" />
          <div className="h-64 rounded-2xl bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <div className="mb-2">
          <h1 className="text-2xl font-bold text-foreground">My Profile</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your account details</p>
        </div>

        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Personal Information</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm mb-4 p-4 bg-muted/30 rounded-xl">
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Current Name</div>
                <div className="font-medium text-foreground">{user?.name}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Email</div>
                <div className="font-medium text-foreground">{user?.email}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Phone</div>
                <div className="font-medium text-foreground">{user?.phone ?? "Not set"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Account Type</div>
                <div className="font-medium text-foreground capitalize">{user?.role}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground mb-0.5">Reference Code</div>
                {user?.depositCode ? (
                  <span className="font-mono text-sm font-bold text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-lg">{user.depositCode}</span>
                ) : (
                  <div className="font-medium text-muted-foreground">—</div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>New Name</Label>
              <Input
                placeholder={user?.name ?? "Enter your name"}
                value={name}
                onChange={e => setName(e.target.value)}
                data-testid="input-profile-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone Number</Label>
              <Input
                placeholder={user?.phone ?? "0244xxxxxx"}
                value={phone}
                onChange={e => setPhone(e.target.value)}
                data-testid="input-profile-phone"
              />
            </div>
            <Button
              onClick={handleSaveInfo}
              disabled={savingInfo || (!name.trim() && phone === "")}
              className="gap-2"
              data-testid="button-save-profile"
            >
              <Save className="w-4 h-4" />
              {savingInfo ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Change Password</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="space-y-1.5">
              <Label>Current Password</Label>
              <Input
                type="password"
                placeholder="Enter current password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                data-testid="input-current-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>New Password</Label>
              <Input
                type="password"
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm New Password</Label>
              <Input
                type="password"
                placeholder="Repeat new password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                data-testid="input-confirm-password"
              />
            </div>
            <Button
              onClick={handleChangePassword}
              disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
              variant="outline"
              className="gap-2"
              data-testid="button-change-password"
            >
              <Lock className="w-4 h-4" />
              {savingPassword ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
