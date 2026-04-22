import React, { createContext, useContext, ReactNode } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { UserProfile } from "@workspace/api-client-react/src/generated/api.schemas";

type AuthContextType = {
  user: UserProfile | null;
  isLoading: boolean;
  isAdmin: boolean;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAdmin: false,
  isAuthenticated: false,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const { data: user, isLoading, error } = useGetMe({
    query: {
      retry: false,
    },
  });

  const isAuthenticated = !!user && !error;
  const isAdmin = isAuthenticated && user?.role === "admin";

  return (
    <AuthContext.Provider
      value={{
        user: user || null,
        isLoading,
        isAdmin,
        isAuthenticated,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
