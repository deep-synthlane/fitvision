/**
 * Actual Replicate usage per prediction (evaluation only; the app adapter is unchanged).
 * Replicate bills public models by GPU time: `metrics.predict_time` × the hardware's per-second price.
 */

/** Published price of Nvidia A100 (80GB), the hardware IDM-VTON runs on (replicate.com/pricing, checked 2026-11-11). */
export const DEFAULT_PRICE_PER_SECOND_USD = 0.0014;

export interface PredictionBilling {
  version: string | null;
  status: string | null;
  predictTimeS: number | null;
  costUsd: number | null;
}

export async function fetchPredictionBilling(
  id: string,
  opts: { token: string; pricePerSecond?: number; baseUrl?: string; fetchImpl?: typeof fetch },
): Promise<PredictionBilling> {
  const res = await (opts.fetchImpl ?? fetch)(`${opts.baseUrl ?? 'https://api.replicate.com/v1'}/predictions/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${opts.token}` },
  });
  if (!res.ok) return { version: null, status: `HTTP ${res.status}`, predictTimeS: null, costUsd: null };
  const p = (await res.json()) as { version?: string; status?: string; metrics?: { predict_time?: number } };
  const t = typeof p.metrics?.predict_time === 'number' ? p.metrics.predict_time : null;
  const price = opts.pricePerSecond ?? DEFAULT_PRICE_PER_SECOND_USD;
  return { version: p.version ?? null, status: p.status ?? null, predictTimeS: t, costUsd: t === null ? null : Math.round(t * price * 10000) / 10000 };
}
