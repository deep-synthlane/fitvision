import { useEffect, useState } from 'react';
import type { SavedLookListResponse, TryOnListResponse, TryOnResult } from '@fitvision/shared';
import { Alert, Card } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';
import { TryOnCard } from './TryOnCard';
import '../clothing/clothing.css';

/** All try-ons, with saved looks first. */
export function TryOnsPage() {
  const [tryOns, setTryOns] = useState<TryOnResult[] | null>(null);
  const [saved, setSaved] = useState<TryOnResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiFetch<TryOnListResponse>('/try-ons'), apiFetch<SavedLookListResponse>('/saved-looks')])
      .then(([t, s]) => {
        setTryOns(t.tryOns);
        setSaved(s.looks.map((l) => l.tryOn));
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load your try-ons'));
  }, []);

  return (
    <div className="fv-page">
      <header>
        <h1>Try-ons & saved looks</h1>
      </header>
      {error && <Alert tone="error">{error}</Alert>}
      <section className="fv-stack" aria-labelledby="saved-heading">
        <h2 id="saved-heading">Saved looks</h2>
        {saved.length ? (
          <div className="fv-product-grid">
            {saved.map((t) => (
              <TryOnCard key={t.id} tryOn={t} />
            ))}
          </div>
        ) : (
          <Card className="fv-empty">
            <p className="fv-muted">Save a try-on result to keep it here.</p>
          </Card>
        )}
      </section>
      <section className="fv-stack" aria-labelledby="all-heading">
        <h2 id="all-heading">All try-ons</h2>
        {tryOns?.length ? (
          <div className="fv-product-grid">
            {tryOns.map((t) => (
              <TryOnCard key={t.id} tryOn={t} />
            ))}
          </div>
        ) : (
          <Card className="fv-empty">
            <p className="fv-muted">{tryOns ? 'Open a product in My clothing and choose “Try on”.' : 'Loading…'}</p>
          </Card>
        )}
      </section>
    </div>
  );
}
