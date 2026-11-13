import { describe, expect, it } from 'vitest';
import { scaleTimings, stretchPcm } from './wsola';

const SAMPLE_RATE = 24_000;

function sine(frequency: number, seconds: number, amplitude = 0.5): Float32Array {
  const samples = new Float32Array(Math.round(SAMPLE_RATE * seconds));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE);
  }
  return samples;
}

/** Goertzel-style magnitude for a single frequency, used to detect pitch shift. */
function magnitudeAt(samples: Float32Array, frequency: number): number {
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const angle = (2 * Math.PI * frequency * index) / SAMPLE_RATE;
    real += samples[index] * Math.cos(angle);
    imaginary += samples[index] * Math.sin(angle);
  }
  return Math.sqrt(real * real + imaginary * imaginary) / samples.length;
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] ** 2;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function peak(samples: Float32Array): number {
  let max = 0;
  for (let index = 0; index < samples.length; index += 1) {
    max = Math.max(max, Math.abs(samples[index]));
  }
  return max;
}

describe('stretchPcm', () => {
  it('returns a copy when the rate is 1', () => {
    const input = sine(220, 0.1);
    const output = stretchPcm(input, { rate: 1 });
    expect(output).not.toBe(input);
    expect(Array.from(output)).toEqual(Array.from(input));
  });

  it('handles empty and invalid input without throwing', () => {
    expect(stretchPcm(new Float32Array(0), { rate: 1.5 })).toHaveLength(0);
    expect(stretchPcm(new Float32Array(0), { rate: Number.NaN })).toHaveLength(0);
    expect(stretchPcm(sine(220, 0.05), { rate: Number.NaN })).toHaveLength(1200);
  });

  it('produces audio whose duration is input / rate', () => {
    const input = sine(220, 1);
    for (const rate of [0.5, 0.75, 1.25, 1.5, 2, 3]) {
      const output = stretchPcm(input, { rate });
      expect(output.length).toBeCloseTo(input.length / rate, -2);
    }
  });

  it('preserves pitch instead of resampling', () => {
    const input = sine(300, 1);
    const output = stretchPcm(input, { rate: 1.6 });
    const original = magnitudeAt(input, 300);
    expect(magnitudeAt(output, 300)).toBeGreaterThan(original * 0.55);
    // A naive resample would move the tone to 300 * 1.6 = 480 Hz.
    expect(magnitudeAt(output, 480)).toBeLessThan(magnitudeAt(output, 300) * 0.25);
  });

  it('keeps amplitude and energy in a sane range', () => {
    const input = sine(440, 1);
    const output = stretchPcm(input, { rate: 1.5 });
    expect(peak(output)).toBeLessThan(peak(input) * 1.25);
    expect(rms(output)).toBeGreaterThan(rms(input) * 0.7);
    expect(rms(output)).toBeLessThan(rms(input) * 1.2);
  });

  it('keeps a constant signal at its original level', () => {
    const input = new Float32Array(24_000).fill(0.25);
    const output = stretchPcm(input, { rate: 2 });
    expect(output).toHaveLength(12_000);
    expect(rms(output)).toBeCloseTo(0.25, 2);
  });

  it('is deterministic', () => {
    const input = sine(180, 0.5);
    const first = stretchPcm(input, { rate: 1.3 });
    const second = stretchPcm(input, { rate: 1.3 });
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});

describe('scaleTimings', () => {
  const timings = [
    { wordId: 'w0001', start: 0, end: 0.4 },
    { wordId: 'w0002', start: 0.4, end: 1.2 },
  ];

  it('maps source time onto stretched time', () => {
    const scaled = scaleTimings(timings, 1.5);
    expect(scaled[0]).toEqual({ wordId: 'w0001', start: 0, end: 0.4 / 1.5 });
    expect(scaled[1].start).toBeCloseTo(0.4 / 1.5, 6);
    expect(scaled[1].end).toBeCloseTo(1.2 / 1.5, 6);
  });

  it('returns the original array at rate 1', () => {
    expect(scaleTimings(timings, 1)).toBe(timings);
  });

  it('does not mutate its input', () => {
    scaleTimings(timings, 2);
    expect(timings[1].end).toBe(1.2);
  });
});
