import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IMPORT_FALLBACK_MESSAGE, type ImportDraft } from '@fitvision/shared';
import { DEFAULT_FETCH_POLICY, policyWithExtraHosts } from '../src/net/policy.js';
import { clearRobotsCache } from '../src/net/robots.js';
import { garmentPng, startProductSite, type ProductSite } from './fixtures/productSite.js';
import { createTestApp, registerUser, type TestContext } from './helpers.js';

let ctx: TestContext;
let site: ProductSite;
beforeAll(async () => {
  site = await startProductSite();
  // Production policy plus the local fixture site only.
  ctx = await createTestApp({ fetchPolicy: policyWithExtraHosts(DEFAULT_FETCH_POLICY, [site.hostPort]) });
});
afterAll(async () => {
  await ctx.close();
  await site.close();
});
beforeEach(() => clearRobotsCache());

// Registration is rate limited (10 per window), so tests share a few named users.
const users = new Map<string, Promise<{ cookie: string }>>();
const user = (name: string) => {
  if (!users.has(name)) users.set(name, registerUser(ctx.app));
  return users.get(name)!;
};

const importUrl = (cookie: string, url: string) =>
  ctx.app.inject({ method: 'POST', url: '/api/products/import', headers: { cookie }, payload: { url } });

async function createProduct(cookie: string, data: unknown, files: Record<string, Buffer> = {}) {
  const fd = new FormData();
  for (const [field, buf] of Object.entries(files)) fd.append(field, new Blob([buf]), `${field}.bin`);
  fd.append('data', JSON.stringify(data));
  return ctx.app.inject({ method: 'POST', url: '/api/products', headers: { cookie }, payload: fd });
}

const manualFields = {
  name: 'White Tee',
  brand: null,
  category: 't_shirts',
  subcategory: null,
  color: 'White',
  sizeLabel: 'M',
  sourceUrl: null,
  price: null,
  currency: null,
  description: null,
};

