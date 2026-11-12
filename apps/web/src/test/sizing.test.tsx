import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_SIZE_RECOMMENDATION_MESSAGE, SIZE_DISCLAIMER, recommendSize, type SizeEngineInput, type SizeRecommendation } from '@fitvision/shared';
import { SizeRecommendationCard } from '../features/sizing/SizeRecommendationCard';
import { mockApi } from './mockApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

const chart: SizeEngineInput['chart'] = {
  kind: 'body',
  source: 'html_table',
  unit: 'cm',
  rows: [
    { sizeLabel: 'S', values: { chestCm: { min: 88, max: 92 }, waistCm: { min: 72, max: 76 }, hipsCm: { min: 92, max: 96 } } },
    { sizeLabel: 'M', values: { chestCm: { min: 93, max: 98 }, waistCm: { min: 77, max: 83 }, hipsCm: { min: 97, max: 102 } } },
    { sizeLabel: 'L', values: { chestCm: { min: 99, max: 104 }, waistCm: { min: 84, max: 90 }, hipsCm: { min: 103, max: 108 } } },
  ],
};
const rec = (values: SizeEngineInput['user']['values'], c: SizeEngineInput['chart'] = chart): SizeRecommendation => ({
  id: 'r1',
  productId: 'p1',
  measurementId: 'm1',
  measurementSource: 'corrected',
  scanVersion: 'mediapipe-pose-full-1.1.1+geom-0.1-uncalibrated',
  recommendedVariantId: null,
  createdAt: '2026-11-05T10:00:00.000Z',
  result: recommendSize({ category: 'dresses', user: { measurementId: 'm1', source: 'corrected', scanVersion: null, values }, chart: c, availableSizes: ['S', 'M', 'L'] }),
});
const profile = { status: 200, body: { profile: { measurementUnit: 'metric' } } };
const renderCard = (compact = false) =>
  render(
    <MemoryRouter>
      <SizeRecommendationCard productId="p1" compact={compact} />
    </MemoryRouter>,
  );

describe('size recommendation card', () => {
  it('finds my size and shows the measurement-by-measurement reasoning', async () => {
    const { calls } = mockApi({
      'GET /api/profile': () => profile,
      'GET /api/products/p1/size-recommendation': () => ({ status: 200, body: { recommendation: null, stale: [], canCompute: true } }),
      'POST /api/products/p1/size-recommendation': () => ({ status: 201, body: { recommendation: rec({ chestCm: 96, waistCm: 82, hipsCm: 98 }), stale: [], canCompute: true } }),
    });
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole('button', { name: 'Find my size' }));
    expect(calls.some((c) => c.key === 'POST /api/products/p1/size-recommendation')).toBe(true);
    expect(await screen.findByText('High confidence')).toBeInTheDocument();
    expect(screen.getByText(/Recommended size:/)).toHaveTextContent('Recommended size: M');
    const row = (label: string) => screen.getByRole('rowheader', { name: label }).closest('tr')!;
    expect(row('Chest / bust')).toHaveTextContent('96 cmM · fits');
    expect(row('Hips')).toHaveTextContent('98 cmM · fits');
    expect(screen.getByText(/Based on your confirmed measurements \(from your body scan, with your corrections, scan mediapipe/)).toBeInTheDocument();
    expect(screen.getByText(SIZE_DISCLAIMER)).toBeInTheDocument();
    expect(screen.queryByText(/AI/)).not.toBeInTheDocument();
  });

  it('explains conflicts instead of hiding them, with an alternative', async () => {
    mockApi({
      'GET /api/profile': () => profile,
      'GET /api/products/p1/size-recommendation': () => ({ status: 200, body: { recommendation: rec({ chestCm: 96, waistCm: 80, hipsCm: 105 }), stale: [], canCompute: true } }),
    });
    renderCard();
    expect(await screen.findByText(/Your chest \/ bust and waist measurements align with M, while your hips measurement aligns more closely with L/)).toBeInTheDocument();
    expect(screen.getByText('Alternative: M.')).toBeInTheDocument();
    expect(screen.getByText('Medium confidence')).toBeInTheDocument();
  });

  it('shows between-sizes guidance', async () => {
    mockApi({
      'GET /api/profile': () => profile,
      'GET /api/products/p1/size-recommendation': () => ({ status: 200, body: { recommendation: rec({ chestCm: 98.5, waistCm: 80, hipsCm: 99 }), stale: [], canCompute: true } }),
    });
    renderCard();
    await screen.findByText('Medium confidence');
    expect(document.querySelector('.fv-size-headline')).toHaveTextContent('Between M and L — recommended L');
    expect(screen.getAllByText(/Choose M for a closer fit/).length).toBeGreaterThan(0);
  });

  it('flags stale recommendations and recalculates', async () => {
    const { calls } = mockApi({
      'GET /api/profile': () => profile,
      'GET /api/products/p1/size-recommendation': () => ({ status: 200, body: { recommendation: rec({ chestCm: 96, waistCm: 82, hipsCm: 98 }), stale: ['measurements_changed'], canCompute: true } }),
      'POST /api/products/p1/size-recommendation': () => ({ status: 201, body: { recommendation: rec({ chestCm: 96, waistCm: 82, hipsCm: 98 }), stale: [], canCompute: true } }),
    });
    const user = userEvent.setup();
    renderCard();
    expect(await screen.findByText(/Your body measurements have changed since this recommendation was generated/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Recalculate' }));
    expect(calls.filter((c) => c.key === 'POST /api/products/p1/size-recommendation')).toHaveLength(1);
    expect(screen.queryByText(/have changed since/)).not.toBeInTheDocument();
  });

  it('says so plainly when no recommendation is possible', async () => {
    mockApi({
      'GET /api/profile': () => profile,
      'GET /api/products/p1/size-recommendation': () => ({ status: 200, body: { recommendation: rec({ chestCm: 96 }, null), stale: [], canCompute: true } }),
    });
    renderCard();
    expect(await screen.findByText('No recommendation available')).toBeInTheDocument();
    expect(screen.getByText(NO_SIZE_RECOMMENDATION_MESSAGE)).toBeInTheDocument();
  });

  it('asks for measurements when none are saved, and stays brief in compact mode', async () => {
    mockApi({
      'GET /api/profile': () => profile,
      'GET /api/products/p1/size-recommendation': () => ({ status: 200, body: { recommendation: null, stale: [], canCompute: false } }),
    });
    renderCard();
    expect(await screen.findByRole('link', { name: 'Add your measurements' })).toHaveAttribute('href', '/profile');
  });

  it('compact mode links to the full breakdown instead of showing the table', async () => {
    mockApi({
      'GET /api/profile': () => profile,
      'GET /api/products/p1/size-recommendation': () => ({ status: 200, body: { recommendation: rec({ chestCm: 96, waistCm: 82, hipsCm: 98 }), stale: [], canCompute: true } }),
    });
    renderCard(true);
    expect(await screen.findByRole('link', { name: 'See the full size breakdown' })).toHaveAttribute('href', '/clothing/p1');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
