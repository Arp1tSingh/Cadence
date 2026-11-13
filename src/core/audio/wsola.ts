/**
 * Offline WSOLA (Waveform Similarity Overlap-Add) time-stretching.
 *
 * Playback speed changes must not re-synthesize or shift pitch, so each cached
 * sentence is stretched on a worker. The algorithm overlaps Hann-windowed
 * frames at a fixed synthesis hop while choosing analysis positions whose
 * waveform best continues the previous frame, which keeps transients coherent
 * and avoids the metallic flutter of naive resampling.
 */

const DEFAULT_FRAME = 1024; // ~43 ms at 24 kHz
const COARSE_STEP = 8;

function hann(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  }
  return window;
}

function readSample(input: Float32Array, index: number): number {
  return index >= 0 && index < input.length ? input[index] : 0;
}

/**
 * Normalised cross-correlation between the candidate segment and the ideal
 * continuation of the previous frame. Only the sign and relative magnitude
 * matter, so a cheap unnormalised dot product with an energy penalty works.
 */
function similarity(
  input: Float32Array,
  candidate: number,
  target: number,
  frameSize: number,
): number {
  let dot = 0;
  let energy = 0;
  for (let index = 0; index < frameSize; index += 4) {
    const a = readSample(input, candidate + index);
    const b = readSample(input, target + index);
    dot += a * b;
    energy += a * a;
  }
  return dot / Math.sqrt(energy + 1e-9);
}

function bestOffset(
  input: Float32Array,
  nominal: number,
  target: number,
  frameSize: number,
  tolerance: number,
): number {
  let best = nominal;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let offset = -tolerance; offset <= tolerance; offset += COARSE_STEP) {
    const candidate = Math.max(0, nominal + offset);
    const score = similarity(input, candidate, target, frameSize);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  const coarseBest = best;
  for (let offset = -COARSE_STEP + 1; offset < COARSE_STEP; offset += 1) {
    const candidate = Math.max(0, coarseBest + offset);
    const score = similarity(input, candidate, target, frameSize);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

export type StretchOptions = {
  /** Playback speed multiplier. 1 returns the input unchanged. */
  rate: number;
  frameSize?: number;
  /** Maximum waveform-similarity search in samples. */
  tolerance?: number;
};

/**
 * Returns PCM whose duration is `input.length / rate`, preserving pitch.
 * `rate > 1` compresses, `rate < 1` expands.
 */
export function stretchPcm(input: Float32Array, options: StretchOptions): Float32Array {
  const rate = Math.min(3, Math.max(0.5, options.rate));
  if (!Number.isFinite(rate) || rate <= 0 || input.length === 0) {
    return input.slice();
  }
  if (Math.abs(rate - 1) < 0.001) return input.slice();

  const frameSize = options.frameSize ?? DEFAULT_FRAME;
  const synthesisHop = Math.floor(frameSize / 2);
  const analysisHop = Math.max(1, Math.round(synthesisHop * rate));
  const tolerance = options.tolerance ?? 256;
  const outputLength = Math.max(1, Math.round(input.length / rate));
  const padded = outputLength + frameSize * 2;

  const window = hann(frameSize);
  const output = new Float32Array(padded);
  const weight = new Float32Array(padded);

  let analysis = 0;
  let target = 0;
  let write = 0;

  while (write < outputLength) {
    const nominal = Math.min(Math.max(0, Math.round(analysis)), Math.max(0, input.length - 1));
    const position =
      target > 0
        ? bestOffset(input, nominal, Math.min(target, Math.max(0, input.length - 1)), frameSize, tolerance)
        : nominal;

    for (let index = 0; index < frameSize; index += 1) {
      const sample = readSample(input, position + index);
      const gain = window[index];
      output[write + index] += sample * gain;
      weight[write + index] += gain;
    }

    // The next frame should continue the waveform that would naturally follow
    // the segment just copied, not the nominal analysis position.
    target = position + synthesisHop;
    analysis += analysisHop;
    write += synthesisHop;
  }

  const result = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const gain = weight[index];
    result[index] = gain > 1e-6 ? output[index] / gain : output[index];
  }
  return result;
}

/** Maps word timings from source time into stretched time. */
export function scaleTimings<T extends { start: number; end: number }>(
  timings: T[],
  rate: number,
): T[] {
  if (Math.abs(rate - 1) < 0.001) return timings;
  return timings.map((timing) => ({
    ...timing,
    start: timing.start / rate,
    end: timing.end / rate,
  }));
}
