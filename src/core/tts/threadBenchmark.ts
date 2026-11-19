import type { SentenceNode, WordToken } from '@/types/domain';
import { clearAudioCacheIndex } from '@/core/storage/db';
import { opfs } from '@/core/storage/opfs';
import {
  disposeTtsWorker,
  ensureTtsModel,
  synthesizeSentence,
} from '@/core/workers/ttsClient';

/**
 * A short, ordinary English sentence. Long enough to exercise the graph and
 * short enough that a six-configuration sweep finishes in a few minutes on a
 * CPU that only manages ~0.4× real time.
 */
const BENCHMARK_TEXT =
  'The lanterns were already lit when the harbor bells began to ring.';

export const DEFAULT_BENCHMARK_THREADS = [1, 2, 4, 6, 7, 8] as const;

export type ThreadBenchmarkRow = {
  threads: number;
  loadMs: number;
  audioSeconds: number;
  /** Measured inference wall time per run, excluding the warm-up. */
  wallMs: number[];
  /** Audio seconds produced per wall second for each run. */
  rtf: number[];
  medianRtf: number;
  /** Median RTF relative to the single-thread run, when available. */
  speedup?: number;
  error?: string;
};

function benchmarkSentence(id: string): SentenceNode {
  const words: WordToken[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(BENCHMARK_TEXT)) !== null) {
    const text = match[0];
    words.push({
      id: `w${String(index + 1).padStart(4, '0')}`,
      text,
      ttsStart: match.index,
      ttsEnd: match.index + text.length,
      isWord: /[\p{L}\p{N}]/u.test(text),
    });
    index += 1;
  }

  return {
    id,
    chapterIndex: 0,
    paragraphIndex: 0,
    sentenceIndex: 0,
    displayText: BENCHMARK_TEXT,
    ttsText: BENCHMARK_TEXT,
    words,
    chunks: [
      {
        id: `${id}_c01`,
        text: BENCHMARK_TEXT,
        startTtsOffset: 0,
        endTtsOffset: BENCHMARK_TEXT.length,
        wordIds: words.map((word) => word.id),
      },
    ],
    charCount: BENCHMARK_TEXT.length,
    wordCount: words.length,
    estimatedDuration: 5,
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Measures Kokoro q8 at several WASM thread counts. Each count gets a fresh
 * worker because ORT reads `numThreads` only when the WASM backend initializes.
 *
 * Dev-only, exposed as `window.__cadenceThreadBenchmark()` in `main.tsx`.
 * Do not run it while narration is playing: the sweep replaces the TTS worker.
 */
export async function runThreadBenchmark(options?: {
  threads?: readonly number[];
  runs?: number;
  onProgress?: (message: string) => void;
}): Promise<ThreadBenchmarkRow[]> {
  const threadCounts = options?.threads ?? DEFAULT_BENCHMARK_THREADS;
  const runs = Math.max(1, Math.floor(options?.runs ?? 3));
  const bookId = `benchmark-threads-${Date.now()}`;
  const rows: ThreadBenchmarkRow[] = [];

  try {
    for (const threads of threadCounts) {
      options?.onProgress?.(
        `Loading Kokoro q8 with ${threads} thread${threads === 1 ? '' : 's'}…`,
      );
      disposeTtsWorker();
      const workerName = `cadence-tts:threads=${threads}`;
      const loadStarted = performance.now();
      try {
        let lastMessage = '';
        await ensureTtsModel(
          'balanced',
          (progress) => {
            // transformers.js repeats the same per-file progress many times per
            // second; forward only transitions so the console stays readable.
            const message = `${progress.message} (${Math.round(progress.progress * 100)}%)`;
            if (message === lastMessage) return;
            lastMessage = message;
            options?.onProgress?.(`${threads} threads · ${message}`);
          },
          {
            threads,
            name: workerName,
          },
        );
      } catch (error) {
        rows.push({
          threads,
          loadMs: Math.round(performance.now() - loadStarted),
          audioSeconds: 0,
          wallMs: [],
          rtf: [],
          medianRtf: 0,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const loadMs = performance.now() - loadStarted;

      const wallMs: number[] = [];
      let audioSeconds = 0;
      try {
        // The first run warms the phonemizer and ORT kernels; exclude it.
        for (let run = 0; run <= runs; run += 1) {
          if (run > 0) {
            options?.onProgress?.(
              `${threads} threads · run ${run}/${runs}…`,
            );
          }
          const sentence = benchmarkSentence(`${bookId}-${threads}-${run}`);
          const started = performance.now();
          const result = await synthesizeSentence(
            {
              bookId,
              tier: 'balanced',
              voice: { primary: 'af_heart' },
              sentence,
              priority: 'foreground',
              skipCache: true,
            },
            { name: workerName },
          );
          const elapsed = performance.now() - started;
          audioSeconds = result.duration;
          if (run > 0) wallMs.push(elapsed);
        }
      } catch (error) {
        rows.push({
          threads,
          loadMs: Math.round(loadMs),
          audioSeconds,
          wallMs: wallMs.map((value) => Math.round(value)),
          rtf: [],
          medianRtf: 0,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const rtf = wallMs.map((value) => audioSeconds / (value / 1000));
      rows.push({
        threads,
        loadMs: Math.round(loadMs),
        audioSeconds: Number(audioSeconds.toFixed(2)),
        wallMs: wallMs.map((value) => Math.round(value)),
        rtf: rtf.map((value) => Number(value.toFixed(2))),
        medianRtf: Number(median(rtf).toFixed(2)),
      });
    }
  } finally {
    disposeTtsWorker();
    // skipCache means these should be empty, but clean up defensively in case
    // a future variant of the benchmark writes audio.
    await clearAudioCacheIndex(bookId).catch(() => undefined);
    await opfs.removeDir('cache', bookId).catch(() => undefined);
  }

  const baseline = rows.find((row) => row.threads === 1 && !row.error);
  if (baseline && baseline.medianRtf > 0) {
    for (const row of rows) {
      if (!row.error && row.medianRtf > 0) {
        row.speedup = Number((row.medianRtf / baseline.medianRtf).toFixed(2));
      }
    }
  }

  return rows;
}
