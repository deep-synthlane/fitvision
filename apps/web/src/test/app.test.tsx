import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicUser } from '@fitvision/shared';
import { mockApi, unauthenticated } from './mockApi';
import { renderApp } from './renderApp';

const baseUser: PublicUser = {
  id: 'u1',
  email: 'ana@example.com',
  name: 'Ana Silva',
  onboarded: false,
  createdAt: '2026-11-04T00:00:00.000Z',
};


afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routing guards', () => {
  it('sends signed-out visitors to the login page', async () => {
    mockApi({ 'GET /api/auth/me': unauthenticated });
    const router = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('sends signed-in but not onboarded users to onboarding', async () => {
    mockApi({ 'GET /api/auth/me': () => ({ status: 200, body: { user: baseUser } }) });
    renderApp('/profile');
    expect(await screen.findByRole('heading', { name: 'Basic profile' })).toBeInTheDocument();
  });
});

describe('login', () => {
  it('shows client-side validation errors without calling the API', async () => {
    const { calls } = mockApi({ 'GET /api/auth/me': unauthenticated });
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(calls.filter((c) => c.key.startsWith('POST'))).toHaveLength(0);
  });

  it('shows the server error on bad credentials', async () => {
    mockApi({
      'GET /api/auth/me': unauthenticated,
      'POST /api/auth/login': () => ({
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password' } },
      }),
    });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password');
  });
});

describe('register', () => {
  it('maps server field errors onto inputs', async () => {
    mockApi({
      'GET /api/auth/me': unauthenticated,
      'POST /api/auth/register': () => ({
        status: 409,
        body: {
          error: {
            code: 'EMAIL_TAKEN',
            message: 'An account with this email already exists',
            fields: { email: 'An account with this email already exists' },
          },
        },
      }),
    });
    renderApp('/register');
    await userEvent.type(await screen.findByLabelText('Name'), 'Ana');
    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'long-enough-pw');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('An account with this email already exists')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('onboarding guard', () => {
  it('sends already-onboarded users from /onboarding to the dashboard', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: { user: { ...baseUser, onboarded: true } } }),
      'GET /api/profile': () => ({ status: 200, body: { profile: null } }),
      'GET /api/measurements/current': () => ({ status: 200, body: { measurements: null } }),
      'GET /api/avatars/current': () => ({ status: 200, body: { avatar: null, outdated: false, canGenerate: false } }),
    });
    const router = renderApp('/onboarding');
    expect(await screen.findByRole('heading', { name: 'Hi, Ana' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});
