/**
 * Pure helpers for the in-memory PCM cache total. The running total lets the
 * TTS worker decide whether eviction is needed without loading every cache
 * row (and its word timings) from IndexedDB on each write.
 */

/** Adds a write and subtracts a replaced entry of the same cache key. */
export function netCacheBytes(current: number, incoming: number, replaced = 0): number {
  const base = Number.isFinite(current) && current > 0 ? current : 0;
  const added = Number.isFinite(incoming) && incoming > 0 ? incoming : 0;
  const removed = Number.isFinite(replaced) && replaced > 0 ? replaced : 0;
  return Math.max(0, base + added - removed);
}

/** A cap of zero or less means unlimited, so it is never over. */
export function cacheOverCap(total: number, capBytes: number): boolean {
  if (!Number.isFinite(capBytes) || capBytes <= 0) return false;
  return Number.isFinite(total) && total > capBytes;
}
