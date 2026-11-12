import { BODIES } from './bodies.js';
import { GARMENTS, type TestGarment } from './garments.js';

/** How many bodies each garment is tried on (24 cases: 4 upper × 3, 3 lower × 2, 2 full × 3). */
const RUNS_PER_REGION = { upper_body: 3, lower_body: 2, full_body: 3 } as const;
/** Dresses and skirts go on the womenswear bodies; everything else on any body. */
const womenswearOnly = (g: TestGarment) => g.category === 'dresses' || g.category === 'skirts';

export interface AvatarCase {
  body: (typeof BODIES)[number];
  garment: TestGarment;
}

/**
 * Deterministic and balanced: each garment goes on the bodies with the fewest cases so far
 * (restricted garments first), so every body gets a similar number of cases.
 */
export function selectCases(all = false): AvatarCase[] {
  const used = new Map<string, number>(BODIES.map((b) => [b.id, 0]));
  const ordered = [...GARMENTS].sort((a, b) => Number(womenswearOnly(b)) - Number(womenswearOnly(a)));
  const out: AvatarCase[] = [];
  for (const garment of ordered) {
    const pool = womenswearOnly(garment) ? BODIES.filter((b) => b.inputs.clothingPreference === 'womenswear') : BODIES;
    const n = all ? pool.length : Math.min(pool.length, RUNS_PER_REGION[garment.region]);
    const chosen = [...pool].sort((a, b) => used.get(a.id)! - used.get(b.id)! || BODIES.indexOf(a) - BODIES.indexOf(b)).slice(0, n);
    for (const body of chosen) {
      used.set(body.id, used.get(body.id)! + 1);
      out.push({ body, garment });
    }
  }
  return out.sort((a, b) => GARMENTS.indexOf(a.garment) - GARMENTS.indexOf(b.garment) || BODIES.indexOf(a.body) - BODIES.indexOf(b.body));
}
