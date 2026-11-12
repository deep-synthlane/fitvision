import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS, type FieldOrigin } from '@fitvision/shared';
import { SelectField, TextField } from '../../design';
import { ORIGIN_HINT, type ProductDraft } from './productDraft';

interface ProductFieldsFormProps {
  draft: ProductDraft;
  errors: Record<string, string>;
  onChange: (patch: Partial<ProductDraft>) => void;
  /** Where each imported value came from (review screen only). */
  origins?: Partial<Record<string, FieldOrigin>>;
}

const CATEGORY_OPTIONS = PRODUCT_CATEGORIES.map((c) => ({ value: c, label: PRODUCT_CATEGORY_LABELS[c] }));

export function ProductFieldsForm({ draft, errors, onChange, origins }: ProductFieldsFormProps) {
  const hint = (key: string, fallback?: string) => (origins?.[key] ? ORIGIN_HINT[origins[key]!] : fallback);
  const field = (key: keyof ProductDraft) => ({
    value: draft[key] as string,
    onChange: (e: { target: { value: string } }) => onChange({ [key]: e.target.value }),
    error: errors[key],
  });
  return (
    <div className="fv-stack">
      <TextField label="Product name" {...field('name')} hint={hint('name')} />
      <div className="fv-row">
        <TextField label="Brand (optional)" {...field('brand')} hint={hint('brand')} />
        <SelectField
          label="Category"
          placeholder="Select a category"
          options={CATEGORY_OPTIONS}
          {...field('category')}
          hint={hint('category')}
          onChange={(e) => onChange({ category: e.target.value as ProductDraft['category'] })}
        />
      </div>
      <div className="fv-row">
        <TextField label="Subcategory (optional)" placeholder="e.g. Denim jacket" {...field('subcategory')} hint={hint('subcategory')} />
        <TextField label="Colour (optional)" {...field('color')} hint={hint('color', draft.colors.length > 1 ? `Available: ${draft.colors.join(', ')}` : undefined)} />
      </div>
      <div className="fv-row">
        <TextField label="Available sizes (optional)" placeholder="e.g. S, M, L" {...field('sizes')} hint={hint('sizes', 'Separate sizes with commas')} />
        <TextField label="Your size (optional)" placeholder="e.g. M" {...field('sizeLabel')} />
      </div>
      <div className="fv-row">
        <TextField label="Price (optional)" inputMode="decimal" {...field('price')} hint={hint('price')} />
        <TextField label="Currency (optional)" placeholder="e.g. USD" maxLength={3} {...field('currency')} hint={hint('currency')} />
      </div>
      <TextField label="Product link (optional)" type="url" placeholder="https://" {...field('sourceUrl')} />
      <div className="fv-field">
        <label className="fv-field__label" htmlFor="product-description">
          Description (optional)
        </label>
        <textarea
          id="product-description"
          className="fv-input fv-textarea"
          rows={3}
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
    </div>
  );
}
