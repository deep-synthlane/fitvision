import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_DISCLAIMER, type Avatar, type BodyParameters } from '@fitvision/shared';
import { AvatarPage } from '../features/avatar/AvatarPage';
import { mockApi } from './mockApi';

// jsdom has no WebGL; stand in for the three.js viewer.
vi.mock('../features/avatar/AvatarViewer', () => ({
  AvatarViewer: ({ view, autoRotate }: { view: string; autoRotate: boolean }) => (
    <div data-testid="viewer">
      view:{view} rotate:{String(autoRotate)}
    </div>
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const parameters: BodyParameters = {
  inputs: {
    measurementId: 'm1',
    clothingPreference: 'womenswear',
    values: { heightCm: 165, shoulderCm: null, chestCm: 88, waistCm: 70, hipsCm: 96, inseamCm: 76, armLengthCm: null },
  },
  resolved: {
    heightCm: { valueCm: 165, source: 'measured' },
    shoulderCm: { valueCm: 38, source: 'default' },
    chestCm: { valueCm: 88, source: 'measured' },
    waistCm: { valueCm: 70, source: 'measured' },
    hipsCm: { valueCm: 96, source: 'measured' },
    inseamCm: { valueCm: 76, source: 'measured' },
    armLengthCm: { valueCm: 53.6, source: 'default' },
  },
  sections: { chest: { widthCm: 32, depthCm: 23 }, waist: { widthCm: 25, depthCm: 19 }, hips: { widthCm: 34, depthCm: 26 } },
  fidelity: { heightErrorCm: 0, shoulderErrorCm: 0, inseamErrorCm: 0, chestErrorPct: -0.1, waistErrorPct: -0.1, hipsErrorPct: -0.1 },
};

const avatar = (overrides: Partial<Avatar> = {}): Avatar => ({
  id: 'a1',
  status: 'ready',
  avatarType: 'parametric_mannequin',
  modelVersion: 'parametric-mannequin-0.1',
  measurementId: 'm1',
  bodyScanId: null,
  parameters,
  error: null,
  assetUrl: '/api/avatars/a1/asset',
  previewUrl: '/api/avatars/a1/preview',
  createdAt: '2026-11-04T10:00:00.000Z',
  updatedAt: '2026-11-04T10:00:00.000Z',
  ...overrides,
});

const profile = { status: 200, body: { profile: { measurementUnit: 'metric' } } };
const renderPage = () =>
  render(
    <MemoryRouter>
      <AvatarPage />
    </MemoryRouter>,
  );

describe('avatar page', () => {
  it('asks for measurements when there is nothing to build from', async () => {
    mockApi({
      'GET /api/profile': () => profile,
      'GET /api/avatars/current': () => ({ status: 200, body: { avatar: null, outdated: false, canGenerate: false } }),
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Add your measurements first' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start body scan' })).toHaveAttribute('href', '/scan');
    expect(screen.getByText(AVATAR_DISCLAIMER)).toBeInTheDocument();
  });

  it('generates: pending → processing → ready, then shows the 3D view and what it was built from', async () => {
    let polls = 0;
    const { calls } = mockApi({
      'GET /api/profile': () => profile,
      'GET /api/avatars/current': () => {
        polls++;
        if (polls === 1) return { status: 200, body: { avatar: null, outdated: false, canGenerate: true } };
        if (polls === 2) return { status: 200, body: { avatar: avatar({ status: 'processing', assetUrl: null, parameters: null }), outdated: false, canGenerate: true } };
        return { status: 200, body: { avatar: avatar(), outdated: false, canGenerate: true } };
      },
      'POST /api/avatars': () => ({ status: 202, body: { avatar: avatar({ status: 'pending', assetUrl: null, previewUrl: null, parameters: null }) } }),
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Create my avatar' }));
    expect(calls.some((c) => c.key === 'POST /api/avatars')).toBe(true);
    expect(await screen.findByText(/Queued/)).toBeInTheDocument();
    expect(await screen.findByText(/Building your avatar/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByTestId('viewer', {}, { timeout: 3000 })).toHaveTextContent('view:front');

    expect(screen.getByText('Approximate · parametric model')).toBeInTheDocument();
    expect(screen.getAllByText('Typical, not measured')).toHaveLength(2);
    expect(screen.getByText('88 cm')).toBeInTheDocument();
    expect(screen.queryByText(/AI/)).not.toBeInTheDocument();
  });

  it('switches between front, side and back views and 360° rotation', async () => {
    mockApi({
      'GET /api/profile': () => profile,
      'GET /api/avatars/current': () => ({ status: 200, body: { avatar: avatar(), outdated: false, canGenerate: true } }),
    });
    renderPage();
    await screen.findByTestId('viewer');
    await userEvent.click(screen.getByRole('button', { name: 'Side' }));
    expect(screen.getByTestId('viewer')).toHaveTextContent('view:side');
    expect(screen.getByRole('button', { name: 'Side' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('viewer')).toHaveTextContent('view:back');
    await userEvent.click(screen.getByRole('button', { name: '360° rotate' }));
    expect(screen.getByTestId('viewer')).toHaveTextContent('rotate:true');
  });

  it('offers regeneration when measurements changed, and retry after a failure', async () => {
    let state: 'outdated' | 'failed' = 'outdated';
    const { calls } = mockApi({
      'GET /api/profile': () => profile,
      'GET /api/avatars/current': () =>
        state === 'outdated'
          ? { status: 200, body: { avatar: avatar(), outdated: true, canGenerate: true } }
          : { status: 200, body: { avatar: avatar({ status: 'failed', error: 'We couldn’t generate your avatar. Please try again.', assetUrl: null }), outdated: false, canGenerate: true } },
      'POST /api/avatars': () => ({ status: 202, body: { avatar: avatar({ status: 'pending', assetUrl: null }) } }),
    });
    const view = renderPage();
    expect(await screen.findByText(/measurements have changed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate avatar' }));
    expect(calls.filter((c) => c.key === 'POST /api/avatars')).toHaveLength(1);

    view.unmount();
    state = 'failed';
    renderPage();
    expect(await screen.findByText('We couldn’t generate your avatar. Please try again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(calls.filter((c) => c.key === 'POST /api/avatars')).toHaveLength(2);
  });
});
