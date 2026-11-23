import type { AudioCacheEntry, WordTiming } from '@/types/domain';
import {
  deleteAudioCacheEntry,
  getAudioCacheEntry,
  hasBookRecord,
  listAudioCacheSizes,
  putAudioCacheEntry,
} from '@/core/storage/db';
import { audioCacheSegments, opfs } from '@/core/storage/opfs';
import { KOKORO_SAMPLE_RATE } from './constants';
import { totalCacheBytes, selectCacheEvictions } from './cachePolicy';
import { cacheOverCap, netCacheBytes } from './cacheAccounting';
import { encodeSentenceCache, type SentenceCachePayload } from './cacheEncoding';
import { int16ToFloat32 } from './pcm';
import type { TtsEngineId } from '@/types/tts';

export type CachedSentenceAudio = {
  audio: Float32Array;
  timings: WordTiming[];
  duration: number;
  /** Native rate of the decoded PCM. Legacy rows are 24 kHz Kokoro. */
  sampleRate: number;
  engine: TtsEngineId;
};

/** Deletes both the OPFS PCM file and the IndexedDB metadata row. */
export async function deleteCachedAudioFile(
  entry: Pick<AudioCacheEntry, 'bookId' | 'voiceKey' | 'key'>,
): Promise<void> {
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
    // Keep the running total honest after dropping an orphaned row.
    if (cacheBytesTotal !== null) {
      cacheBytesTotal = netCacheBytes(cacheBytesTotal, 0, entry.size);
    }
    return null;
  }

  const audio = int16ToFloat32(bytes);
  const sampleRate = entry.sampleRate ?? KOKORO_SAMPLE_RATE;
  const duration = audio.length / sampleRate;
  return {
    audio,
    duration,
    sampleRate,
    engine: entry.engine ?? 'kokoro',
    timings: entry.timings.map((timing) => ({
      wordId: timing.wordId,
      start: Math.min(timing.start, duration),
      end: Math.min(timing.end, duration),
    })),
  };
}

/**
 * Running total of rendered PCM on disk. `null` means it has not been scanned
 * yet; the first write performs one lightweight pass and every later write is
 * pure arithmetic.
 */
let cacheBytesTotal: number | null = null;
/** Active soft cap; zero or less means unlimited. */
let cacheByteLimit = 0;

/** Forces the next write to rescan the index (used after external clears). */
export function resetAudioCacheAccounting(): void {
  cacheBytesTotal = null;
}

async function knownCacheBytes(): Promise<number | null> {
  if (cacheBytesTotal === null) {
    const entries = await listAudioCacheSizes();
    // A failed scan must not be mistaken for an empty cache: returning null
    // makes callers skip eviction and retry the scan on the next write.
    if (!entries) return null;
    cacheBytesTotal = totalCacheBytes(entries);
  }
  return cacheBytesTotal;
}

/**
 * Enforces the soft cap oldest-first. Returns how many entries were evicted.
 * A cap of zero or less means unlimited. Used directly when the user changes
 * the cap, and internally when a write pushes the total past it.
 */
export async function enforceAudioCacheCap(capBytes: number): Promise<number> {
  if (!Number.isFinite(capBytes) || capBytes <= 0) return 0;

  cacheByteLimit = capBytes;
  const entries = await listAudioCacheSizes();
  if (!entries) return 0;
  const evicted = selectCacheEvictions(entries, capBytes);
  for (const entry of evicted) await deleteCachedAudioFile(entry);
  cacheBytesTotal = totalCacheBytes(entries) - totalCacheBytes(evicted);
  return evicted.length;
}

async function sweepCacheIfNeeded(): Promise<void> {
  const known = await knownCacheBytes();
  if (known === null || !cacheOverCap(known, cacheByteLimit)) return;

  const entries = await listAudioCacheSizes();
  if (!entries) return;
  const evicted = selectCacheEvictions(entries, cacheByteLimit);
  for (const entry of evicted) await deleteCachedAudioFile(entry);
  // Recompute instead of subtracting: another context (the settings sheet or
  // a book deletion) may have removed rows since the last write.
  cacheBytesTotal = totalCacheBytes(entries) - totalCacheBytes(evicted);
}

/**
 * Writes one encoded sentence to OPFS and IndexedDB. An existing row with the
 * same key is replaced, so its size is subtracted from the running total.
 */
export async function persistSentenceCache(
  payload: SentenceCachePayload,
  cacheCapBytes?: number,
): Promise<void> {
  // Deleting a book can race an in-flight synthesis (notably an export that
  // was cancelled from the shelf). Never recreate a cache directory that
  // removeBook has already cleared.
  if (!(await hasBookRecord(payload.bookId))) return;

  const existing = await getAudioCacheEntry(payload.cacheKey);
  const segments = audioCacheSegments(payload.bookId, payload.voiceKey, payload.cacheKey);

  await opfs.write(segments, payload.pcm);

  // The record can disappear while PCM is being written. Drop the fresh file
  // instead of leaving an unreachable orphan behind.
  if (!(await hasBookRecord(payload.bookId))) {
    await opfs.remove(segments).catch(() => undefined);
    return;
  }

  await putAudioCacheEntry({
    key: payload.cacheKey,
    bookId: payload.bookId,
    voiceKey: payload.voiceKey,
    sentenceId: payload.sentenceId,
    chapterIndex: payload.chapterIndex,
    duration: payload.duration,
    timings: payload.timings,
    size: payload.size,
    createdAt: payload.createdAt,
    engine: payload.engine,
    sampleRate: payload.sampleRate,
    speechKey: payload.speechKey,
  });

  cacheByteLimit = cacheCapBytes ?? 0;
  const known = await knownCacheBytes();
  if (known === null) {
    // Leave the total unknown so the next write rescans instead of trusting a
    // total that predates this row.
    cacheBytesTotal = null;
    return;
  }
  cacheBytesTotal = netCacheBytes(known, payload.size, existing?.size ?? 0);
  if (cacheByteLimit > 0) await sweepCacheIfNeeded();
}

/**
 * Encodes and writes in one step for callers that must await persistence
 * (export). Playback uses `encodeSentenceCache` + `persistSentenceCache` from
 * a background queue instead.
 */
export async function writeSentenceCache(params: {
  bookId: string;
  voiceKey: string;
  cacheKey: string;
  sentenceId: string;
  chapterIndex: number;
  audio: Float32Array;
  timings: WordTiming[];
  engine: TtsEngineId;
  sampleRate: number;
  speechKey?: string;
  cacheCapBytes?: number;
}): Promise<void> {
  await persistSentenceCache(
    encodeSentenceCache({
      bookId: params.bookId,
      voiceKey: params.voiceKey,
      cacheKey: params.cacheKey,
      sentenceId: params.sentenceId,
      chapterIndex: params.chapterIndex,
      audio: params.audio,
      timings: params.timings,
      engine: params.engine,
      sampleRate: params.sampleRate,
      speechKey: params.speechKey,
    }),
    params.cacheCapBytes,
  );
}
