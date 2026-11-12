import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  AVATAR_TRY_ON_MISSING,
  AVATAR_TRY_ON_NOTICE,
  CATEGORY_REGION,
  GARMENT_REGION_LABELS,
  MAX_TRY_ON_PHOTO_BYTES,
  MOCK_TRY_ON_NOTICE,
  PRODUCT_IMAGE_TYPE_LABELS,
  TRY_ON_DISCLAIMER,
  type AvatarResponse,
  type PhotoOrigin,
  type Product,
  type ProductResponse,
  type TryOnPhoto,
  type TryOnPhotoListResponse,
  type TryOnPhotoResponse,
  type TryOnProviderInfo,
  type TryOnResponse,
  type TryOnSuitability,
} from '@fitvision/shared';
import { Alert, Button, Card } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';
import { createPersonPhotoAnalyzer, type PersonPhotoAnalyzer } from './analyzer';
import { CameraCapture } from './CameraCapture';
import { canvasToJpeg, fileToCanvas } from './photoUtils';
import '../scan/scan.css';
import '../clothing/clothing.css';
import './tryon.css';

const GUIDANCE = [
  'Stand facing the camera, with your whole body in the photo (head to feet for dresses and trousers)',
  'Arms slightly away from your body',
  'Good, even lighting and a plain background',
  'Only you in the photo, nothing covering your body',
  'Fitted clothing works best — avoid very loose layers',
];
const UNSUITABLE_TYPES = new Set(['detail', 'lifestyle']);
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

type Candidate = { canvas: HTMLCanvasElement; url: string; suitability: TryOnSuitability; origin: PhotoOrigin };

/** The "Use my avatar" option: the server renders the saved avatar from the front for this garment. */
type AvatarChoice =
  | { state: 'loading' }
  | { state: 'ready'; photo: TryOnPhoto; outdated: boolean }
  | { state: 'missing' }
  | { state: 'pending' }
  | { state: 'error'; message: string };

