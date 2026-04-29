import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";

interface User {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isDealer: boolean;
  isAgent: boolean;
  signOut: () => void;
  refetchUser: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const logoutMutation = useLogout();

  const { data: user, isLoading, refetch } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      staleTime: 5 * 60 * 1000,
    },
  });

  // When any authenticated API call (except /auth/me itself) returns 401 it
  // means the session has expired. Clear the cache and send the user to login.
  const setLocationRef = useRef(setLocation);
  setLocationRef.current = setLocation;
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  useEffect(() => {
    const handler = () => {
      queryClientRef.current.clear();
      setLocationRef.current("/login");
    };
    window.addEventListener("auth:unauthorized", handler);
    return () => window.removeEventListener("auth:unauthorized", handler);
  }, []);

  const signOut = useCallback(() => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        setLocation("/login");
      },
    });
  }, [logoutMutation, queryClient, setLocation]);

  const refetchUser = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <AuthContext.Provider
      value={{
        user: (user as User) ?? null,
        isLoading,
        isAuthenticated: !!user,
        isAdmin: (user as User | undefined)?.role === "admin",
        isDealer: (user as User | undefined)?.role === "dealer",
        isAgent: (user as User | undefined)?.role === "agent",
        signOut,
        refetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
