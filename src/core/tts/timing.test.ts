import { describe, expect, it } from 'vitest';
import {
  alignWords,
  offsetTimings,
  wordIndexAt,
  wordProgressAt,
  wordWeight,
} from './timing';

const words = [
  { id: 'w0001', text: 'The' },
  { id: 'w0002', text: 'harbor' },
  { id: 'w0003', text: 'bell,' },
  { id: 'w0004', text: 'chimed.' },
];

describe('wordWeight', () => {
  it('gives longer words more weight than short ones', () => {
    expect(wordWeight('extraordinary')).toBeGreaterThan(wordWeight('a'));
  });

  it('adds a pause for sentence punctuation', () => {
    expect(wordWeight('chimed.')).toBeGreaterThan(wordWeight('chimed'));
    expect(wordWeight('bell,')).toBeGreaterThan(wordWeight('bell'));
  });

  it('keeps punctuation-only tokens positive', () => {
    expect(wordWeight('—')).toBeGreaterThan(0);
  });
});

describe('alignWords', () => {
  it('returns an empty timing array without words or duration', () => {
    expect(alignWords([], 4)).toEqual([]);
    expect(alignWords(words, 0)).toEqual([]);
    expect(alignWords(words, Number.NaN)).toEqual([]);
  });

  it('covers the whole measured duration without overlap', () => {
    const timings = alignWords(words, 3.2);
    expect(timings).toHaveLength(words.length);
    expect(timings[0].start).toBe(0);
    expect(timings.at(-1)?.end).toBeCloseTo(3.2, 6);

    for (let index = 1; index < timings.length; index += 1) {
      expect(timings[index].start).toBeCloseTo(timings[index - 1].end, 6);
      expect(timings[index].end).toBeGreaterThan(timings[index].start);
    }
  });

  it('preserves word identity', () => {
    const timings = alignWords(words, 1);
    expect(timings.map((timing) => timing.wordId)).toEqual(words.map((word) => word.id));
  });
});

describe('offsetTimings', () => {
  it('shifts both ends and leaves the source untouched', () => {
    const source = alignWords(words, 2);
    const shifted = offsetTimings(source, 5);
    expect(shifted[0].start).toBeCloseTo(5, 6);
    expect(shifted.at(-1)?.end).toBeCloseTo(7, 6);
    expect(source[0].start).toBe(0);
  });
});

describe('wordIndexAt', () => {
  const timings = alignWords(words, 4);

  it('clamps before and after the timeline', () => {
    expect(wordIndexAt(timings, -1)).toBe(0);
    expect(wordIndexAt(timings, 4)).toBe(words.length - 1);
    expect(wordIndexAt(timings, 20)).toBe(words.length - 1);
    expect(wordIndexAt([], 1)).toBe(-1);
  });

  it('finds the active word at each boundary', () => {
    timings.forEach((timing, index) => {
      expect(wordIndexAt(timings, timing.start)).toBe(index);
      expect(wordIndexAt(timings, timing.end - 0.0001)).toBe(index);
    });
  });
});

describe('wordProgressAt', () => {
  const timings = alignWords(words, 4);

  it('reports 0 at the start and ~1 at the end of a word', () => {
    expect(wordProgressAt(timings, timings[1].start)).toBe(0);
    const midpoint = (timings[1].start + timings[1].end) / 2;
    expect(wordProgressAt(timings, midpoint)).toBeCloseTo(0.5, 5);
    expect(wordProgressAt(timings, timings[1].end - 0.00001)).toBeCloseTo(1, 3);
  });

  it('is safe without timings', () => {
    expect(wordProgressAt([], 1)).toBe(0);
  });
});
