import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicUser } from '@fitvision/shared';
import { mockApi } from './mockApi';
import { renderApp } from './renderApp';

const newUser: PublicUser = {
  id: 'u1',
  email: 'ana@example.com',
  name: 'Ana Silva',
  onboarded: false,
  createdAt: '2026-11-04T00:00:00.000Z',
};

const savedProfile = {
  birthYear: null,
  clothingPreference: 'womenswear',
  heightCm: 168,
  weightKg: 60,
  country: 'IN',
  measurementUnit: 'metric',
  onboardedAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
};

const savedMeasurements = {
  id: 'm1',
  heightCm: 168,
  chestCm: 88,
  waistCm: 70,
  hipsCm: null,
  shoulderCm: null,
  inseamCm: null,
  armLengthCm: null,
  source: 'manual',
  createdAt: '2026-11-04T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function api(withMeasurements = true) {
  return mockApi({
    'GET /api/auth/me': () => ({ status: 200, body: { user: newUser } }),
    'POST /api/measurements': () => ({ status: 201, body: { measurements: savedMeasurements } }),
    'PUT /api/profile': () => ({ status: 200, body: { profile: savedProfile, user: { ...newUser, onboarded: true } } }),
    'GET /api/profile': () => ({ status: 200, body: { profile: savedProfile } }),
    'GET /api/measurements/current': () => ({
      status: 200,
      body: { measurements: withMeasurements ? savedMeasurements : null },
    }),
    'GET /api/avatars/current': () => ({ status: 200, body: { avatar: null, outdated: false, canGenerate: withMeasurements } }),
  });
}

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByLabelText('Womenswear'));
  // jsdom reports en-US, so the form defaults to imperial; pick metric explicitly.
  await user.click(screen.getByLabelText('Metric (cm, kg)'));
  await user.type(screen.getByLabelText('Height (cm)'), '168');
  await user.type(screen.getByLabelText('Weight (kg)'), '60');
  await user.selectOptions(screen.getByLabelText('Country'), 'IN');
}

describe('fashion onboarding', () => {
  it('prefills the name and validates required basics', async () => {
    api();
    const user = userEvent.setup();
    renderApp('/onboarding');
    expect(await screen.findByLabelText('Name')).toHaveValue('Ana Silva');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Select a clothing preference')).toBeInTheDocument();
    expect(screen.getByText('Enter your height')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Basic profile' })).toBeInTheDocument();

    // Fixing a field clears its message straight away.
    await user.click(screen.getByLabelText('Womenswear'));
    expect(screen.queryByText('Select a clothing preference')).not.toBeInTheDocument();
    expect(screen.getByText('Enter your height')).toBeInTheDocument();
  });

  it('saves measurements then the profile, and lands on the fashion dashboard', async () => {
    const { calls } = api();
    const user = userEvent.setup();
    const router = renderApp('/onboarding');

    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: 'Body measurements' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Chest / bust (cm)'), '88');
    await user.type(screen.getByLabelText('Waist (cm)'), '70');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('heading', { name: 'Body scan setup' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip scan for now' }));

    expect(await screen.findByRole('heading', { name: 'Hi, Ana' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');

    const posts = calls.filter((c) => c.key === 'POST /api/measurements' || c.key === 'PUT /api/profile');
    expect(posts.map((c) => c.key)).toEqual(['POST /api/measurements', 'PUT /api/profile']);
    expect(posts[0]!.body).toEqual({
      heightCm: 168,
      chestCm: 88,
      waistCm: 70,
      hipsCm: null,
      shoulderCm: null,
      inseamCm: null,
      armLengthCm: null,
      source: 'manual',
    });
    expect(posts[1]!.body).toEqual({
      name: 'Ana Silva',
      birthYear: null,
      clothingPreference: 'womenswear',
      heightCm: 168,
      weightKg: 60,
      country: 'IN',
      measurementUnit: 'metric',
    });

    // Dashboard shows the body profile and empty try-on sections.
    expect(await screen.findByText('88 cm')).toBeInTheDocument();
    expect(screen.getByText('Your try-on results will appear here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create my avatar' })).toHaveAttribute('href', '/avatar');
  });

  it('skips the measurements call when none are entered', async () => {
    const { calls } = api(false);
    const user = userEvent.setup();
    renderApp('/onboarding');
    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Skip scan for now' }));
    expect(await screen.findByRole('heading', { name: 'Hi, Ana' })).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/measurements')).toBe(false);
  });

  it('converts imperial entries to metric and shows ranges in inches', async () => {
    const { calls } = api();
    const user = userEvent.setup();
    renderApp('/onboarding');
    await user.click(await screen.findByLabelText('Womenswear'));
    await user.click(screen.getByLabelText('Imperial (ft/in, lb)'));
    await user.type(screen.getByLabelText('Height feet'), '5');
    await user.type(screen.getByLabelText('Height inches'), '6');
    await user.type(screen.getByLabelText('Weight (lb)'), '132');
    await user.selectOptions(screen.getByLabelText('Country'), 'US');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await user.type(screen.getByLabelText('Waist (in)'), '2');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Waist must be 15.7–78.7 in')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Waist (in)'));
    await user.type(screen.getByLabelText('Waist (in)'), '28');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Finish & start body scan' }));
    // Goes straight into the scan flow.
    expect(await screen.findByRole('heading', { name: 'Allow camera access' })).toBeInTheDocument();

    expect(calls.find((c) => c.key === 'POST /api/measurements')?.body).toMatchObject({ heightCm: 167.6, waistCm: 71.1 });
    expect(calls.find((c) => c.key === 'PUT /api/profile')?.body).toMatchObject({
      heightCm: 167.6,
      weightKg: 59.9,
      measurementUnit: 'imperial',
    });
  });
});
