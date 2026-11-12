import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { FieldOrigin, SizeChart } from '@fitvision/shared';

export interface FetchedPage {
  url: URL;
  html: string;
  $: CheerioAPI;
}

export interface ImportContext {
  /** The product page, fetched once (SSRF-safe) and shared by all importers. */
  getPage(): Promise<FetchedPage>;
}

export interface ExtractedVariant {
  size: string | null;
  color: string | null;
  sku: string | null;
  availability: string | null;
}

/** What one importer found; every field optional. */
export interface ExtractedProduct {
  name?: string;
  brand?: string;
  categoryHints?: string[];
  color?: string;
  price?: number;
  currency?: string;
  description?: string;
  images?: string[];
  sizes?: string[];
  colors?: string[];
  variants?: ExtractedVariant[];
  sizeChart?: SizeChart;
  canonicalUrl?: string;
  /** Things the user should double-check on the review screen. */
  warnings?: string[];
}

/**
 * One way of extracting product data. Store-specific adapters implement this too and are
 * registered with origin `store_adapter`.
 */
export interface ProductImporter {
  readonly name: string;
  readonly origin: Exclude<FieldOrigin, 'not_found'>;
  canHandle(url: URL): boolean;
  importProduct(url: URL, ctx: ImportContext): Promise<ExtractedProduct | null>;
}

export const clean = (v: unknown): string | undefined => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s : undefined;
};

/** Product descriptions often contain markup; keep only the text (never rendered as HTML). */
export function plainText(v: unknown, max = 2000): string | undefined {
  const s = clean(v);
  if (!s) return undefined;
  return clean(/[<&]/.test(s) ? cheerio.load(`<div>${s}</div>`)('div').first().text() : s)?.slice(0, max);
}

export function toAbsoluteHttpUrl(value: string | undefined, base: URL): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function parsePrice(v: unknown): number | undefined {
  const s = clean(v);
  if (!s) return undefined;
  // "1.299,00" (EU) vs "1,299.00" (US): the last separator followed by 1–2 digits is the decimal mark.
  const m = /^[^\d]*([\d.,\s]+)/.exec(s);
  if (!m) return undefined;
  let n = m[1]!.replace(/\s/g, '');
  const dec = /[.,](\d{1,2})$/.exec(n);
  n = dec ? n.slice(0, dec.index).replace(/[.,]/g, '') + '.' + dec[1] : n.replace(/[.,]/g, '');
  const value = Number(n);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}
