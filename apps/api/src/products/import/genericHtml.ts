import { extractSizeChart } from './sizeChart.js';
import { clean, parsePrice, plainText, toAbsoluteHttpUrl, type ExtractedProduct, type ImportContext, type ProductImporter } from './types.js';

const PLACEHOLDER_OPTION = /^(select|choose|pick|size|colou?r)\b|^-+$|^$/i;
const NON_PRODUCT_IMAGE = /logo|icon|sprite|avatar|badge|payment|banner|placeholder|blank|pixel|tracking/i;

/** Last-resort extraction from plain HTML (no JavaScript is executed). */
export class GenericHtmlImporter implements ProductImporter {
  readonly name = 'html';
  readonly origin = 'html' as const;

  canHandle() {
    return true;
  }

  async importProduct(_url: URL, ctx: ImportContext): Promise<ExtractedProduct | null> {
    const { $, url } = await ctx.getPage();

    const options = (pattern: RegExp) => {
      const values = new Set<string>();
      $('select')
        .filter((_, el) => pattern.test(`${$(el).attr('name') ?? ''} ${$(el).attr('id') ?? ''} ${$(el).attr('class') ?? ''} ${$(el).attr('aria-label') ?? ''}`))
        .find('option')
        .each((_, o) => {
          const v = clean($(o).text());
          if (v && !PLACEHOLDER_OPTION.test(v) && v.length <= 40) values.add(v.replace(/\s*[-–(].*(sold out|unavailable|out of stock).*$/i, ''));
        });
      $('[data-size], [data-option-size]').each((_, el) => {
        if (pattern.source.includes('size')) {
          const v = clean($(el).attr('data-size') ?? $(el).attr('data-option-size'));
          if (v && v.length <= 40) values.add(v);
        }
      });
      return [...values];
    };

    const imgSrc = (el: Parameters<typeof $>[0]) => {
      const $el = $(el);
      const srcset = $el.attr('srcset') ?? $el.attr('data-srcset');
      const largest = srcset
        ?.split(',')
        .map((s) => s.trim().split(/\s+/))
        .sort((a, b) => parseInt(b[1] ?? '0', 10) - parseInt(a[1] ?? '0', 10))[0]?.[0];
      return largest ?? $el.attr('data-src') ?? $el.attr('data-zoom-image') ?? $el.attr('src');
    };
    const scoped = $('[itemprop="image"], [class*="product" i] img, [class*="gallery" i] img, [id*="product" i] img').toArray();
    const candidates = (scoped.length ? scoped : $('main img, img').toArray())
      .filter((el) => {
        const $el = $(el);
        const w = Number($el.attr('width') ?? 0);
        const label = `${$el.attr('src') ?? ''} ${$el.attr('class') ?? ''} ${$el.attr('alt') ?? ''}`;
        return !(w && w < 200) && !NON_PRODUCT_IMAGE.test(label);
      })
      .map((el) => (el.tagName === 'meta' ? $(el).attr('content') : imgSrc(el)))
      .map((src) => toAbsoluteHttpUrl(src, url))
      .filter((src): src is string => Boolean(src) && !/\.svg(\?|$)/i.test(src!));

    const breadcrumb = clean($('[class*="breadcrumb" i], nav[aria-label*="breadcrumb" i]').first().text());
    const chart = extractSizeChart($);

    const result: ExtractedProduct = {
      name: clean($('h1').first().text()) ?? clean($('title').text())?.split(/\s[|–-]\s/)[0],
      brand: clean($('[itemprop="brand"]').first().attr('content') ?? $('[itemprop="brand"]').first().text()),
      categoryHints: [breadcrumb, clean($('h1').first().text())].filter((x): x is string => Boolean(x)),
      price: parsePrice($('[itemprop="price"]').first().attr('content') ?? $('[itemprop="price"]').first().text()),
      currency: clean($('[itemprop="priceCurrency"]').first().attr('content')),
      description: plainText($('meta[name="description"]').attr('content')),
      images: [...new Set(candidates)].slice(0, 12),
      sizes: options(/size/i),
      colors: options(/colou?r/i),
      sizeChart: chart?.chart,
      canonicalUrl: toAbsoluteHttpUrl($('link[rel="canonical"]').attr('href'), url),
      warnings: chart?.inferredUnit
        ? [`The size chart doesn’t state its unit; we assumed ${chart.chart.unit === 'in' ? 'inches' : 'centimetres'}. Please check.`]
        : [],
    };
    return result;
  }
}

export { extractSizeChart };
