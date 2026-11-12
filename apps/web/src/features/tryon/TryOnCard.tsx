import { Link } from 'react-router';
import type { TryOnResult } from '@fitvision/shared';
import { Badge, Card } from '../../design';

const STATUS_LABEL: Record<TryOnResult['status'], string> = {
  pending: 'Queued',
  processing: 'Generating…',
  ready: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function TryOnCard({ tryOn }: { tryOn: TryOnResult }) {
  return (
    <Card className="fv-product-card">
      {tryOn.resultImageUrl ? <img src={tryOn.resultImageUrl} alt="" loading="lazy" /> : <div className="fv-product-card__noimg" aria-hidden="true" />}
      <h3>
        <Link to={`/try-ons/${tryOn.id}`}>{tryOn.productName}</Link>
      </h3>
      <div className="fv-product-card__meta">
        <Badge>{STATUS_LABEL[tryOn.status]}</Badge>
        {tryOn.source === 'mock' && <span className="fv-badge fv-badge--mock">Mock</span>}
        {tryOn.savedLookId && <Badge>Saved</Badge>}
      </div>
    </Card>
  );
}
