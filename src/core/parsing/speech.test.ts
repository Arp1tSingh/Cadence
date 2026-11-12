import { describe, expect, it } from 'vitest';
import {
  expandTokenForSpeech,
  integerToWords,
  ordinalToWords,
  yearToWords,
} from './speech';

describe('integerToWords', () => {
  it('handles small and large numbers', () => {
    expect(integerToWords(0)).toBe('zero');
    expect(integerToWords(42)).toBe('forty-two');
    expect(integerToWords(1001)).toBe('one thousand one');
    expect(integerToWords(1_234_567)).toBe('one million two hundred thirty-four thousand five hundred sixty-seven');
  });
});

describe('yearToWords', () => {
  it('reads years naturally', () => {
    expect(yearToWords(1984)).toBe('nineteen eighty-four');
    expect(yearToWords(2005)).toBe('twenty oh five');
    expect(yearToWords(2000)).toBe('two thousand');
  });
});

describe('ordinalToWords', () => {
  it('handles compound ordinals', () => {
    expect(ordinalToWords(1)).toBe('first');
    expect(ordinalToWords(21)).toBe('twenty-first');
    expect(ordinalToWords(100)).toBe('one hundredth');
  });
});

describe('expandTokenForSpeech', () => {
  it('expands abbreviations and acronyms', () => {
    expect(expandTokenForSpeech('Mr.')).toBe('Mister');
    expect(expandTokenForSpeech('e.g.')).toBe('for example');
    expect(expandTokenForSpeech('U.S.A.')).toBe('U S A');
  });

  it('expands numbers while preserving surrounding punctuation', () => {
    expect(expandTokenForSpeech('"1984"')).toBe('"nineteen eighty-four"');
    expect(expandTokenForSpeech('42,')).toBe('forty-two,');
    expect(expandTokenForSpeech('45%')).toBe('forty-five percent');
    expect(expandTokenForSpeech('$12.50')).toBe('twelve dollars and fifty cents');
    expect(expandTokenForSpeech('3:05')).toBe("three oh five");
    expect(expandTokenForSpeech('3:00')).toBe("three o'clock");
  });

  it('leaves ordinary words alone', () => {
    expect(expandTokenForSpeech('harbor')).toBe('harbor');
    expect(expandTokenForSpeech('“Hello,”')).toBe('“Hello,”');
  });
});