describe('product import (fixtures)', () => {
  it('extracts a product from JSON-LD, preferring it over other sources', async () => {
    const { cookie } = await user('importer');
    const res = await importUrl(cookie, `${site.origin}/products/denim-jacket`);
    expect(res.statusCode).toBe(200);
    const draft: ImportDraft = res.json().draft;
    expect(draft.fields).toMatchObject({
      name: 'Classic Denim Jacket',
      brand: 'Acme Apparel',
      category: 'jackets',
      subcategory: 'Denim Jackets',
      price: 89.5,
      currency: 'EUR',
      sizes: ['XS', 'S', 'M', 'L'],
      colors: ['Indigo'],
    });
    // Markup in the description is reduced to text; the single variant colour becomes the colour.
    expect(draft.fields.description).toBe('A classic denim jacket.');
    expect(draft.fields.color).toBe('Indigo');
    expect(draft.origins.color).toBe('structured_data');
    expect(draft.fields.variants[0]).toEqual({ sizeLabel: 'XS', color: 'Indigo', sku: 'DJ-XS', availability: 'OutOfStock' });
    expect(draft.origins).toMatchObject({ name: 'structured_data', brand: 'structured_data', price: 'structured_data' });
    expect(draft.canonicalUrl).toBe(`${site.origin}/products/denim-jacket`);
    expect(draft.importers).toEqual(['json-ld', 'html']);
    expect(draft.images.map((i) => i.url)).toEqual([`${site.origin}/img/front.png`, `${site.origin}/img/back.png`, `${site.origin}/img/front-dupe.jpg`]);
  });

  it('falls back to OpenGraph and reports missing fields', async () => {
    const { cookie } = await user('importer');
    const draft: ImportDraft = (await importUrl(cookie, `${site.origin}/p/linen-dress`)).json().draft;
    expect(draft.fields).toMatchObject({ name: 'Linen Midi Dress', category: 'dresses', price: 1299, currency: 'SEK', brand: null, sizes: [] });
    expect(draft.origins).toMatchObject({ name: 'opengraph', brand: 'not_found' });
    expect(draft.warnings).toContain('No sizes were found on the page.');
  });

  it('uses generic HTML as a last resort, including sizes and a normalised size chart', async () => {
    const { cookie } = await user('importer');
    const draft: ImportDraft = (await importUrl(cookie, `${site.origin}/products/slim-chinos`)).json().draft;
    expect(draft.fields).toMatchObject({ name: 'Slim Chinos', category: 'trousers', sizes: ['30', '32', '34'] });
    expect(draft.origins.name).toBe('html');
    expect(draft.images.map((i) => i.url)).toEqual([`${site.origin}/img/front.png`, `${site.origin}/img/back.png`]);
    const chart = draft.fields.sizeChart!;
    expect(chart).toMatchObject({ unit: 'in', kind: 'body', source: 'html_table' });
    expect(chart.rows[0]).toMatchObject({ sizeLabel: '30', waistCm: 77.5, hipsCm: 96.5, inseamCm: 81.3 });
    expect(chart.rows[2]!.raw.waist).toEqual({ raw: '34 1/2', minCm: 87.6, maxCm: 87.6 });
  });

  it('follows safe redirects', async () => {
    const { cookie } = await user('importer');
    const res = await importUrl(cookie, `${site.origin}/redirect-ok`);
    expect(res.json().draft.fetchedUrl).toBe(`${site.origin}/products/denim-jacket`);
  });

  const failures: [string, string, RegExp][] = [
    ['invalid URL', 'not a link', /valid link/],
    ['non-http scheme', 'file:///etc/passwd', /http and https/],
    ['localhost', 'http://localhost/products/1', /can’t be imported/],
    ['private IP', 'http://192.168.0.10/product', /can’t be imported/],
    ['cloud metadata IP', 'http://169.254.169.254/latest/meta-data/', /can’t be imported/],
    ['redirect into a private IP', '/redirect-private', /can’t be imported/],
    ['redirect loop', '/redirect-loop', /redirected too many times/],
    ['oversized page', '/huge', /too large/],
    ['non-HTML content', '/api.json', /doesn’t point to a product web page/],
    ['site that blocks automated access', '/blocked', /blocked automated access/],
    ['page disallowed by robots.txt', '/private/item', /asks automated tools not to access/],
    ['page without product data', '/no-product', /couldn’t find product information/],
  ];
  it.each(failures)('falls back clearly for %s', async (_label, path, reason) => {
    const { cookie } = await user('importer');
    const res = await importUrl(cookie, path.startsWith('/') ? `${site.origin}${path}` : path);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'IMPORT_FAILED', message: IMPORT_FALLBACK_MESSAGE });
    expect(res.json().error.fields.reason).toMatch(reason);
  });

  it('requires auth', async () => {
    expect((await ctx.app.inject({ method: 'POST', url: '/api/products/import', payload: { url: site.origin } })).statusCode).toBe(401);
  });
});

