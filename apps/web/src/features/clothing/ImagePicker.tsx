import { PRODUCT_IMAGE_TYPE_LABELS, PRODUCT_IMAGE_TYPES, type ProductImageType } from '@fitvision/shared';

export interface PickerImage {
  key: string;
  src: string;
  /** External images are shown without sending a referrer. */
  external?: boolean;
  label?: string;
  included: boolean;
  imageType: ProductImageType;
}

interface ImagePickerProps {
  images: PickerImage[];
  tryOnKey: string | null;
  onChange: (images: PickerImage[]) => void;
  onTryOnChange: (key: string) => void;
  /** Hide the include checkbox (e.g. images already saved). */
  allowExclude?: boolean;
  onRemove?: (key: string) => void;
}

/** Choose which images to keep, label them, and pick the one used for virtual try-on. */
export function ImagePicker({ images, tryOnKey, onChange, onTryOnChange, allowExclude = true, onRemove }: ImagePickerProps) {
  const update = (key: string, patch: Partial<PickerImage>) => onChange(images.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  return (
    <fieldset className="fv-fieldset fv-stack">
      <legend className="fv-field__label">Images</legend>
      <p className="fv-muted fv-small">
        Pick the image to use for virtual try-on — a front view of the garment on its own works best.
      </p>
      <div className="fv-image-grid">
        {images.map((img, i) => (
          <div key={img.key} className={`fv-image-card${img.included ? '' : ' fv-image-card--excluded'}${tryOnKey === img.key ? ' fv-image-card--tryon' : ''}`}>
            <img src={img.src} alt={img.label ?? `Product image ${i + 1}`} loading="lazy" referrerPolicy={img.external ? 'no-referrer' : undefined} />
            <div className="fv-image-card__controls">
              {allowExclude && (
                <label className="fv-inline-check">
                  <input type="checkbox" checked={img.included} onChange={(e) => update(img.key, { included: e.target.checked })} /> Include
                </label>
              )}
              <label className="fv-inline-check">
                <input
                  type="radio"
                  name="tryon-image"
                  checked={tryOnKey === img.key}
                  disabled={!img.included}
                  onChange={() => onTryOnChange(img.key)}
                />{' '}
                Use for try-on
              </label>
              <label className="fv-visually-hidden" htmlFor={`type-${img.key}`}>
                Image {i + 1} type
              </label>
              <select
                id={`type-${img.key}`}
                className="fv-input fv-input--sm"
                value={img.imageType}
                disabled={!img.included}
                onChange={(e) => update(img.key, { imageType: e.target.value as ProductImageType })}
              >
                {PRODUCT_IMAGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PRODUCT_IMAGE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              {onRemove && (
                <button type="button" className="fv-btn fv-btn--ghost fv-btn--sm" onClick={() => onRemove(img.key)}>
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
