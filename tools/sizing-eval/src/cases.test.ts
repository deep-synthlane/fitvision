import { describe, expect, it } from 'vitest';
import { CASES } from './cases.js';
import { evaluateCase } from './evaluate.js';

describe('size engine known-answer cases', () => {
  it.each(CASES.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const outcome = evaluateCase(c);
    expect(outcome.problems).toEqual([]);
  });
});
