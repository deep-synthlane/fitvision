/** Manual review criteria, scored 1 (poor) – 5 (excellent) per output. */
export const CRITERIA = [
  'identity_preservation',
  'garment_color',
  'pattern_logo',
  'sleeve_length',
  'neckline',
  'silhouette',
  'lower_body_placement',
  'occlusion_hands',
  'body_shape_distortion',
  'artifacts',
] as const;
export type Criterion = (typeof CRITERIA)[number];

export interface RunRecord {
  caseId: string;
  provider: string;
  modelVersion: string;
  source: 'mock' | 'real';
  status: 'ready' | 'failed' | 'cancelled' | 'timeout';
  errorCode: string | null;
  latencyMs: number;
  attempts: number;
  estimatedCostUsd: number | null;
  output: string | null;
  /** Provider job id (e.g. Replicate prediction id), to look up billed time afterwards. */
  providerJobId?: string | null;
}

export function toCsv(rows: Record<string, string | number | null>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h] ?? null)).join(','))].join('\n') + '\n';
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim()));
  return header ? body.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) : [];
}
