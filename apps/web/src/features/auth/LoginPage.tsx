import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { loginSchema } from '@fitvision/shared';
import { Alert, Button, Card, TextField } from '../../design';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/useAuth';
import { validate } from '../../lib/forms';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const result = validate(loginSchema, { email, password });
    if (!result.data) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const user = await login(result.data);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(user.onboarded ? (from ?? '/') : '/onboarding', { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fv-auth">
      <Card className="fv-auth__card">
        <form className="fv-stack" onSubmit={onSubmit} noValidate aria-labelledby="login-title">
          <div>
            <h1 id="login-title">Welcome back</h1>
            <p className="fv-muted">Sign in to see how clothes fit you.</p>
          </div>
          {formError && <Alert tone="error">{formError}</Alert>}
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <Button type="submit" block loading={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="fv-muted fv-center">
            New to FitVision? <Link to="/register">Create an account</Link>
          </p>
        </form>
      </Card>
    </div>
  );
}
