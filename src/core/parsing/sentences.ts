import { MAX_TTS_CHUNK_CHARS } from './constants';
import { expandTokenForSpeech } from './speech';
import {
  estimateSentenceDuration,
  normalizeBlockText,
  normalizeWhitespace,
  sanitizeChapterTitle,
} from './text';
import type {
  ChapterNode,
  ParagraphKind,
  ParagraphNode,
  SentenceNode,
  TtsChunk,
  WordToken,
} from '@/types/domain';

const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'jr',
  'sr',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'no',
  'vol',
  'ch',
  'fig',
  'eq',
  'approx',
  'inc',
  'ltd',
  'co',
  'capt',
  'col',
  'gen',
  'lt',
  'sgt',
  'rev',
  'hon',
  'pres',
  'gov',
  'sen',
  'rep',
  'mt',
  'ft',
  'ave',
  'blvd',
  'rd',
  'u.s',
  'u.k',
]);

const CLOSING_PUNCTUATION = /["'”’»)\]]/;
const WORD_WITH_PUNCTUATION = /([\p{L}][\p{L}.'’]*)$/u;
const CHUNK_BOUNDARY = /[;:,—]$/;
const CONJUNCTIONS = new Set([
  'and',
  'but',
  'or',
  'nor',
  'yet',
  'so',
  'because',
  'while',
  'when',
  'although',
  'though',
  'which',
  'that',
  'who',
  'whom',
  'where',
  'if',
  'then',
]);

export type DisplayToken = {
  text: string;
  start: number;
  end: number;
};

export function tokenizeDisplayText(text: string): DisplayToken[] {
  const tokens: DisplayToken[] = [];
  const pattern = /\S+/gu;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    tokens.push({ text: match[0], start, end: start + match[0].length });
  }
  return tokens;
}

function isAbbreviation(word: string): boolean {
  const lower = word.toLowerCase();
  if (ABBREVIATIONS.has(lower)) return true;
  return /^(?:[A-Za-z]\.){1,}$/.test(word);
}

/**
 * Sentence segmentation that protects abbreviations, initials, decimals, and
 * ellipses. It intentionally keeps a lowercase continuation attached, which
 * avoids splitting mid-sentence on stray periods.
 */
export function splitSentences(input: string): string[] {
  const text = normalizeWhitespace(input);
  if (!text) return [];

  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char !== '.' && char !== '!' && char !== '?' && char !== '…') continue;

    let end = i;
    while (end + 1 < text.length && '.!?…'.includes(text[end + 1])) end += 1;

    let after = end + 1;
    while (after < text.length && CLOSING_PUNCTUATION.test(text[after])) after += 1;

    if (after < text.length && !/\s/.test(text[after])) {
      i = end;
      continue;
    }

    let next = after;
    while (next < text.length && /\s/.test(text[next])) next += 1;

    if (next >= text.length) {
      const tail = text.slice(start).trim();
      if (tail) sentences.push(tail);
      start = text.length;
      break;
    }

    const punctuation = text.slice(i, end + 1);
    const isEllipsis = punctuation.includes('…') || punctuation.length > 1;
    const before = text.slice(start, i);
    const nextChar = text[next];
    const lastWord = WORD_WITH_PUNCTUATION.exec(before)?.[1] ?? '';

    if (!isEllipsis && char === '.') {
      if (/[\p{Ll}\p{N}]/u.test(nextChar)) {
        i = end;
        continue;
      }
      if (isAbbreviation(lastWord)) {
        i = end;
        continue;
      }
      if (/(?:^|\s)[\p{Lu}]$/u.test(before) && /\p{Lu}/u.test(nextChar)) {
        i = end;
        continue;
      }
      if (/\d$/u.test(before) && /\d/u.test(nextChar)) {
        i = end;
        continue;
      }
    }

    const sentence = text.slice(start, after).trim();
    if (sentence) sentences.push(sentence);
    start = next;
    i = next - 1;
  }

  if (start < text.length) {
    const tail = text.slice(start).trim();
    if (tail) sentences.push(tail);
  }

  return sentences;
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

export const chapterId = (chapterIndex: number): string => `ch${pad(chapterIndex + 1)}`;

export const paragraphId = (chapterIndex: number, paragraphIndex: number): string =>
  `${chapterId(chapterIndex)}_p${pad(paragraphIndex + 1)}`;

export const sentenceId = (
  chapterIndex: number,
  paragraphIndex: number,
  index: number,
): string => `${paragraphId(chapterIndex, paragraphIndex)}_s${pad(index + 1)}`;

export const wordId = (index: number): string => `w${pad(index + 1, 4)}`;

export const chunkId = (index: number): string => `c${pad(index + 1, 3)}`;

function isChunkBoundary(word: string): boolean {
  if (CHUNK_BOUNDARY.test(word)) return true;
  const clean = word.toLowerCase().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  return CONJUNCTIONS.has(clean);
}

function buildTtsChunks(words: WordToken[], ttsText: string): TtsChunk[] {
  if (words.length === 0) return [];

  const chunks: TtsChunk[] = [];
  let start = 0;

  while (start < words.length) {
    let end = start;

    // Measure the spoken span (including spaces) so number and abbreviation
    // expansion cannot push a chunk past the engine's comfortable length.
    while (end < words.length) {
      const spokenLength = words[end].ttsEnd - words[start].ttsStart;
      if (spokenLength > MAX_TTS_CHUNK_CHARS && end > start) break;
      end += 1;
    }

    if (end < words.length) {
      const minimum = start + Math.max(1, Math.floor((end - start) * 0.55));
      for (let index = end - 1; index >= minimum; index -= 1) {
        if (isChunkBoundary(words[index].text)) {
          end = index + 1;
          break;
        }
      }
    }

    const slice = words.slice(start, end);
    const first = slice[0];
    const last = slice[slice.length - 1];

    chunks.push({
      id: chunkId(chunks.length),
      text: ttsText.slice(first.ttsStart, last.ttsEnd),
      startTtsOffset: first.ttsStart,
      endTtsOffset: last.ttsEnd,
      wordIds: slice.map((word) => word.id),
    });

    start = end;
  }

  return chunks;
}

export type BuildSentenceParams = {
  chapterIndex: number;
  paragraphIndex: number;
  sentenceIndex: number;
  text: string;
};

export type SpokenWordSeed = Pick<WordToken, 'id' | 'text' | 'isWord'>;

/**
 * Rebuilds TTS spans and chunks from existing word ids and a parallel list of
 * spoken strings. Used both by the parser (initial expansion) and by the
 * pronunciation lexicon (re-expansion at synthesis time), so the two can never
 * disagree about how spans and chunks are laid out.
 */
export function buildSpokenWords(
  seeds: ReadonlyArray<SpokenWordSeed>,
  spoken: ReadonlyArray<string>,
): { words: WordToken[]; ttsText: string; chunks: TtsChunk[] } {
  const words: WordToken[] = [];
  const parts: string[] = [];
  let ttsCursor = 0;

  seeds.forEach((seed, index) => {
    const expansion = (spoken[index] ?? '').trim();
    const ttsStart = ttsCursor;
    ttsCursor += expansion.length + (index < seeds.length - 1 ? 1 : 0);
    parts.push(expansion);
    words.push({
      id: seed.id,
      text: seed.text,
      ttsStart,
      ttsEnd: ttsStart + expansion.length,
      isWord: seed.isWord,
    });
  });

  const ttsText = parts.join(' ');
  return { words, ttsText, chunks: buildTtsChunks(words, ttsText) };
}

export function buildSentence({
  chapterIndex,
  paragraphIndex,
  sentenceIndex,
  text,
}: BuildSentenceParams): SentenceNode {
  const displayText = normalizeBlockText(text);
  const tokens = tokenizeDisplayText(displayText);
  const spoken = tokens.map((token) => expandTokenForSpeech(token.text).trim() || token.text);
  const seeds: SpokenWordSeed[] = tokens.map((token, index) => ({
    id: wordId(index),
    text: token.text,
    isWord: /[\p{L}\p{N}]/u.test(token.text),
  }));
  const { words, ttsText, chunks } = buildSpokenWords(seeds, spoken);

  const wordCount = words.filter((word) => word.isWord).length;
  const sentencesId = sentenceId(chapterIndex, paragraphIndex, sentenceIndex);

  return {
    id: sentencesId,
    chapterIndex,
    paragraphIndex,
    sentenceIndex,
    displayText,
    ttsText,
    words,
    chunks,
    charCount: displayText.length,
    wordCount,
    estimatedDuration: estimateSentenceDuration(wordCount),
  };
}

export type BuildParagraphParams = {
  chapterIndex: number;
  paragraphIndex: number;
  text: string;
  kind?: ParagraphKind;
  level?: number;
};

export function buildParagraph({
  chapterIndex,
  paragraphIndex,
  text,
  kind = 'paragraph',
  level,
}: BuildParagraphParams): ParagraphNode | null {
  const displayText = normalizeBlockText(text);
  if (!displayText) return null;

  const sentences = splitSentences(displayText).map((sentence, index) =>
    buildSentence({ chapterIndex, paragraphIndex, sentenceIndex: index, text: sentence }),
  );

  if (sentences.length === 0) return null;

  return {
    id: paragraphId(chapterIndex, paragraphIndex),
    kind,
    ...(kind === 'heading' && level ? { level } : {}),
    displayText,
    sentences,
  };
}

export type RawBlock = {
  kind: ParagraphKind;
  text: string;
  level?: number;
};

export type BuildChapterParams = {
  index: number;
  title: string;
  href?: string;
  blocks: RawBlock[];
};

export function buildChapter({
  index,
  title,
  href,
  blocks,
}: BuildChapterParams): ChapterNode | null {
  const paragraphs: ParagraphNode[] = [];
  let paragraphIndex = 0;

  for (const block of blocks) {
    const paragraph = buildParagraph({
      chapterIndex: index,
      paragraphIndex,
      text: block.text,
      kind: block.kind,
      level: block.level,
    });
    if (!paragraph) continue;
    paragraphs.push(paragraph);
    paragraphIndex += 1;
  }

  if (paragraphs.length === 0) return null;

  const sentences = paragraphs.flatMap((paragraph) => paragraph.sentences);
  const wordCount = sentences.reduce((total, sentence) => total + sentence.wordCount, 0);
  const charCount = sentences.reduce((total, sentence) => total + sentence.charCount, 0);
  const estimatedDuration = sentences.reduce(
    (total, sentence) => total + sentence.estimatedDuration,
    0,
  );

  return {
    id: chapterId(index),
    index,
    title: sanitizeChapterTitle(title, index),
    ...(href ? { href } : {}),
    paragraphs,
    wordCount,
    charCount,
    estimatedDuration,
    startSentenceId: sentences[0]?.id ?? '',
  };
}

export function countWords(text: string): number {
  return normalizeWhitespace(text)
    .split(/\s+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export function chapterWordStats(chapter: ChapterNode): { words: number; minutes: number } {
  return {
    words: chapter.wordCount,
    minutes: chapter.estimatedDuration / 60,
  };
}