describe('saving products', () => {
  it('saves an imported product with user edits, chosen try-on image, variants and size chart', async () => {
    const { cookie } = await user('saver');
    const draft: ImportDraft = (await importUrl(cookie, `${site.origin}/products/slim-chinos`)).json().draft;
    const res = await createProduct(cookie, {
      source: 'product_url',
      fields: {
        ...draft.fields,
        name: 'Slim Chinos (navy)', // user edit
        color: 'Navy',
        sizes: ['30', '32'], // user removed 34
        sourceUrl: draft.canonicalUrl,
      },
      images: [
        { kind: 'url', url: `${site.origin}/img/front.png`, imageType: 'garment_front' },
        { kind: 'url', url: `${site.origin}/img/back.png`, imageType: 'garment_back' },
        { kind: 'url', url: `${site.origin}/img/front-dupe.jpg`, imageType: 'on_model' },
      ],
      tryOnImageIndex: 1,
      importInfo: { importers: draft.importers, fetchedUrl: draft.fetchedUrl, warnings: draft.warnings },
    });
    expect(res.statusCode).toBe(201);
    const { product, notices } = res.json();
    expect(notices).toContain('A duplicate image was skipped.');
    expect(product).toMatchObject({ source: 'product_url', name: 'Slim Chinos (navy)', color: 'Navy', category: 'trousers', sizes: ['30', '32'] });
    expect(product.images).toHaveLength(2);
    expect(product.images.map((i: { imageType: string }) => i.imageType)).toEqual(['garment_front', 'garment_back']);
    expect(product.tryOnImageId).toBe(product.images[1].id);
    expect(product.images[0].sourceUrl).toBe(`${site.origin}/img/front.png`);
    expect(product.preparation).toEqual({ processorVersion: 'sharp-basic-0.1', backgroundRemoval: 'not_available' });
    // Chart rows are kept for every size in the chart; cm values normalised, raw text retained.
    expect(product.sizeChart.rows).toHaveLength(3);
    expect(product.sizeChart.rows[1]).toMatchObject({ sizeLabel: '32', waistCm: 82.6, raw: { waist: { raw: '32-33' } } });

    // Stored copies: original + prepared per image, served only to the owner.
    expect(ctx.storage.files.size).toBeGreaterThanOrEqual(4);
    const img = await ctx.app.inject({ method: 'GET', url: product.images[0].url, headers: { cookie } });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['cache-control']).toBe('private, no-store');
    const original = await ctx.app.inject({ method: 'GET', url: `${product.images[0].url}?variant=original`, headers: { cookie } });
    expect((await sharp(original.rawPayload).metadata()).width).toBe(400);

    // Importing the same link again warns about the duplicate.
    const again: ImportDraft = (await importUrl(cookie, `${site.origin}/products/slim-chinos`)).json().draft;
    expect(again.possibleDuplicates).toEqual([{ id: product.id, name: 'Slim Chinos (navy)' }]);
  });

  it('uploads a product manually with multiple images', async () => {
    const { cookie } = await user('uploader');
    const res = await createProduct(
      cookie,
      {
        source: 'manual_upload',
        fields: manualFields,
        images: [
          { kind: 'upload', field: 'image0', imageType: 'garment_front' },
          { kind: 'upload', field: 'image1', imageType: 'garment_back' },
        ],
        tryOnImageIndex: 0,
      },
      { image0: await garmentPng('#eeeeee'), image1: await garmentPng('#222222') },
    );
    expect(res.statusCode).toBe(201);
    const { product } = res.json();
    expect(product).toMatchObject({ source: 'manual_upload', name: 'White Tee', sizeLabel: 'M', sizes: [], sizeChart: null });
    expect(product.images).toHaveLength(2);
    expect(product.tryOnImageId).toBe(product.images[0].id);

    const list = (await ctx.app.inject({ method: 'GET', url: '/api/products', headers: { cookie } })).json();
    expect(list.products).toHaveLength(1);
    expect(list.products[0]).toMatchObject({ name: 'White Tee', category: 't_shirts', source: 'manual_upload', imageUrl: product.images[0].url });
  });

  it('rejects non-image and oversized uploads', async () => {
    const { cookie } = await user('importer');
    const data = { source: 'manual_upload', fields: manualFields, images: [{ kind: 'upload', field: 'image0', imageType: 'unknown' }], tryOnImageIndex: 0 };
    const pdf = await createProduct(cookie, data, { image0: Buffer.from('%PDF-1.7 fake') });
    expect(pdf.statusCode).toBe(400);
    expect(pdf.json().error).toMatchObject({ code: 'BAD_IMAGE', fields: { image0: expect.stringMatching(/supported image/) } });
    const big = await createProduct(cookie, data, { image0: Buffer.alloc(11 * 1024 * 1024, 1) });
    expect(big.statusCode).toBe(413);
  });

  it('validates fields and the try-on choice', async () => {
    const { cookie } = await user('importer');
    const res = await createProduct(
      cookie,
      {
        source: 'manual_upload',
        fields: { ...manualFields, name: '', category: 'shoes', currency: 'euro' },
        images: [{ kind: 'upload', field: 'image0', imageType: 'unknown' }],
        tryOnImageIndex: 0,
      },
      { image0: await garmentPng('#ccc') },
    );
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields).sort()).toEqual(['fields.category', 'fields.currency', 'fields.name']);
  });

  it('skips remote images that are not images, and fails clearly when none are usable', async () => {
    const { cookie } = await user('importer');
    const res = await createProduct(cookie, {
      source: 'product_url',
      fields: manualFields,
      images: [
        { kind: 'url', url: `${site.origin}/img/fake.png`, imageType: 'unknown' },
        { kind: 'url', url: 'http://10.0.0.1/secret.png', imageType: 'unknown' },
        { kind: 'url', url: `${site.origin}/img/tiny.png`, imageType: 'unknown' },
      ],
      tryOnImageIndex: 0,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('NO_USABLE_IMAGES');
  });
});

