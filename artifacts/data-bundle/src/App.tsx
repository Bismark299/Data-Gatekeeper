import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { CartDrawer } from "@/components/CartDrawer";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Bundles from "@/pages/bundles";
import Dashboard from "@/pages/dashboard";
import Orders from "@/pages/orders";
import WalletPage from "@/pages/wallet";
import AdminDashboard from "@/pages/admin/index";
import AdminBundles from "@/pages/admin/bundles";
import AdminUsers from "@/pages/admin/users";
import AdminOrders from "@/pages/admin/orders";
import AdminWallets from "@/pages/admin/wallets";
import AdminDeposits from "@/pages/admin/deposits";
import AdminStats from "@/pages/admin/stats";
import AdminStores from "@/pages/admin/stores";
import AdminAgentDetail from "@/pages/admin/agent-detail";
import AdminSettings from "@/pages/admin/settings";
import Shop from "@/pages/shop";
import StoreManager from "@/pages/store-manager";
import PublicStore from "@/pages/public-store";
import Profile from "@/pages/profile";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { CheckoutSuccessDialog } from "@/components/CheckoutSuccessDialog";
import { useCart } from "@/context/CartContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
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
    <Switch>
      <Route path="/">{() => <Redirect to="/dashboard" />}</Route>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/bundles" component={Bundles} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/orders" component={Orders} />
      <Route path="/wallet" component={WalletPage} />
      <Route path="/profile" component={Profile} />
      <Route path="/admin">{() => <ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>}</Route>
      <Route path="/admin/bundles">{() => <ProtectedRoute adminOnly><AdminBundles /></ProtectedRoute>}</Route>
      <Route path="/admin/users">{() => <ProtectedRoute adminOnly><AdminUsers /></ProtectedRoute>}</Route>
      <Route path="/admin/orders">{() => <ProtectedRoute adminOnly><AdminOrders /></ProtectedRoute>}</Route>
      <Route path="/admin/wallets">{() => <ProtectedRoute adminOnly><AdminWallets /></ProtectedRoute>}</Route>
      <Route path="/admin/deposits">{() => <ProtectedRoute adminOnly><AdminDeposits /></ProtectedRoute>}</Route>
      <Route path="/admin/stats">{() => <ProtectedRoute adminOnly><AdminStats /></ProtectedRoute>}</Route>
      <Route path="/admin/stores">{() => <ProtectedRoute adminOnly><AdminStores /></ProtectedRoute>}</Route>
      <Route path="/admin/agents/:userId">{(params) => <ProtectedRoute adminOnly><AdminAgentDetail /></ProtectedRoute>}</Route>
      <Route path="/admin/settings">{() => <ProtectedRoute adminOnly><AdminSettings /></ProtectedRoute>}</Route>
      <Route path="/shop" component={Shop} />
      <Route path="/store-manager" component={StoreManager} />
      <Route path="/s/:slug" component={PublicStore} />
      <Route component={NotFound} />
    </Switch>
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
    </QueryClientProvider>
  );
}

export default App;
