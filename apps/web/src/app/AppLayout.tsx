import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { Button } from '../design';
import { useAuth } from '../lib/useAuth';

export function AppLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function onLogout() {
    setSigningOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="fv-shell">
      <a className="fv-skip" href="#main">
        Skip to main content
      </a>
      <header className="fv-topbar">
        <Link to="/" className="fv-brand">
          <img src="/favicon.svg" alt="" />
          FitVision
        </Link>
        <nav className="fv-nav" aria-label="Main">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/avatar">Avatar</NavLink>
          <NavLink to="/wardrobe">Wardrobe</NavLink>
          <NavLink to="/profile">Profile</NavLink>
        </nav>
        <Button variant="ghost" onClick={onLogout} loading={signingOut}>
          Sign out
        </Button>
      </header>
      <main className="fv-main" id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="fv-footer">
        <Link to="/privacy">Privacy & your data</Link>
        <span className="fv-muted">Measurements, avatars, try-ons and sizes are estimates.</span>
      </footer>
    </div>
  );
}
