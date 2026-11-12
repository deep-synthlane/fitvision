import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { DATA_KIND_LABELS, type DataKind } from '@fitvision/shared';
import { Alert, Button, Card, TextField } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';

const EXPLANATIONS: { title: string; body: string[] }[] = [
  {
    title: 'Body scan',
    body: [
      'Your camera photos are analysed in your browser to estimate measurements. When you save a scan, the front, side and optional back photos and the estimates are stored privately in your account.',
      'Estimates are approximate and uncalibrated — you review and correct every value before it’s saved. You can delete scan photos at any time; your saved measurements are kept unless you delete them too.',
    ],
  },
  {
    title: 'Avatar',
    body: ['Your avatar is a simple 3D mannequin generated from your measurements (a parametric model). It is not built from your photos and is not an exact reconstruction of your body.'],
  },
  {
    title: 'Virtual try-on',
    body: [
      'Try-on photos and results are stored privately in your account. When a third-party AI service is used to generate a preview, your photo and the garment image are sent to that service — you’ll be asked to confirm each time before anything is sent.',
      'If you choose “Use my avatar”, FitVision makes a front-view image of your avatar and uses it instead of a photo. It is stored with your try-on photos and deleted when you delete your avatar.',
      'Previews are visual approximations only; they don’t show whether a size fits.',
    ],
  },
  {
    title: 'Product imports',
    body: ['When you paste a link, FitVision’s server retrieves that public product page from the store’s website (once, without your cookies) to read the product details and images you choose to keep.'],
  },
  {
    title: 'Size recommendations and feedback',
    body: ['Recommendations are calculated from your measurements and the product’s size chart. Fit feedback is stored with your account and analysed in aggregate to improve future versions.'],
  },
  {
    title: 'Usage analytics',
    body: ['We record which features are used (for example “try-on started”) under a pseudonymous id. Measurements, photos, product links and your name or email are never included.'],
  },
];

export function PrivacyPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();

  async function deleteKind(kind: DataKind) {
    if (!window.confirm(`Delete all your ${DATA_KIND_LABELS[kind].split(' (')[0]!.toLowerCase()}? This can’t be undone.`)) return;
    setBusy(kind);
    setStatus(null);
    try {
      await apiFetch(`/account/data/${kind}`, { method: 'DELETE' });
      setStatus({ tone: 'info', text: `${DATA_KIND_LABELS[kind].split(' (')[0]} deleted.` });
    } catch (err) {
      setStatus({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not delete' });
    } finally {
      setBusy(null);
    }
  }

  async function signOutEverywhere() {
    setBusy('logout-all');
    try {
      await apiFetch('/auth/logout-all', { method: 'POST' });
      navigate('/login', { replace: true });
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    if (!password) {
      setPasswordError('Enter your password to confirm');
      return;
    }
    if (!window.confirm('Delete your FitVision account and all of its data permanently?')) return;
    setBusy('account');
    setPasswordError(undefined);
    try {
      await apiFetch('/account', { method: 'DELETE', body: { password } });
      // The goodbye page clears the signed-in user once this guarded page has unmounted.
      navigate('/goodbye', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_PASSWORD') setPasswordError('Incorrect password');
      else setStatus({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not delete your account' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fv-page fv-page--narrow">
      <header>
        <h1>Privacy & your data</h1>
        <p className="fv-muted">What FitVision stores, who processes it, and how to delete it.</p>
      </header>

      <section className="fv-stack" aria-labelledby="how-heading">
        <h2 id="how-heading">How your data is used</h2>
        {EXPLANATIONS.map((x) => (
          <Card key={x.title} className="fv-stack">
            <h3>{x.title}</h3>
            {x.body.map((p) => (
              <p key={p} className="fv-small">
                {p}
              </p>
            ))}
          </Card>
        ))}
      </section>

      <section className="fv-stack" aria-labelledby="delete-heading">
        <h2 id="delete-heading">Delete your data</h2>
        {status && <Alert tone={status.tone}>{status.text}</Alert>}
        <Card>
          <ul className="fv-data-list">
            {(Object.keys(DATA_KIND_LABELS) as DataKind[]).map((kind) => (
              <li key={kind}>
                <span>{DATA_KIND_LABELS[kind]}</span>
                <Button variant="secondary" className="fv-btn--sm" onClick={() => deleteKind(kind)} loading={busy === kind}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="fv-stack" aria-labelledby="account-heading">
        <h2 id="account-heading">Account</h2>
        <Card className="fv-stack">
          <div className="fv-section-head">
            <p className="fv-small">Sign out on every device where you’re signed in.</p>
            <Button variant="secondary" onClick={signOutEverywhere} loading={busy === 'logout-all'}>
              Sign out everywhere
            </Button>
          </div>
        </Card>
        <Card>
          <form className="fv-stack" onSubmit={deleteAccount} noValidate aria-labelledby="delete-account-heading">
            <h3 id="delete-account-heading">Delete account</h3>
            <p className="fv-small">
              Permanently deletes your account, profile, measurements, scans and photos, avatar, clothing, try-ons, saved looks, size
              recommendations and feedback, and every stored image. Your pseudonymous usage events are deleted too.
            </p>
            <TextField label="Confirm with your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={passwordError} />
            <div>
              <Button type="submit" className="fv-btn--danger" loading={busy === 'account'}>
                Delete my account
              </Button>
            </div>
          </form>
        </Card>
      </section>
    </div>
  );
}
