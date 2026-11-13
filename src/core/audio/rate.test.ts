import { describe, expect, it } from 'vitest';
import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE, clampPlaybackRate, formatPlaybackRate } from './rate';

describe('clampPlaybackRate', () => {
  it('clamps to the supported range', () => {
    expect(clampPlaybackRate(0.1)).toBe(MIN_PLAYBACK_RATE);
    expect(clampPlaybackRate(10)).toBe(MAX_PLAYBACK_RATE);
  });

  it('snaps to the 0.05x grid', () => {
    expect(clampPlaybackRate(1.234)).toBe(1.25);
    expect(clampPlaybackRate(1.22)).toBe(1.2);
  });

  it('falls back to 1x for invalid input', () => {
    expect(clampPlaybackRate(Number.NaN)).toBe(1);
    expect(clampPlaybackRate(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('formatPlaybackRate', () => {
  it('prints whole and fractional speeds without trailing zeros', () => {
    expect(formatPlaybackRate(1)).toBe('1×');
    expect(formatPlaybackRate(1.5)).toBe('1.5×');
    expect(formatPlaybackRate(1.25)).toBe('1.25×');
    expect(formatPlaybackRate(0.75)).toBe('0.75×');
  });

  it('clamps before formatting', () => {
    expect(formatPlaybackRate(9)).toBe('3×');
  });
});
