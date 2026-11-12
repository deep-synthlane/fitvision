import { useEffect } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../lib/useAuth';

/**
 * Shown after account deletion. It sits outside the auth guards and clears the signed-in user on
 * mount, so the guard can't redirect to /login before this confirmation appears.
 */
export function AccountDeletedPage() {
  const { setUser } = useAuth();
  useEffect(() => setUser(null), [setUser]);
  return (
    <div className="fv-auth">
      <main id="main" className="fv-stack fv-center">
        <h1>Your account has been deleted</h1>
        <p className="fv-muted">Your profile, measurements, scans, avatar, clothing, try-ons and saved looks have been permanently removed.</p>
        <Link to="/register">Create a new account</Link>
      </main>
    </div>
  );
}
