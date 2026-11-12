import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="fv-auth">
      <div className="fv-stack fv-center">
        <h1>Page not found</h1>
        <p className="fv-muted">That page doesn’t exist.</p>
        <Link to="/">Go to dashboard</Link>
      </div>
    </div>
  );
}
