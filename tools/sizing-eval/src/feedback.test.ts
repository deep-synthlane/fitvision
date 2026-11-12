import { describe, expect, it } from 'vitest';
import { summarise, type FeedbackRow } from './feedback.js';

const row = (o: Partial<FeedbackRow>): FeedbackRow => ({
  subject: 's',
  engineVersion: 'size-1',
  category: 'dresses',
  brand: 'Acme',
  recommendedSize: 'M',
  purchasedSize: 'M',
  fitRating: 'just_right',
  returned: false,
  ...o,
});

describe('feedback summary', () => {
  it('reports just-right rate and bias only for buyers who followed the recommendation', () => {
    const [g] = summarise(
      [
        row({}),
        row({ fitRating: 'too_small', returned: true }),
        row({ purchasedSize: 'L', fitRating: 'too_large' }), // bought a different size: excluded from bias
        row({ purchasedSize: null, fitRating: 'slightly_small' }),
      ],
      (r) => r.category,
    );
    expect(g).toMatchObject({ key: 'size-1 · dresses', count: 4, followed: 2, justRightWhenFollowed: 0.5, sizeBias: -0.5, returned: 1, enoughData: false });
    expect(g!.ratings).toEqual({ too_small: 1, slightly_small: 1, just_right: 1, slightly_large: 0, too_large: 1 });
  });

  it('keeps engine versions apart and ignores unknown ratings', () => {
    const groups = summarise([row({}), row({ engineVersion: 'size-2' }), row({ fitRating: 'weird' as never })], (r) => r.category);
    expect(groups.map((g) => [g.key, g.count])).toEqual([
      ['size-1 · dresses', 1],
      ['size-2 · dresses', 1],
    ]);
  });
});
