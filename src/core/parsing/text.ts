import { WORDS_PER_MINUTE } from './constants';

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
// eslint-disable-next-line no-control-regex -- control characters must be stripped from imported text.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const INVISIBLE_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

/** Normalizes source text without changing meaning or punctuation. */
export function normalizeWhitespace(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\u00AD/g, '')
    .replace(ZERO_WIDTH, '')
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE_SPACES, ' ')
    .replace(/[\t\f\v\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cleans a paragraph for display while preserving prose punctuation. */
export function normalizeBlockText(input: string): string {
  return normalizeWhitespace(input)
    .replace(/\s*—\s*/g, ' — ')
    .replace(/\s+([,.;:!?%…])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Joins two extracted PDF lines, healing words broken across a line ending.
 */
export function joinPdfLines(previous: string, next: string): string {
  if (!previous) return next;
  if (!next) return previous;
  if (previous.endsWith('-') && /^[\p{Ll}]/u.test(next)) {
    return `${previous.slice(0, -1)}${next}`;
  }
  return `${previous} ${next}`;
}

export function dehyphenateLines(input: string): string {
  return input.replace(/(\p{Ll})-[ \t]*\r?\n[ \t]*(\p{Ll})/gu, '$1$2');
}

export function looksLikePageNumber(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^[-–—]?\s*\d{1,4}\s*[-–—]?$/.test(trimmed)) return true;
  if (/^(?:page|p\.)\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i.test(trimmed)) return true;
  return false;
}

export function looksLikeChapterHeading(text: string): boolean {
  return /^(?:chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|afterword|appendix)\b/i.test(
    text.trim(),
  );
}

export function sanitizeChapterTitle(title: string | undefined, index: number): string {
  const clean = normalizeWhitespace(title ?? '');
  if (!clean) return `Chapter ${index + 1}`;
  return clean.length > 160 ? `${clean.slice(0, 157).trimEnd()}…` : clean;
}

export function estimateDurationSeconds(wordCount: number): number {
  return wordCount / (WORDS_PER_MINUTE / 60);
}

export function estimateSentenceDuration(wordCount: number): number {
  return wordCount / (WORDS_PER_MINUTE / 60) + 0.25;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
