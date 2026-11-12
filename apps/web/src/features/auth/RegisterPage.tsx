import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { registerSchema } from '@fitvision/shared';
import { Alert, Button, Card, TextField } from '../../design';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/useAuth';
import { validate } from '../../lib/forms';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const result = validate(registerSchema, { name, email, password });
    if (!result.data) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await register(result.data);
      navigate('/onboarding', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        if (Object.keys(err.fields).length === 0) setFormError(err.message);
      } else setFormError('Sign up failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fv-auth">
      <Card className="fv-auth__card">
        <form className="fv-stack" onSubmit={onSubmit} noValidate aria-labelledby="register-title">
          <div>
            <h1 id="register-title">Create your account</h1>
            <p className="fv-muted">Try clothes on virtually and find your size before you buy.</p>
          </div>
          {formError && <Alert tone="error">{formError}</Alert>}
          <TextField label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
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
            autoComplete="new-password"
            hint="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <Button type="submit" block loading={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
          <p className="fv-muted fv-center">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </Card>
    </div>
  );
}
