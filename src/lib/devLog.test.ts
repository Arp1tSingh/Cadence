import { describe, expect, it } from 'vitest';
import { realTimeFactor } from './devLog';

describe('realTimeFactor', () => {
  it('divides audio seconds by wall seconds', () => {
    expect(realTimeFactor(6, 2000)).toBe(3);
    expect(realTimeFactor(0.5, 250)).toBe(2);
  });

  it('returns zero for non-positive or invalid wall time', () => {
    expect(realTimeFactor(3, 0)).toBe(0);
    expect(realTimeFactor(3, -100)).toBe(0);
    expect(realTimeFactor(3, Number.NaN)).toBe(0);
    expect(realTimeFactor(Number.POSITIVE_INFINITY, 1000)).toBe(0);
  });
});