export function TryOnStartPage({ createAnalyzer = createPersonPhotoAnalyzer }: { createAnalyzer?: () => PersonPhotoAnalyzer }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const analyzer = useMemo(createAnalyzer, [createAnalyzer]);
  useEffect(() => () => analyzer.close(), [analyzer]);

  const [product, setProduct] = useState<Product | null>(null);
  const [photos, setPhotos] = useState<TryOnPhoto[]>([]);
  const [provider, setProvider] = useState<TryOnProviderInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [avatarChoice, setAvatarChoice] = useState<AvatarChoice | null>(null);
  const [garmentId, setGarmentId] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [camera, setCamera] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState<'analysing' | 'uploading' | 'submitting' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // One idempotency key per submit attempt: a double click or retried request can't create two paid jobs.
  const submitKey = useRef<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<ProductResponse>(`/products/${id}`),
      apiFetch<TryOnPhotoListResponse>('/try-on-photos'),
      apiFetch<TryOnProviderInfo>('/try-ons/provider'),
    ])
      .then(([p, ph, pr]) => {
        setProduct(p.product);
        setGarmentId(p.product.tryOnImageId ?? p.product.images[0]?.id ?? null);
        setPhotos(ph.photos);
        setProvider(pr);
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : 'Could not load try-on'));
  }, [id]);

  useEffect(
    () => () => {
      if (candidate) URL.revokeObjectURL(candidate.url);
    },
    [candidate],
  );

  if (loadError) return <Alert tone="error">{loadError}</Alert>;
  if (!product || !provider) return <p className="fv-muted">Loading…</p>;

  const region = CATEGORY_REGION[product.category];
  const suits = (s: TryOnSuitability) => s.onePerson && s.regions[region] && s.sharpOk;
  const usingAvatar = avatarChoice !== null;
  const selectedPhoto = usingAvatar ? (avatarChoice.state === 'ready' ? avatarChoice.photo : undefined) : photos.find((p) => p.id === photoId);
  const garment = product.images.find((i) => i.id === garmentId);
  const limitReached = provider.limits.usedToday >= provider.limits.dailyLimit;
  const canSubmit = Boolean(selectedPhoto && suits(selectedPhoto.suitability) && garment && !UNSUITABLE_TYPES.has(garment.imageType) && (!provider.external || consent) && !limitReached);

  async function analyse(canvas: HTMLCanvasElement, origin: PhotoOrigin) {
    setError(null);
    setCamera(false);
    setBusy('analysing');
    try {
      const suitability = await analyzer.analyze(canvas);
      const blob = await canvasToJpeg(canvas);
      setCandidate({ canvas, url: URL.createObjectURL(blob), suitability, origin });
    } catch (err) {
      console.error(err);
      setError('We couldn’t check the photo. Check your connection (the pose model is downloaded the first time) and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ACCEPT.includes(file.type)) return setError('Use a JPEG, PNG, WebP or AVIF photo.');
    if (file.size > MAX_TRY_ON_PHOTO_BYTES) return setError(`Photos must be under ${MAX_TRY_ON_PHOTO_BYTES / 1024 / 1024} MB.`);
    try {
      await analyse(await fileToCanvas(file), 'uploaded_photo');
    } catch {
      setError('That file couldn’t be opened as a photo.');
    }
  }

  async function useCandidate() {
    if (!candidate) return;
    setBusy('uploading');
    setError(null);
    try {
      const form = new FormData();
      form.append('suitability', JSON.stringify(candidate.suitability));
      form.append('origin', candidate.origin);
      form.append('photo', await canvasToJpeg(candidate.canvas), 'try-on.jpg');
      const res = await apiFetch<{ photo: TryOnPhoto }>('/try-on-photos', { method: 'POST', body: form });
      setPhotos((p) => [res.photo, ...p]);
      setPhotoId(res.photo.id);
      setCandidate(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the photo');
    } finally {
      setBusy(null);
    }
  }

  async function useAvatar() {
    setError(null);
    setCandidate(null);
    setCamera(false);
    setAvatarChoice({ state: 'loading' });
    try {
      const current = await apiFetch<AvatarResponse>('/avatars/current');
      const status = current.avatar?.status;
      if (status === 'pending' || status === 'processing') return setAvatarChoice({ state: 'pending' });
      if (status !== 'ready') return setAvatarChoice({ state: 'missing' });
      const res = await apiFetch<TryOnPhotoResponse>('/try-on-photos/avatar-render', { method: 'POST', body: { productId: product!.id } });
      setAvatarChoice({ state: 'ready', photo: res.photo, outdated: current.outdated });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AVATAR_REQUIRED') setAvatarChoice({ state: 'missing' });
      else if (err instanceof ApiError && err.code === 'AVATAR_NOT_READY') setAvatarChoice({ state: 'pending' });
      else setAvatarChoice({ state: 'error', message: err instanceof ApiError ? err.message : 'Could not prepare your avatar' });
    }
  }

  async function deletePhoto(photo: TryOnPhoto) {
    if (!window.confirm('Delete this try-on photo? Results already generated are kept.')) return;
    try {
      await apiFetch(`/try-on-photos/${photo.id}`, { method: 'DELETE' });
      setPhotos((p) => p.filter((x) => x.id !== photo.id));
      if (photoId === photo.id) setPhotoId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the photo');
    }
  }

  async function submit() {
    if (!canSubmit || busy) return;
    submitKey.current ??= crypto.randomUUID();
    setBusy('submitting');
    setError(null);
    try {
      const res = await apiFetch<TryOnResponse>('/try-ons', {
        method: 'POST',
        body: { productId: product!.id, personPhotoId: selectedPhoto!.id, productImageId: garmentId, idempotencyKey: submitKey.current, acknowledgeThirdParty: consent },
      });
      navigate(`/try-ons/${res.tryOn.id}`);
    } catch (err) {
      submitKey.current = null;
      setError(err instanceof ApiError ? `${err.message}${err.fields.reason ? ` ${err.fields.reason}` : ''}` : 'Could not start the try-on');
      setBusy(null);
    }
  }

  return (
    <div className="fv-page fv-page--narrow">
      <p>
        <Link to={`/clothing/${product.id}`}>← {product.name}</Link>
      </p>
      <header>
        <h1>Virtual try-on</h1>
        <p className="fv-muted">
          {product.name} · needs a photo suitable for {GARMENT_REGION_LABELS[region].toLowerCase()}.
        </p>
      </header>
      {error && <Alert tone="error">{error}</Alert>}

      <Card className="fv-stack">
        <h2>1. Your try-on photo</h2>
        {usingAvatar ? (
          <AvatarPanel choice={avatarChoice} onRetry={useAvatar} onUsePhoto={() => setAvatarChoice(null)} />
        ) : (
          <>
            <ul className="fv-checklist">
              {GUIDANCE.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            {photos.length > 0 && (
              <div className="fv-photo-grid" role="radiogroup" aria-label="Your try-on photos">
                {photos.map((p) => {
                  const ok = suits(p.suitability);
                  return (
                    <div key={p.id} className={`fv-photo-option${photoId === p.id ? ' fv-photo-option--selected' : ''}`}>
                      <label>
                        <input type="radio" name="photo" checked={photoId === p.id} disabled={!ok} onChange={() => setPhotoId(p.id)} />
                        <img src={p.thumbnailUrl} alt="Your try-on photo" />
                        <span className={`fv-badge ${ok ? 'fv-confidence--high' : 'fv-confidence--low'}`}>{ok ? 'Suitable' : 'Not suitable here'}</span>
                      </label>
                      {!ok && <span className="fv-small fv-muted">{p.suitability.issues[0] ?? `Not suitable for ${GARMENT_REGION_LABELS[region].toLowerCase()}.`}</span>}
                      <button type="button" className="fv-btn fv-btn--ghost fv-btn--sm" onClick={() => deletePhoto(p)}>
                        Delete
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {camera ? (
              <CameraCapture onCapture={(canvas) => analyse(canvas, 'camera_photo')} onCancel={() => setCamera(false)} />
            ) : candidate ? (
              <div className="fv-stack">
                <img className="fv-candidate" src={candidate.url} alt="New photo to check" />
                {suits(candidate.suitability) ? (
                  <Alert>Looks good for {GARMENT_REGION_LABELS[region].toLowerCase()}.</Alert>
                ) : (
                  <Alert tone="warning">
                    This photo isn’t suitable for {GARMENT_REGION_LABELS[region].toLowerCase()}:
                    <ul className="fv-plain-list">
                      {(candidate.suitability.issues.length ? candidate.suitability.issues : ['The needed part of your body isn’t visible.']).map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  </Alert>
                )}
                <p className="fv-muted fv-small">Saving stores the photo privately in your FitVision account. Only you can see it, and you can delete it at any time.</p>
                <div className="fv-actions">
                  <Button variant="ghost" onClick={() => setCandidate(null)}>
                    Discard
                  </Button>
                  <Button onClick={useCandidate} disabled={!suits(candidate.suitability)} loading={busy === 'uploading'}>
                    Save & use this photo
                  </Button>
                </div>
              </div>
            ) : (
              <div className="fv-actions fv-actions--start">
                <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={busy === 'analysing'}>
                  {busy === 'analysing' ? 'Checking photo…' : 'Upload photo'}
                </Button>
                <Button variant="secondary" onClick={() => setCamera(true)} disabled={busy !== null}>
                  Take photo
                </Button>
                <Button variant="secondary" onClick={useAvatar} disabled={busy !== null}>
                  Use my avatar
                </Button>
                <input ref={fileRef} type="file" accept={ACCEPT.join(',')} className="fv-visually-hidden" aria-label="Choose a try-on photo" onChange={onFile} />
              </div>
            )}
            <p className="fv-muted fv-small">Body-scan photos are never reused here unless you upload them yourself.</p>
          </>
        )}
      </Card>

      <Card className="fv-stack">
        <h2>2. Garment image</h2>
        <div className="fv-photo-grid" role="radiogroup" aria-label="Garment image">
          {product.images.map((img, i) => {
            const bad = UNSUITABLE_TYPES.has(img.imageType);
            return (
              <div key={img.id} className={`fv-photo-option${garmentId === img.id ? ' fv-photo-option--selected' : ''}`}>
                <label>
                  <input type="radio" name="garment" checked={garmentId === img.id} disabled={bad} onChange={() => setGarmentId(img.id)} />
                  <img src={img.url} alt={`Garment image ${i + 1}`} />
                  <span className="fv-badge">{PRODUCT_IMAGE_TYPE_LABELS[img.imageType]}</span>
                </label>
                {bad && <span className="fv-small fv-muted">Detail and lifestyle shots rarely work — choose a front view.</span>}
                {img.imageType === 'on_model' && garmentId === img.id && (
                  <span className="fv-small fv-muted">Photos of the garment on its own usually work better than on a model.</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="fv-stack">
        <h2>3. Generate</h2>
        {selectedPhoto && garment && (
          <div className="fv-tryon-inputs" aria-label="Try-on inputs">
            <figure>
              <img src={selectedPhoto.thumbnailUrl} alt={usingAvatar ? 'Avatar input' : 'Photo input'} />
              <figcaption>{usingAvatar ? 'Avatar input' : 'Photo input'}</figcaption>
            </figure>
            <span aria-hidden="true">+</span>
            <figure>
              <img src={garment.url} alt="Selected garment input" />
              <figcaption>Selected garment input</figcaption>
            </figure>
            <span aria-hidden="true">→</span>
            <p className="fv-muted fv-small">Generated try-on result</p>
          </div>
        )}
        {usingAvatar && provider.source === 'real' && !provider.avatarVerified && (
          <Alert tone="warning">Avatar try-on hasn’t been verified with this try-on service yet. The result may not show the garment correctly.</Alert>
        )}
        {provider.source === 'mock' ? (
          <Alert tone="warning">
            <strong>Mock mode.</strong> {MOCK_TRY_ON_NOTICE}
          </Alert>
        ) : (
          <>
            {!provider.verified && <Alert tone="warning">This try-on service hasn’t been fully tested by FitVision yet. Results may be unreliable.</Alert>}
            {provider.external && provider.disclosure && (
              <label className="fv-inline-check fv-consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> {provider.disclosure}
              </label>
            )}
          </>
        )}
        <p className="fv-muted fv-small">
          {provider.source === 'mock' ? 'Mock mode: results are labelled placeholder images, not AI previews.' : TRY_ON_DISCLAIMER} · {provider.limits.usedToday} of {provider.limits.dailyLimit} try-ons used today.
        </p>
        {limitReached && <Alert tone="warning">You’ve reached today’s try-on limit. Please come back tomorrow.</Alert>}
        <div>
          <Button onClick={submit} disabled={!canSubmit} loading={busy === 'submitting'}>
            Generate try-on
          </Button>
        </div>
      </Card>
    </div>
  );
}

function AvatarPanel({ choice, onRetry, onUsePhoto }: { choice: AvatarChoice; onRetry: () => void; onUsePhoto: () => void }) {
  const usePhoto = (
    <Button variant="secondary" onClick={onUsePhoto}>
      Use a photo instead
    </Button>
  );
  return (
    <div className="fv-stack" aria-live="polite">
      {choice.state === 'loading' && (
        <p role="status">
          <span className="fv-spinner" aria-hidden="true" /> Preparing your avatar…
        </p>
      )}
      {choice.state === 'ready' && (
        <>
          <p>
            <span className="fv-badge fv-confidence--high">Using your avatar</span>
          </p>
          <figure className="fv-stack">
            <img className="fv-candidate fv-avatar-render" src={choice.photo.imageUrl} alt="Front view of your avatar, used as the try-on image" />
            <figcaption className="fv-muted fv-small">Avatar input — the try-on result is generated from this and the garment below.</figcaption>
          </figure>
          <Alert>{AVATAR_TRY_ON_NOTICE}</Alert>
          {choice.outdated && (
            <Alert tone="warning">
              Your measurements have changed since this avatar was made. <Link to="/avatar">Update your avatar</Link> to use them.
            </Alert>
          )}
        </>
      )}
      {choice.state === 'missing' && (
        <Alert tone="warning">
          <p>{AVATAR_TRY_ON_MISSING}</p>
          <p>
            <Link className="fv-btn fv-btn--primary fv-btn--sm" to="/avatar">
              Create my avatar
            </Link>
          </p>
        </Alert>
      )}
      {choice.state === 'pending' && (
        <Alert tone="warning">
          Your avatar is still being generated.{' '}
          <Button variant="ghost" className="fv-btn--sm" onClick={onRetry}>
            Check again
          </Button>
        </Alert>
      )}
      {choice.state === 'error' && <Alert tone="error">{choice.message}</Alert>}
      <div className="fv-actions fv-actions--start">{usePhoto}</div>
    </div>
  );
}
