import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  CHART_SOURCE_LABELS,
  FIT_LABELS,
  SIZE_DISCLAIMER,
  formatLength,
  type Confidence,
  type MeasurementUnit,
  type ProfileResponse,
  type SizeRecommendationResponse,
  type StaleReason,
} from '@fitvision/shared';
import { Alert, Button, Card } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';
import { SizeFeedbackForm } from './SizeFeedbackForm';
import './sizing.css';

const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence', none: 'No recommendation' };
const STALE_MESSAGE: Record<StaleReason, string> = {
  measurements_changed: 'Your body measurements have changed since this recommendation was generated.',
  product_changed: 'This product’s size information has changed since this recommendation was generated.',
  algorithm_changed: 'FitVision’s sizing method has been updated since this recommendation was generated.',
};
const SOURCE_LABEL = { manual: 'entered by you', body_scan: 'from your body scan', corrected: 'from your body scan, with your corrections' } as const;
const STATUS_LABEL = {
  inside: 'fits',
  near_boundary: 'near size edge',
  between: 'between sizes',
  below_smallest: 'below smallest size',
  above_largest: 'above largest size',
  unavailable: 'not compared',
} as const;

interface Props {
  productId: string;
  /** Offered sizes, for the fit-feedback form. */
  sizes?: string[];
  /** Compact summary for the try-on page; the full breakdown lives on the product page. */
  compact?: boolean;
}

/** "Find my size": deterministic recommendation from confirmed measurements and the product's size chart. */
export function SizeRecommendationCard({ productId, sizes = [], compact = false }: Props) {
  const [data, setData] = useState<SizeRecommendationResponse | null>(null);
  const [unit, setUnit] = useState<MeasurementUnit>('metric');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<SizeRecommendationResponse>(`/products/${productId}/size-recommendation`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the size recommendation');
    }
  }, [productId]);

  useEffect(() => {
    void load();
    apiFetch<ProfileResponse>('/profile')
      .then((p) => p.profile && setUnit(p.profile.measurementUnit))
      .catch(() => {});
  }, [load]);

  async function compute() {
    setBusy(true);
    setError(null);
    try {
      setData(await apiFetch<SizeRecommendationResponse>(`/products/${productId}/size-recommendation`, { method: 'POST' }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not calculate your size');
    } finally {
      setBusy(false);
    }
  }

  const rec = data?.recommendation;
  const r = rec?.result;
  const len = (cm: number | null) => (cm === null ? '—' : formatLength(cm, unit));

  return (
    <Card className="fv-stack fv-size-card" aria-labelledby={`size-${productId}`}>
      <div className="fv-section-head">
        <h2 id={`size-${productId}`}>Size recommendation</h2>
        {r && <span className={`fv-badge fv-size-conf--${r.confidence}`}>{CONFIDENCE_LABEL[r.confidence]}</span>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {!data && !error && <p className="fv-muted">Loading…</p>}

      {data && !rec && (
        <>
          <p className="fv-muted">Compare your confirmed body measurements with this product’s size chart.</p>
          {data.canCompute ? (
            <div>
              <Button onClick={compute} loading={busy}>
                Find my size
              </Button>
            </div>
          ) : (
            <p className="fv-small">
              <Link to="/profile">Add your measurements</Link> or <Link to="/scan">take a body scan</Link> to get a size recommendation.
            </p>
          )}
        </>
      )}

      {rec && r && (
        <>
          {data!.stale.length > 0 && (
            <Alert tone="warning">
              {data!.stale.map((s) => STALE_MESSAGE[s]).join(' ')}{' '}
              <Button variant="secondary" className="fv-btn--sm" onClick={compute} loading={busy}>
                Recalculate
              </Button>
            </Alert>
          )}
          {r.recommendedSize ? (
            <p className="fv-size-headline">
              {r.betweenSizes ? (
                <>
                  Between <strong>{r.betweenSizes[0]}</strong> and <strong>{r.betweenSizes[1]}</strong> — recommended <strong>{r.recommendedSize}</strong>
                </>
              ) : (
                <>
                  Recommended size: <strong>{r.recommendedSize}</strong>
                </>
              )}
              {r.fit && <span className="fv-muted"> · {FIT_LABELS[r.fit]} fit</span>}
            </p>
          ) : (
            <p className="fv-size-headline">No recommendation available</p>
          )}
          <p>{r.summary}</p>
          {r.alternativeSize && r.alternativeReason && (
            <p className="fv-small">
              <strong>Alternative: {r.alternativeSize}.</strong> {r.alternativeReason}
            </p>
          )}

          {compact ? (
            <p className="fv-small">
              <Link to={`/clothing/${productId}`}>See the full size breakdown</Link>
            </p>
          ) : (
            <>
              {r.measurements.length > 0 && (
                <div className="fv-table-scroll">
                  <table className="fv-table">
                    <thead>
                      <tr>
                        <th scope="col">Measurement</th>
                        <th scope="col">You</th>
                        <th scope="col">Points to</th>
                        <th scope="col">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.measurements.map((m) => (
                        <tr key={m.key}>
                          <th scope="row">
                            {m.label}
                            {m.role === 'secondary' && <span className="fv-muted"> (secondary)</span>}
                          </th>
                          <td>{len(m.userValueCm)}</td>
                          <td>
                            {m.betweenSizes ? `${m.betweenSizes[0]}–${m.betweenSizes[1]}` : (m.matchedSize ?? '—')}
                            {m.status !== 'unavailable' && <span className="fv-muted"> · {STATUS_LABEL[m.status]}</span>}
                          </td>
                          <td className="fv-size-note">{m.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {r.warnings.length > 0 && (
                <Alert tone="warning">
                  <ul className="fv-plain-list">
                    {r.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              {r.notes.map((n) => (
                <p key={n} className="fv-muted fv-small">
                  {n}
                </p>
              ))}
              {r.confidenceReasons.length > 0 && (
                <details className="fv-small">
                  <summary>Why this confidence?</summary>
                  <ul className="fv-plain-list">
                    {r.confidenceReasons.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="fv-muted fv-small">
                Based on your confirmed measurements ({SOURCE_LABEL[rec.measurementSource]}
                {rec.scanVersion ? `, scan ${rec.scanVersion}` : ''}) and{' '}
                {r.chartSource ? `this product’s ${CHART_SOURCE_LABELS[r.chartSource].replace('Product size chart', 'size chart')}` : 'this product’s size information'}.
                Calculated {new Date(rec.createdAt).toLocaleString()} · {r.algorithmVersion}.
              </p>
              {data!.stale.length === 0 && (
                <div>
                  <Button variant="ghost" className="fv-btn--sm" onClick={compute} loading={busy}>
                    Recalculate
                  </Button>
                </div>
              )}
            </>
          )}
          {!compact && r.recommendedSize && <SizeFeedbackForm productId={productId} recommendationId={rec.id} sizes={sizes} />}
          <p className="fv-muted fv-small">{SIZE_DISCLAIMER}</p>
        </>
      )}
    </Card>
  );
}
