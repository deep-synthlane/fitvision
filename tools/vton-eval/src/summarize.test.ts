import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv, type RunRecord } from './criteria.js';
import { summarize } from './summarize.js';

const rec = (provider: string, status: RunRecord['status'], latencyMs: number, source: RunRecord['source'] = 'real'): RunRecord => ({
  caseId: `c-${Math.random()}`,
  provider,
  modelVersion: 'v1',
  source,
  status,
  errorCode: status === 'ready' ? null : 'failed',
  latencyMs,
  attempts: 1,
  estimatedCostUsd: 0.05,
  output: null,
});

describe('vton evaluation summary', () => {
  it('round-trips CSV with quotes and commas', () => {
    const csv = toCsv([{ case: 'c1', comments: 'logo "blurred", sleeve ok' }]);
    expect(parseCsv(csv)).toEqual([{ case: 'c1', comments: 'logo "blurred", sleeve ok' }]);
  });

  it('reports failure rate, latency percentiles, cost and mean scores per provider', () => {
    const records = [rec('a', 'ready', 10_000), rec('a', 'ready', 20_000), rec('a', 'failed', 5_000), rec('b', 'ready', 4_000)];
    const scores: Record<string, string>[] = [
      { provider: 'a', identity_preservation: '4', garment_color: '5' },
      { provider: 'a', identity_preservation: '2', garment_color: '' },
      { provider: 'b', identity_preservation: '' },
    ];
    const md = summarize(records, scores);
    expect(md).toContain('| a (v1) | real | 3 | 33% | 10.0 | 20.0 | $0.050 |');
    expect(md).toMatch(/\| a \(v1\) \| 2 \| 3\.0 \| 5\.0 \|/);
    expect(md).toMatch(/\| b \(v1\) \| 0 \| — \|/);
  });

  it('warns that mock rows are not comparable', () => {
    expect(summarize([rec('mock', 'ready', 1, 'mock')], [])).toMatch(/Mock rows are placeholders/);
  });
});
