import {
  productFieldsSchema,
  type FieldOrigin,
  type ImportDraft,
  type Product,
  type ProductCategory,
  type ProductFields,
  type SizeChart,
  type VariantInput,
} from '@fitvision/shared';
import { validate } from '../../lib/forms';

/** Product form state; free-text values stay strings while editing. */
export interface ProductDraft {
  name: string;
  brand: string;
  category: ProductCategory | '';
  subcategory: string;
  color: string;
  sizeLabel: string;
  sizes: string;
  sourceUrl: string;
  price: string;
  currency: string;
  description: string;
  colors: string[];
  variants: VariantInput[];
  sizeChart: SizeChart | null;
}

export const emptyDraft = (): ProductDraft => ({
  name: '',
  brand: '',
  category: '',
  subcategory: '',
  color: '',
  sizeLabel: '',
  sizes: '',
  sourceUrl: '',
  price: '',
  currency: '',
  description: '',
  colors: [],
  variants: [],
  sizeChart: null,
});

export function draftFromImport(d: ImportDraft): ProductDraft {
  const f = d.fields;
  return {
    name: f.name ?? '',
    brand: f.brand ?? '',
    category: f.category ?? '',
    subcategory: f.subcategory ?? '',
    color: f.color ?? '',
    sizeLabel: '',
    sizes: f.sizes.join(', '),
    sourceUrl: d.canonicalUrl ?? d.fetchedUrl,
    price: f.price == null ? '' : String(f.price),
    currency: f.currency ?? '',
    description: f.description ?? '',
    colors: f.colors,
    variants: f.variants,
    sizeChart: f.sizeChart,
  };
}

export function draftFromProduct(p: Product): ProductDraft {
  return {
    name: p.name,
    brand: p.brand ?? '',
    category: p.category,
    subcategory: p.subcategory ?? '',
    color: p.color ?? '',
    sizeLabel: p.sizeLabel ?? '',
    sizes: p.sizes.join(', '),
    sourceUrl: p.sourceUrl ?? '',
    price: p.price == null ? '' : String(p.price),
    currency: p.currency ?? '',
    description: p.description ?? '',
    colors: p.colors,
    variants: p.variants.map((v) => ({ sizeLabel: v.sizeLabel, color: v.color, sku: v.sku, availability: v.availability })),
    sizeChart: p.sizeChart,
  };
}

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

export function draftToFields(d: ProductDraft) {
  return {
    name: d.name,
    brand: orNull(d.brand),
    category: d.category || undefined,
    subcategory: orNull(d.subcategory),
    color: orNull(d.color),
    sizeLabel: orNull(d.sizeLabel),
    sourceUrl: orNull(d.sourceUrl),
    price: d.price.trim() === '' ? null : Number(d.price.replace(',', '.')),
    currency: orNull(d.currency),
    description: orNull(d.description),
    sizes: [...new Set(d.sizes.split(',').map((s) => s.trim()).filter(Boolean))],
    colors: d.colors,
    variants: d.variants,
    sizeChart: d.sizeChart,
  };
}

export function validateDraft(d: ProductDraft): { data: ProductFields; errors: null } | { data: null; errors: Record<string, string> } {
  return validate(productFieldsSchema, draftToFields(d)) as { data: ProductFields; errors: null } | { data: null; errors: Record<string, string> };
}

export const ORIGIN_HINT: Record<FieldOrigin, string | undefined> = {
  structured_data: 'From the product data',
  opengraph: 'From the page metadata',
  store_adapter: 'From the store',
  html: 'From the page text — please check',
  not_found: 'Not found on the page',
};
