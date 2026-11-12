import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductSummary, SizeChart, WardrobeCollection } from '@fitvision/shared';
import { AccountDeletedPage } from '../features/account/AccountDeletedPage';
import { PrivacyPage } from '../features/account/PrivacyPage';
import { SizeChartEditor } from '../features/sizing/SizeChartEditor';
import { SizeFeedbackForm } from '../features/sizing/SizeFeedbackForm';
import { WardrobePage } from '../features/wardrobe/WardrobePage';
import { AuthProvider } from '../lib/auth';
import { mockApi } from './mockApi';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const item = (overrides: Partial<ProductSummary> = {}): ProductSummary => ({
  id: 'p1',
  name: 'Linen Shirt',
  brand: 'Acme',
  category: 'shirts',
  color: 'White',
  source: 'manual_upload',
  sizes: ['S', 'M'],
  isFavourite: false,
  createdAt: '2026-11-06T00:00:00.000Z',
  lastViewedAt: null,
  imageUrl: null,
  collectionIds: [],
  ...overrides,
});
const facets = { categories: ['shirts', 'jackets'], brands: ['Acme', 'Blue Co'], colors: ['White'] };

function renderWardrobe(path = '/wardrobe') {
  const router = createMemoryRouter([{ path: '/wardrobe', element: <WardrobePage /> }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('wardrobe', () => {
  it('passes search, filters and sort to the API through the URL', async () => {
    const { calls } = mockApi({
      'GET /api/collections': () => ({ status: 200, body: { collections: [] } }),
      'GET /api/products?sort=newest': () => ({ status: 200, body: { products: [item()], facets, total: 1 } }),
      'GET /api/products?brand=Acme&sort=newest': () => ({ status: 200, body: { products: [item()], facets, total: 1 } }),
      'GET /api/products?q=linen&brand=Acme&sort=newest': () => ({ status: 200, body: { products: [item()], facets, total: 1 } }),
      'GET /api/products?q=linen&brand=Acme&sort=oldest': () => ({ status: 200, body: { products: [], facets, total: 1 } }),
    });
    const user = userEvent.setup();
    const router = renderWardrobe();
    await screen.findByRole('link', { name: 'Linen Shirt' });
    await user.selectOptions(screen.getByLabelText('Brand'), 'Acme');
    await user.type(screen.getByLabelText('Search'), 'linen');
    await screen.findByText('1 of 1 item');
    await user.selectOptions(screen.getByLabelText('Sort'), 'oldest');
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument();
    expect(Object.fromEntries(new URLSearchParams(router.state.location.search))).toEqual({ brand: 'Acme', q: 'linen', sort: 'oldest' });
    expect(calls.map((c) => c.key)).toContain('GET /api/products?q=linen&brand=Acme&sort=oldest');
  });

  it('toggles favourites and adds items to collections', async () => {
    let fav = false;
    let collections: WardrobeCollection[] = [{ id: 'c1', name: 'Work', productIds: [], createdAt: '', updatedAt: '' }];
    const { calls } = mockApi({
      'GET /api/collections': () => ({ status: 200, body: { collections } }),
      'GET /api/products?sort=newest': () => ({ status: 200, body: { products: [item({ isFavourite: fav, collectionIds: collections[0]!.productIds.includes('p1') ? ['c1'] : [] })], facets, total: 1 } }),
      'POST /api/products/p1/favourite': (b) => {
        fav = (b as { favourite: boolean }).favourite;
        return { status: 200, body: {} };
      },
      'PUT /api/collections/c1/items/p1': () => {
        collections = [{ ...collections[0]!, productIds: ['p1'] }];
        return { status: 200, body: { collections } };
      },
    });
    const user = userEvent.setup();
    renderWardrobe();
    await user.click(await screen.findByRole('button', { name: 'Add Linen Shirt to favourites' }));
    expect(await screen.findByRole('button', { name: 'Remove Linen Shirt from favourites' })).toHaveAttribute('aria-pressed', 'true');
    expect(calls.find((c) => c.key === 'POST /api/products/p1/favourite')!.body).toEqual({ favourite: true });
    await user.selectOptions(screen.getByLabelText('Add Linen Shirt to a collection'), 'c1');
    expect(await screen.findByText('Work', { selector: '.fv-badge' })).toBeInTheDocument();
  });

  it('manages collections and removes saved looks', async () => {
    let collections: WardrobeCollection[] = [];
    const look = {
      id: 'l1',
      productId: 'p1',
      tryOnResultId: 't1',
      createdAt: '',
      tryOn: { id: 't1', productId: 'p1', productName: 'Linen Shirt', status: 'ready', source: 'mock', resultImageUrl: null, savedLookId: 'l1' },
    };
    const { calls } = mockApi({
      'GET /api/collections': () => ({ status: 200, body: { collections } }),
      'POST /api/collections': (b) => {
        collections = [...collections, { id: `c${collections.length + 1}`, name: (b as { name: string }).name, productIds: [], createdAt: '', updatedAt: '' }];
        return { status: 201, body: { collections } };
      },
      'PATCH /api/collections/c1': (b) => {
        collections = [{ ...collections[0]!, name: (b as { name: string }).name }];
        return { status: 200, body: { collections } };
      },
      'GET /api/saved-looks': () => ({ status: 200, body: { looks: [look] } }),
      'DELETE /api/saved-looks/l1': () => ({ status: 204 }),
    });
    const user = userEvent.setup();
    renderWardrobe('/wardrobe?tab=collections');
    await user.click(await screen.findByRole('button', { name: '+ Work' }));
    expect(await screen.findByRole('heading', { name: 'Work' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Work' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.clear(screen.getByLabelText('Rename Work'));
    await user.type(screen.getByLabelText('Rename Work'), 'Office');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Office' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Saved looks' }));
    await user.click(await screen.findByRole('button', { name: 'Remove saved look: Linen Shirt' }));
    expect(calls.some((c) => c.key === 'DELETE /api/saved-looks/l1')).toBe(true);
    expect(await screen.findByText('Save a try-on result to keep it here.')).toBeInTheDocument();
  });
});

describe('manual size chart', () => {
  it('parses ranges and inches, asks for review, then saves an engine-ready chart', async () => {
    const onSave = vi.fn(async (_c: SizeChart) => {});
    const user = userEvent.setup();
    render(<SizeChartEditor initial={null} onSave={onSave} onCancel={() => {}} />);
    await user.click(screen.getByLabelText('Inches'));
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Add at least two sizes.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Row 1 size label'), 'S');
    await user.type(screen.getByLabelText('Row 1 Chest / bust (in)'), '34-36');
    await user.type(screen.getByLabelText('Row 2 size label'), 'M');
    await user.type(screen.getByLabelText('Row 2 Chest / bust (in)'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText(/“abc” isn’t a number or range/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Row 2 Chest / bust (in)'));
    await user.type(screen.getByLabelText('Row 2 Chest / bust (in)'), '38 1/2');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByRole('heading', { name: 'Review size chart' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '88.9' })).toHaveAttribute('title', 'Original: 34-36');
    await user.click(screen.getByRole('button', { name: 'Save size chart' }));
    expect(onSave.mock.calls[0]![0]).toEqual({
      unit: 'in',
      kind: 'body',
      source: 'user',
      rows: [
        { sizeLabel: 'S', chestCm: 88.9, waistCm: null, hipsCm: null, shoulderCm: null, inseamCm: null, sleeveCm: null, raw: { chest: { raw: '34-36', minCm: 86.4, maxCm: 91.4 } } },
        { sizeLabel: 'M', chestCm: 97.8, waistCm: null, hipsCm: null, shoulderCm: null, inseamCm: null, sleeveCm: null, raw: { chest: { raw: '38 1/2', minCm: 97.8, maxCm: 97.8 } } },
      ],
    });
  });
});

describe('size feedback', () => {
  it('collects how the size fitted', async () => {
    const { calls } = mockApi({ 'POST /api/products/p1/size-feedback': () => ({ status: 201, body: { feedback: {} } }) });
    const user = userEvent.setup();
    render(<SizeFeedbackForm productId="p1" recommendationId="r1" sizes={['S', 'M']} />);
    await user.click(screen.getByRole('button', { name: 'Bought it? Tell us how it fitted' }));
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(screen.getByText('Choose how it fitted.')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Slightly small'));
    await user.type(screen.getByLabelText('Size you bought (optional)'), 'M');
    await user.click(screen.getByLabelText('Returned it'));
    await user.type(screen.getByLabelText('Why did you return it? (optional)'), 'Tight shoulders');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByText(/doesn’t change this recommendation/)).toBeInTheDocument();
    expect(calls[0]!.body).toEqual({ recommendationId: 'r1', fitRating: 'slightly_small', purchasedSize: 'M', returned: true, returnReason: 'Tight shoulders', fitPreference: null });
  });
});

describe('privacy & data controls', () => {
  function renderPrivacy() {
    const router = createMemoryRouter(
      [
        { path: '/privacy', element: <PrivacyPage /> },
        { path: '/goodbye', element: <AccountDeletedPage /> },
      ],
      { initialEntries: ['/privacy'] },
    );
    render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );
    return router;
  }

  it('explains each sensitive feature and deletes data by category', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => ({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }),
      'DELETE /api/account/data/scans': () => ({ status: 204 }),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderPrivacy();
    for (const h of ['Body scan', 'Avatar', 'Virtual try-on', 'Product imports']) expect(screen.getByRole('heading', { name: h })).toBeInTheDocument();
    expect(screen.getByText(/sent to that service/)).toBeInTheDocument();
    const row = screen.getByText('Body-scan photos').closest('li')!;
    await user.click(row.querySelector('button')!);
    expect(calls.some((c) => c.key === 'DELETE /api/account/data/scans')).toBe(true);
    expect(await screen.findByText('Body-scan photos deleted.')).toBeInTheDocument();
  });

  it('deletes the account only with the correct password', async () => {
    let attempts = 0;
    const { calls } = mockApi({
      'GET /api/auth/me': () => ({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }),
      'DELETE /api/account': () =>
        ++attempts === 1 ? { status: 403, body: { error: { code: 'INVALID_PASSWORD', message: 'Incorrect password', fields: { password: 'Incorrect password' } } } } : { status: 204 },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const router = renderPrivacy();
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(screen.getByText('Enter your password to confirm')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Confirm with your password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('Incorrect password')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Confirm with your password'));
    await user.type(screen.getByLabelText('Confirm with your password'), 'right-password');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByRole('heading', { name: 'Your account has been deleted' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/goodbye');
    expect(calls.filter((c) => c.key === 'DELETE /api/account').map((c) => c.body)).toEqual([{ password: 'wrong' }, { password: 'right-password' }]);
  });
});
