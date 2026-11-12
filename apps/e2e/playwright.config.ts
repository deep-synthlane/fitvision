import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests against the real API (PGlite + local disk in a throwaway directory), the Vite app
 * and a local fixture "retailer" site. Try-on always uses the labelled mock provider; no paid or
 * external services are contacted.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '.data');
const API_PORT = 4100;
const WEB_PORT = 5180;
const FIXTURE_PORT = 4599;
const PREVIEW_PORT = 5181;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const PREVIEW_ORIGIN = `http://localhost:${PREVIEW_PORT}`;

// Fresh database and storage per run (the config is also loaded by workers; only clear once).
if (!process.env.TEST_WORKER_INDEX) rmSync(dataDir, { recursive: true, force: true });

// Prefer the installed Chrome locally; CI runs `playwright install chromium` instead.
const useChrome = !process.env.CI && process.env.E2E_BROWSER !== 'chromium';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], ...(useChrome ? { channel: 'chrome' } : {}) } }],
  webServer: [
    {
      command: 'tsx fixture-site.ts',
      env: { FIXTURE_PORT: String(FIXTURE_PORT) },
      url: `http://127.0.0.1:${FIXTURE_PORT}/robots.txt`,
      reuseExistingServer: false,
    },
    {
      // tsx directly (not `pnpm start`) so a developer's apps/api/.env can't change providers or storage.
      command: 'pnpm --filter @fitvision/api exec tsx src/server.ts',
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        HOST: '127.0.0.1',
        DATABASE_URL: '',
        PGLITE_DIR: path.join(dataDir, 'pglite'),
        STORAGE_DRIVER: 'local',
        STORAGE_DIR: path.join(dataDir, 'uploads'),
        WEB_ORIGIN,
        IMPORT_ALLOW_HOSTS: `127.0.0.1:${FIXTURE_PORT}`,
        AUTH_RATE_LIMIT_MAX: '1000',
        BCRYPT_ROUNDS: '4',
        TRYON_PROVIDER: 'mock',
        TRYON_POLL_MS: '200',
        JOB_MODE: 'inline',
        LOG_LEVEL: 'warn',
      },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @fitvision/web exec vite --port ${WEB_PORT} --strictPort`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      url: WEB_ORIGIN,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      // Production build with the production security headers (CSP check).
      command: `pnpm --filter @fitvision/web build && node ../../node_modules/vite/bin/vite.js preview --config preview.config.ts`,
      env: { PREVIEW_PORT: String(PREVIEW_PORT), API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`, API_WEB_ORIGIN: WEB_ORIGIN },
      url: PREVIEW_ORIGIN,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
