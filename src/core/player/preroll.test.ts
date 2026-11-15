import { describe, expect, it } from 'vitest';
import {
  INITIAL_PREROLL_SECONDS,
  MAX_PREROLL_SECONDS,
  nextPreroll,
  prerollReached,
} from './preroll';

describe('nextPreroll', () => {
  it('grows from the initial target and settles at the cap', () => {
    expect(nextPreroll(3)).toBe(6.5);
    expect(nextPreroll(6.5)).toBe(11.75);
    expect(nextPreroll(11.75)).toBe(19.625);
    expect(nextPreroll(19.625)).toBe(MAX_PREROLL_SECONDS);
    expect(nextPreroll(MAX_PREROLL_SECONDS)).toBe(MAX_PREROLL_SECONDS);
  });

  it('falls back to the initial target for invalid input', () => {
    expect(nextPreroll(Number.NaN)).toBe(6.5);
    expect(nextPreroll(0)).toBe(6.5);
    expect(nextPreroll(-4)).toBe(6.5);
    expect(INITIAL_PREROLL_SECONDS).toBe(3);
  });
});

describe('prerollReached', () => {
  it('waits until enough narration is queued', () => {
    expect(prerollReached(0, 3, false)).toBe(false);
    expect(prerollReached(2.99, 3, false)).toBe(false);
    expect(prerollReached(3, 3, false)).toBe(true);
    expect(prerollReached(9, 6.5, false)).toBe(true);
  });

  it('releases the clock once every sentence is scheduled', () => {
    expect(prerollReached(0, 20, true)).toBe(true);
  });

  it('rejects non-finite buffer readings', () => {
    expect(prerollReached(Number.NaN, 3, false)).toBe(false);
    expect(prerollReached(Number.POSITIVE_INFINITY, 3, false)).toBe(false);
  });
});
