import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  AVATAR_DISCLAIMER,
  AVATAR_MEASUREMENTS,
  AVATAR_VIEWS,
  BODY_MEASUREMENTS,
  formatHeight,
  formatLength,
  type Avatar,
  type AvatarResponse,
  type AvatarView,
  type MeasurementUnit,
  type ProfileResponse,
} from '@fitvision/shared';
import { Alert, Badge, Button, Card } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';
import { AvatarViewer } from './AvatarViewer';
import './avatar.css';

const POLL_MS = 1000;
const LABEL = Object.fromEntries(BODY_MEASUREMENTS.map((m) => [m.key, m.label])) as Record<string, string>;
const VIEW_LABEL: Record<AvatarView, string> = { front: 'Front', side: 'Side', back: 'Back' };
const STATUS_TEXT = { pending: 'Queued…', processing: 'Building your avatar…' } as const;

export function AvatarPage() {
  const [data, setData] = useState<AvatarResponse | null>(null);
  const [unit, setUnit] = useState<MeasurementUnit>('metric');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<AvatarView>('front');
  const [autoRotate, setAutoRotate] = useState(false);
  const [fallback, setFallback] = useState<'webgl' | 'load' | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<AvatarResponse>('/avatars/current'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your avatar');
    }
  }, []);

  useEffect(() => {
    void load();
    apiFetch<ProfileResponse>('/profile')
      .then((p) => p.profile && setUnit(p.profile.measurementUnit))
      .catch(() => {});
  }, [load]);

  const status = data?.avatar?.status;
  useEffect(() => {
    if (status !== 'pending' && status !== 'processing') return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [status, load]);

  async function generate() {
    setBusy(true);
    setError(null);
    setFallback(null);
    try {
      const res = await apiFetch<{ avatar: Avatar }>('/avatars', { method: 'POST' });
      setData((d) => ({ canGenerate: true, outdated: false, ...d, avatar: res.avatar }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start avatar generation');
    } finally {
      setBusy(false);
    }
  }

  async function remove(avatar: Avatar) {
    if (!window.confirm('Delete your avatar? You can generate a new one at any time.')) return;
    setBusy(true);
    try {
      await apiFetch(`/avatars/${avatar.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the avatar');
    } finally {
      setBusy(false);
    }
  }

  const avatar = data?.avatar ?? null;

  return (
    <div className="fv-page">
      <header className="fv-section-head">
        <div>
          <h1>My avatar</h1>
          <p className="fv-muted">A 3D mannequin shaped from your confirmed measurements.</p>
        </div>
        {avatar?.status === 'ready' && <Badge>Approximate · parametric model</Badge>}
      </header>

      <Alert tone="warning">{AVATAR_DISCLAIMER}</Alert>
      {error && <Alert tone="error">{error}</Alert>}
      {!data && !error && <p className="fv-muted">Loading…</p>}

      {data && !avatar && (
        <Card className="fv-stack">
          {data.canGenerate ? (
            <>
              <h2>Create your avatar</h2>
              <p className="fv-muted">
                We’ll build a 3D mannequin from your latest saved measurements. Any measurement you haven’t provided uses a
                typical proportion for your height, and we’ll show which ones.
              </p>
              <div>
                <Button onClick={generate} loading={busy}>
                  Create my avatar
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2>Add your measurements first</h2>
              <p className="fv-muted">Your avatar is built from your measurements. Take a body scan or enter them in your profile.</p>
              <div className="fv-actions fv-actions--start">
                <Link className="fv-btn fv-btn--primary" to="/scan">
                  Start body scan
                </Link>
                <Link className="fv-btn fv-btn--secondary" to="/profile">
                  Enter measurements
                </Link>
              </div>
            </>
          )}
        </Card>
      )}

      {(avatar?.status === 'pending' || avatar?.status === 'processing') && (
        <Card className="fv-stack">
          <h2>Generating avatar</h2>
          <p role="status" aria-live="polite">
            <span className="fv-spinner" aria-hidden="true" /> {STATUS_TEXT[avatar.status]}{' '}
            <span className="fv-muted">({avatar.status})</span>
          </p>
        </Card>
      )}

      {avatar?.status === 'failed' && (
        <Card className="fv-stack">
          <h2>Avatar generation failed</h2>
          <Alert tone="error">{avatar.error ?? 'Something went wrong.'}</Alert>
          <div>
            <Button onClick={generate} loading={busy}>
              Try again
            </Button>
          </div>
        </Card>
      )}

      {avatar?.status === 'ready' && avatar.parameters && (
        <>
          {data?.outdated && (
            <Alert tone="warning">
              Your measurements have changed since this avatar was created.{' '}
              <Button variant="secondary" onClick={generate} loading={busy}>
                Regenerate avatar
              </Button>
            </Alert>
          )}
          <div className="fv-avatar-layout">
            <Card className="fv-stack">
              <div className="fv-avatar-stage">
                {fallback || !avatar.assetUrl ? (
                  <img className="fv-avatar-fallback" src={avatar.previewUrl ?? ''} alt="Avatar front view" />
                ) : (
                  <AvatarViewer assetUrl={avatar.assetUrl} view={view} autoRotate={autoRotate} onError={setFallback} />
                )}
              </div>
              {fallback ? (
                <p className="fv-muted fv-small">
                  {fallback === 'webgl'
                    ? '3D preview isn’t available on this device, so a front view is shown.'
                    : 'The 3D model couldn’t be loaded, so a front view is shown.'}
                </p>
              ) : (
                <div className="fv-actions fv-actions--start" role="group" aria-label="Avatar view">
                  {AVATAR_VIEWS.map((v) => (
                    <Button
                      key={v}
                      variant={view === v && !autoRotate ? 'primary' : 'secondary'}
                      aria-pressed={view === v && !autoRotate}
                      onClick={() => {
                        setAutoRotate(false);
                        setView(v);
                      }}
                    >
                      {VIEW_LABEL[v]}
                    </Button>
                  ))}
                  <Button variant={autoRotate ? 'primary' : 'secondary'} aria-pressed={autoRotate} onClick={() => setAutoRotate((a) => !a)}>
                    360° rotate
                  </Button>
                </div>
              )}
              {!fallback && <p className="fv-muted fv-small">Drag the model to rotate it.</p>}
            </Card>

            <Card className="fv-stack">
              <h2>Built from</h2>
              <dl className="fv-param-list">
                {AVATAR_MEASUREMENTS.map((key) => {
                  const p = avatar.parameters!.resolved[key];
                  return (
                    <div key={key}>
                      <dt>{LABEL[key]}</dt>
                      <dd>
                        {key === 'heightCm' ? formatHeight(p.valueCm, unit) : formatLength(p.valueCm, unit)}{' '}
                        {p.source === 'default' && <span className="fv-badge fv-confidence--low">Typical, not measured</span>}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {AVATAR_MEASUREMENTS.some((k) => avatar.parameters!.resolved[k].source === 'default') && (
                <p className="fv-small">
                  Measurements marked “typical” weren’t provided, so a typical proportion for your height was used.{' '}
                  <Link to="/profile">Add them</Link> for a closer match.
                </p>
              )}
              <p className="fv-muted fv-small">
                Model: {avatar.modelVersion} · created {new Date(avatar.createdAt).toLocaleString()}
                {avatar.bodyScanId ? ' · from a body scan' : ''}
              </p>
              <div className="fv-actions fv-actions--start">
                <Button variant="secondary" onClick={generate} loading={busy}>
                  Regenerate
                </Button>
                <Button variant="ghost" onClick={() => remove(avatar)} disabled={busy}>
                  Delete avatar
                </Button>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
