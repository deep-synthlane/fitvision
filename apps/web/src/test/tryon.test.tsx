import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_TRY_ON_NOTICE, TRY_ON_DISCLAIMER, type Product, type TryOnProviderInfo, type TryOnResult, type TryOnSuitability } from '@fitvision/shared';
import type { PersonPhotoAnalyzer } from '../features/tryon/analyzer';
import { TryOnResultPage } from '../features/tryon/TryOnResultPage';
import { TryOnStartPage } from '../features/tryon/TryOnStartPage';
import { mockApi } from './mockApi';

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', async () => ({ width: 600, height: 900, close: () => {} }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => {} } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['jpeg'], { type: 'image/jpeg' })));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:candidate', revokeObjectURL: () => {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const suitable: TryOnSuitability = {
  checkedBy: 'test',
  onePerson: true,
  facingCamera: true,
  personHeightFraction: 0.85,
  regions: { upper_body: true, lower_body: true, full_body: true },
  lightingOk: true,
  sharpOk: true,
  issues: [],
};
const upperOnly: TryOnSuitability = { ...suitable, regions: { upper_body: true, lower_body: false, full_body: false }, issues: ['Your hips, knees and ankles need to be visible for trousers, skirts and shorts.'] };

const product: Product = {
  id: 'p1',
  source: 'manual_upload',
  sourceUrl: null,
  name: 'Linen Dress',
  brand: null,
  category: 'dresses',
  subcategory: null,
  color: null,
  sizeLabel: null,
  price: null,
  currency: null,
  description: null,
  sizes: [],
  colors: [],
  tryOnImageId: 'g1',
  isFavourite: false,
  images: [
    { id: 'g1', url: '/api/products/p1/images/g1', sourceUrl: null, imageType: 'garment_front', position: 0, width: 800, height: 1000 },
    { id: 'g2', url: '/api/products/p1/images/g2', sourceUrl: null, imageType: 'detail', position: 1, width: 800, height: 1000 },
  ],
  variants: [],
  sizeChart: null,
  preparation: { processorVersion: 'x', backgroundRemoval: 'not_available' },
  createdAt: '',
  updatedAt: '',
};

const providerInfo = (overrides: Partial<TryOnProviderInfo> = {}): TryOnProviderInfo => ({
  provider: 'mock',
  modelVersion: 'mock-composite-0.1',
  source: 'mock',
  external: false,
  verified: true,
  avatarVerified: false,
  disclosure: null,
  limits: { dailyLimit: 20, usedToday: 3, maxActive: 2 },
  ...overrides,
});

const tryOn = (overrides: Partial<TryOnResult> = {}): TryOnResult => ({
  id: 't1',
  productId: 'p1',
  productImageId: 'g1',
  personPhotoId: 'ph1',
  personSource: 'uploaded_photo',
  avatarId: null,
  avatarModelVersion: null,
  status: 'ready',
  source: 'mock',
  provider: 'mock',
  modelVersion: 'mock-composite-0.1',
  providerJobId: 'mock-1',
  errorCode: null,
  errorMessage: null,
  resultImageUrl: '/api/try-ons/t1/image',
  personPhotoUrl: '/api/try-on-photos/ph1/image',
  garmentImageUrl: '/api/products/p1/images/g1',
  productName: 'Linen Dress',
  savedLookId: null,
  createdAt: '2026-11-05T10:00:00.000Z',
  startedAt: '2026-11-05T10:00:01.000Z',
  completedAt: '2026-11-05T10:00:05.000Z',
  ...overrides,
});

function renderAt(path: string, analysis: TryOnSuitability = suitable) {
  const analyzer: PersonPhotoAnalyzer = { analyze: vi.fn(async () => analysis), close: vi.fn() };
  const router = createMemoryRouter(
    [
      { path: '/clothing/:id/try-on', element: <TryOnStartPage createAnalyzer={() => analyzer} /> },
      { path: '/try-ons/:id', element: <TryOnResultPage /> },
      { path: '/clothing/:id', element: <p>Product page</p> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const photo = { id: 'ph1', source: 'uploaded_photo' as const, avatarId: null, avatarModelVersion: null, imageUrl: '/api/try-on-photos/ph1/image', thumbnailUrl: '/api/try-on-photos/ph1/image?size=thumb', suitability: { ...suitable, server: { width: 600, height: 900, sharpness: 80, sharpOk: true } }, createdAt: '' };

describe('try-on start', () => {
  it('checks a new photo, saves it, and submits with an idempotency key (mock clearly labelled)', async () => {
    const { calls } = mockApi({
      'GET /api/products/p1': () => ({ status: 200, body: { product, notices: [] } }),
      'GET /api/try-on-photos': () => ({ status: 200, body: { photos: [] } }),
      'GET /api/try-ons/provider': () => ({ status: 200, body: providerInfo() }),
      'POST /api/try-on-photos': () => ({ status: 201, body: { photo } }),
      'POST /api/try-ons': () => ({ status: 202, body: { tryOn: tryOn({ status: 'pending', resultImageUrl: null }) } }),
      'GET /api/try-ons/t1': () => ({ status: 200, body: { tryOn: tryOn({ status: 'pending', resultImageUrl: null }) } }),
    });
    const user = userEvent.setup();
    const router = renderAt('/clothing/p1/try-on');

    expect(await screen.findByText(/needs a photo suitable for full-body garments/)).toBeInTheDocument();
    expect(screen.getByText(/NOT generated by AI/)).toBeInTheDocument();
    expect(screen.getByText(/3 of 20 try-ons used today/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate try-on' })).toBeDisabled();
    // Detail shots can't be chosen as the garment image.
    expect(screen.getByRole('radio', { name: /Garment image 2/ })).toBeDisabled();

    await user.upload(screen.getByLabelText('Choose a try-on photo'), new File(['x'], 'me.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByText('Looks good for full-body garments (e.g. dresses).')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save & use this photo' }));
    const uploaded = calls.find((c) => c.key === 'POST /api/try-on-photos')!.body as FormData;
    expect(JSON.parse(String(uploaded.get('suitability')))).toMatchObject({ onePerson: true });
    expect(uploaded.get('origin')).toBe('uploaded_photo');

    await user.click(await screen.findByRole('button', { name: 'Generate try-on' }));
    expect(await screen.findByText(/Queued/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/try-ons/t1');
    const body = calls.find((c) => c.key === 'POST /api/try-ons')!.body as Record<string, unknown>;
    expect(body).toMatchObject({ productId: 'p1', personPhotoId: 'ph1', productImageId: 'g1', acknowledgeThirdParty: false });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('explains why a photo is unsuitable and does not let it be used', async () => {
    mockApi({
      'GET /api/products/p1': () => ({ status: 200, body: { product, notices: [] } }),
      'GET /api/try-on-photos': () => ({ status: 200, body: { photos: [] } }),
      'GET /api/try-ons/provider': () => ({ status: 200, body: providerInfo() }),
    });
    const user = userEvent.setup();
    renderAt('/clothing/p1/try-on', upperOnly);
    await user.upload(await screen.findByLabelText('Choose a try-on photo'), new File(['x'], 'me.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByText(/knees and ankles need to be visible/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save & use this photo' })).toBeDisabled();
  });

  it('requires explicit consent before using an external AI provider', async () => {
    const { calls } = mockApi({
      'GET /api/products/p1': () => ({ status: 200, body: { product, notices: [] } }),
      'GET /api/try-on-photos': () => ({ status: 200, body: { photos: [photo] } }),
      'GET /api/try-ons/provider': () => ({
        status: 200,
        body: providerInfo({ provider: 'replicate', source: 'real', external: true, verified: false, disclosure: 'Your photo will be sent to a third-party AI service (replicate).' }),
      }),
      'POST /api/try-ons': () => ({ status: 202, body: { tryOn: tryOn({ status: 'pending', source: 'real' }) } }),
      'GET /api/try-ons/t1': () => ({ status: 200, body: { tryOn: tryOn({ status: 'pending', source: 'real' }) } }),
    });
    const user = userEvent.setup();
    renderAt('/clothing/p1/try-on');
    await user.click(await screen.findByRole('radio', { name: /Your try-on photo/ }));
    expect(screen.getByText(/hasn’t been fully tested/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate try-on' })).toBeDisabled();
    await user.click(screen.getByLabelText(/third-party AI service/));
    await user.click(screen.getByRole('button', { name: 'Generate try-on' }));
    await screen.findByText(/Queued/);
    expect(calls.find((c) => c.key === 'POST /api/try-ons')!.body).toMatchObject({ acknowledgeThirdParty: true });
  });
});

describe('avatar try-on', () => {
  const render = { ...photo, id: 'av-render', source: 'avatar_render' as const, avatarId: 'a1', avatarModelVersion: 'parametric-mannequin-0.1', imageUrl: '/api/try-on-photos/av-render/image' };
  const avatarResponse = (status: string | null, outdated = false) => ({
    status: 200,
    body: { avatar: status ? { id: 'a1', status, modelVersion: 'parametric-mannequin-0.1' } : null, outdated, canGenerate: true },
  });
  const base = {
    'GET /api/products/p1': () => ({ status: 200, body: { product, notices: [] } }),
    'GET /api/try-on-photos': () => ({ status: 200, body: { photos: [] } }),
    'GET /api/try-ons/provider': () => ({ status: 200, body: providerInfo() }),
  };

  it('uses the rendered avatar as the try-on image, with an approximate-preview notice', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /api/avatars/current': () => avatarResponse('ready', true),
      'POST /api/try-on-photos/avatar-render': () => ({ status: 201, body: { photo: render } }),
      'POST /api/try-ons': () => ({ status: 202, body: { tryOn: tryOn({ status: 'pending', personPhotoId: 'av-render', personSource: 'avatar_render' }) } }),
      'GET /api/try-ons/t1': () => ({ status: 200, body: { tryOn: tryOn({ status: 'pending', personPhotoId: 'av-render', personSource: 'avatar_render' }) } }),
    });
    const user = userEvent.setup();
    const router = renderAt('/clothing/p1/try-on');
    await user.click(await screen.findByRole('button', { name: 'Use my avatar' }));
    expect(await screen.findByText('Using your avatar')).toBeInTheDocument();
    expect(screen.getByText('Avatar try-on is an approximate visual preview based on your saved body measurements.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Front view of your avatar/ })).toHaveAttribute('src', '/api/try-on-photos/av-render/image');
    expect(screen.getByText(/measurements have changed since this avatar was made/)).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/try-on-photos/avatar-render')!.body).toEqual({ productId: 'p1' });
    // The confirmation step shows both inputs, labelled as inputs.
    const inputs = screen.getByLabelText('Try-on inputs');
    expect(within(inputs).getByRole('img', { name: 'Avatar input' })).toHaveAttribute('src', render.thumbnailUrl);
    expect(within(inputs).getByRole('img', { name: 'Selected garment input' })).toHaveAttribute('src', product.images[0]!.url);
    expect(screen.getByText(/Avatar input — the try-on result is generated from this/)).toBeInTheDocument();

    // Switching back shows the photo options again; switching to the avatar again re-uses it.
    await user.click(screen.getByRole('button', { name: 'Use a photo instead' }));
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use my avatar' }));
    await screen.findByText('Using your avatar');

    await user.click(screen.getByRole('button', { name: 'Generate try-on' }));
    await screen.findByText(/Queued/);
    expect(router.state.location.pathname).toBe('/try-ons/t1');
    expect(calls.find((c) => c.key === 'POST /api/try-ons')!.body).toMatchObject({ productId: 'p1', personPhotoId: 'av-render' });
  });

  it('warns that avatar try-on is unverified with a real provider', async () => {
    mockApi({
      ...base,
      'GET /api/try-ons/provider': () => ({ status: 200, body: providerInfo({ provider: 'replicate', source: 'real', verified: true, avatarVerified: false }) }),
      'GET /api/avatars/current': () => avatarResponse('ready'),
      'POST /api/try-on-photos/avatar-render': () => ({ status: 201, body: { photo: render } }),
    });
    const user = userEvent.setup();
    renderAt('/clothing/p1/try-on');
    await user.click(await screen.findByRole('button', { name: 'Use my avatar' }));
    expect(await screen.findByText(/Avatar try-on hasn’t been verified with this try-on service yet/)).toBeInTheDocument();
  });

  it('asks the user to create an avatar first when there is none', async () => {
    const { calls } = mockApi({ ...base, 'GET /api/avatars/current': () => avatarResponse(null) });
    const user = userEvent.setup();
    renderAt('/clothing/p1/try-on');
    await user.click(await screen.findByRole('button', { name: 'Use my avatar' }));
    expect(await screen.findByText('You need to create your avatar before using avatar try-on.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create my avatar' })).toHaveAttribute('href', '/avatar');
    expect(screen.getByRole('button', { name: 'Generate try-on' })).toBeDisabled();
    expect(calls.some((c) => c.key === 'POST /api/try-on-photos/avatar-render')).toBe(false);
  });
});

describe('try-on result (avatar)', () => {
  it('says when the avatar was used', async () => {
    mockApi({
      'GET /api/try-ons/t1': () => ({ status: 200, body: { tryOn: tryOn({ personSource: 'avatar_render', avatarId: 'a1', avatarModelVersion: 'parametric-mannequin-0.1' }) } }),
      'GET /api/products/p1/size-recommendation': () => ({ status: 200, body: { recommendation: null, stale: false } }),
    });
    const user = userEvent.setup();
    renderAt('/try-ons/t1');
    expect(await screen.findByText('Using your avatar.')).toBeInTheDocument();
    expect(screen.getByText('Avatar try-on is an approximate visual preview based on your saved body measurements.')).toBeInTheDocument();

    // The generated output is the result; the avatar input is not shown until asked for.
    const card = screen.getByRole('heading', { name: 'Visual try-on result' }).closest('section, div.fv-card, [aria-labelledby]') as HTMLElement;
    const images = within(card).getAllByRole('img');
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute('src', '/api/try-ons/t1/image');
    expect(within(card).getAllByRole('button').map((b) => b.textContent).slice(0, 4)).toEqual(['Compare with my avatar', 'View garment', 'Regenerate', 'Save look']);

    await user.click(screen.getByRole('button', { name: 'Compare with my avatar' }));
    expect(screen.getByRole('img', { name: 'Front view of your avatar' })).toHaveAttribute('src', '/api/try-on-photos/ph1/image');
    expect(screen.getByText('Your avatar (input)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View garment' }));
    expect(screen.getByRole('img', { name: 'Garment image used' })).toBeInTheDocument();
  });

  it('polls until ready, labels mock output, compares, saves and deletes', async () => {
    let polls = 0;
    let saved = false;
    const { calls } = mockApi({
      'GET /api/try-ons/t1': () => {
        polls++;
        return { status: 200, body: { tryOn: polls === 1 ? tryOn({ status: 'processing', resultImageUrl: null }) : tryOn({ savedLookId: saved ? 'l1' : null }) } };
      },
      'POST /api/saved-looks': () => {
        saved = true;
        return { status: 201, body: {} };
      },
      'DELETE /api/try-ons/t1': () => ({ status: 204 }),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const router = renderAt('/try-ons/t1');

    expect(await screen.findByText(/Generating your try-on/)).toBeInTheDocument();
    expect(screen.getByText(/You can leave this page/)).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Try-on result: Linen Dress (mock)' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('Mock result — not AI')).toBeInTheDocument();
    expect(screen.getByText(MOCK_TRY_ON_NOTICE)).toBeInTheDocument();
    // A mock result must not also claim to be an AI-generated preview.
    expect(screen.queryByText(TRY_ON_DISCLAIMER)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Compare with my photo' }));
    expect(screen.getByRole('img', { name: 'Your original photo' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Garment image used' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View garment' }));
    expect(screen.getByRole('img', { name: 'Garment image used' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save look' }));
    expect(await screen.findByRole('button', { name: 'Saved ✓ (remove)' })).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/saved-looks')!.body).toEqual({ tryOnResultId: 't1' });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Product page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/clothing/p1');
  });

  it('shows a safe failure message and lets the user try again', async () => {
    const { calls } = mockApi({
      'GET /api/try-ons/t1': () => ({
        status: 200,
        body: { tryOn: tryOn({ status: 'failed', resultImageUrl: null, errorCode: 'provider_timeout', errorMessage: 'The try-on service took too long to respond. Please try again.' }) },
      }),
      'GET /api/try-ons/provider': () => ({ status: 200, body: providerInfo() }),
      'POST /api/try-ons': () => ({ status: 202, body: { tryOn: tryOn({ id: 't2', status: 'pending' }) } }),
      'GET /api/try-ons/t2': () => ({ status: 200, body: { tryOn: tryOn({ id: 't2', status: 'pending', resultImageUrl: null }) } }),
    });
    const user = userEvent.setup();
    const router = renderAt('/try-ons/t1');
    expect(await screen.findByText(/took too long to respond/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/Queued/);
    expect(router.state.location.pathname).toBe('/try-ons/t2');
    expect(calls.find((c) => c.key === 'POST /api/try-ons')!.body).toMatchObject({ productId: 'p1', personPhotoId: 'ph1', productImageId: 'g1' });
  });
});
