import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABELS,
  type CollectionListResponse,
  type ProductListResponse,
  type ProductSummary,
  type SavedLook,
  type SavedLookListResponse,
  type TryOnListResponse,
  type TryOnResult,
  type WardrobeCollection,
} from '@fitvision/shared';
import { Alert, Button, Card, SelectField, TextField } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';
import { ProductCard } from '../clothing/ProductCard';
import { TryOnCard } from '../tryon/TryOnCard';
import { CollectionsPanel } from './CollectionsPanel';
import '../clothing/clothing.css';
import './wardrobe.css';

const TABS = [
  { id: 'clothing', label: 'My clothing' },
  { id: 'favourites', label: 'Favourites' },
  { id: 'viewed', label: 'Recently viewed' },
  { id: 'looks', label: 'Saved looks' },
  { id: 'tried', label: 'Recently tried' },
  { id: 'collections', label: 'Collections' },
] as const;
type Tab = (typeof TABS)[number]['id'];
const PRODUCT_TABS: Tab[] = ['clothing', 'favourites', 'viewed'];
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'recently_viewed', label: 'Recently viewed' },
  { value: 'name', label: 'Name' },
];

/** Everything the user has saved, in one place: clothing, favourites, looks, try-ons and collections. */
export function WardrobePage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'clothing') as Tab;
  const filters = {
    q: params.get('q') ?? '',
    category: params.get('category') ?? '',
    brand: params.get('brand') ?? '',
    color: params.get('color') ?? '',
    collectionId: params.get('collectionId') ?? '',
    sort: params.get('sort') ?? (tab === 'viewed' ? 'recently_viewed' : 'newest'),
  };
  const [search, setSearch] = useState(filters.q);
  const [list, setList] = useState<ProductListResponse | null>(null);
  const [collections, setCollections] = useState<WardrobeCollection[]>([]);
  const [looks, setLooks] = useState<SavedLook[] | null>(null);
  const [tried, setTried] = useState<TryOnResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  // Debounced search box → URL.
  useEffect(() => {
    if (search === filters.q) return;
    const t = setTimeout(() => update({ q: search }), 250);
    return () => clearTimeout(t);
  }, [search, filters.q, update]);

  const query = new URLSearchParams();
  if (filters.q) query.set('q', filters.q);
  for (const k of ['category', 'brand', 'color', 'collectionId'] as const) if (filters[k]) query.set(k, filters[k]);
  query.set('sort', filters.sort);
  if (tab === 'favourites') query.set('favourite', 'true');
  if (tab === 'viewed') query.set('viewed', 'true');
  const queryString = query.toString();

  const loadProducts = useCallback(async () => {
    try {
      setList(await apiFetch<ProductListResponse>(`/products?${queryString}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your wardrobe');
    }
  }, [queryString]);

  useEffect(() => {
    if (PRODUCT_TABS.includes(tab)) void loadProducts();
  }, [tab, loadProducts]);
  useEffect(() => {
    apiFetch<CollectionListResponse>('/collections')
      .then((r) => setCollections(r.collections))
      .catch(() => setCollections([]));
  }, []);
  useEffect(() => {
    if (tab === 'looks') apiFetch<SavedLookListResponse>('/saved-looks').then((r) => setLooks(r.looks)).catch(() => setLooks([]));
    if (tab === 'tried') apiFetch<TryOnListResponse>('/try-ons').then((r) => setTried(r.tryOns.slice(0, 24))).catch(() => setTried([]));
  }, [tab]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }
  const toggleFavourite = (p: ProductSummary) =>
    act(async () => {
      await apiFetch(`/products/${p.id}/favourite`, { method: 'POST', body: { favourite: !p.isFavourite } });
      await loadProducts();
    });
  const addToCollection = (p: ProductSummary, collectionId: string) =>
    act(async () => {
      setCollections((await apiFetch<CollectionListResponse>(`/collections/${collectionId}/items/${p.id}`, { method: 'PUT' })).collections);
      await loadProducts();
    });
  const remove = (p: ProductSummary) =>
    act(async () => {
      if (!window.confirm(`Delete “${p.name}”? Its images, try-ons and size recommendations are deleted too.`)) return;
      await apiFetch(`/products/${p.id}`, { method: 'DELETE' });
      await loadProducts();
    });
  const removeLook = (look: SavedLook) =>
    act(async () => {
      await apiFetch(`/saved-looks/${look.id}`, { method: 'DELETE' });
      setLooks((l) => l?.filter((x) => x.id !== look.id) ?? null);
    });

  const activeCollection = collections.find((c) => c.id === filters.collectionId);
  const filtered = Boolean(filters.q || filters.category || filters.brand || filters.color || filters.collectionId);

  return (
    <div className="fv-page">
      <header className="fv-section-head">
        <div>
          <h1>Wardrobe</h1>
          <p className="fv-muted">Your clothing, saved looks and collections.</p>
        </div>
        <div className="fv-row-wrap">
          <Link className="fv-btn fv-btn--primary" to="/clothing/new">
            Paste product link
          </Link>
          <Link className="fv-btn fv-btn--secondary" to="/clothing/new?mode=upload">
            Upload clothing
          </Link>
        </div>
      </header>

      <nav className="fv-tabs fv-tabs--scroll" aria-label="Wardrobe sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setParams(t.id === 'clothing' ? {} : { tab: t.id })}>
            {t.label}
          </button>
        ))}
      </nav>
      {error && <Alert tone="error">{error}</Alert>}

      {PRODUCT_TABS.includes(tab) && (
        <>
          <Card className="fv-filters" role="search" aria-label="Filter clothing">
            <TextField label="Search" type="search" placeholder="Name or brand" value={search} onChange={(e) => setSearch(e.target.value)} />
            <SelectField
              label="Category"
              placeholder="All categories"
              options={(list?.facets.categories ?? PRODUCT_CATEGORIES).map((c) => ({ value: c, label: PRODUCT_CATEGORY_LABELS[c] }))}
              value={filters.category}
              onChange={(e) => update({ category: e.target.value })}
            />
            <SelectField label="Brand" placeholder="All brands" options={(list?.facets.brands ?? []).map((b) => ({ value: b, label: b }))} value={filters.brand} onChange={(e) => update({ brand: e.target.value })} />
            <SelectField label="Colour" placeholder="All colours" options={(list?.facets.colors ?? []).map((c) => ({ value: c, label: c }))} value={filters.color} onChange={(e) => update({ color: e.target.value })} />
            <SelectField label="Collection" placeholder="All collections" options={collections.map((c) => ({ value: c.id, label: c.name }))} value={filters.collectionId} onChange={(e) => update({ collectionId: e.target.value })} />
            <SelectField label="Sort" options={SORTS} value={filters.sort} onChange={(e) => update({ sort: e.target.value })} />
            {filtered && (
              <Button
                variant="ghost"
                className="fv-btn--sm"
                onClick={() => {
                  setSearch('');
                  update({ q: '', category: '', brand: '', color: '', collectionId: '' });
                }}
              >
                Clear filters
              </Button>
            )}
          </Card>
          <p className="fv-muted fv-small" role="status" aria-live="polite">
            {list ? `${list.products.length} of ${list.total} item${list.total === 1 ? '' : 's'}${activeCollection ? ` in ${activeCollection.name}` : ''}` : 'Loading…'}
          </p>
          {list && list.products.length === 0 ? (
            <Card className="fv-empty">
              <p className="fv-muted">
                {list.total === 0
                  ? 'No clothing yet. Paste a product link or upload a photo to get started.'
                  : tab === 'favourites'
                    ? 'No favourites match. Tap ☆ on any item to add it.'
                    : tab === 'viewed'
                      ? 'Items you open will appear here.'
                      : 'Nothing matches these filters.'}
              </p>
            </Card>
          ) : (
            <div className="fv-product-grid">
              {list?.products.map((p) => (
                <ProductCard key={p.id} product={p} onDelete={remove} onToggleFavourite={toggleFavourite} collections={collections} onAddToCollection={addToCollection} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'looks' &&
        (looks?.length ? (
          <div className="fv-product-grid">
            {looks.map((l) => (
              <div key={l.id} className="fv-stack fv-look">
                <TryOnCard tryOn={l.tryOn} />
                <div className="fv-row-wrap">
                  <Link className="fv-btn fv-btn--secondary fv-btn--sm" to={`/clothing/${l.productId}`}>
                    View product
                  </Link>
                  <Button variant="ghost" className="fv-btn--sm" onClick={() => removeLook(l)} aria-label={`Remove saved look: ${l.tryOn.productName}`}>
                    Remove look
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Card className="fv-empty">
            <p className="fv-muted">{looks ? 'Save a try-on result to keep it here.' : 'Loading…'}</p>
          </Card>
        ))}

      {tab === 'tried' &&
        (tried?.length ? (
          <div className="fv-product-grid">
            {tried.map((t) => (
              <TryOnCard key={t.id} tryOn={t} />
            ))}
          </div>
        ) : (
          <Card className="fv-empty">
            <p className="fv-muted">{tried ? 'Your try-ons will appear here.' : 'Loading…'}</p>
          </Card>
        ))}

      {tab === 'collections' && (
        <CollectionsPanel collections={collections} onChange={setCollections} onOpen={(c) => setParams({ collectionId: c.id })} />
      )}
    </div>
  );
}
