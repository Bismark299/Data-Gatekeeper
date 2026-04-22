import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useGetWalletBalance } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Menu, X, Wifi, LogOut, ShieldCheck, ShoppingCart, Wallet, UserCircle } from "lucide-react";

export function Navbar() {
  const { isAuthenticated, isAdmin, user, signOut } = useAuth();
  const { cartCount, setOpen: setCartOpen } = useCart();
  const { data: wallet } = useGetWalletBalance({ query: { enabled: isAuthenticated } });
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-xl">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Wifi className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-foreground">DataBundle</span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            <Link href="/bundles">
              <Button variant={location === "/bundles" ? "secondary" : "ghost"} size="sm">Browse Plans</Button>
            </Link>
            {isAuthenticated && !isAdmin && (
              <>
                <Link href="/dashboard">
                  <Button variant={location === "/dashboard" ? "secondary" : "ghost"} size="sm">Dashboard</Button>
                </Link>
                <Link href="/orders">
                  <Button variant={location === "/orders" ? "secondary" : "ghost"} size="sm">My Orders</Button>
                </Link>
                <Link href="/profile">
                  <Button variant={location === "/profile" ? "secondary" : "ghost"} size="sm">
                    <UserCircle className="w-4 h-4 mr-1.5" />Profile
                  </Button>
                </Link>
              </>
            )}
            {isAdmin && (
              <Link href="/admin">
                <Button variant={location.startsWith("/admin") ? "secondary" : "ghost"} size="sm">
                  <ShieldCheck className="w-4 h-4 mr-1.5" />Admin
                </Button>
              </Link>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isAuthenticated && wallet !== undefined && (
              <Link href="/wallet" className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/15 transition-colors text-xs font-bold text-primary">
                <Wallet className="w-3.5 h-3.5" />
                GH₵{(wallet?.balance ?? 0).toFixed(2)}
              </Link>
            )}

            {isAuthenticated && (
              <Button
                variant="ghost"
                size="icon"
                className="relative"
                onClick={() => setCartOpen(true)}
                data-testid="button-open-cart"
              >
                <ShoppingCart className="w-5 h-5" />
                {cartCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold leading-none">
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </Button>
            )}

            {isAuthenticated ? (
              <Button
                variant="ghost"
                size="sm"
                className="hidden md:flex gap-1.5"
                onClick={signOut}
                data-testid="button-logout"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            ) : (
              <div className="hidden md:flex gap-2">
                <Link href="/login">
                  <Button variant="ghost" size="sm" data-testid="link-login">Login</Button>
                </Link>
                <Link href="/register">
                  <Button size="sm" data-testid="link-register">Get Started</Button>
                </Link>
              </div>
            )}

            <button
              className="md:hidden p-2 rounded-lg hover:bg-muted"
              onClick={() => setMenuOpen(!menuOpen)}
              data-testid="button-mobile-menu"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-border py-3 flex flex-col gap-1">
            <Link href="/bundles" onClick={() => setMenuOpen(false)}>
              <Button variant="ghost" className="w-full justify-start">Browse Plans</Button>
            </Link>
            {isAuthenticated && !isAdmin && (
              <>
                <Link href="/dashboard" onClick={() => setMenuOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start">Dashboard</Button>
                </Link>
                <Link href="/orders" onClick={() => setMenuOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start">My Orders</Button>
                </Link>
                <Link href="/wallet" onClick={() => setMenuOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start">
                    <Wallet className="w-4 h-4 mr-2" />
                    Wallet {wallet ? `(GH₵${wallet.balance.toFixed(2)})` : ""}
                  </Button>
                </Link>
                <Link href="/profile" onClick={() => setMenuOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start">
                    <UserCircle className="w-4 h-4 mr-2" />Profile
                  </Button>
                </Link>
              </>
            )}
            {isAdmin && (
              <Link href="/admin" onClick={() => setMenuOpen(false)}>
                <Button variant="ghost" className="w-full justify-start">
                  <ShieldCheck className="w-4 h-4 mr-2" />Admin Panel
                </Button>
              </Link>
            )}
            {isAuthenticated ? (
              <Button
                variant="ghost"
                className="w-full justify-start text-destructive"
                onClick={() => { signOut(); setMenuOpen(false); }}
              >
                <LogOut className="w-4 h-4 mr-2" />Sign Out
              </Button>
            ) : (
              <>
                <Link href="/login" onClick={() => setMenuOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start">Login</Button>
                </Link>
                <Link href="/register" onClick={() => setMenuOpen(false)}>
                  <Button className="w-full justify-start">Get Started</Button>
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
