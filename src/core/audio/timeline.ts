/**
 * Pure timeline math for sentence-accurate seeking. The session keeps every
 * sentence start on a 1× content clock, while scheduled audio runs on the
 * stretched playback clock; these helpers convert between the two without
 * touching the Web Audio graph.
 */

/** A resume offset never schedules less than this much audible tail. */
export const MIN_RESUME_TAIL_SECONDS = 0.25;

export type ContentPosition = {
  index: number;
  /** Seconds into the sentence, on the 1× content timeline. */
  offsetSeconds: number;
};

/**
 * Finds the sentence that contains `contentSeconds` and the offset inside it.
 * `prefixDurations` holds each sentence's start time, so the last start at or
 * before the target is the answer. Binary search keeps scrubbing cheap on
 * books with thousands of sentences.
 */
export function sentenceAtContentTime(
  prefixDurations: readonly number[],
  contentSeconds: number,
): ContentPosition {
  if (prefixDurations.length === 0) return { index: 0, offsetSeconds: 0 };

  const target = Math.max(0, contentSeconds);
  let low = 0;
  let high = prefixDurations.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (prefixDurations[mid] <= target) low = mid;
    else high = mid - 1;
  }
  return { index: low, offsetSeconds: Math.max(0, target - prefixDurations[low]) };
}

/**
 * Clamps a saved or requested offset so a resume never lands in the last
 * fraction of a sentence, where playback would be an inaudible click.
 */
export function clampResumeOffset(
  offsetSeconds: number,
  durationSeconds: number,
  minTailSeconds = MIN_RESUME_TAIL_SECONDS,
): number {
  if (!Number.isFinite(offsetSeconds) || offsetSeconds <= 0) return 0;
  const duration = Number.isFinite(durationSeconds) ? durationSeconds : 0;
  if (duration <= minTailSeconds) return 0;
  return Math.min(offsetSeconds, duration - minTailSeconds);
}

export type ScheduledSpan = {
  startAt: number;
  duration: number;
  /** Playback seconds skipped at the start of the source buffer. */
  startOffset: number;
};

/**
 * Elapsed narration inside a scheduled sentence at wall-clock `time`. Returns
 * null before the sentence starts. The result stays on the sentence's own
 * timeline, so word timings and chapter positions need no offset handling.
 */
export function spanElapsed(span: ScheduledSpan, time: number): number | null {
  if (time < span.startAt) return null;
  const offset = Math.max(0, Math.min(span.startOffset, span.duration));
  return Math.min(span.duration, offset + (time - span.startAt));
}
