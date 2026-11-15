import { describe, expect, it } from 'vitest';
import {
  hasLargeIllustrationImage,
  isIllustrationCandidate,
} from './pdf-illustrations';

describe('PDF illustration detection', () => {
  it('accepts a low-text page after the cover and rejects the cover', () => {
    expect(isIllustrationCandidate(0, 0)).toBe(false);
    expect(isIllustrationCandidate(17, 31)).toBe(true);
    expect(isIllustrationCandidate(17, 0)).toBe(true);
  });

  it('rejects text-heavy pages and logos', () => {
    expect(isIllustrationCandidate(17, 223)).toBe(false);
    expect(
      hasLargeIllustrationImage([
        { width: 192, height: 192 },
        { width: 97, height: 150 },
      ]),
    ).toBe(false);
  });

  it('accepts full-page portrait and landscape artwork', () => {
    expect(hasLargeIllustrationImage([{ width: 1403, height: 2000 }])).toBe(true);
    expect(hasLargeIllustrationImage([{ width: 2000, height: 1425 }])).toBe(true);
    expect(hasLargeIllustrationImage([{ width: 0, height: 2000 }])).toBe(false);
  });
});
