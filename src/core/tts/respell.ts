import { buildSpokenWords, tokenizeDisplayText } from '@/core/parsing/sentences';
import { expandTokenForSpeech, integerToWords } from '@/core/parsing/speech';
import type { SentenceNode, WordToken } from '@/types/domain';
import {
  DEFAULT_NORMALIZATION_RULES,
  MAX_LEXICON_WORDS,
  type LexiconEntry,
  type NormalizationRules,
  type SpeechProfile,
} from '@/types/speech';

const ROMAN_NUMERAL = /^[IVXLCDM]{1,7}$/u;
const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};

/** `Chapter IV` → `Chapter four`, but a bare pronoun `I` is left alone. */
const ROMAN_CONTEXT = new Set([
  'act',
  'appendix',
  'article',
  'book',
  'canto',
  'chapter',
  'clause',
  'fig',
  'figure',
  'lesson',
  'page',
  'part',
  'plate',
  'rule',
  'scene',
  'sec',
  'section',
  'stanza',
  'table',
  'title',
  'unit',
  'vol',
  'volume',
]);

const URL_PATTERN = /^(?:https?:\/\/|www\.)\S+$/iu;
const BARE_DOMAIN_PATTERN =
  /^(?:[\p{L}\p{N}][\p{L}\p{N}-]*\.)+(?:com|org|net|edu|gov|io|dev|ai|co|uk|me|app|info|xyz)(?:\/\S*)?$/iu;
const BRACKET_CITATION = /^\[[\d\s,;:–—-]+\]$/u;
const CITATION_YEAR = /\b(?:19|20)\d{2}[a-z]?\b/iu;
const CITATION_SIGNAL = /(?:et\s+al|,|&)/iu;

type LexiconMatch = {
  entry: LexiconEntry;
  length: number;
};

type LexiconIndex = {
  entries: Map<string, LexiconMatch>;
  maxWords: number;
};

type CitedSpan = {
  length: number;
  /** Punctuation that followed the closing bracket or parenthesis. */
  trailing: string;
};

/**
 * Case-insensitive matching key for a display token. Surrounding punctuation
 * is ignored, and possessives match their stem (`Hermione's` → `hermione`).
 */
function normalizeKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/['’]s$/u, '');
}

function splitTrailing(token: string): { core: string; trailing: string } {
  const match = /([.,!?;:…)\]}"'”’]+)$/u.exec(token);
  if (!match) return { core: token, trailing: '' };
  return { core: token.slice(0, token.length - match[1].length), trailing: match[1] };
}

