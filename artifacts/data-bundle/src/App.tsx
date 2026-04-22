import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { CartDrawer } from "@/components/CartDrawer";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
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
import Profile from "@/pages/profile";
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
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/bundles" component={Bundles} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/orders" component={Orders} />
      <Route path="/wallet" component={WalletPage} />
      <Route path="/profile" component={Profile} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/bundles" component={AdminBundles} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/orders" component={AdminOrders} />
      <Route path="/admin/wallets" component={AdminWallets} />
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
