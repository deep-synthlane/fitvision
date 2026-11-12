import * as cheerio from 'cheerio';
import type { FieldOrigin, ImportDraft } from '@fitvision/shared';
import { FetchError, checkUrl, type FetchPolicy } from '../../net/policy.js';
import { robotsAllows } from '../../net/robots.js';
import { safeFetch, type DnsLookup } from '../../net/safeFetch.js';
import { mapCategory } from './categories.js';
import type { ExtractedProduct, FetchedPage, ProductImporter } from './types.js';

export const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_CANDIDATE_IMAGES = 12;

export interface ImportDeps {
  policy: FetchPolicy;
  lookup?: DnsLookup;
  /** In priority order: structured data, OpenGraph, store adapters, generic HTML. */
  importers: ProductImporter[];
}

/** Import could not produce a usable draft; `reason` is a short user-facing explanation. */
export class ImportFailure extends Error {
  constructor(
    public readonly code: string,
    public readonly reason: string,
  ) {
    super(reason);
  }
}

function toFailure(err: unknown): ImportFailure {
  if (err instanceof ImportFailure) return err;
  if (err instanceof FetchError) {
    const reasons: Partial<Record<FetchError['code'], string>> = {
      blocked_by_site: 'The website blocked automated access.',
      unsupported_content: 'That link doesn’t point to a product web page.',
      http_error: `The page returned an error${err.status ? ` (${err.status})` : ''}.`,
    };
    return new ImportFailure(err.code, reasons[err.code] ?? err.message);
  }
  return new ImportFailure('import_error', 'Something went wrong while reading the page.');
}

export async function importFromUrl(rawUrl: string, deps: ImportDeps): Promise<Omit<ImportDraft, 'possibleDuplicates'>> {
  try {
    const url = checkUrl(rawUrl, deps.policy);
    if (!(await robotsAllows(url, { policy: deps.policy, lookup: deps.lookup }))) {
      throw new ImportFailure('robots_disallowed', 'This website asks automated tools not to access this page.');
    }

    let pagePromise: Promise<FetchedPage> | null = null;
    const ctx = {
      getPage: () =>
        (pagePromise ??= safeFetch(url, {
          policy: deps.policy,
          lookup: deps.lookup,
          accept: ['text/html', 'application/xhtml+xml'],
          maxBytes: MAX_PAGE_BYTES,
        }).then((res) => {
          const html = res.body.toString('utf8');
          // Parsed only — scripts on the page are never executed.
          return { url: res.url, html, $: cheerio.load(html) };
        })),
    };

    const results: { importer: ProductImporter; data: ExtractedProduct }[] = [];
    const warnings: string[] = [];
    for (const importer of deps.importers) {
      if (!importer.canHandle(url)) continue;
      try {
        const data = await importer.importProduct(url, ctx);
        if (data) results.push({ importer, data });
      } catch (err) {
        if (err instanceof FetchError) throw err; // the page itself couldn't be fetched
        warnings.push(`Part of the page couldn’t be read (${importer.name}).`);
      }
    }
    const page = await ctx.getPage();
    return merge(results, page.url, warnings);
  } catch (err) {
    throw toFailure(err);
  }
}

type DraftFields = ImportDraft['fields'];

function merge(results: { importer: ProductImporter; data: ExtractedProduct }[], fetchedUrl: URL, warnings: string[]): Omit<ImportDraft, 'possibleDuplicates'> {
  const origins: ImportDraft['origins'] = {};
  const pick = <K extends keyof ExtractedProduct>(key: K, field: keyof DraftFields = key as keyof DraftFields): ExtractedProduct[K] | undefined => {
    for (const r of results) {
      const v = r.data[key];
      if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) {
        origins[field] = r.importer.origin;
        return v;
      }
    }
    origins[field] = 'not_found';
    return undefined;
  };

  let category: DraftFields['category'] = null;
  let subcategory: string | null = null;
  let unsupported = false;
  origins.category = 'not_found';
  for (const r of results) {
    const mapped = mapCategory(r.data.categoryHints ?? []);
    unsupported ||= mapped.unsupported;
    if (mapped.category) {
      category = mapped.category;
      subcategory = mapped.subcategory;
      origins.category = r.importer.origin;
      origins.subcategory = r.importer.origin;
      break;
    }
  }

  const images: { url: string; origin: FieldOrigin }[] = [];
  for (const r of results) {
    for (const url of r.data.images ?? []) {
      if (!images.some((i) => i.url === url) && images.length < MAX_CANDIDATE_IMAGES) images.push({ url, origin: r.importer.origin });
    }
  }

  const fields: DraftFields = {
    name: pick('name') ?? null,
    brand: pick('brand') ?? null,
    category,
    subcategory,
    color: pick('color') ?? null,
    price: pick('price') ?? null,
    currency: pick('currency')?.toUpperCase() ?? null,
    description: pick('description') ?? null,
    sizes: pick('sizes') ?? [],
    colors: pick('colors') ?? [],
    variants: (pick('variants') ?? []).map((v) => ({ sizeLabel: v.size, color: v.color, sku: v.sku, availability: v.availability })),
    sizeChart: pick('sizeChart') ?? null,
  };
  const canonicalUrl = pick('canonicalUrl') ?? null;
  // A single colour across all variants is the product's colour.
  if (!fields.color && fields.colors.length === 1) {
    fields.color = fields.colors[0]!;
    origins.color = origins.colors;
  }

  if (!fields.name && images.length === 0) {
    throw new ImportFailure('no_product_data', 'We couldn’t find product information on this page.');
  }
  for (const r of results) warnings.push(...(r.data.warnings ?? []));
  if (unsupported && !category) warnings.push('This looks like footwear or an accessory, which isn’t supported for try-on yet.');
  if (!fields.name) warnings.push('We couldn’t find the product name — please enter it.');
  if (!category) warnings.push('We couldn’t tell the clothing category — please choose one.');
  if (images.length === 0) warnings.push('We couldn’t find product images — please upload one.');
  if (fields.price !== null && !fields.currency) warnings.push('We found a price but no currency — please check.');
  if (fields.sizes.length === 0) warnings.push('No sizes were found on the page.');

  return {
    fetchedUrl: fetchedUrl.toString(),
    canonicalUrl,
    fields,
    origins,
    images,
    importers: results.map((r) => r.importer.name),
    warnings: [...new Set(warnings)],
  };
}
