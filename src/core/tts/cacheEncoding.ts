import type { WordTiming } from '@/types/domain';
import { SAMPLE_RATE } from './constants';
import { float32ToInt16 } from './pcm';

/**
 * A sentence's cache payload, encoded but not yet written. Encoding happens
 * while the Float32 buffer still exists: Comlink transfers (and detaches) it
 * when the synthesized result returns to the main thread.
 */
export type SentenceCachePayload = {
  bookId: string;
  voiceKey: string;
  cacheKey: string;
  sentenceId: string;
  chapterIndex: number;
  /** Little-endian Int16 PCM, exactly the bytes written to OPFS. */
  pcm: Uint8Array<ArrayBuffer>;
  duration: number;
  timings: WordTiming[];
  speechKey?: string;
  /** Byte size of `pcm`, used for cache accounting. */
  size: number;
  createdAt: number;
};

export type SentenceCacheInput = {
  bookId: string;
  voiceKey: string;
  cacheKey: string;
  sentenceId: string;
  chapterIndex: number;
  audio: Float32Array;
  timings: WordTiming[];
  speechKey?: string;
};

export function encodeSentenceCache(
  input: SentenceCacheInput,
  now = Date.now(),
): SentenceCachePayload {
  const pcm = float32ToInt16(input.audio);
  return {
    bookId: input.bookId,
    voiceKey: input.voiceKey,
    cacheKey: input.cacheKey,
    sentenceId: input.sentenceId,
    chapterIndex: input.chapterIndex,
    pcm: new Uint8Array(pcm.buffer as ArrayBuffer, pcm.byteOffset, pcm.byteLength),
    duration: input.audio.length / SAMPLE_RATE,
    timings: input.timings,
    ...(input.speechKey ? { speechKey: input.speechKey } : {}),
    size: pcm.byteLength,
    createdAt: now,
  };
}
