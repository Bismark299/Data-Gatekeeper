import { createContext, useContext, useState, type ReactNode } from "react";
import {
  useGetCart,
  useAddToCart,
  useRemoveFromCart,
  useClearCart,
  useCheckoutCart,
  getGetCartQueryKey,
  getGetWalletBalanceQueryKey,
  getListMyOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "./AuthContext";

interface CartContextType {
  open: boolean;
  setOpen: (v: boolean) => void;
  cartCount: number;
  isLoading: boolean;
  addItem: (bundleId: number, phoneNumber: string) => void;
  removeItem: (id: number) => void;
  clearItems: () => void;
  checkout: () => void;
  isCheckingOut: boolean;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: cart, isLoading } = useGetCart({ query: { enabled: isAuthenticated } });
  const addToCart = useAddToCart();
  const removeFromCart = useRemoveFromCart();
  const clearCart = useClearCart();
  const checkoutCart = useCheckoutCart();

  const invalidateCart = () => queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
  const cartCount = cart?.length ?? 0;

  const addItem = (bundleId: number, phoneNumber: string) => {
    addToCart.mutate(
      { data: { bundleId, phoneNumber } },
      {
        onSuccess: () => {
          toast({ title: "Added to cart" });
          invalidateCart();
          setOpen(true);
        },
        onError: (e: unknown) => {
          const msg = (e as { message?: string })?.message ?? "Failed to add to cart";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  };

  const removeItem = (id: number) => {
    removeFromCart.mutate({ id }, { onSuccess: () => invalidateCart() });
  };

  const clearItems = () => {
    clearCart.mutate(undefined, { onSuccess: () => invalidateCart() });
  };

  const checkout = () => {
    checkoutCart.mutate(undefined, {
      onSuccess: (result) => {
        toast({
          title: `Order placed! ${result.orders.length} bundle${result.orders.length > 1 ? "s" : ""} purchased.`,
          description: `GH₵${result.totalCharged.toFixed(2)} deducted. Balance: GH₵${result.remainingBalance.toFixed(2)}`,
        });
        invalidateCart();
        queryClient.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMyOrdersQueryKey() });
        setOpen(false);
      },
      onError: (e: unknown) => {
        const msg = (e as { message?: string })?.message ?? "Checkout failed";
        toast({ title: msg, variant: "destructive" });
      },
    });
  };

  return (
    <CartContext.Provider value={{
      open,
      setOpen,
      cartCount,
      isLoading,
      addItem,
      removeItem,
      clearItems,
      checkout,
      isCheckingOut: checkoutCart.isPending,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be inside CartProvider");
  return ctx;
}
