import { describe, expect, it } from 'vitest';
import { cacheOverCap, netCacheBytes } from './cacheAccounting';
import { encodeSentenceCache } from './cacheEncoding';
import { SAMPLE_RATE } from './constants';

describe('netCacheBytes', () => {
  it('adds writes and subtracts a replaced entry', () => {
    expect(netCacheBytes(1000, 250)).toBe(1250);
    expect(netCacheBytes(1000, 250, 250)).toBe(1000);
    expect(netCacheBytes(100, 50, 200)).toBe(0);
  });

  it('ignores invalid sizes instead of corrupting the total', () => {
    expect(netCacheBytes(Number.NaN, 10)).toBe(10);
    expect(netCacheBytes(10, -5)).toBe(10);
    expect(netCacheBytes(10, 5, Number.NaN)).toBe(15);
  });
});

describe('cacheOverCap', () => {
  it('treats zero and negative caps as unlimited', () => {
    expect(cacheOverCap(Number.MAX_SAFE_INTEGER, 0)).toBe(false);
    expect(cacheOverCap(10, -1)).toBe(false);
    expect(cacheOverCap(10, Number.NaN)).toBe(false);
  });

  it('compares against a positive cap', () => {
    expect(cacheOverCap(99, 100)).toBe(false);
    expect(cacheOverCap(100, 100)).toBe(false);
    expect(cacheOverCap(101, 100)).toBe(true);
  });
});

describe('encodeSentenceCache', () => {
  it('accounts Int16 bytes and duration without touching the float buffer', () => {
    const audio = new Float32Array([0.5, -0.5, 0, 2]);
    const payload = encodeSentenceCache(
      {
        bookId: 'book',
        voiceKey: 'af_heart',
        cacheKey: 'key',
        sentenceId: 'ch01_p0_s0',
        chapterIndex: 0,
        audio,
        timings: [],
        speechKey: 'speech',
      },
      1234,
    );

    expect(payload.pcm.byteLength).toBe(audio.length * Int16Array.BYTES_PER_ELEMENT);
    expect(payload.size).toBe(payload.pcm.byteLength);
    expect(payload.duration).toBeCloseTo(audio.length / SAMPLE_RATE, 10);
    expect(payload.createdAt).toBe(1234);
    expect(payload.speechKey).toBe('speech');
    expect(audio[0]).toBe(0.5);
  });
});
