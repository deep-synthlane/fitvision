import { createContext, useContext } from 'react';
import type { LoginInput, PublicUser, RegisterInput } from '@fitvision/shared';

export interface AuthState {
  user: PublicUser | null;
  /** True until the initial session check finishes. */
  loading: boolean;
  login: (input: LoginInput) => Promise<PublicUser>;
  register: (input: RegisterInput) => Promise<PublicUser>;
  logout: () => Promise<void>;
  setUser: (user: PublicUser | null) => void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
