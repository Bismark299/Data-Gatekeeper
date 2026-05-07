import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Package, Users, ShoppingCart, LogOut, Wifi, ChevronRight, X,
  Wallet, ArrowDownCircle, BarChart3, Store, Settings, Zap, Loader2,
} from "lucide-react";

const navItems = [
  { href: "/admin",           icon: LayoutDashboard, label: "Dashboard" },
  { href: "/admin/bundles",   icon: Package,         label: "Bundles" },
  { href: "/admin/users",     icon: Users,           label: "Users" },
  { href: "/admin/orders",    icon: ShoppingCart,    label: "Orders" },
  { href: "/admin/stores",    icon: Store,           label: "Stores" },
  { href: "/admin/wallets",   icon: Wallet,          label: "Wallets" },
  { href: "/admin/deposits",  icon: ArrowDownCircle, label: "Deposits" },
  { href: "/admin/stats",     icon: BarChart3,       label: "Statistics" },
  { href: "/admin/settings",  icon: Settings,        label: "Settings" },
];

interface AdminSidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function AdminSidebar({ open, onClose }: AdminSidebarProps) {
  const [location] = useLocation();
  const { user, signOut } = useAuth();

  const { data: mcbisBalance, isLoading: balanceLoading, error: balanceError } = useQuery<number | null>({
    queryKey: ["mcbis-balance-sidebar"],
    queryFn: async () => {
      const r = await fetch("/api/admin/mcbis/balance", { credentials: "include" });
      const d = await r.json() as { balance?: number; error?: string };
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      return d.balance ?? null;
    },
    refetchInterval: 30_000,
    staleTime: 0,
    retry: false,
  });

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-6 py-5 border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-lg">
          <div className="w-7 h-7 rounded-md bg-sidebar-primary flex items-center justify-center">
            <Wifi className="w-3.5 h-3.5 text-sidebar-primary-foreground" />
          </div>
          <span>DataBundle</span>
        </Link>
        {onClose && (
          <button onClick={onClose} className="lg:hidden p-1 rounded hover:bg-sidebar-accent">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="px-4 py-3 border-b border-sidebar-border">
        <div className="text-xs font-semibold text-sidebar-foreground/40 uppercase tracking-wider mb-1">Admin Panel</div>
      </div>

      {/* McbisSolution live wallet balance */}
      <div className="mx-3 mt-3 mb-1 rounded-xl bg-sidebar-accent/50 border border-sidebar-border px-3 py-2.5 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-sky-500/15 flex items-center justify-center shrink-0">
          <Zap className="w-3.5 h-3.5 text-sky-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-wider leading-none mb-0.5">McbisSolution</div>
          {balanceLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-sidebar-foreground/40" />
          ) : balanceError ? (
            <div className="text-xs text-red-400" title={(balanceError as Error).message}>Error: {(balanceError as Error).message.slice(0, 40)}</div>
          ) : mcbisBalance == null ? (
            <div className="text-xs text-sidebar-foreground/40">Unavailable</div>
          ) : (
            <div className="text-sm font-bold text-sky-500">GH₵{mcbisBalance.toFixed(2)}</div>
          )}
        </div>
        <div className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" title="Live" />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = item.href === "/admin"
            ? location === "/admin"
            : location.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} onClick={onClose}>
              <div
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
                {isActive && <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded-lg bg-sidebar-accent/40">
          <div className="w-7 h-7 rounded-full bg-sidebar-primary flex items-center justify-center text-xs font-bold text-sidebar-primary-foreground">
            {user?.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-sidebar-foreground truncate">{user?.name}</div>
            <div className="text-xs text-sidebar-foreground/50 truncate">{user?.email}</div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sidebar-foreground/60 hover:text-destructive hover:bg-destructive/10"
          onClick={signOut}
          data-testid="button-admin-logout"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:flex w-64 shrink-0 h-screen sticky top-0 flex-col border-r border-sidebar-border">
        <SidebarContent />
      </aside>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50" onClick={onClose} />
          <aside className="relative w-64 h-full flex flex-col shadow-2xl z-10">
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  );
}
