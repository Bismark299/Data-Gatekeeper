import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { CartDrawer } from "@/components/CartDrawer";
import { CheckoutSuccessDialog } from "@/components/CheckoutSuccessDialog";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useCart } from "@/context/CartContext";

// ── Lazy-loaded pages (each becomes its own JS chunk, loaded only when visited) ─
const NotFound       = lazy(() => import("@/pages/not-found"));
const Login          = lazy(() => import("@/pages/login"));
const Register       = lazy(() => import("@/pages/register"));
const Bundles        = lazy(() => import("@/pages/bundles"));
const Dashboard      = lazy(() => import("@/pages/dashboard"));
const Orders         = lazy(() => import("@/pages/orders"));
const WalletPage     = lazy(() => import("@/pages/wallet"));
const Profile        = lazy(() => import("@/pages/profile"));
const Shop           = lazy(() => import("@/pages/shop"));
const StoreManager   = lazy(() => import("@/pages/store-manager"));
const PublicStore    = lazy(() => import("@/pages/public-store"));

const AdminDashboard  = lazy(() => import("@/pages/admin/index"));
const AdminBundles    = lazy(() => import("@/pages/admin/bundles"));
const AdminUsers      = lazy(() => import("@/pages/admin/users"));
const AdminOrders     = lazy(() => import("@/pages/admin/orders"));
const AdminWallets    = lazy(() => import("@/pages/admin/wallets"));
const AdminDeposits   = lazy(() => import("@/pages/admin/deposits"));
const AdminStats      = lazy(() => import("@/pages/admin/stats"));
const AdminReport     = lazy(() => import("@/pages/admin/report"));
const AdminStores     = lazy(() => import("@/pages/admin/stores"));
const AdminAgentDetail = lazy(() => import("@/pages/admin/agent-detail"));
const AdminSettings   = lazy(() => import("@/pages/admin/settings"));
const AdminMomo       = lazy(() => import("@/pages/admin/momo"));
const AdminTopupgh    = lazy(() => import("@/pages/admin/topupgh"));
const AdminApiClients = lazy(() => import("@/pages/admin/api-clients"));

// ── Minimal page-level loading indicator ────────────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <span className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,           // data stays fresh 30 s — avoids redundant refetches on navigation
      gcTime: 10 * 60 * 1000,     // keep unused cache for 10 min so revisiting a page is instant
      refetchOnWindowFocus: false, // don't silently refetch everything when the user alt-tabs back
      retry: (failureCount, error: unknown) => {
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403) return false;
        return failureCount < 2;
      },
    },
  },
});

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/">{() => <Redirect to="/login" />}</Route>
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/bundles">{() => <ProtectedRoute><Bundles /></ProtectedRoute>}</Route>
        <Route path="/dashboard">{() => <ProtectedRoute><Dashboard /></ProtectedRoute>}</Route>
        <Route path="/orders">{() => <ProtectedRoute><Orders /></ProtectedRoute>}</Route>
        <Route path="/wallet">{() => <ProtectedRoute><WalletPage /></ProtectedRoute>}</Route>
        <Route path="/profile">{() => <ProtectedRoute><Profile /></ProtectedRoute>}</Route>
        <Route path="/admin">{() => <ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>}</Route>
        <Route path="/admin/bundles">{() => <ProtectedRoute adminOnly><AdminBundles /></ProtectedRoute>}</Route>
        <Route path="/admin/users">{() => <ProtectedRoute adminOnly><AdminUsers /></ProtectedRoute>}</Route>
        <Route path="/admin/orders">{() => <ProtectedRoute adminOnly><AdminOrders /></ProtectedRoute>}</Route>
        <Route path="/admin/wallets">{() => <ProtectedRoute adminOnly><AdminWallets /></ProtectedRoute>}</Route>
        <Route path="/admin/deposits">{() => <ProtectedRoute adminOnly><AdminDeposits /></ProtectedRoute>}</Route>
        <Route path="/admin/stats">{() => <ProtectedRoute adminOnly><AdminStats /></ProtectedRoute>}</Route>
        <Route path="/admin/report">{() => <ProtectedRoute adminOnly><AdminReport /></ProtectedRoute>}</Route>
        <Route path="/admin/stores">{() => <ProtectedRoute adminOnly><AdminStores /></ProtectedRoute>}</Route>
        <Route path="/admin/agents/:userId">{() => <ProtectedRoute adminOnly><AdminAgentDetail /></ProtectedRoute>}</Route>
        <Route path="/admin/settings">{() => <ProtectedRoute adminOnly><AdminSettings /></ProtectedRoute>}</Route>
        <Route path="/admin/momo">{() => <ProtectedRoute adminOnly><AdminMomo /></ProtectedRoute>}</Route>
        <Route path="/admin/topupgh">{() => <ProtectedRoute adminOnly><AdminTopupgh /></ProtectedRoute>}</Route>
        <Route path="/admin/api-clients">{() => <ProtectedRoute adminOnly><AdminApiClients /></ProtectedRoute>}</Route>
        <Route path="/shop">{() => <ProtectedRoute><Shop /></ProtectedRoute>}</Route>
        <Route path="/store-manager">{() => <ProtectedRoute><StoreManager /></ProtectedRoute>}</Route>
        <Route path="/s/:slug" component={PublicStore} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function CartOverlays() {
  const { checkoutResult, clearCheckoutResult } = useCart();
  return (
    <>
      <CartDrawer />
      <CheckoutSuccessDialog result={checkoutResult} onClose={clearCheckoutResult} />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <CartProvider>
                <Router />
                <CartOverlays />
              </CartProvider>
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
