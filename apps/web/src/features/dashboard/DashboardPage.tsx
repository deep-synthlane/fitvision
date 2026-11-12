import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  AVATAR_DISCLAIMER,
  CLOTHING_PREFERENCE_LABELS,
  formatHeight,
  formatLength,
  formatWeight,
  type AvatarResponse,
  type BodyMeasurements,
  type CurrentMeasurementsResponse,
  type Profile,
  type ProductListResponse,
  type ProductSummary,
  type ProfileResponse,
  type SavedLook,
  type SavedLookListResponse,
  type TryOnListResponse,
  type TryOnResult,
} from '@fitvision/shared';
import { ProductCard } from '../clothing/ProductCard';
import { TryOnCard } from '../tryon/TryOnCard';
import '../clothing/clothing.css';
import { Alert, Badge, Card } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/useAuth';
import { MEASUREMENT_INPUTS } from '../profile/drafts';

function BodySummary({ profile, measurements }: { profile: Profile; measurements: BodyMeasurements | null }) {
  const unit = profile.measurementUnit;
  const rows = [
    { label: 'Height', value: formatHeight(profile.heightCm, unit) },
    { label: 'Weight', value: formatWeight(profile.weightKg, unit) },
    ...MEASUREMENT_INPUTS.map(({ key, label }) => ({
      label,
      value: measurements?.[key] != null ? formatLength(measurements[key], unit) : null,
    })),
  ];
  return (
    <dl className="fv-body-summary">
      {rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd>{r.value ?? <span className="fv-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function AvatarCardBody({ avatar, hasScan }: { avatar: AvatarResponse; hasScan: boolean }) {
  const status = avatar.avatar?.status;
  const scanLink = (
    <Link className={`fv-btn ${hasScan ? 'fv-btn--ghost' : 'fv-btn--secondary'}`} to="/scan">
      {hasScan ? 'Re-scan body' : 'Start body scan'}
    </Link>
  );
  if (status === 'ready') {
    return (
      <>
        <p className="fv-muted fv-small">
          {avatar.outdated ? 'Your measurements changed — regenerate to update your avatar.' : AVATAR_DISCLAIMER}
        </p>
        <Link className="fv-btn fv-btn--primary" to="/avatar">
          {avatar.outdated ? 'Update my avatar' : 'View my avatar'}
        </Link>
        {scanLink}
      </>
    );
  }
  if (status === 'pending' || status === 'processing') {
    return (
      <>
        <p className="fv-muted fv-small" role="status">
          Your avatar is being generated…
        </p>
        <Link className="fv-btn fv-btn--secondary" to="/avatar">
          View progress
        </Link>
      </>
    );
  }
  return (
    <>
      <p className="fv-muted fv-small">
        {status === 'failed'
          ? 'Avatar generation failed. You can try again.'
          : avatar.canGenerate
            ? 'Create a 3D mannequin from your measurements.'
            : 'Take a quick body scan — we’ll estimate your measurements and use them to build your avatar.'}
      </p>
      {avatar.canGenerate ? (
        <Link className="fv-btn fv-btn--primary" to="/avatar">
          {status === 'failed' ? 'Try again' : 'Create my avatar'}
        </Link>
      ) : null}
      {scanLink}
    </>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [measurements, setMeasurements] = useState<BodyMeasurements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [avatar, setAvatar] = useState<AvatarResponse | null>(null);
  const [clothing, setClothing] = useState<ProductSummary[] | null>(null);
  const [tryOns, setTryOns] = useState<TryOnResult[] | null>(null);
  const [looks, setLooks] = useState<SavedLook[] | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<ProfileResponse>('/profile'),
      apiFetch<CurrentMeasurementsResponse>('/measurements/current'),
      apiFetch<AvatarResponse>('/avatars/current'),
    ])
      .then(([p, m, a]) => {
        setProfile(p.profile);
        setMeasurements(m.measurements);
        setAvatar(a);
        setLoaded(true);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load your profile'));
    apiFetch<ProductListResponse>('/products')
      .then((res) => setClothing(res.products))
      .catch(() => setClothing([]));
    apiFetch<TryOnListResponse>('/try-ons')
      .then((res) => setTryOns(res.tryOns))
      .catch(() => setTryOns([]));
    apiFetch<SavedLookListResponse>('/saved-looks')
      .then((res) => setLooks(res.looks))
      .catch(() => setLooks([]));
  }, []);

  const missing = MEASUREMENT_INPUTS.filter(({ key }) => measurements?.[key] == null).length;

  return (
    <div className="fv-page">
      <header>
        <h1>Hi, {user?.name.split(' ')[0]}</h1>
        <p className="fv-muted">See how clothes could look and fit before you buy.</p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      <section aria-labelledby="avatar-title" className="fv-dash-grid">
        <Card className="fv-avatar-card">
          <div className="fv-section-head">
            <h2 id="avatar-title">My avatar</h2>
            {avatar?.avatar?.status === 'ready' && <Badge>Approximate</Badge>}
          </div>
          <div className="fv-avatar-placeholder">
            {avatar?.avatar?.status === 'ready' && avatar.avatar.previewUrl ? (
              <img src={avatar.avatar.previewUrl} alt="Your avatar, front view" />
            ) : (
              <svg viewBox="0 0 40 80" aria-hidden="true">
                <circle cx="20" cy="9" r="7" />
                <path d="M8 22h24l-3 26h-4l-1 30h-8l-1-30h-4z" />
              </svg>
            )}
          </div>
          {loaded && avatar && <AvatarCardBody avatar={avatar} hasScan={Boolean(measurements?.scanId)} />}
        </Card>

        <Card>
          <div className="fv-section-head">
            <h2>Body profile</h2>
            <Link to="/profile">Edit</Link>
          </div>
          {profile ? (
            <>
              <p className="fv-muted fv-small">
                {CLOTHING_PREFERENCE_LABELS[profile.clothingPreference]}
                {measurements && measurements.source !== 'manual' && ` · from body scan${measurements.source === 'corrected' ? ' (corrected)' : ''}`}
                {missing > 0 && ` · ${missing} measurement${missing === 1 ? '' : 's'} missing`}
              </p>
              <BodySummary profile={profile} measurements={measurements} />
            </>
          ) : (
            !error && <p className="fv-muted">Loading…</p>
          )}
        </Card>
      </section>

      <section aria-labelledby="tryon-title" className="fv-stack">
        <h2 id="tryon-title">Try on something new</h2>
        <div className="fv-feature-grid">
          <Card className="fv-feature">
            <h3>Paste product link</h3>
            <p className="fv-muted">Import a product from a store’s product page. You’ll review the details before saving.</p>
            <Link className="fv-btn fv-btn--primary" to="/clothing/new">
              Paste product link
            </Link>
          </Card>
          <Card className="fv-feature">
            <h3>Upload clothing</h3>
            <p className="fv-muted">Add photos of a garment with its size and colour.</p>
            <Link className="fv-btn fv-btn--secondary" to="/clothing/new?mode=upload">
              Upload clothing
            </Link>
          </Card>
        </div>
      </section>

      <section aria-labelledby="clothing-title" className="fv-stack">
        <div className="fv-section-head">
          <h2 id="clothing-title">My clothing</h2>
          {clothing && clothing.length > 0 && <Link to="/clothing">View all</Link>}
        </div>
        {clothing?.length ? (
          <div className="fv-product-grid">
            {clothing.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <Card className="fv-empty">
            <p className="fv-muted">{clothing ? 'Clothing you add will appear here.' : 'Loading…'}</p>
          </Card>
        )}
      </section>

      <section aria-labelledby="recent-title" className="fv-stack">
        <div className="fv-section-head">
          <h2 id="recent-title">Recent try-ons</h2>
          {tryOns && tryOns.length > 0 && <Link to="/try-ons">View all</Link>}
        </div>
        {tryOns?.length ? (
          <div className="fv-product-grid">
            {tryOns.slice(0, 4).map((t) => (
              <TryOnCard key={t.id} tryOn={t} />
            ))}
          </div>
        ) : (
          <Card className="fv-empty">
            <p className="fv-muted">Your try-on results will appear here.</p>
          </Card>
        )}
      </section>

      <section aria-labelledby="saved-title" className="fv-stack">
        <h2 id="saved-title">Saved looks</h2>
        {looks?.length ? (
          <div className="fv-product-grid">
            {looks.slice(0, 4).map((l) => (
              <TryOnCard key={l.id} tryOn={l.tryOn} />
            ))}
          </div>
        ) : (
          <Card className="fv-empty">
            <p className="fv-muted">Save looks you like to compare them later.</p>
          </Card>
        )}
      </section>

      <p className="fv-muted fv-small">
        Try-on images are visual previews and size recommendations are estimates from your measurements — neither shows exactly how a garment will fit.
      </p>
    </div>
  );
}
