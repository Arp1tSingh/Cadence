import type { AudioCacheEntry } from '@/types/domain';

/** Default soft cap for rendered PCM; models and voices live outside it. */
export const DEFAULT_CACHE_CAP_BYTES = 2 * 1024 * 1024 * 1024;
export const UNLIMITED_CACHE_BYTES = 0;

export type CacheCapOption = {
  bytes: number;
  label: string;
  hint: string;
};

export const CACHE_CAP_OPTIONS: ReadonlyArray<CacheCapOption> = [
  { bytes: 512 * 1024 * 1024, label: '512 MB', hint: 'Light on disk' },
  { bytes: 1024 * 1024 * 1024, label: '1 GB', hint: 'About 10 hours' },
  { bytes: 2 * 1024 * 1024 * 1024, label: '2 GB', hint: 'Recommended' },
  { bytes: 4 * 1024 * 1024 * 1024, label: '4 GB', hint: 'Long books' },
  { bytes: UNLIMITED_CACHE_BYTES, label: 'Unlimited', hint: 'Never evict' },
];

export type CacheEntryMeta = Pick<AudioCacheEntry, 'key' | 'size' | 'createdAt'>;

export function totalCacheBytes(entries: ReadonlyArray<Pick<AudioCacheEntry, 'size'>>): number {
  let total = 0;
  for (const entry of entries) total += Math.max(0, entry.size);
  return total;
}

/**
 * Oldest-first eviction plan. A cap of zero or less means unlimited, so nothing
 * is ever selected; the caller decides when to run this.
 */
export function selectCacheEvictions<T extends CacheEntryMeta>(
  entries: ReadonlyArray<T>,
  capBytes: number,
): T[] {
  if (!Number.isFinite(capBytes) || capBytes <= 0) return [];

  let total = totalCacheBytes(entries);
  if (total <= capBytes) return [];

  const oldest = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  const evicted: T[] = [];

  for (const entry of oldest) {
    if (total <= capBytes) break;
    evicted.push(entry);
    total -= Math.max(0, entry.size);
  }

  return evicted;
}
