import { describe, expect, it } from 'vitest';
import {
  clampResumeOffset,
  MIN_RESUME_TAIL_SECONDS,
  sentenceAtContentTime,
  spanElapsed,
} from './timeline';

const PREFIX = [0, 4, 10.5, 22];

describe('sentenceAtContentTime', () => {
  it('returns the first sentence for the beginning and negative input', () => {
    expect(sentenceAtContentTime(PREFIX, 0)).toEqual({ index: 0, offsetSeconds: 0 });
    expect(sentenceAtContentTime(PREFIX, -8)).toEqual({ index: 0, offsetSeconds: 0 });
  });

  it('finds the containing sentence and the offset inside it', () => {
    expect(sentenceAtContentTime(PREFIX, 6)).toEqual({ index: 1, offsetSeconds: 2 });
    expect(sentenceAtContentTime(PREFIX, 21.25)).toEqual({ index: 2, offsetSeconds: 10.75 });
  });

  it('treats an exact sentence start as offset zero', () => {
    expect(sentenceAtContentTime(PREFIX, 10.5)).toEqual({ index: 2, offsetSeconds: 0 });
  });

  it('clamps past the end to the final sentence', () => {
    expect(sentenceAtContentTime(PREFIX, 500)).toEqual({ index: 3, offsetSeconds: 478 });
  });

  it('handles a single-sentence book and an empty table', () => {
    expect(sentenceAtContentTime([0], 3)).toEqual({ index: 0, offsetSeconds: 3 });
    expect(sentenceAtContentTime([], 3)).toEqual({ index: 0, offsetSeconds: 0 });
  });
});

describe('clampResumeOffset', () => {
  it('keeps a mid-sentence offset', () => {
    expect(clampResumeOffset(2, 8)).toBe(2);
  });

  it('leaves a minimum audible tail', () => {
    expect(clampResumeOffset(7.95, 8)).toBeCloseTo(8 - MIN_RESUME_TAIL_SECONDS, 5);
  });

  it('returns zero for short or invalid durations', () => {
    expect(clampResumeOffset(0.1, 0.2)).toBe(0);
    expect(clampResumeOffset(1, Number.NaN)).toBe(0);
    expect(clampResumeOffset(Number.NaN, 8)).toBe(0);
    expect(clampResumeOffset(-3, 8)).toBe(0);
  });
});

describe('spanElapsed', () => {
  it('returns null before the sentence starts', () => {
    expect(spanElapsed({ startAt: 10, duration: 4, startOffset: 0 }, 9.9)).toBeNull();
  });

  it('reports the skipped offset at the start of a resumed sentence', () => {
    expect(spanElapsed({ startAt: 10, duration: 4, startOffset: 2.5 }, 10)).toBe(2.5);
  });

  it('advances from the offset and clamps at the sentence duration', () => {
    expect(spanElapsed({ startAt: 10, duration: 4, startOffset: 2.5 }, 11)).toBe(3.5);
    expect(spanElapsed({ startAt: 10, duration: 4, startOffset: 2.5 }, 99)).toBe(4);
  });

  it('ignores offsets outside the buffer', () => {
    expect(spanElapsed({ startAt: 0, duration: 2, startOffset: 99 }, 0)).toBe(2);
    expect(spanElapsed({ startAt: 0, duration: 2, startOffset: -4 }, 0.5)).toBe(0.5);
  });
});
