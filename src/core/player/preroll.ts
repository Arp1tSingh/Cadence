/**
 * Playback starts once this much narration is queued, instead of starting on
 * the first scheduled sentence. On devices slower than real time this trades a
 * longer initial wait for far fewer mid-sentence pauses.
 */
export const INITIAL_PREROLL_SECONDS = 3;

/** Upper bound so a very slow device does not wait forever for the first line. */
export const MAX_PREROLL_SECONDS = 20;

/**
 * Grows the target after an underrun. The +2 makes the first step meaningful
 * for short sentences, and the cap keeps the initial wait bounded.
 */
export function nextPreroll(current: number): number {
  const base = Number.isFinite(current) && current > 0 ? current : INITIAL_PREROLL_SECONDS;
  return Math.min(MAX_PREROLL_SECONDS, base * 1.5 + 2);
}

/**
 * True when the clock may resume. Scheduling the whole book (the last
 * sentence) also releases the clock: there is no more audio coming, so waiting
 * for the target would deadlock.
 */
export function prerollReached(
  bufferedSeconds: number,
  preroll: number,
  schedulingComplete: boolean,
): boolean {
  if (schedulingComplete) return true;
  if (!Number.isFinite(bufferedSeconds)) return false;
  return bufferedSeconds >= Math.max(0, preroll);
}
