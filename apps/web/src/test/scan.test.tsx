import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BODY_SCAN_DISCLAIMER, type ScanEstimates } from '@fitvision/shared';
import type { BodyScanProcessor } from '../features/scan/engine';
import { ScanPage } from '../features/scan/ScanPage';
import { ReviewStep } from '../features/scan/steps/ReviewStep';
import { mockApi } from './mockApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

const result: ScanEstimates = {
  processingVersion: 'test',
  estimates: {
    shoulderCm: { valueCm: 41.5, confidence: 0.8 },
    chestCm: { valueCm: 96.2, confidence: 0.82 },
    waistCm: { valueCm: 82.4, confidence: 0.45 },
    hipsCm: { valueCm: 98.1, confidence: 0.7 },
  },
  proportions: { shoulderToHipRatio: 1.1, waistToHipRatio: 0.84, legToHeightRatio: 0.47, bodyShape: 'rectangle' },
  warnings: [],
};

function renderReview(overrides: Partial<Parameters<typeof ReviewStep>[0]> = {}) {
  const onSave = vi.fn();
  render(
    <ReviewStep
      result={result}
      unit="metric"
      heightCm={176}
      previous={null}
      saving={false}
      saveError={null}
      onSave={onSave}
      onRetake={vi.fn()}
      {...overrides}
    />,
  );
  return onSave;
}

describe('scan review', () => {
  it('shows the estimate disclaimer and highlights low-confidence values', () => {
    renderReview();
    expect(screen.getByText(BODY_SCAN_DISCLAIMER)).toBeInTheDocument();
    const waistRow = screen.getByLabelText('Waist (cm)').closest('.fv-review__row') as HTMLElement;
    expect(waistRow).toHaveClass('fv-review__row--low');
    expect(within(waistRow).getByText('Low confidence — please check')).toBeInTheDocument();
    expect(screen.getByText(/1 measurement has low confidence/)).toBeInTheDocument();
  });

  it('asks for inseam and arm length manually and saves accepted estimates unchanged', async () => {
    const onSave = renderReview();
    expect(screen.getByLabelText('Inseam (cm)')).toHaveValue('');
    expect(screen.getAllByText(/Not estimated from the scan — enter manually/)).toHaveLength(2);
    await userEvent.type(screen.getByLabelText('Inseam (cm)'), '81');
    expect(screen.getByText('These will be saved as body-scan measurements.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save scan & measurements' }));
    expect(onSave).toHaveBeenCalledWith({
      heightCm: 176,
      shoulderCm: 41.5,
      chestCm: 96.2,
      waistCm: 82.4,
      hipsCm: 98.1,
      inseamCm: 81,
      armLengthCm: null,
    });
  });

  it('marks edited estimates and announces they will be saved as corrected', async () => {
    const onSave = renderReview();
    await userEvent.clear(screen.getByLabelText('Waist (cm)'));
    await userEvent.type(screen.getByLabelText('Waist (cm)'), '80');
    expect(screen.getByText('Edited')).toBeInTheDocument();
    expect(screen.getByText(/saved as corrected measurements/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save scan & measurements' }));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ waistCm: 80, chestCm: 96.2 });
  });

  it('keeps exact values for untouched imperial estimates (no false corrections from rounding)', async () => {
    const onSave = renderReview({ unit: 'imperial' });
    expect(screen.getByLabelText('Chest / bust (in)')).toHaveValue('37.9');
    await userEvent.click(screen.getByRole('button', { name: 'Save scan & measurements' }));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ chestCm: 96.2, waistCm: 82.4 });
  });

  it('validates corrected values', async () => {
    const onSave = renderReview();
    await userEvent.clear(screen.getByLabelText('Hips (cm)'));
    await userEvent.type(screen.getByLabelText('Hips (cm)'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save scan & measurements' }));
    expect(screen.getByText('Hips must be 50–200 cm')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('scan page', () => {
  const fakeProcessor = (): BodyScanProcessor => ({
    processingVersion: 'fake',
    load: vi.fn(async () => {}),
    assess: vi.fn(),
    estimate: vi.fn(),
    close: vi.fn(),
  });

  function renderScan() {
    mockApi({
      'GET /api/profile': () => ({
        status: 200,
        body: {
          profile: {
            birthYear: null,
            clothingPreference: 'menswear',
            heightCm: 176,
            weightKg: 72,
            country: 'IN',
            measurementUnit: 'metric',
            onboardedAt: '2026-11-04T00:00:00.000Z',
            updatedAt: '2026-11-04T00:00:00.000Z',
          },
        },
      }),
      'GET /api/measurements/current': () => ({ status: 200, body: { measurements: null } }),
    });
    const router = createMemoryRouter([{ path: '/scan', element: <ScanPage createProcessor={fakeProcessor} /> }], {
      initialEntries: ['/scan'],
    });
    render(<RouterProvider router={router} />);
  }

  it('explains a blocked camera and offers uploading instead', async () => {
    renderScan();
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(new DOMException('denied', 'NotAllowedError'))) },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Allow camera' }));
    expect(await screen.findByText(/Camera access was blocked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Upload photos instead' }));
    expect(screen.getByRole('heading', { name: 'Before you start' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start with front photo' }));
    expect(screen.getByRole('heading', { name: /Front photo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Capture/ })).not.toBeInTheDocument();
  });

  it('reports when the browser has no camera API', async () => {
    renderScan();
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
    await userEvent.click(await screen.findByRole('button', { name: 'Allow camera' }));
    expect(await screen.findByText(/can’t access a camera/)).toBeInTheDocument();
  });
});
