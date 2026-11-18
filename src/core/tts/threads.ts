/**
 * ONNX Runtime Web's default is `min(4, ceil(logicalCores / 2))`. That heuristic
 * exists because `navigator.hardwareConcurrency` reports logical CPUs, while
 * ONNX matmuls scale with physical cores and regress once hyperthreads
 * oversubscribe them.
 *
 * Measured on the QA i5-8265U (4 cores / 8 logical) with Kokoro q8, a 13-word
 * sentence, 3 runs per count:
 *
 *   threads   median RTF   wall time (4.28 s audio)
 *   1         0.14         31.2 s
 *   2         0.17         25.5 s
 *   4         0.18         23.2 s   ← best
 *   6         0.16         26.0 s
 *   7         0.17         25.2 s
 *   8         0.17         25.2 s
 *
 * So half the logical count is the right estimate for physical cores. We keep
 * that heuristic but raise ORT's four-thread cap to `MAX_TTS_THREADS`, so a
 * 6-core/12-thread laptop can use six threads instead of four.
 *
 * This is not about consuming every CPU: eight threads used twice the CPU of
 * four and produced audio ~10% slower. Re-run `threadBenchmark.ts` on a new
 * device before changing the policy.
 */
export const MAX_TTS_THREADS = 8;

/** Estimates physical cores from the logical count reported by the browser. */
export function defaultTtsThreads(
  hardwareConcurrency: number | undefined,
  crossOriginIsolated: boolean,
): number {
  if (!crossOriginIsolated) return 1;
  const logical = Math.max(1, Math.floor(hardwareConcurrency || 2));
  const estimatedPhysical = Math.ceil(logical / 2);
  return Math.max(1, Math.min(MAX_TTS_THREADS, estimatedPhysical));
}

/**
 * Dev-only worker names look like `cadence-tts:threads=8`. A worker cannot
 * change ORT's thread pool after the WASM module initializes, so the benchmark
 * spawns a fresh worker for each count instead of mutating a live session.
 */
export function parseThreadOverride(name: string | undefined): number | null {
  if (!name) return null;
  const match = /(?:^|:)threads=(\d+)(?:$|:)/.exec(name);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 1 || value > 32) return null;
  return value;
}
