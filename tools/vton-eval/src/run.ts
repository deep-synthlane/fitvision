/**
 * Runs every manifest case through each configured provider via the app's VirtualTryOnProvider
 * interface, and writes outputs, timings and a scoring sheet to runs/<timestamp>/ (git-ignored,
 * separate from user data).
 *
 *   pnpm --filter @fitvision/vton-eval run-eval data/manifest.json
 *   REPLICATE_API_TOKEN=… REPLICATE_MODEL_VERSION=… REPLICATE_COST_USD=0.05 pnpm … run-eval data/manifest.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { GarmentRegion } from '@fitvision/shared';
import { DEFAULT_FETCH_POLICY } from '../../../apps/api/src/net/policy.js';
import { safeFetch } from '../../../apps/api/src/net/safeFetch.js';
import { MockVirtualTryOnProvider } from '../../../apps/api/src/tryon/mockProvider.js';
import type { ProviderJobState, VirtualTryOnProvider } from '../../../apps/api/src/tryon/provider.js';
import { ReplicateVirtualTryOnProvider } from '../../../apps/api/src/tryon/replicateProvider.js';
import { CRITERIA, toCsv, type RunRecord } from './criteria.js';

interface Case {
  id: string;
  person: string;
  garment: string;
  region: GarmentRegion;
  description: string;
  notes?: string;
}

const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 300_000);
const POLL_MS = 2000;

function providers(): VirtualTryOnProvider[] {
  const list: VirtualTryOnProvider[] = [new MockVirtualTryOnProvider(0)];
  if (process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_MODEL_VERSION) {
    list.push(
      new ReplicateVirtualTryOnProvider({
        apiToken: process.env.REPLICATE_API_TOKEN,
        modelVersion: process.env.REPLICATE_MODEL_VERSION,
        estimatedCostUsd: process.env.REPLICATE_COST_USD ? Number(process.env.REPLICATE_COST_USD) : null,
      }),
    );
  }
  return list;
}

const prepare = async (file: string) => ({
  data: await sharp(readFileSync(file)).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer(),
  mime: 'image/webp',
});

async function runOne(provider: VirtualTryOnProvider, c: Case, dir: string, out: string): Promise<RunRecord> {
  const started = Date.now();
  const deadline = started + TIMEOUT_MS;
  const base = { caseId: c.id, provider: provider.metadata.provider, modelVersion: provider.metadata.modelVersion, source: provider.metadata.source, estimatedCostUsd: provider.metadata.estimatedCostUsd };
  let attempts = 0;
  try {
    attempts++;
    let state: ProviderJobState = await provider.createTryOn({
      personImage: await prepare(path.join(dir, c.person)),
      garmentImage: await prepare(path.join(dir, c.garment)),
      region: c.region,
      garmentDescription: c.description,
    });
    const providerJobId = state.providerJobId;
    while (state.state === 'processing') {
      if (Date.now() > deadline) {
        await provider.cancel?.(state.providerJobId).catch(() => {});
        return { ...base, providerJobId, status: 'timeout', errorCode: 'timeout', latencyMs: Date.now() - started, attempts, output: null };
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
      state = await provider.getStatus(state.providerJobId);
    }
    if (state.state !== 'ready') {
      return { ...base, providerJobId, status: state.state, errorCode: state.state === 'failed' ? state.error.code : null, latencyMs: Date.now() - started, attempts, output: null };
    }
    const raw = 'data' in state.image ? state.image.data : (await safeFetch(state.image.url, { policy: DEFAULT_FETCH_POLICY, accept: ['image/'], maxBytes: 25e6 })).body;
    const file = path.join(out, provider.metadata.provider, `${c.id}.webp`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, await sharp(raw).webp({ quality: 92 }).toBuffer());
    return { ...base, providerJobId, status: 'ready', errorCode: null, latencyMs: Date.now() - started, attempts, output: path.relative(out, file) };
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'error';
    return { ...base, status: 'failed', errorCode: code, latencyMs: Date.now() - started, attempts, output: null };
  }
}

function contactSheet(cases: Case[], records: RunRecord[], dir: string, out: string): string {
  const rel = (p: string) => path.relative(out, path.join(dir, p));
  const rows = cases
    .map((c) => {
      const cells = records
        .filter((r) => r.caseId === c.id)
        .map((r) => `<td>${r.output ? `<img src="${r.output}">` : `<em>${r.status} ${r.errorCode ?? ''}</em>`}<br>${r.provider} · ${(r.latencyMs / 1000).toFixed(1)} s${r.source === 'mock' ? ' · MOCK' : ''}</td>`)
        .join('');
      return `<tr><th>${c.id}<br><small>${c.notes ?? ''}</small></th><td><img src="${rel(c.person)}"></td><td><img src="${rel(c.garment)}"></td>${cells}</tr>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>VTON evaluation</title>
<style>body{font:14px system-ui;margin:16px}td,th{vertical-align:top;padding:6px;border-bottom:1px solid #ddd}img{max-height:360px;max-width:260px;display:block}</style>
<h1>VTON evaluation contact sheet</h1><p>Score each output in scoring.csv (1–5) against the criteria in the README.</p>
<table><tr><th>Case</th><th>Person</th><th>Garment</th><th colspan="9">Outputs</th></tr>${rows}</table>`;
}

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Usage: pnpm --filter @fitvision/vton-eval run-eval <data/manifest.json>');
  process.exit(1);
}
const resolved = path.resolve(process.env.INIT_CWD ?? process.cwd(), manifestPath);
const dir = path.dirname(resolved);
const { cases } = JSON.parse(readFileSync(resolved, 'utf8')) as { cases: Case[] };
const out = path.resolve(import.meta.dirname, '../runs', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });

const records: RunRecord[] = [];
for (const provider of providers()) {
  for (const c of cases) {
    const r = await runOne(provider, c, dir, out);
    records.push(r);
    console.log(`${r.provider}\t${c.id}\t${r.status}\t${(r.latencyMs / 1000).toFixed(1)}s${r.errorCode ? `\t${r.errorCode}` : ''}`);
  }
}
writeFileSync(path.join(out, 'results.json'), JSON.stringify(records, null, 2));
writeFileSync(
  path.join(out, 'scoring.csv'),
  toCsv(records.map((r) => ({ case: r.caseId, provider: r.provider, status: r.status, output: r.output, ...Object.fromEntries(CRITERIA.map((k) => [k, ''])), reviewer: '', comments: '' }))),
);
writeFileSync(path.join(out, 'contact-sheet.html'), contactSheet(cases, records, dir, out));
console.log(`\nWrote ${out}\nOpen contact-sheet.html, fill in scoring.csv, then run: pnpm --filter @fitvision/vton-eval summarize ${path.relative(process.cwd(), out)}`);
