import { Link } from 'react-router';
import { PRODUCT_CATEGORY_LABELS, PRODUCT_SOURCE_LABELS, type ProductSummary, type WardrobeCollection } from '@fitvision/shared';
import { Badge, Button, Card } from '../../design';

interface ProductCardProps {
  product: ProductSummary;
  onDelete?: (product: ProductSummary) => void;
  onToggleFavourite?: (product: ProductSummary) => void;
  collections?: WardrobeCollection[];
  onAddToCollection?: (product: ProductSummary, collectionId: string) => void;
}

export function ProductCard({ product, onDelete, onToggleFavourite, collections, onAddToCollection }: ProductCardProps) {
  const available = collections?.filter((c) => !product.collectionIds.includes(c.id)) ?? [];
  const inCollections = collections?.filter((c) => product.collectionIds.includes(c.id)) ?? [];
  return (
    <Card className="fv-product-card">
      <div className="fv-product-card__media">
        {product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" /> : <div className="fv-product-card__noimg" aria-hidden="true" />}
        {onToggleFavourite && (
          <button
            type="button"
            className={`fv-fav${product.isFavourite ? ' fv-fav--on' : ''}`}
            aria-pressed={product.isFavourite}
            aria-label={product.isFavourite ? `Remove ${product.name} from favourites` : `Add ${product.name} to favourites`}
            onClick={() => onToggleFavourite(product)}
          >
            <span aria-hidden="true">{product.isFavourite ? '★' : '☆'}</span>
          </button>
        )}
      </div>
      <div>
        <h3>
          <Link to={`/clothing/${product.id}`}>{product.name}</Link>
        </h3>
        {product.brand && <p className="fv-muted fv-small">{product.brand}</p>}
      </div>
      <div className="fv-product-card__meta">
        <Badge>{PRODUCT_CATEGORY_LABELS[product.category]}</Badge>
        <Badge>{PRODUCT_SOURCE_LABELS[product.source]}</Badge>
        {product.color && <Badge>{product.color}</Badge>}
        {inCollections.map((c) => (
          <Badge key={c.id}>{c.name}</Badge>
        ))}
      </div>
      <p className="fv-muted fv-small">{product.sizes.length ? `Sizes: ${product.sizes.join(', ')}` : 'Sizes unknown'}</p>
      {onAddToCollection && available.length > 0 && (
        <label className="fv-small">
          <span className="fv-visually-hidden">Add {product.name} to a collection</span>
          <select
            className="fv-input fv-input--sm"
            value=""
            onChange={(e) => e.target.value && onAddToCollection(product, e.target.value)}
          >
            <option value="">Add to collection…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="fv-product-card__actions">
        <Link className="fv-btn fv-btn--primary fv-btn--sm" to={`/clothing/${product.id}/try-on`}>
          Try on
        </Link>
        <Link className="fv-btn fv-btn--secondary fv-btn--sm" to={`/clothing/${product.id}#size`}>
          Find my size
        </Link>
        <Link className="fv-btn fv-btn--ghost fv-btn--sm" to={`/clothing/${product.id}?edit=1`}>
          Edit
        </Link>
        {onDelete && (
          <Button type="button" variant="ghost" className="fv-btn--sm" onClick={() => onDelete(product)}>
            Delete
          </Button>
        )}
      </div>
    </Card>
  );
}
