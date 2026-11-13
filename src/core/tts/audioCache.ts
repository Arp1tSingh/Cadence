import type { AudioCacheEntry, WordTiming } from '@/types/domain';
import {
  deleteAudioCacheEntry,
  getAudioCacheEntry,
  listAllAudioCacheEntries,
  putAudioCacheEntry,
} from '@/core/storage/db';
import { audioCacheSegments, opfs } from '@/core/storage/opfs';
import { SAMPLE_RATE } from './constants';
import { selectCacheEvictions } from './cachePolicy';
import { int16ToFloat32, float32ToInt16 } from './pcm';

export type CachedSentenceAudio = {
  audio: Float32Array;
  timings: WordTiming[];
  duration: number;
};

/** Deletes both the OPFS PCM file and the IndexedDB metadata row. */
export async function deleteCachedAudioFile(entry: AudioCacheEntry): Promise<void> {
  await opfs
    .remove(audioCacheSegments(entry.bookId, entry.voiceKey, entry.key))
    .catch(() => undefined);
  await deleteAudioCacheEntry(entry.key).catch(() => undefined);
}

export async function readSentenceCache(
  bookId: string,
  voiceKey: string,
  cacheKey: string,
  speechKey?: string,
): Promise<CachedSentenceAudio | null> {
  const entry = await getAudioCacheEntry(cacheKey);
  if (!entry) return null;

  // The cache key hashes the spoken text, so a hit is valid for the current
  // profile even if it was rendered under another one. Refresh the marker so
  // chapter rings stop treating reusable audio as stale.
  if (speechKey && entry.speechKey !== speechKey) {
    await putAudioCacheEntry({ ...entry, speechKey }).catch(() => undefined);
  }

  const bytes = await opfs.read(audioCacheSegments(bookId, voiceKey, cacheKey));
  if (!bytes || bytes.byteLength === 0) {
    await deleteAudioCacheEntry(cacheKey).catch(() => undefined);
    return null;
  }

  const audio = int16ToFloat32(bytes);
  const duration = audio.length / SAMPLE_RATE;
  return {
    audio,
    duration,
    timings: entry.timings.map((timing) => ({
      wordId: timing.wordId,
      start: Math.min(timing.start, duration),
      end: Math.min(timing.end, duration),
    })),
  };
}

/** Counts writes so a large prefetch batch only sweeps occasionally. */
let writesSinceSweep = 0;
const SWEEP_INTERVAL = 8;

/**
 * Enforces the soft cap oldest-first. Returns how many entries were evicted.
 * A cap of zero or less means unlimited.
 */
export async function enforceAudioCacheCap(capBytes: number): Promise<number> {
  if (!Number.isFinite(capBytes) || capBytes <= 0) return 0;

  const entries = await listAllAudioCacheEntries();
  const evicted = selectCacheEvictions(entries, capBytes);
  for (const entry of evicted) await deleteCachedAudioFile(entry);
  return evicted.length;
}

export async function writeSentenceCache(params: {
  bookId: string;
  voiceKey: string;
  cacheKey: string;
  sentenceId: string;
  chapterIndex: number;
  audio: Float32Array;
  timings: WordTiming[];
  speechKey?: string;
  cacheCapBytes?: number;
}): Promise<void> {
  const pcm = float32ToInt16(params.audio);
  const duration = params.audio.length / SAMPLE_RATE;

  await opfs.write(
    audioCacheSegments(params.bookId, params.voiceKey, params.cacheKey),
    new Uint8Array(pcm.buffer as ArrayBuffer),
  );

  await putAudioCacheEntry({
    key: params.cacheKey,
    bookId: params.bookId,
    voiceKey: params.voiceKey,
    sentenceId: params.sentenceId,
    chapterIndex: params.chapterIndex,
    duration,
    timings: params.timings,
    size: pcm.byteLength,
    createdAt: Date.now(),
    speechKey: params.speechKey,
  });

  if (params.cacheCapBytes && params.cacheCapBytes > 0) {
    writesSinceSweep += 1;
    if (writesSinceSweep >= SWEEP_INTERVAL) {
      writesSinceSweep = 0;
      await enforceAudioCacheCap(params.cacheCapBytes).catch(() => undefined);
    }
  }
}
