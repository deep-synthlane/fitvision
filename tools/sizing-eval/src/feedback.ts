import { FIT_RATINGS, type FitRating } from '@fitvision/shared';

/** One exported feedback row (see apps/api/src/exportFeedback.ts). */
export interface FeedbackRow {
  subject: string;
  engineVersion: string | null;
  category: string;
  brand: string | null;
  recommendedSize: string | null;
  purchasedSize: string | null;
  fitRating: FitRating;
  returned: boolean | null;
}

export interface FeedbackGroup {
  key: string;
  count: number;
  ratings: Record<FitRating, number>;
  /** Rows where the purchased size was the recommended one. */
  followed: number;
  /** "Just right" share among rows that followed the recommendation. */
  justRightWhenFollowed: number | null;
  /** −1 (all too small) … +1 (all too large), over rows that followed the recommendation. */
  sizeBias: number | null;
  returned: number;
  /** Fewer rows than this and the group is reported but flagged as too small to act on. */
  enoughData: boolean;
}

export const MIN_GROUP_SIZE = 30;
const BIAS: Record<FitRating, number> = { too_small: -1, slightly_small: -0.5, just_right: 0, slightly_large: 0.5, too_large: 1 };
const same = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Groups feedback (by engine version and the given key) into descriptive statistics. Never adjusts the engine. */
export function summarise(rows: FeedbackRow[], by: (r: FeedbackRow) => string): FeedbackGroup[] {
  const groups = new Map<string, FeedbackRow[]>();
  for (const r of rows) {
    if (!FIT_RATINGS.includes(r.fitRating)) continue;
    const key = `${r.engineVersion ?? 'unknown'} · ${by(r)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, rs]) => {
      const ratings = Object.fromEntries(FIT_RATINGS.map((f) => [f, rs.filter((r) => r.fitRating === f).length])) as Record<FitRating, number>;
      const followed = rs.filter((r) => same(r.recommendedSize, r.purchasedSize));
      return {
        key,
        count: rs.length,
        ratings,
        followed: followed.length,
        justRightWhenFollowed: followed.length ? followed.filter((r) => r.fitRating === 'just_right').length / followed.length : null,
        sizeBias: followed.length ? followed.reduce((s, r) => s + BIAS[r.fitRating], 0) / followed.length : null,
        returned: rs.filter((r) => r.returned).length,
        enoughData: rs.length >= MIN_GROUP_SIZE,
      };
    })
    .sort((a, b) => b.count - a.count);
}

export function parseJsonl(text: string): FeedbackRow[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as FeedbackRow);
}
