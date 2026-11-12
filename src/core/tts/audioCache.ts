import type { WordTiming } from '@/types/domain';
import {
  deleteAudioCacheEntry,
  getAudioCacheEntry,
  putAudioCacheEntry,
} from '@/core/storage/db';
import { audioCacheSegments, opfs } from '@/core/storage/opfs';
import { SAMPLE_RATE } from './constants';
import { int16ToFloat32, float32ToInt16 } from './pcm';

export type CachedSentenceAudio = {
  audio: Float32Array;
  timings: WordTiming[];
  duration: number;
};

export async function readSentenceCache(
  bookId: string,
  voiceKey: string,
  cacheKey: string,
): Promise<CachedSentenceAudio | null> {
  const entry = await getAudioCacheEntry(cacheKey);
  if (!entry) return null;

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

export async function writeSentenceCache(params: {
  bookId: string;
  voiceKey: string;
  cacheKey: string;
  sentenceId: string;
  chapterIndex: number;
  audio: Float32Array;
  timings: WordTiming[];
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
  });
}
