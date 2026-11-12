import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_FALLBACK_MESSAGE, type ImportDraft, type Product } from '@fitvision/shared';
import { AddClothingPage } from '../features/clothing/AddClothingPage';
import { ProductDetailPage } from '../features/clothing/ProductDetailPage';
import { WardrobePage } from '../features/wardrobe/WardrobePage';
import { mockApi } from './mockApi';

beforeEach(() => {
  let n = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:preview-${++n}`, revokeObjectURL: () => {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/wardrobe', element: <WardrobePage /> },
      { path: '/clothing/new', element: <AddClothingPage /> },
      { path: '/clothing/:id', element: <ProductDetailPage /> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const draft: ImportDraft = {
  fetchedUrl: 'https://shop.example.com/p/denim-jacket',
  canonicalUrl: 'https://shop.example.com/p/denim-jacket',
  fields: {
    name: 'Classic Denim Jacket',
    brand: 'Acme',
    category: 'jackets',
    subcategory: 'Denim Jackets',
    color: 'Indigo',
    price: 89.5,
    currency: 'EUR',
    description: null,
    sizes: ['S', 'M', 'L'],
    colors: ['Indigo'],
    variants: [{ sizeLabel: 'S', color: 'Indigo', sku: 'DJ-S', availability: 'InStock' }],
    sizeChart: {
      unit: 'in',
      kind: 'body',
      source: 'html_table',
      rows: [{ sizeLabel: 'M', chestCm: 99.1, waistCm: null, hipsCm: null, shoulderCm: null, inseamCm: null, sleeveCm: null, raw: { chest: { raw: '38-40', minCm: 96.5, maxCm: 101.6 } } }],
    },
  },
  origins: { name: 'structured_data', brand: 'structured_data', category: 'html', price: 'structured_data', color: 'not_found' },
  images: [
    { url: 'https://cdn.example.com/front.jpg', origin: 'structured_data' },
    { url: 'https://cdn.example.com/model.jpg', origin: 'structured_data' },
  ],
  importers: ['json-ld', 'html'],
  warnings: ['The size chart doesn’t state its unit; we assumed inches. Please check.'],
  possibleDuplicates: [],
};

const product: Product = {
  id: 'p1',
  source: 'product_url',
  sourceUrl: 'https://shop.example.com/p/denim-jacket',
  name: 'Classic Denim Jacket',
  brand: 'Acme',
  category: 'jackets',
  subcategory: 'Denim Jackets',
  color: 'Indigo',
  sizeLabel: null,
  price: 89.5,
  currency: 'EUR',
  description: null,
  sizes: ['S', 'M', 'L'],
  colors: ['Indigo'],
  tryOnImageId: 'i1',
  isFavourite: false,
  images: [
    { id: 'i1', url: '/api/products/p1/images/i1', sourceUrl: null, imageType: 'garment_front', position: 0, width: 400, height: 500 },
    { id: 'i2', url: '/api/products/p1/images/i2', sourceUrl: null, imageType: 'on_model', position: 1, width: 400, height: 500 },
  ],
  variants: [],
  sizeChart: null,
  preparation: { processorVersion: 'sharp-basic-0.1', backgroundRemoval: 'not_available' },
  createdAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
};

describe('product link import', () => {
  it('imports, lets the user review and correct everything, and saves the chosen images', async () => {
    const { calls } = mockApi({
      'POST /api/products/import': () => ({ status: 200, body: { draft } }),
      'POST /api/products': () => ({ status: 201, body: { product, notices: [] } }),
      'GET /api/products/p1': () => ({ status: 200, body: { product, notices: [] } }),
    });
    const user = userEvent.setup();
    const router = renderAt('/clothing/new');

    await user.type(screen.getByLabelText('Product link'), 'https://shop.example.com/p/denim-jacket');
    await user.click(screen.getByRole('button', { name: 'Import product' }));

    expect(await screen.findByRole('heading', { name: 'Review imported details' })).toBeInTheDocument();
    expect(screen.getByText(/we assumed inches/)).toBeInTheDocument();
    expect(screen.getByLabelText('Product name')).toHaveValue('Classic Denim Jacket');
    expect(screen.getAllByText('From the product data').length).toBeGreaterThan(0);
    expect(screen.getByText('From the page text — please check')).toBeInTheDocument();
    expect(screen.getByLabelText('Available sizes (optional)')).toHaveValue('S, M, L');
    expect(screen.getByRole('cell', { name: '99.1' })).toHaveAttribute('title', 'Original: 38-40');

    // User corrections.
    await user.clear(screen.getByLabelText('Product name'));
    await user.type(screen.getByLabelText('Product name'), 'Denim Jacket (Indigo)');
    // The server promotes a single variant colour.
    expect(screen.getByLabelText('Colour (optional)')).toHaveValue('Indigo');
    const [front, model] = screen.getAllByRole('img').filter((i) => i.getAttribute('src')?.startsWith('https://cdn'));
    const modelCard = model!.closest('.fv-image-card') as HTMLElement;
    await user.click(within(modelCard).getByLabelText('Include'));
    await user.selectOptions(screen.getByLabelText('Image 1 type'), 'garment_front');
    expect(front).toHaveAttribute('referrerpolicy', 'no-referrer');

    await user.click(screen.getByRole('button', { name: 'Save to my clothing' }));
    expect(await screen.findByRole('heading', { name: 'Classic Denim Jacket' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/clothing/p1');

    const form = calls.find((c) => c.key === 'POST /api/products')!.body as FormData;
    const data = JSON.parse(String(form.get('data')));
    expect(data).toMatchObject({
      source: 'product_url',
      tryOnImageIndex: 0,
      images: [{ kind: 'url', url: 'https://cdn.example.com/front.jpg', imageType: 'garment_front' }],
      fields: { name: 'Denim Jacket (Indigo)', color: 'Indigo', category: 'jackets', sizes: ['S', 'M', 'L'], price: 89.5, currency: 'EUR' },
      importInfo: { importers: ['json-ld', 'html'] },
    });
    expect(data.fields.sizeChart.rows).toHaveLength(1);
  });

  it('shows the fallback message and offers manual upload when import fails', async () => {
    mockApi({
      'POST /api/products/import': () => ({
        status: 422,
        body: { error: { code: 'IMPORT_FAILED', message: IMPORT_FALLBACK_MESSAGE, fields: { reason: 'The website blocked automated access.' } } },
      }),
    });
    const user = userEvent.setup();
    const router = renderAt('/clothing/new');
    await user.type(screen.getByLabelText('Product link'), 'https://blocked.example.com/p/1');
    await user.click(screen.getByRole('button', { name: 'Import product' }));
    expect(await screen.findByText(IMPORT_FALLBACK_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(/blocked automated access/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Upload clothing instead' }));
    expect(router.state.location.search).toBe('?mode=upload');
    expect(screen.getByLabelText('Product link (optional)')).toHaveValue('https://blocked.example.com/p/1');
  });

  it('rejects links that are not http(s) before calling the server', async () => {
    const { calls } = mockApi({});
    const user = userEvent.setup();
    renderAt('/clothing/new');
    await user.type(screen.getByLabelText('Product link'), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Import product' }));
    expect(screen.getByText(/starting with https/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe('manual upload', () => {
  it('validates files and fields, then uploads multiple images with the try-on choice', async () => {
    const { calls } = mockApi({
      'POST /api/products': () => ({ status: 201, body: { product, notices: ['A duplicate image was skipped.'] } }),
      'GET /api/products/p1': () => ({ status: 200, body: { product, notices: [] } }),
    });
    const user = userEvent.setup({ applyAccept: false });
    renderAt('/clothing/new?mode=upload');

    const input = screen.getByLabelText('Choose garment photos');
    await user.upload(input, [
      new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' }),
      new File([new Uint8Array(11 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' }),
      new File(['a'], 'front.png', { type: 'image/png' }),
      new File(['b'], 'back.png', { type: 'image/png' }),
    ]);
    expect(screen.getByText(/invoice.pdf: not a supported image/)).toBeInTheDocument();
    expect(screen.getByText(/huge.jpg: larger than 10 MB/)).toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: /Use for try-on/ })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Save to my clothing' }));
    expect(screen.getByText('Product name is required')).toBeInTheDocument();
    expect(screen.getByText('Choose a category')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Product name'), 'Linen Shirt');
    await user.selectOptions(screen.getByLabelText('Category'), 'shirts');
    await user.click(screen.getAllByRole('radio', { name: /Use for try-on/ })[1]!);
    await user.click(screen.getByRole('button', { name: 'Save to my clothing' }));

    expect(await screen.findByText('A duplicate image was skipped.')).toBeInTheDocument();
    const form = calls.find((c) => c.key === 'POST /api/products')!.body as FormData;
    const data = JSON.parse(String(form.get('data')));
    expect(data).toMatchObject({
      source: 'manual_upload',
      tryOnImageIndex: 1,
      images: [
        { kind: 'upload', field: 'image0' },
        { kind: 'upload', field: 'image1' },
      ],
      fields: { name: 'Linen Shirt', category: 'shirts' },
    });
    expect((form.get('image0') as File).name).toBe('front.png');
  });
});

describe('clothing library and product page', () => {
  it('lists products in the wardrobe with Try on, and deletes', async () => {
    let deleted = false;
    const summary = { id: 'p1', name: 'Classic Denim Jacket', brand: 'Acme', category: 'jackets', color: 'Indigo', source: 'product_url', sizes: ['S', 'M'], isFavourite: false, createdAt: '', lastViewedAt: null, imageUrl: '/api/products/p1/images/i1', collectionIds: [] };
    const { calls } = mockApi({
      'GET /api/products?sort=newest': () => ({ status: 200, body: { products: deleted ? [] : [summary], facets: { categories: ['jackets'], brands: ['Acme'], colors: ['Indigo'] }, total: deleted ? 0 : 1 } }),
      'GET /api/collections': () => ({ status: 200, body: { collections: [] } }),
      'DELETE /api/products/p1': () => {
        deleted = true;
        return { status: 204 };
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderAt('/wardrobe');
    expect(await screen.findByRole('link', { name: 'Classic Denim Jacket' })).toBeInTheDocument();
    expect(screen.getByText('Imported from link')).toBeInTheDocument();
    expect(screen.getByText('Sizes: S, M')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try on' })).toHaveAttribute('href', '/clothing/p1/try-on');
    expect(screen.getByRole('link', { name: 'Find my size' })).toHaveAttribute('href', '/clothing/p1#size');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(calls.some((c) => c.key === 'DELETE /api/products/p1')).toBe(true);
    expect(await screen.findByText(/No clothing yet/)).toBeInTheDocument();
  });

  it('edits a product: fields, try-on image, image types and removal', async () => {
    const { calls } = mockApi({
      'GET /api/products/p1': () => ({ status: 200, body: { product, notices: [] } }),
      'PATCH /api/products/p1': () => ({ status: 200, body: { product: { ...product, name: 'Renamed' }, notices: [] } }),
    });
    const user = userEvent.setup();
    renderAt('/clothing/p1');
    expect(await screen.findByRole('link', { name: 'Try on' })).toHaveAttribute('href', '/clothing/p1/try-on');
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    await user.clear(await screen.findByLabelText('Product name'));
    await user.type(screen.getByLabelText('Product name'), 'Renamed');
    await user.click(screen.getAllByRole('radio', { name: /Use for try-on/ })[1]!);
    await user.selectOptions(screen.getByLabelText('Image 2 type'), 'garment_back');
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    const patch = calls.find((c) => c.key === 'PATCH /api/products/p1')!.body as Record<string, unknown>;
    expect(patch).toMatchObject({ tryOnImageId: 'i2', imageTypes: { i2: 'garment_back' }, removeImageIds: ['i1'], fields: { name: 'Renamed' } });
  });
});
