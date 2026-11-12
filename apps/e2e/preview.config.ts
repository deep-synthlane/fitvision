// Serves the production web build with the same security headers Caddy sends in production,
// so the E2E suite can catch Content-Security-Policy breakage before deployment.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const caddy = readFileSync(new URL('../../deploy/security-headers.caddy', import.meta.url), 'utf8');
const headers = Object.fromEntries([...caddy.matchAll(/^\s+([A-Z][\w-]+) "(.*)"$/gm)].map((m) => [m[1]!, m[2]!]));
if (!headers['Content-Security-Policy']) throw new Error('No Content-Security-Policy found in deploy/security-headers.caddy');

export default defineConfig({
  root: fileURLToPath(new URL('../web', import.meta.url)),
  preview: {
    port: Number(process.env.PREVIEW_PORT ?? 5181),
    strictPort: true,
    headers,
    // Same-origin in production (Caddy); here the API's origin check expects the E2E web origin.
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4100', headers: { origin: process.env.API_WEB_ORIGIN ?? 'http://localhost:5180' } } },
  },
});
