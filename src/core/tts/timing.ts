import type { WordToken, WordTiming } from '@/types/domain';

const PAUSE_WEIGHTS: Record<string, number> = {
  ',': 1.15,
  ';': 1.35,
  ':': 1.3,
  '.': 1.8,
  '!': 1.9,
  '?': 1.9,
  '…': 2,
  '—': 1.4,
  '–': 1.25,
};

/**
 * Estimates a spoken weight for a word. This intentionally mirrors the
 * blueprint's `alpha * phonemes + beta * vowels + punctuation pause` formula
 * using grapheme clusters, which is stable and fast enough for thousands of
 * words while staying close to real phoneme counts.
 */
export function wordWeight(text: string): number {
  const letters = text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
  if (!letters) {
    const trailing = text.trim().slice(-1);
    return PAUSE_WEIGHTS[trailing] ?? 0.4;
  }

  const vowelGroups = letters.match(/[aeiouy]+/gi)?.length ?? 0;
  const clusters = Math.max(1, Math.ceil(letters.length / 2.2));
  const punctuation = text.trim().slice(-1);
  const pause = PAUSE_WEIGHTS[punctuation] ?? 0;

  return 0.55 + clusters * 0.55 + vowelGroups * 0.22 + pause;
}

/**
 * Distributes a phrase's measured audio duration across its words. The last
 * word absorbs rounding error so timings always end exactly at `duration`.
 */
export function alignWords(
  words: ReadonlyArray<Pick<WordToken, 'id' | 'text'>>,
  duration: number,
): WordTiming[] {
  if (words.length === 0 || !Number.isFinite(duration) || duration <= 0) return [];

  // Empty spans belong to words the lexicon chose not to speak; they must not
  // consume time on the word-sync timeline.
  const weights = words.map((word) => (word.text.trim() ? wordWeight(word.text) : 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) {
    return words.map((word) => ({ wordId: word.id, start: 0, end: 0 }));
  }

  let lastSpoken = -1;
  for (let index = words.length - 1; index >= 0; index -= 1) {
    if (weights[index] > 0) {
      lastSpoken = index;
      break;
    }
  }

  const timings: WordTiming[] = [];
  let cursor = 0;

  words.forEach((word, index) => {
    if (weights[index] <= 0) {
      timings.push({ wordId: word.id, start: cursor, end: cursor });
      return;
    }

    const isLast = index === lastSpoken;
    const span = isLast ? duration - cursor : (weights[index] / total) * duration;
    const end = isLast ? duration : cursor + span;
    timings.push({ wordId: word.id, start: cursor, end });
    cursor = end;
  });

  return timings;
}

/** Shifts a phrase's timings onto the sentence timeline. */
export function offsetTimings(timings: WordTiming[], offset: number): WordTiming[] {
  return timings.map((timing) => ({
    wordId: timing.wordId,
    start: timing.start + offset,
    end: timing.end + offset,
  }));
}

/** Returns the active word index for a sentence-local elapsed time. */
export function wordIndexAt(timings: ReadonlyArray<WordTiming>, elapsed: number): number {
  if (timings.length === 0) return -1;
  if (elapsed <= timings[0].start) return 0;

  let low = 0;
  let high = timings.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const timing = timings[mid];
    if (elapsed < timing.start) high = mid - 1;
    else if (elapsed >= timing.end) low = mid + 1;
    else return mid;
  }
  return Math.min(timings.length - 1, Math.max(0, low));
}

/** Normalized 0..1 progress through the active word, for karaoke fill. */
export function wordProgressAt(timings: ReadonlyArray<WordTiming>, elapsed: number): number {
  const index = wordIndexAt(timings, elapsed);
  if (index < 0) return 0;
  const timing = timings[index];
  const span = timing.end - timing.start;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (elapsed - timing.start) / span));
}