describe('editing, ownership and deletion', () => {
  async function seed(cookie: string) {
    return (
      await createProduct(
        cookie,
        {
          source: 'manual_upload',
          fields: { ...manualFields, sizes: ['S', 'M'], sizeChart: { unit: 'cm', kind: 'garment', source: 'user', rows: [{ sizeLabel: 'M', chestCm: 104, waistCm: null, hipsCm: null, shoulderCm: 45, inseamCm: null, sleeveCm: null, raw: {} }] } },
          images: [
            { kind: 'upload', field: 'image0', imageType: 'garment_front' },
            { kind: 'upload', field: 'image1', imageType: 'unknown' },
          ],
          tryOnImageIndex: 1,
        },
        { image0: await garmentPng('#14532d'), image1: await garmentPng('#7c2d12') },
      )
    ).json().product;
  }

  it('lets the owner edit fields, sizes, image types and the try-on image, and remove images', async () => {
    const { cookie } = await user('editor');
    const product = await seed(cookie);
    const [first, second] = product.images;
    expect(product.sizeChart.rows[0]).toMatchObject({ sizeLabel: 'M', chestCm: 104 });

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/products/${product.id}`,
      headers: { cookie },
      payload: {
        fields: { name: 'Green Tee', brand: 'Acme', sizes: ['M', 'L'], price: 25, currency: 'gbp' },
        tryOnImageId: first.id,
        imageTypes: { [first.id]: 'garment_back' },
        removeImageIds: [second.id],
      },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json().product;
    expect(updated).toMatchObject({ name: 'Green Tee', brand: 'Acme', sizes: ['M', 'L'], price: 25, currency: 'GBP', tryOnImageId: first.id });
    expect(updated.images).toHaveLength(1);
    expect(updated.images[0].imageType).toBe('garment_back');
    expect(updated.sizeChart.rows[0].sizeLabel).toBe('M');
    expect((await ctx.app.inject({ method: 'GET', url: second.url, headers: { cookie } })).statusCode).toBe(404);

    // An edit that doesn't mention sizes or the chart leaves them untouched.
    const renamed = (
      await ctx.app.inject({ method: 'PATCH', url: `/api/products/${product.id}`, headers: { cookie }, payload: { fields: { name: 'Renamed' } } })
    ).json().product;
    expect(renamed).toMatchObject({ name: 'Renamed', sizes: ['M', 'L'], brand: 'Acme' });
    expect(renamed.sizeChart.rows).toHaveLength(1);

    const removeAll = await ctx.app.inject({ method: 'PATCH', url: `/api/products/${product.id}`, headers: { cookie }, payload: { fields: {}, removeImageIds: [first.id] } });
    expect(removeAll.statusCode).toBe(400);
  });

  it('keeps products and images private to their owner', async () => {
    const owner = await user('owner');
    const other = await user('other');
    const product = await seed(owner.cookie);
    const as = (cookie: string | undefined, method: 'GET' | 'PATCH' | 'DELETE', url: string) =>
      ctx.app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(method === 'PATCH' && { payload: { fields: { name: 'x' } } }) });

    expect((await as(undefined, 'GET', `/api/products/${product.id}`)).statusCode).toBe(401);
    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      expect((await as(other.cookie, method, `/api/products/${product.id}`)).statusCode).toBe(404);
    }
    expect((await as(other.cookie, 'GET', product.images[0].url)).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/products', headers: { cookie: other.cookie } })).json().products).toEqual([]);
    // Another user's image id can't be set as the try-on image either.
    const mine = await seed(other.cookie);
    const res = await ctx.app.inject({ method: 'PATCH', url: `/api/products/${mine.id}`, headers: { cookie: other.cookie }, payload: { fields: {}, tryOnImageId: product.images[0].id } });
    expect(res.statusCode).toBe(400);
  });

  it('deletes a product with its images, variants and size chart', async () => {
    const { cookie } = await user('editor');
    const product = await seed(cookie);
    const before = ctx.storage.files.size;
    const res = await ctx.app.inject({ method: 'DELETE', url: `/api/products/${product.id}`, headers: { cookie } });
    expect(res.statusCode).toBe(204);
    expect(ctx.storage.files.size).toBe(before - 4);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/products/${product.id}`, headers: { cookie } })).statusCode).toBe(404);
  });
});
