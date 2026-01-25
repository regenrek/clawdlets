import * as React from "react";

type AuthState = {
  authDisabled: boolean;
};

const AuthStateContext = React.createContext<AuthState | null>(null);

export function AuthStateProvider({
  value,
  children,
}: {
  value: AuthState;
  children: React.ReactNode;
}) {
  return <AuthStateContext.Provider value={value}>{children}</AuthStateContext.Provider>;
}

export function useAuthState(): AuthState {
  const ctx = React.useContext(AuthStateContext);
  if (!ctx) throw new Error("AuthStateProvider missing");
  return ctx;
}

