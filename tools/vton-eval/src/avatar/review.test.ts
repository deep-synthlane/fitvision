import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { evaluate, report, type ScoringRow } from './review.js';
import { fetchPredictionBilling } from './replicateBilling.js';
import { changedShares } from './sheet.js';

const row = (o: Partial<ScoringRow> = {}): ScoringRow => ({
  case: 'c',
  style: 'avatar-render-1.0-flat',
  provider: 'replicate (v1)',
  source: 'real',
  body: 'b1',
  garment: 'u1',
  region: 'upper_body',
  generation_failure: 'no',
  error: '',
  latency_s: '20.0',
  model_version: 'v1',
  predict_time_s: '',
  actual_cost_usd: '',
  est_cost_usd: '0.05',
  auto_unchanged: 'no',
  auto_changed_pct: '30',
  auto_changed_upper_pct: '50',
  auto_changed_lower_pct: '5',
  output: 'x.webp',
  garment_visible: 'yes',
  category_position: 'ok',
  neckline: '4',
  shoulder: '4',
  sleeve: '4',
  waist: 'na',
  lower_body: 'na',
  colour: '5',
  pattern_logo: '3',
  body_distortion: 'none',
  artifacts: 'minor',
  acceptable: 'yes',
  reviewer: 'AB',
  notes: '',
  ...o,
});
const bodies = ['b1', 'b2', 'b3', 'b4', 'b5'];
const many = (n: number, f: (i: number) => Partial<ScoringRow> = () => ({})) => Array.from({ length: n }, (_, i) => row({ case: `c${i}`, body: bodies[i % 5], ...f(i) }));

describe('avatar try-on pass criteria', () => {
  it('passes 20+ real runs with ≥ 90 % correct and no systematic distortion', () => {
    const [v] = evaluate(many(20, (i) => (i === 3 ? { garment_visible: 'no' } : {})));
    expect(v).toMatchObject({ verdict: 'PASS', runs: 20, correct: 19, latencyP50: 20, totalCostUsd: 1, costIsActual: false });
    expect(v!.meanScores.neckline).toBe(4);
    expect(v!.meanScores.waist).toBeNull();
  });

  it('counts failures as misses and requires every completed output to be reviewed', () => {
    const [v] = evaluate(many(22, (i) => (i < 2 ? { generation_failure: 'yes', garment_visible: '', category_position: '' } : i === 5 ? { garment_visible: '' } : {})));
    expect(v!.verdict).toBe('NOT MET');
    expect(v!.reasons.join(' ')).toMatch(/1 completed outputs not reviewed/);
    expect(v!.correct).toBe(19);
  });

  it('fails on too few runs, wrong regions, unchanged outputs and systematic severe distortion', () => {
    const [v] = evaluate(
      many(12, (i) => ({
        region: i < 6 ? 'lower_body' : 'upper_body',
        category_position: i < 2 ? 'wrong' : 'ok',
        body_distortion: i === 6 || i === 11 ? 'severe' : 'none',
        body: i === 6 || i === 11 ? 'b3' : bodies[i % 5],
        auto_unchanged: i === 7 ? 'yes' : 'no',
      })),
    );
    const reasons = v!.reasons.join(' ');
    expect(reasons).toMatch(/Only 12 runs/);
    expect(reasons).toMatch(/lower_body: placed correctly in 4\/6/);
    expect(reasons).toMatch(/Systematic severe distortion on: b3 \(2\)/);
    expect(reasons).toMatch(/1 outputs returned the avatar unchanged/);
  });

  it('never counts the mock provider, and compares styles side by side', () => {
    const verdicts = evaluate([...many(20, () => ({ provider: 'mock (mock-composite-0.1)', source: 'mock' })), ...many(20, () => ({ style: 'avatar-render-1.1-humanlike' }))]);
    expect(verdicts.map((v) => [v.key, v.verdict])).toEqual([
      ['mock (mock-composite-0.1) · avatar-render-1.0-flat', 'NOT ELIGIBLE'],
      ['replicate (v1) · avatar-render-1.1-humanlike', 'PASS'],
    ]);
    expect(report(verdicts)).toContain('| replicate (v1) · avatar-render-1.1-humanlike | real | 20 |');
  });
});

describe('billing', () => {
  it('prefers the provider’s actual cost over the estimate', () => {
    const [v] = evaluate(many(20, () => ({ actual_cost_usd: '0.021', predict_time_s: '15' })));
    expect(v).toMatchObject({ totalCostUsd: 0.42, costIsActual: true, acceptable: 20 });
    expect(report([v!])).toContain('$0.42 |');
  });

  it('reads billed compute time from a Replicate prediction', async () => {
    const fetchImpl = (async (url: string) => {
      expect(url).toBe('https://api.replicate.com/v1/predictions/p1');
      return new Response(JSON.stringify({ version: 'abc', status: 'succeeded', metrics: { predict_time: 17.5 } }));
    }) as unknown as typeof fetch;
    expect(await fetchPredictionBilling('p1', { token: 't', fetchImpl })).toEqual({ version: 'abc', status: 'succeeded', predictTimeS: 17.5, costUsd: 0.0245 });
  });
});

describe('automatic image checks', () => {
  it('measures where the avatar changed (upper vs lower half)', async () => {
    const person = await sharp({ create: { width: 96, height: 128, channels: 3, background: { r: 242, g: 242, b: 240 } } })
      .composite([{ input: { create: { width: 30, height: 110, channels: 3, background: '#c8c4c0' } }, left: 33, top: 9 }])
      .png()
      .toBuffer();
    const shirt = await sharp(person).composite([{ input: { create: { width: 30, height: 40, channels: 3, background: '#1d4ed8' } }, left: 33, top: 15 }]).png().toBuffer();
    const shares = await changedShares(person, shirt);
    expect(Number(shares.upper)).toBeGreaterThan(60);
    expect(shares.lower).toBe('0');
    expect(await changedShares(person, person)).toEqual({ all: '0', upper: '0', lower: '0' });
  });
});
