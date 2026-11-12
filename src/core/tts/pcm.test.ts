import { describe, expect, it } from 'vitest';
import { float32ToInt16, int16ToFloat32, concatPcm } from './pcm';

describe('float32ToInt16', () => {
  it('clamps to the 16-bit range', () => {
    const pcm = float32ToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    expect(Array.from(pcm)).toEqual([0, 32767, -32767, 32767, -32767, 16384]);
  });

  it('handles empty input', () => {
    expect(float32ToInt16(new Float32Array(0)).length).toBe(0);
  });
});

describe('int16ToFloat32', () => {
  it('round-trips within a quantisation step', () => {
    const source = new Float32Array([0, 0.25, -0.5, 0.999]);
    const restored = int16ToFloat32(float32ToInt16(source));
    for (let index = 0; index < source.length; index += 1) {
      expect(restored[index]).toBeCloseTo(source[index], 3);
    }
  });

  it('reads little-endian bytes with a byte offset', () => {
    const bytes = new Uint8Array([0, 0, 0, 64, 0, 192]);
    const restored = int16ToFloat32(bytes.subarray(2));
    expect(restored).toHaveLength(2);
    expect(restored[0]).toBeCloseTo(0.5, 5);
    expect(restored[1]).toBeCloseTo(-0.5, 5);
  });
});

describe('concatPcm', () => {
  it('joins segments without a gap', () => {
    const joined = concatPcm([new Float32Array([1, 2]), new Float32Array([3])]);
    expect(Array.from(joined)).toEqual([1, 2, 3]);
  });

  it('inserts silence between segments', () => {
    const joined = concatPcm([new Float32Array([1]), new Float32Array([2])], 2);
    expect(Array.from(joined)).toEqual([1, 0, 0, 2]);
  });

  it('returns an empty buffer for no segments', () => {
    expect(concatPcm([]).length).toBe(0);
  });
});
