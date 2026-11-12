/** Converts Float32 PCM in [-1, 1] to little-endian Int16 samples. */
export function float32ToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index];
    const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample;
    output[index] = Math.round(clamped * 32767);
  }
  return output;
}

/** Converts little-endian Int16 samples back to Float32. */
export function int16ToFloat32(input: Int16Array | Uint8Array): Float32Array {
  const samples =
    input instanceof Int16Array
      ? input
      : new Int16Array(input.buffer, input.byteOffset, Math.floor(input.byteLength / 2));
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    output[index] = samples[index] / 32768;
  }
  return output;
}

/** Concatenates PCM segments, optionally inserting silence between them. */
export function concatPcm(segments: ReadonlyArray<Float32Array>, gapSamples = 0): Float32Array {
  const length =
    segments.reduce((total, segment) => total + segment.length, 0) +
    gapSamples * Math.max(0, segments.length - 1);
  const output = new Float32Array(length);
  let cursor = 0;

  segments.forEach((segment, index) => {
    output.set(segment, cursor);
    cursor += segment.length;
    if (index < segments.length - 1) cursor += gapSamples;
  });

  return output;
}
