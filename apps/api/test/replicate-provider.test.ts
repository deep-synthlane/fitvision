import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TryOnProviderError } from '../src/tryon/provider.js';
import { ReplicateVirtualTryOnProvider } from '../src/tryon/replicateProvider.js';

/** Local fake of the predictions API — a contract test of our adapter, not of the real service. */
let server: http.Server;
let base = '';
const received: { method: string; url: string; auth?: string; body?: Record<string, unknown> }[] = [];
let nextCreate: { status: number; body: unknown } = { status: 201, body: {} };
const predictions = new Map<string, unknown>();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && req.url === '/v1/predictions') return send(nextCreate.status, nextCreate.body);
      const m = /^\/v1\/predictions\/([^/]+)(\/cancel)?$/.exec(req.url!);
      if (m && m[2]) return send(200, { id: m[1], status: 'canceled' });
      if (m && predictions.has(m[1]!)) return send(200, predictions.get(m[1]!));
      send(404, { detail: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const provider = () => new ReplicateVirtualTryOnProvider({ apiToken: 'test-token', modelVersion: 'abc123', baseUrl: base });
const request = {
  personImage: { data: Buffer.from('person'), mime: 'image/webp' },
  garmentImage: { data: Buffer.from('garment'), mime: 'image/webp' },
  region: 'full_body' as const,
  garmentDescription: 'Blue linen dress',
};

describe('Replicate provider adapter (contract)', () => {
  it('is marked as an external, real, unverified provider', () => {
    expect(provider().metadata).toMatchObject({ provider: 'replicate', source: 'real', external: true, verified: false, modelVersion: 'abc123' });
  });

  it('submits images as data URIs with the mapped category and polls to a result URL', async () => {
    nextCreate = { status: 201, body: { id: 'p1', status: 'starting' } };
    const p = provider();
    expect(await p.createTryOn(request)).toEqual({ state: 'processing', providerJobId: 'p1' });
    const sent = received.at(-1)!;
    expect(sent.auth).toBe('Bearer test-token');
    expect(sent.body).toMatchObject({
      version: 'abc123',
      input: { category: 'dresses', garment_des: 'Blue linen dress', human_img: `data:image/webp;base64,${Buffer.from('person').toString('base64')}` },
    });

    predictions.set('p1', { id: 'p1', status: 'succeeded', output: ['https://replicate.delivery/out.png'] });
    expect(await p.getStatus('p1')).toEqual({ state: 'ready', providerJobId: 'p1', image: { url: 'https://replicate.delivery/out.png' } });
  });

  it('normalises failures, moderation and HTTP errors', async () => {
    const p = provider();
    predictions.set('p2', { id: 'p2', status: 'failed', error: 'NSFW content detected' });
    const failed = await p.getStatus('p2');
    expect(failed.state === 'failed' && failed.error.code).toBe('moderation');

    for (const [status, code, retryable] of [
      [429, 'rate_limited', true],
      [503, 'unavailable', true],
      [401, 'unavailable', false],
      [422, 'invalid_input', false],
    ] as const) {
      nextCreate = { status, body: { detail: 'x' } };
      const err = await p.createTryOn(request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TryOnProviderError);
      expect(err).toMatchObject({ code, retryable });
    }
  });

  it('cancels predictions', async () => {
    await provider().cancel('p9');
    expect(received.at(-1)).toMatchObject({ method: 'POST', url: '/v1/predictions/p9/cancel' });
  });
});
