import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AVATAR_TRY_ON_NOTICE, MOCK_TRY_ON_NOTICE, TRY_ON_DISCLAIMER, type TryOnProviderInfo, type TryOnResponse, type TryOnResult } from '@fitvision/shared';
import { Alert, Badge, Button, Card } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';
import { SizeRecommendationCard } from '../sizing/SizeRecommendationCard';
import './tryon.css';

const POLL_MS = 1500;
const STATUS_TEXT = { pending: 'Queued…', processing: 'Generating your try-on…' } as const;

export function TryOnResultPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tryOn, setTryOn] = useState<TryOnResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInput, setShowInput] = useState(false);
  const [showGarment, setShowGarment] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTryOn((await apiFetch<TryOnResponse>(`/try-ons/${id}`)).tryOn);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this try-on');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const status = tryOn?.status;
  useEffect(() => {
    if (status !== 'pending' && status !== 'processing') return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [status, load]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message}${err.fields.reason ? ` ${err.fields.reason}` : ''}` : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const regenerate = () =>
    act(async () => {
      const info = await apiFetch<TryOnProviderInfo>('/try-ons/provider');
      if (info.external && !window.confirm(info.disclosure ?? 'Your photo will be sent to a third-party AI service.')) return;
      const res = await apiFetch<TryOnResponse>('/try-ons', {
        method: 'POST',
        body: {
          productId: tryOn!.productId,
          personPhotoId: tryOn!.personPhotoId,
          productImageId: tryOn!.productImageId || undefined,
          idempotencyKey: crypto.randomUUID(),
          acknowledgeThirdParty: info.external,
        },
      });
      navigate(`/try-ons/${res.tryOn.id}`);
    });

  const toggleSave = () =>
    act(async () => {
      if (tryOn!.savedLookId) await apiFetch(`/saved-looks/${tryOn!.savedLookId}`, { method: 'DELETE' });
      else await apiFetch('/saved-looks', { method: 'POST', body: { tryOnResultId: tryOn!.id } });
      await load();
    });

  const remove = () =>
    act(async () => {
      if (!window.confirm('Delete this try-on result?')) return;
      await apiFetch(`/try-ons/${tryOn!.id}`, { method: 'DELETE' });
      navigate(`/clothing/${tryOn!.productId}`, { replace: true });
    });

  const cancel = () => act(async () => setTryOn((await apiFetch<TryOnResponse>(`/try-ons/${tryOn!.id}/cancel`, { method: 'POST' })).tryOn));

  if (error && !tryOn) return <Alert tone="error">{error}</Alert>;
  if (!tryOn) return <p className="fv-muted">Loading…</p>;
  const mock = tryOn.source === 'mock';
  const avatar = tryOn.personSource === 'avatar_render';

  return (
    <div className="fv-page">
      <p>
        <Link to={`/clothing/${tryOn.productId}`}>← {tryOn.productName}</Link>
      </p>
      <header className="fv-section-head">
        <div>
          <h1>Try-on: {tryOn.productName}</h1>
          <p className="fv-muted fv-small">
            {tryOn.provider} · {tryOn.modelVersion} · started {new Date(tryOn.createdAt).toLocaleString()}
          </p>
        </div>
        {mock ? <span className="fv-badge fv-badge--mock">Mock result — not AI</span> : <Badge>AI-generated preview</Badge>}
      </header>
      <Alert tone="warning">{mock ? MOCK_TRY_ON_NOTICE : TRY_ON_DISCLAIMER}</Alert>
      {avatar && (
        <Alert>
          <strong>Using your avatar.</strong> {AVATAR_TRY_ON_NOTICE}
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      {(tryOn.status === 'pending' || tryOn.status === 'processing') && (
        <Card className="fv-stack">
          <p role="status" aria-live="polite">
            <span className="fv-spinner" aria-hidden="true" /> {STATUS_TEXT[tryOn.status]} <span className="fv-muted">({tryOn.status})</span>
          </p>
          <p className="fv-muted fv-small">You can leave this page — generation continues and the result will be waiting under your try-ons.</p>
          <div>
            <Button variant="secondary" onClick={cancel} loading={busy}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {(tryOn.status === 'failed' || tryOn.status === 'cancelled') && (
        <Card className="fv-stack">
          <h2>{tryOn.status === 'failed' ? 'Try-on failed' : 'Try-on cancelled'}</h2>
          {tryOn.errorMessage && <Alert tone="error">{tryOn.errorMessage}</Alert>}
          <div className="fv-actions fv-actions--start">
            <Button onClick={regenerate} loading={busy} disabled={!tryOn.personPhotoUrl}>
              Try again
            </Button>
            <Button variant="ghost" onClick={remove} disabled={busy}>
              Delete
            </Button>
          </div>
          {!tryOn.personPhotoUrl && (
            <p className="fv-muted fv-small">{avatar ? 'The avatar used was deleted' : 'The photo used was deleted'}, so this can’t be regenerated.</p>
          )}
        </Card>
      )}

      {tryOn.status === 'ready' && tryOn.resultImageUrl && (
        <Card className="fv-stack" aria-labelledby="visual-result">
          <h2 id="visual-result">Visual try-on result</h2>
          {/* The generated image is the result; the inputs only appear beside it for comparison. */}
          <div className={showInput || showGarment ? 'fv-compare' : 'fv-result'}>
            {showInput && tryOn.personPhotoUrl && (
              <figure>
                <img src={tryOn.personPhotoUrl} alt={avatar ? 'Front view of your avatar' : 'Your original photo'} />
                <figcaption>{avatar ? 'Your avatar (input)' : 'Your photo (input)'}</figcaption>
              </figure>
            )}
            <figure>
              <img src={tryOn.resultImageUrl} alt={`Try-on result: ${tryOn.productName}${mock ? ' (mock)' : ''}`} />
              <figcaption>{mock ? 'Mock result — not AI generated' : 'Generated try-on result'}</figcaption>
            </figure>
            {showGarment && tryOn.garmentImageUrl && (
              <figure>
                <img src={tryOn.garmentImageUrl} alt="Garment image used" />
                <figcaption>Garment (input)</figcaption>
              </figure>
            )}
          </div>
          <div className="fv-actions fv-actions--start">
            <Button variant={showInput ? 'primary' : 'secondary'} aria-pressed={showInput} onClick={() => setShowInput((v) => !v)} disabled={!tryOn.personPhotoUrl}>
              {avatar ? 'Compare with my avatar' : 'Compare with my photo'}
            </Button>
            <Button variant={showGarment ? 'primary' : 'secondary'} aria-pressed={showGarment} onClick={() => setShowGarment((v) => !v)}>
              View garment
            </Button>
            <Button variant="secondary" onClick={regenerate} disabled={busy || !tryOn.personPhotoUrl}>
              Regenerate
            </Button>
            <Button onClick={toggleSave} loading={busy} aria-pressed={Boolean(tryOn.savedLookId)}>
              {tryOn.savedLookId ? 'Saved ✓ (remove)' : 'Save look'}
            </Button>
            <Button variant="ghost" onClick={remove} disabled={busy}>
              Delete
            </Button>
            <Link className="fv-btn fv-btn--ghost" to={`/clothing/${tryOn.productId}`}>
              Back to product
            </Link>
          </div>
        </Card>
      )}

      {tryOn.status === 'ready' && (
        <>
          <p className="fv-muted fv-small">
            The size recommendation below is calculated separately from your measurements and the product’s size chart — it is not
            derived from the preview image, and the preview doesn’t show whether a size fits.
          </p>
          <SizeRecommendationCard productId={tryOn.productId} compact />
        </>
      )}
    </div>
  );
}
