import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  IMPORT_FALLBACK_MESSAGE,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES,
  type CreateProductInput,
  type ImportDraft,
  type ImportResponse,
  type ProductResponse,
} from '@fitvision/shared';
import { Alert, Button, Card, TextField } from '../../design';
import { ApiError, apiFetch } from '../../lib/api';
import { ImagePicker, type PickerImage } from './ImagePicker';
import { ProductFieldsForm } from './ProductFieldsForm';
import { SizeChartTable } from './SizeChartTable';
import { draftFromImport, emptyDraft, validateDraft, type ProductDraft } from './productDraft';
import './clothing.css';

type Mode = 'link' | 'upload';
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

interface UploadImage extends PickerImage {
  file?: File;
}

export function AddClothingPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('mode') === 'upload' ? 'upload' : 'link';

  const [link, setLink] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<{ message: string; reason?: string } | null>(null);
  const [imported, setImported] = useState<ImportDraft | null>(null);

  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [images, setImages] = useState<UploadImage[]>([]);
  const [tryOnKey, setTryOnKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Revoke local previews on unmount.
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => () => imagesRef.current.forEach((i) => i.file && URL.revokeObjectURL(i.src)), []);

  function switchMode(next: Mode, keepLink = false) {
    setParams(next === 'upload' ? { mode: 'upload' } : {}, { replace: true });
    setImported(null);
    setImportError(null);
    setErrors({});
    setSaveError(null);
    setImages((imgs) => {
      imgs.forEach((i) => i.file && URL.revokeObjectURL(i.src));
      return [];
    });
    setTryOnKey(null);
    setDraft({ ...emptyDraft(), sourceUrl: keepLink ? link : '' });
  }

  async function runImport(e: FormEvent) {
    e.preventDefault();
    setImportError(null);
    let url: URL;
    try {
      url = new URL(link.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    } catch {
      setImportError({ message: 'Enter a full product link starting with https://' });
      return;
    }
    setImporting(true);
    try {
      const res = await apiFetch<ImportResponse>('/products/import', { method: 'POST', body: { url: url.toString() } });
      setImported(res.draft);
      setDraft(draftFromImport(res.draft));
      const picks = res.draft.images.map((img, i) => ({ key: `url-${i}`, src: img.url, external: true, included: true, imageType: 'unknown' as const }));
      setImages(picks);
      setTryOnKey(picks[0]?.key ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IMPORT_FAILED') setImportError({ message: err.message, reason: err.fields.reason });
      else setImportError({ message: err instanceof ApiError ? err.message : IMPORT_FALLBACK_MESSAGE });
    } finally {
      setImporting(false);
    }
  }

  function addFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    const problems: string[] = [];
    const accepted: UploadImage[] = [];
    for (const file of files) {
      if (!ACCEPTED_TYPES.includes(file.type)) problems.push(`${file.name}: not a supported image (JPEG, PNG, WebP, AVIF or GIF).`);
      else if (file.size > MAX_PRODUCT_IMAGE_BYTES) problems.push(`${file.name}: larger than ${MAX_PRODUCT_IMAGE_BYTES / 1024 / 1024} MB.`);
      else accepted.push({ key: `file-${crypto.randomUUID()}`, src: URL.createObjectURL(file), file, label: file.name, included: true, imageType: 'unknown' });
    }
    const room = MAX_PRODUCT_IMAGES - images.length;
    if (accepted.length > room) problems.push(`Only ${MAX_PRODUCT_IMAGES} images per product — some were not added.`);
    const added = accepted.slice(0, Math.max(0, room));
    accepted.slice(added.length).forEach((i) => URL.revokeObjectURL(i.src));
    setImages((imgs) => [...imgs, ...added]);
    if (!tryOnKey && added[0]) setTryOnKey(added[0].key);
    setErrors((er) => ({ ...er, images: problems.join(' ') }));
  }

  function removeImage(key: string) {
    setImages((imgs) => {
      const img = imgs.find((i) => i.key === key);
      if (img?.file) URL.revokeObjectURL(img.src);
      const rest = imgs.filter((i) => i.key !== key);
      if (tryOnKey === key) setTryOnKey(rest[0]?.key ?? null);
      return rest;
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    const result = validateDraft(draft);
    const included = images.filter((i) => i.included);
    const imageError = included.length === 0 ? 'Add at least one image' : !included.some((i) => i.key === tryOnKey) ? 'Choose an image for try-on' : undefined;
    if (!result.data || imageError) {
      setErrors({ ...(result.errors ?? {}), ...(imageError && { images: imageError }) });
      return;
    }
    setErrors({});
    const form = new FormData();
    const inputs: CreateProductInput['images'] = included.map((img, i) => {
      if (img.file) {
        form.append(`image${i}`, img.file, img.file.name);
        return { kind: 'upload', field: `image${i}`, imageType: img.imageType };
      }
      return { kind: 'url', url: img.src, imageType: img.imageType };
    });
    const payload: CreateProductInput = {
      source: imported ? 'product_url' : 'manual_upload',
      fields: result.data,
      images: inputs,
      tryOnImageIndex: included.findIndex((i) => i.key === tryOnKey),
      importInfo: imported ? { importers: imported.importers, fetchedUrl: imported.fetchedUrl, warnings: imported.warnings } : null,
    };
    form.append('data', JSON.stringify(payload));
    setSaving(true);
    try {
      const res = await apiFetch<ProductResponse>('/products', { method: 'POST', body: form });
      navigate(`/clothing/${res.product.id}`, { state: { notices: res.notices } });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^fields\./, ''), v])));
        setSaveError(err.message);
      } else setSaveError('Could not save the product. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const showForm = mode === 'upload' || imported !== null;

  return (
    <div className="fv-page fv-page--narrow">
      <header>
        <h1>Add clothing</h1>
        <p className="fv-muted">Paste a product link or upload photos. You’ll review everything before it’s saved.</p>
      </header>
      <div className="fv-tabs" role="tablist" aria-label="How to add clothing">
        <button type="button" role="tab" aria-selected={mode === 'link'} onClick={() => switchMode('link')}>
          Paste product link
        </button>
        <button type="button" role="tab" aria-selected={mode === 'upload'} onClick={() => switchMode('upload')}>
          Upload clothing
        </button>
      </div>

      {mode === 'link' && !imported && (
        <Card>
          <form className="fv-stack" onSubmit={runImport} noValidate>
            <TextField
              label="Product link"
              type="url"
              inputMode="url"
              placeholder="https://store.example.com/product/…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              hint="We read the public product page once to fill in the details. Some stores block this."
            />
            {importError && (
              <Alert tone="warning">
                <strong>{importError.message}</strong>
                {importError.reason && <> Reason: {importError.reason}</>}
              </Alert>
            )}
            <div className="fv-actions fv-actions--start">
              <Button type="submit" loading={importing}>
                {importing ? 'Reading product page…' : 'Import product'}
              </Button>
              {importError && (
                <Button type="button" variant="secondary" onClick={() => switchMode('upload', true)}>
                  Upload clothing instead
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      {showForm && (
        <form className="fv-stack" onSubmit={save} noValidate>
          {imported && (
            <Card className="fv-stack">
              <div className="fv-section-head">
                <h2>Review imported details</h2>
                <Button type="button" variant="ghost" onClick={() => switchMode('link')}>
                  Start over
                </Button>
              </div>
              <p className="fv-muted fv-small">
                Imported from <span className="fv-break">{imported.fetchedUrl}</span>. Check each field — imported details can be wrong or
                incomplete.
              </p>
              {imported.possibleDuplicates.length > 0 && (
                <Alert tone="warning">
                  You may already have this product:{' '}
                  {imported.possibleDuplicates.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && ', '}
                      <Link to={`/clothing/${d.id}`}>{d.name}</Link>
                    </span>
                  ))}
                </Alert>
              )}
              {imported.warnings.length > 0 && (
                <Alert tone="warning">
                  <ul className="fv-plain-list">
                    {imported.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Alert>
              )}
            </Card>
          )}

          <Card className="fv-stack">
            {mode === 'upload' && (
              <div className="fv-stack">
                <div className="fv-section-head">
                  <h2>Photos</h2>
                  <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={images.length >= MAX_PRODUCT_IMAGES}>
                    Add photos
                  </Button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_TYPES.join(',')}
                  className="fv-visually-hidden"
                  aria-label="Choose garment photos"
                  onChange={addFiles}
                />
                {images.length === 0 && <p className="fv-muted">Add up to {MAX_PRODUCT_IMAGES} photos (JPEG, PNG, WebP, AVIF or GIF, up to 10 MB each).</p>}
              </div>
            )}
            {images.length > 0 && (
              <ImagePicker
                images={images}
                tryOnKey={tryOnKey}
                onChange={(next) => {
                  setImages(next);
                  if (tryOnKey && !next.find((i) => i.key === tryOnKey)?.included) setTryOnKey(next.find((i) => i.included)?.key ?? null);
                }}
                onTryOnChange={setTryOnKey}
                allowExclude={mode === 'link'}
                onRemove={mode === 'upload' ? removeImage : undefined}
              />
            )}
            {errors.images && <span className="fv-field__error">{errors.images}</span>}
            <p className="fv-muted fv-small">Background removal for try-on isn’t available yet.</p>
          </Card>

          <Card className="fv-stack">
            <h2>Details</h2>
            <ProductFieldsForm
              draft={draft}
              errors={errors}
              origins={imported?.origins}
              onChange={(patch) => {
                setDraft((d) => ({ ...d, ...patch }));
                setErrors((er) => {
                  const next = { ...er };
                  Object.keys(patch).forEach((k) => delete next[k]);
                  return next;
                });
              }}
            />
          </Card>

          {draft.sizeChart && (
            <Card className="fv-stack">
              <div className="fv-section-head">
                <h2>Size chart</h2>
                <Button type="button" variant="ghost" onClick={() => setDraft((d) => ({ ...d, sizeChart: null }))}>
                  Don’t save size chart
                </Button>
              </div>
              <SizeChartTable
                chart={draft.sizeChart}
                onRemoveRow={(i) =>
                  setDraft((d) => {
                    const rows = d.sizeChart!.rows.filter((_, j) => j !== i);
                    return { ...d, sizeChart: rows.length ? { ...d.sizeChart!, rows } : null };
                  })
                }
              />
            </Card>
          )}

          {saveError && <Alert tone="error">{saveError}</Alert>}
          <div className="fv-actions">
            <Link className="fv-btn fv-btn--ghost" to="/clothing">
              Cancel
            </Link>
            <Button type="submit" loading={saving}>
              {saving ? 'Saving…' : 'Save to my clothing'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
