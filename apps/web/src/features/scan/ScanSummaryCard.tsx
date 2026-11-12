import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { BodyScan, ScanListResponse } from '@fitvision/shared';
import { Alert, Button, Card } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Latest body scan with its (owner-only) photos, for the profile page. */
export function ScanSummaryCard({ onDeleted }: { onDeleted?: () => void }) {
  const [scan, setScan] = useState<BodyScan | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    apiFetch<ScanListResponse>('/scans')
      .then((res) => setScan(res.scans[0] ?? null))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load your scans'));
  }, []);

  async function remove() {
    if (!scan || !window.confirm('Delete this scan and its photos? Your saved measurements are kept.')) return;
    setDeleting(true);
    try {
      await apiFetch(`/scans/${scan.id}`, { method: 'DELETE' });
      setScan(null);
      onDeleted?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the scan');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <div className="fv-stack">
        <div className="fv-section-head">
          <h2>Body scan</h2>
          <Link className="fv-btn fv-btn--secondary" to="/scan">
            {scan ? 'Re-scan' : 'Start body scan'}
          </Link>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {scan === undefined && !error && <p className="fv-muted">Loading…</p>}
        {scan === null && <p className="fv-muted">No scan yet. A scan estimates your shoulder, chest, waist and hip measurements.</p>}
        {scan && (
          <>
            <p className="fv-muted fv-small">Scanned {date(scan.createdAt)} · photos are private to your account</p>
            <div className="fv-thumbs">
              {scan.views.map((v) => (
                <img key={v} className="fv-thumb" src={scan.imageUrls[v]} alt={`${v} scan photo`} loading="lazy" />
              ))}
            </div>
            <div>
              <Button variant="ghost" onClick={remove} loading={deleting}>
                Delete scan & photos
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
