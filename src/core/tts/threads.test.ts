import { describe, expect, it } from 'vitest';
import {
  MAX_TTS_THREADS,
  defaultTtsThreads,
  parseThreadOverride,
} from './threads';

describe('defaultTtsThreads', () => {
  it('estimates physical cores from the logical count', () => {
    // The QA i5-8265U is 4 cores / 8 logical; four threads measured fastest.
    expect(defaultTtsThreads(8, true)).toBe(4);
    expect(defaultTtsThreads(4, true)).toBe(2);
    expect(defaultTtsThreads(12, true)).toBe(6);
  });

  it('never returns less than one or more than the cap', () => {
    expect(defaultTtsThreads(1, true)).toBe(1);
    expect(defaultTtsThreads(2, true)).toBe(1);
    expect(defaultTtsThreads(32, true)).toBe(MAX_TTS_THREADS);
    expect(defaultTtsThreads(undefined, true)).toBe(1);
  });

  it('falls back to one thread when cross-origin isolation is unavailable', () => {
    expect(defaultTtsThreads(8, false)).toBe(1);
  });
});

describe('parseThreadOverride', () => {
  it('reads the dev worker-name suffix', () => {
    expect(parseThreadOverride('cadence-tts:threads=8')).toBe(8);
    expect(parseThreadOverride('cadence-tts:threads=1')).toBe(1);
    expect(parseThreadOverride('threads=6')).toBe(6);
  });

  it('ignores names without a valid count', () => {
    expect(parseThreadOverride(undefined)).toBeNull();
    expect(parseThreadOverride('cadence-tts')).toBeNull();
    expect(parseThreadOverride('cadence-tts:threads=0')).toBeNull();
    expect(parseThreadOverride('cadence-tts:threads=33')).toBeNull();
    expect(parseThreadOverride('cadence-tts:threads=abc')).toBeNull();
  });
});