/** Closing brackets belong to the citation, so only sentence punctuation is split. */
function splitCitationTrailing(token: string): { core: string; trailing: string } {
  const match = /([.,!?;:…"'”’]+)$/u.exec(token);
  if (!match) return { core: token, trailing: '' };
  return { core: token.slice(0, token.length - match[1].length), trailing: match[1] };
}

function buildLexiconIndex(lexicon: ReadonlyArray<LexiconEntry>): LexiconIndex {
  const entries = new Map<string, LexiconMatch>();
  let maxWords = 0;

  for (const entry of lexicon) {
    if (!entry.enabled) continue;
    const tokens = tokenizeDisplayText(entry.phrase.trim()).slice(0, MAX_LEXICON_WORDS);
    if (tokens.length === 0) continue;

    const key = tokens
      .map((token) => normalizeKey(token.text))
      .filter(Boolean)
      .join(' ');
    if (!key) continue;

    entries.set(key, { entry, length: tokens.length });
    maxWords = Math.max(maxWords, tokens.length);
  }

  return { entries, maxWords };
}

/** Prefers the longest phrase that starts at `start`. */
function matchLexicon(
  index: LexiconIndex,
  words: ReadonlyArray<WordToken>,
  start: number,
): LexiconMatch | null {
  if (index.maxWords === 0) return null;
  const remaining = Math.min(index.maxWords, words.length - start);

  for (let length = remaining; length >= 1; length -= 1) {
    const key = words
      .slice(start, start + length)
      .map((word) => normalizeKey(word.text))
      .filter(Boolean)
      .join(' ');
    const hit = index.entries.get(key);
    if (hit && hit.length === length) return hit;
  }

  return null;
}

function romanValue(token: string): number | null {
  if (!ROMAN_NUMERAL.test(token)) return null;

  let total = 0;
  let previous = 0;
  for (let index = token.length - 1; index >= 0; index -= 1) {
    const value = ROMAN_VALUES[token[index]];
    if (!value) return null;
    if (value < previous) total -= value;
    else {
      total += value;
      previous = value;
    }
  }

  return total > 0 && total < 4000 ? total : null;
}

function romanAfterContext(token: string, previous: string | undefined): string | null {
  if (!previous || !ROMAN_CONTEXT.has(normalizeKey(previous))) return null;
  const value = romanValue(token);
  return value === null ? null : integerToWords(value);
}

/**
 * Finds a bracketed or author-year citation that starts at `start`. The scan is
 * deliberately short and conservative so a normal parenthetical is untouched.
 */
function matchCitation(
  words: ReadonlyArray<WordToken>,
  start: number,
): CitedSpan | null {
  const first = words[start].text;
  const opening = first.startsWith('[') ? '[' : first.startsWith('(') ? '(' : null;
  if (!opening) return null;

  const closing = opening === '[' ? ']' : ')';
  const maxTokens = opening === '[' ? 8 : 14;
  const maxChars = opening === '[' ? 60 : 140;
  let text = '';

  for (let length = 1; length <= maxTokens && start + length <= words.length; length += 1) {
    text += (length > 1 ? ' ' : '') + words[start + length - 1].text;
    if (text.length > maxChars) return null;

    const { core, trailing } = splitCitationTrailing(text);
    if (!core.endsWith(closing)) continue;

    if (opening === '[') {
      return BRACKET_CITATION.test(core) ? { length, trailing } : null;
    }

    if (!CITATION_YEAR.test(core) || !CITATION_SIGNAL.test(core)) return null;
    return { length, trailing };
  }

  return null;
}

/** Keeps a removed citation's final period/comma as a natural pause. */
function appendPunctuation(spoken: string[], before: number, trailing: string): void {
  if (!trailing) return;
  for (let index = before - 1; index >= 0; index -= 1) {
    const previous = spoken[index];
    if (!previous) continue;
    if (!/[.,!?;:…]$/u.test(previous)) spoken[index] = previous + trailing;
    return;
  }
}

function speakToken(
  text: string,
  previous: string | undefined,
  rules: NormalizationRules,
): string {
  if (rules.urls) {
    const { core, trailing } = splitTrailing(text);
    if (URL_PATTERN.test(core) || BARE_DOMAIN_PATTERN.test(core)) return `link${trailing}`;
  }

  if (rules.abbreviations) {
    const roman = romanAfterContext(text, previous);
    if (roman) return roman;
  }

  return expandTokenForSpeech(text, { abbreviations: rules.abbreviations }).trim() || text;
}

/**
 * Rewrites a sentence's spoken text for the active lexicon and normalization
 * rules while preserving display text, word ids, word order, and highlighting.
 *
 * The parser's `ttsText` is built with the default rules, so an unchanged
 * profile returns the original object and keeps the existing cache key.
 */
export function respellSentence(sentence: SentenceNode, profile?: SpeechProfile): SentenceNode {
  if (sentence.words.length === 0) return sentence;

  const rules: NormalizationRules = { ...DEFAULT_NORMALIZATION_RULES, ...profile?.rules };
  const lexicon = buildLexiconIndex(profile?.lexicon ?? []);
  const words = sentence.words;
  const spoken: string[] = new Array<string>(words.length).fill('');

  for (let index = 0; index < words.length; index += 1) {
    const hit = matchLexicon(lexicon, words, index);
    if (hit) {
      const last = words[index + hit.length - 1];
      const replacement = hit.entry.say.trim();
      const possessive = /['’]s$/iu.test(last.text) && !/['’]s$/iu.test(replacement);
      const trailing = splitTrailing(last.text).trailing;
      const suffix =
        trailing && replacement && !/[.,!?;:…—–]$/u.test(replacement) ? trailing : '';

      spoken[index] = `${replacement}${possessive ? "'s" : ''}${suffix}`;
      index += hit.length - 1;
      continue;
    }

    if (rules.citations) {
      const citation = matchCitation(words, index);
      if (citation) {
        appendPunctuation(spoken, index, citation.trailing);
        index += citation.length - 1;
        continue;
      }
    }

    spoken[index] = speakToken(
      words[index].text,
      index > 0 ? words[index - 1].text : undefined,
      rules,
    );
  }

  const rebuilt = buildSpokenWords(
    words.map((word) => ({ id: word.id, text: word.text, isWord: word.isWord })),
    spoken,
  );

  if (rebuilt.ttsText === sentence.ttsText) return sentence;

  return {
    ...sentence,
    ttsText: rebuilt.ttsText,
    words: rebuilt.words,
    chunks: rebuilt.chunks,
  };
}
