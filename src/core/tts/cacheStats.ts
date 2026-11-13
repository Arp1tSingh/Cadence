import type { BookDocument } from '@/types/domain';
import type { VoiceSelection } from '@/types/tts';
import { listAudioCacheForBook } from '@/core/storage/db';
import { voiceKeyFor } from './voices';

export type ChapterCacheStat = {
  cached: number;
  total: number;
};

/** Cached sentences are voice-specific, so stats are keyed by narrator. */
export const EMPTY_CHAPTER_CACHE_STAT: ChapterCacheStat = { cached: 0, total: 0 };

export function chapterSentenceCounts(book: BookDocument): Map<number, number> {
  const counts = new Map<number, number>();
  for (const chapter of book.chapters) {
    let total = 0;
    for (const paragraph of chapter.paragraphs) total += paragraph.sentences.length;
    counts.set(chapter.index, total);
  }
  return counts;
}

/**
 * Reads the audio cache index for a book and aggregates it into per-chapter
 * progress. This is metadata only; PCM still lives in OPFS.
 */
export async function readChapterCacheStats(
  book: BookDocument,
  voice: VoiceSelection,
): Promise<Map<number, ChapterCacheStat>> {
  const totals = chapterSentenceCounts(book);
  const stats = new Map<number, ChapterCacheStat>();
  for (const [chapterIndex, total] of totals) {
    stats.set(chapterIndex, { cached: 0, total });
  }

  let entries;
  try {
    entries = await listAudioCacheForBook(book.id);
  } catch {
    return stats;
  }

  const key = voiceKeyFor(voice);
  for (const entry of entries) {
    if (entry.voiceKey !== key) continue;
    const stat = stats.get(entry.chapterIndex);
    if (!stat || stat.cached >= stat.total) continue;
    stat.cached += 1;
  }
  return stats;
}

export function cacheRatio(stat: ChapterCacheStat | undefined): number {
  if (!stat || stat.total === 0) return 0;
  return Math.min(1, stat.cached / stat.total);
}
