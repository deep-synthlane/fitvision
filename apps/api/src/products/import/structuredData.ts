import { clean, parsePrice, plainText, toAbsoluteHttpUrl, type ExtractedProduct, type ExtractedVariant, type ImportContext, type ProductImporter } from './types.js';

type Json = Record<string, unknown>;

const isType = (node: Json, ...types: string[]) => {
  const t = node['@type'];
  const list = (Array.isArray(t) ? t : [t]).map((x) => String(x).replace(/^.*[/:]/, ''));
  return types.some((type) => list.includes(type));
};

function flatten(value: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(value)) value.forEach((v) => flatten(v, out));
  else if (value && typeof value === 'object') {
    const node = value as Json;
    out.push(node);
    if (node['@graph']) flatten(node['@graph'], out);
  }
  return out;
}

const first = <T>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);
const nameOf = (v: unknown) => clean(typeof v === 'object' && v ? (v as Json).name : v);

function images(v: unknown, base: URL): string[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return list
    .map((i) => (typeof i === 'string' ? i : clean((i as Json)?.contentUrl) ?? clean((i as Json)?.url)))
    .map((i) => toAbsoluteHttpUrl(i, base))
    .filter((i): i is string => Boolean(i));
}

function offerInfo(offers: unknown) {
  const list = (Array.isArray(offers) ? offers : offers ? [offers] : []) as Json[];
  const o = list[0];
  if (!o) return {};
  const price = parsePrice(o.price ?? o.lowPrice ?? (first(o.priceSpecification as Json | Json[]) as Json | undefined)?.price);
  const currency = clean(o.priceCurrency ?? (first(o.priceSpecification as Json | Json[]) as Json | undefined)?.priceCurrency);
  const availability = clean(o.availability)?.replace(/^.*[/:]/, '');
  return { price, currency, availability };
}

/** schema.org Product / ProductGroup in JSON-LD. */
export class StructuredDataImporter implements ProductImporter {
  readonly name = 'json-ld';
  readonly origin = 'structured_data' as const;

  canHandle() {
    return true;
  }

  async importProduct(_url: URL, ctx: ImportContext): Promise<ExtractedProduct | null> {
    const page = await ctx.getPage();
    const nodes: Json[] = [];
    page.$('script[type="application/ld+json"]').each((_, el) => {
      const text = page.$(el).text().replace(/^\s*<!--|-->\s*$/g, '');
      try {
        flatten(JSON.parse(text), nodes);
      } catch {
        // Invalid JSON-LD blocks are common; ignore them.
      }
    });
    const product = nodes.find((n) => isType(n, 'ProductGroup')) ?? nodes.find((n) => isType(n, 'Product'));
    if (!product) return null;

    const base = page.url;
    const variantNodes = (Array.isArray(product.hasVariant) ? product.hasVariant : []) as Json[];
    const variants: ExtractedVariant[] = variantNodes.map((v) => ({
      size: clean(nameOf(v.size)) ?? null,
      color: clean(v.color) ?? null,
      sku: clean(v.sku) ?? null,
      availability: offerInfo(v.offers).availability ?? null,
    }));
    const ownSize = clean(nameOf(product.size));
    if (variants.length === 0 && ownSize) variants.push({ size: ownSize, color: clean(product.color) ?? null, sku: clean(product.sku) ?? null, availability: offerInfo(product.offers).availability ?? null });

    const offer = offerInfo(product.offers ?? first(variantNodes)?.offers);
    const breadcrumb = nodes.find((n) => isType(n, 'BreadcrumbList'));
    const crumbs = ((breadcrumb?.itemListElement ?? []) as Json[]).map((i) => nameOf(i.item) ?? clean(i.name)).filter(Boolean) as string[];
    const imgs = [...images(product.image, base), ...variantNodes.flatMap((v) => images(v.image, base))];

    return {
      name: clean(product.name),
      brand: nameOf(product.brand),
      categoryHints: [clean(product.category), crumbs.join(' > '), clean(product.name)].filter((x): x is string => Boolean(x)),
      color: clean(product.color),
      price: offer.price,
      currency: offer.currency,
      description: plainText(product.description),
      images: [...new Set(imgs)],
      sizes: [...new Set(variants.map((v) => v.size).filter((s): s is string => Boolean(s)))],
      colors: [...new Set(variants.map((v) => v.color).filter((c): c is string => Boolean(c)))],
      variants,
      canonicalUrl: toAbsoluteHttpUrl(clean(product.url), base),
    };
  }
}
