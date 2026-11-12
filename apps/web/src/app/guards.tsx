import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../lib/useAuth';

function FullPageLoading() {
  return (
    <div className="fv-loading" role="status">
      Loading…
    </div>
  );
}

/** Signed-in users only. With `onboarded`, also requires a completed profile. */
export function RequireAuth({ onboarded, children }: { onboarded?: true; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (onboarded && !user.onboarded) return <Navigate to="/onboarding" replace />;
  return children;
}

/** Signed-out users only (login/register). */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoading />;
  if (user) return <Navigate to={user.onboarded ? '/' : '/onboarding'} replace />;
  return children;
}
