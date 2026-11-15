import {
  clearAllAudioCacheIndex,
  listAllAudioCacheEntries,
} from '@/core/storage/db';
import { clearAllAudioCacheFiles } from '@/core/storage/opfs';
import { enforceAudioCacheCap, resetAudioCacheAccounting } from './audioCache';

export type AudioCacheUsage = {
  entries: number;
  bytes: number;
};

export async function readAudioCacheUsage(): Promise<AudioCacheUsage> {
  const entries = await listAllAudioCacheEntries();
  let bytes = 0;
  for (const entry of entries) bytes += Math.max(0, entry.size);
  return { entries: entries.length, bytes };
}

/** Applies a newly chosen cap immediately; returns the evicted entry count. */
export async function applyAudioCacheCap(capBytes: number): Promise<number> {
  return enforceAudioCacheCap(capBytes);
}

/**
 * Removes every rendered sentence. Models and voice styles are separate and
 * stay downloaded, so the next listen is fast again after a model load.
 * Removing a book already drops its own cache rows in `deleteBook()`.
 */
export async function clearRenderedAudio(): Promise<void> {
  try {
    await clearAllAudioCacheFiles();
  } finally {
    await clearAllAudioCacheIndex();
    // The running total now understates nothing but could still hold the old
    // figure; drop it so the next write rescans the (empty) index.
    resetAudioCacheAccounting();
  }
}
