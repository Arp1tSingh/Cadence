import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  joinPdfLines,
  looksLikePageNumber,
  normalizeBlockText,
  normalizeWhitespace,
} from './text';

describe('normalizeWhitespace', () => {
  it('collapses invisible whitespace and control characters', () => {
    expect(normalizeWhitespace('  A\u00a0\u00a0book\n\nwith\tlines  ')).toBe('A book with lines');
    expect(normalizeWhitespace('zero\u200bwidth\u00adsoft')).toBe('zerowidthsoft');
  });
});

describe('normalizeBlockText', () => {
  it('normalizes dash spacing and errant spaces before punctuation', () => {
    expect(normalizeBlockText('She paused — then left .')).toBe('She paused — then left.');
  });
});

describe('joinPdfLines', () => {
  it('repairs words broken across lines', () => {
    expect(joinPdfLines('extraor-', 'dinary')).toBe('extraordinary');
    expect(joinPdfLines('ordinary', 'day')).toBe('ordinary day');
  });
});

describe('looksLikePageNumber', () => {
  it('detects common page furniture', () => {
    expect(looksLikePageNumber('42')).toBe(true);
    expect(looksLikePageNumber('Page 12 of 300')).toBe(true);
    expect(looksLikePageNumber('Chapter 12')).toBe(false);
  });
});

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(90)).toBe('2m');
    expect(formatDuration(3660)).toBe('1h 1m');
  });
});
