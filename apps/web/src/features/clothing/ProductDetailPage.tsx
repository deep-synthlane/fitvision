import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_IMAGE_TYPE_LABELS,
  PRODUCT_SOURCE_LABELS,
  type Product,
  type ProductResponse,
  type TryOnListResponse,
  type TryOnResult,
  type UpdateProductInput,
} from '@fitvision/shared';
import { SizeChartEditor } from '../sizing/SizeChartEditor';
import { SizeRecommendationCard } from '../sizing/SizeRecommendationCard';
import { TryOnCard } from '../tryon/TryOnCard';
import { Alert, Badge, Button, Card } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';
import { ImagePicker, type PickerImage } from './ImagePicker';
import { ProductFieldsForm } from './ProductFieldsForm';
import { SizeChartTable } from './SizeChartTable';
import { draftFromProduct, draftToFields, validateDraft, type ProductDraft } from './productDraft';
import './clothing.css';

export function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const editing = search.get('edit') === '1';
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>((location.state as { notices?: string[] } | null)?.notices ?? []);
  const [shown, setShown] = useState<string | null>(null);
  const [tryOns, setTryOns] = useState<TryOnResult[]>([]);
  const [chartEditing, setChartEditing] = useState(false);

  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [images, setImages] = useState<PickerImage[]>([]);
  const [tryOnKey, setTryOnKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<ProductResponse>(`/products/${id}`)
      .then((res) => setProduct(res.product))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load this product'));
    apiFetch<TryOnListResponse>(`/try-ons?productId=${id}`)
      .then((res) => setTryOns(res.tryOns))
      .catch(() => setTryOns([]));
  }, [id]);

  useEffect(() => {
    if (!product || !editing) return;
    setDraft(draftFromProduct(product));
    setImages(product.images.map((i) => ({ key: i.id, src: i.url, included: true, imageType: i.imageType })));
    setTryOnKey(product.tryOnImageId);
    setErrors({});
  }, [product, editing]);

  async function remove() {
    if (!product || !window.confirm(`Delete “${product.name}” and its images?`)) return;
    try {
      await apiFetch(`/products/${product.id}`, { method: 'DELETE' });
      navigate('/clothing', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the product');
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!product || !draft) return;
    const result = validateDraft(draft);
    if (!result.data) {
      setErrors(result.errors);
      return;
    }
    const kept = images.map((i) => i.key);
    const payload: UpdateProductInput = {
      fields: draftToFields(draft) as UpdateProductInput['fields'],
      tryOnImageId: tryOnKey ?? undefined,
      imageTypes: Object.fromEntries(images.map((i) => [i.key, i.imageType])),
      removeImageIds: product.images.filter((i) => !kept.includes(i.id)).map((i) => i.id),
    };
    setSaving(true);
    try {
      const res = await apiFetch<ProductResponse>(`/products/${product.id}`, { method: 'PATCH', body: payload });
      setProduct(res.product);
      setNotices(['Changes saved.']);
      setSearch({}, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^fields\./, ''), v])));
      setError(err instanceof ApiError ? err.message : 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  if (error && !product) return <Alert tone="error">{error}</Alert>;
  if (!product) return <p className="fv-muted">Loading…</p>;

  const tryOn = product.images.find((i) => i.id === product.tryOnImageId) ?? product.images[0];
  const main = product.images.find((i) => i.id === shown) ?? tryOn;

  return (
    <div className="fv-page">
      <p>
        <Link to="/clothing">← My clothing</Link>
      </p>
      {notices.map((n) => (
        <Alert key={n} tone={n === 'Changes saved.' || n === 'Size chart saved.' ? 'info' : 'warning'}>
          {n}
        </Alert>
      ))}
      {error && <Alert tone="error">{error}</Alert>}

      {editing && draft ? (
        <form className="fv-stack" onSubmit={save} noValidate>
          <h1>Edit {product.name}</h1>
          <Card>
            <ImagePicker
              images={images}
              tryOnKey={tryOnKey}
              onChange={setImages}
              onTryOnChange={setTryOnKey}
              allowExclude={false}
              onRemove={
                images.length > 1
                  ? (key) => {
                      const rest = images.filter((i) => i.key !== key);
                      setImages(rest);
                      if (tryOnKey === key) setTryOnKey(rest[0]?.key ?? null);
                    }
                  : undefined
              }
            />
          </Card>
          <Card>
            <ProductFieldsForm draft={draft} errors={errors} onChange={(patch) => setDraft((d) => d && { ...d, ...patch })} />
          </Card>
          {draft.sizeChart && (
            <Card className="fv-stack">
              <div className="fv-section-head">
                <h2>Size chart</h2>
                <Button type="button" variant="ghost" onClick={() => setDraft((d) => d && { ...d, sizeChart: null })}>
                  Remove size chart
                </Button>
              </div>
              <SizeChartTable chart={draft.sizeChart} />
            </Card>
          )}
          <div className="fv-actions">
            <Button type="button" variant="ghost" onClick={() => setSearch({}, { replace: true })}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="fv-product-detail">
          <div className="fv-stack fv-product-detail__main">
            {main && <img src={main.url} alt={`${product.name} — ${PRODUCT_IMAGE_TYPE_LABELS[main.imageType]}`} />}
            {product.images.length > 1 && (
              <div className="fv-thumb-row">
                {product.images.map((img, i) => (
                  <button key={img.id} type="button" aria-pressed={img.id === main?.id} onClick={() => setShown(img.id)}>
                    <img src={img.url} alt={`Image ${i + 1}${img.id === product.tryOnImageId ? ' (try-on image)' : ''}`} />
                  </button>
                ))}
              </div>
            )}
            <p className="fv-muted fv-small">
              {tryOn
                ? `Try-on image: image ${product.images.indexOf(tryOn) + 1}${tryOn.imageType === 'unknown' ? '' : ` (${PRODUCT_IMAGE_TYPE_LABELS[tryOn.imageType].toLowerCase()})`}.`
                : 'No try-on image selected.'}{' '}
              Background removal: not available yet.
            </p>
          </div>
          <div className="fv-stack">
            <div>
              <h1>{product.name}</h1>
              {product.brand && <p className="fv-muted">{product.brand}</p>}
            </div>
            <div className="fv-product-card__meta">
              <Badge>{PRODUCT_CATEGORY_LABELS[product.category]}</Badge>
              <Badge>{PRODUCT_SOURCE_LABELS[product.source]}</Badge>
            </div>
            <dl className="fv-kv">
              {product.subcategory && (
                <>
                  <dt>Subcategory</dt>
                  <dd>{product.subcategory}</dd>
                </>
              )}
              <dt>Colour</dt>
              <dd>{product.color ?? '—'}</dd>
              <dt>Sizes</dt>
              <dd>{product.sizes.length ? product.sizes.join(', ') : 'Unknown'}</dd>
              <dt>Your size</dt>
              <dd>{product.sizeLabel ?? '—'}</dd>
              <dt>Price</dt>
              <dd>{product.price != null ? `${product.price} ${product.currency ?? ''}` : '—'}</dd>
              {product.sourceUrl && (
                <>
                  <dt>Product page</dt>
                  <dd>
                    <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer">
                      {new URL(product.sourceUrl).hostname}
                    </a>
                  </dd>
                </>
              )}
            </dl>
            {product.description && <p className="fv-small">{product.description}</p>}
            <div className="fv-actions fv-actions--start">
              <Link className="fv-btn fv-btn--primary" to={`/clothing/${product.id}/try-on`}>
                Try on
              </Link>
              <Button type="button" variant="secondary" onClick={() => setSearch({ edit: '1' })}>
                Edit
              </Button>
              <Button type="button" variant="ghost" onClick={remove}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {!editing && (
        <section id="size" className="fv-stack" aria-label="Size">
          <SizeRecommendationCard key={product.updatedAt} productId={product.id} sizes={product.sizes} />
          {chartEditing ? (
            <Card className="fv-stack">
              <h2>{product.sizeChart ? 'Edit size chart' : 'Add size information'}</h2>
              <SizeChartEditor
                initial={product.sizeChart}
                onCancel={() => setChartEditing(false)}
                onSave={async (chart) => {
                  const res = await apiFetch<ProductResponse>(`/products/${product.id}`, { method: 'PATCH', body: { fields: { sizeChart: chart } } });
                  setProduct(res.product);
                  setChartEditing(false);
                  setNotices(['Size chart saved.']);
                }}
              />
            </Card>
          ) : (
            <div>
              <Button variant="secondary" onClick={() => setChartEditing(true)}>
                {product.sizeChart ? 'Edit size chart' : 'Add size information manually'}
              </Button>
            </div>
          )}
        </section>
      )}

      {!editing && tryOns.length > 0 && (
        <section className="fv-stack" aria-labelledby="product-tryons">
          <h2 id="product-tryons">Your try-ons of this item</h2>
          <div className="fv-product-grid">
            {tryOns.map((t) => (
              <TryOnCard key={t.id} tryOn={t} />
            ))}
          </div>
        </section>
      )}

      {!editing && product.sizeChart && (
        <Card className="fv-stack">
          <h2>Size chart</h2>
          <SizeChartTable chart={product.sizeChart} />
        </Card>
      )}
    </div>
  );
}
