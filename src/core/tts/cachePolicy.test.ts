import { describe, expect, it } from 'vitest';
import { selectCacheEvictions, totalCacheBytes } from './cachePolicy';

function entry(key: string, size: number, createdAt: number) {
  return { key, size, createdAt };
}

describe('cachePolicy', () => {
  it('totals sizes and ignores negative values', () => {
    expect(totalCacheBytes([])).toBe(0);
    expect(totalCacheBytes([{ size: 10 }, { size: -5 }, { size: 2.5 }])).toBe(12.5);
  });

  it('keeps everything when the cache fits', () => {
    const entries = [entry('a', 40, 1), entry('b', 60, 2)];
    expect(selectCacheEvictions(entries, 100)).toEqual([]);
    expect(selectCacheEvictions(entries, 101)).toEqual([]);
  });

  it('evicts oldest-first until the cap is met', () => {
    const entries = [
      entry('newest', 100, 3),
      entry('oldest', 100, 1),
      entry('middle', 100, 2),
    ];
    expect(selectCacheEvictions(entries, 250).map((item) => item.key)).toEqual(['oldest']);
    expect(selectCacheEvictions(entries, 150).map((item) => item.key)).toEqual([
      'oldest',
      'middle',
    ]);
    expect(selectCacheEvictions(entries, 10).map((item) => item.key)).toEqual([
      'oldest',
      'middle',
      'newest',
    ]);
  });

  it('treats zero, negative, and non-finite caps as unlimited', () => {
    const entries = [entry('a', 10, 1)];
    for (const cap of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(selectCacheEvictions(entries, cap)).toEqual([]);
    }
  });

  it('does not mutate the input order', () => {
    const entries = [entry('newest', 10, 2), entry('oldest', 10, 1)];
    selectCacheEvictions(entries, 10);
    expect(entries.map((item) => item.key)).toEqual(['newest', 'oldest']);
  });
});
