import { clean, parsePrice, plainText, toAbsoluteHttpUrl, type ExtractedProduct, type ImportContext, type ProductImporter } from './types.js';

/** OpenGraph and product:* meta tags. */
export class OpenGraphImporter implements ProductImporter {
  readonly name = 'opengraph';
  readonly origin = 'opengraph' as const;

  canHandle() {
    return true;
  }

  async importProduct(_url: URL, ctx: ImportContext): Promise<ExtractedProduct | null> {
    const { $, url } = await ctx.getPage();
    const metas = (key: string) =>
      $(`meta[property="${key}"], meta[name="${key}"]`)
        .toArray()
        .map((m) => clean($(m).attr('content')))
        .filter((v): v is string => Boolean(v));
    const meta = (...keys: string[]) => keys.map((k) => metas(k)[0]).find(Boolean);

    const images = [...metas('og:image:secure_url'), ...metas('og:image'), ...metas('og:image:url')]
      .map((i) => toAbsoluteHttpUrl(i, url))
      .filter((i): i is string => Boolean(i));
    const result: ExtractedProduct = {
      name: meta('og:title', 'twitter:title'),
      brand: meta('product:brand', 'og:brand'),
      categoryHints: [meta('product:category'), meta('og:title')].filter((x): x is string => Boolean(x)),
      color: meta('product:color'),
      price: parsePrice(meta('product:price:amount', 'og:price:amount')),
      currency: meta('product:price:currency', 'og:price:currency'),
      description: plainText(meta('og:description', 'twitter:description')),
      images: [...new Set(images)],
      canonicalUrl: toAbsoluteHttpUrl(meta('og:url'), url),
    };
    return Object.values(result).some((v) => (Array.isArray(v) ? v.length : v !== undefined)) ? result : null;
  }
}
