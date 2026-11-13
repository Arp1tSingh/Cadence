import { describe, expect, it } from 'vitest';
import type { BookDocument, ChapterNode, ParagraphNode, SentenceNode } from '@/types/domain';
import { cacheRatio, chapterSentenceCounts } from './cacheStats';

function sentence(id: string, chapterIndex: number): SentenceNode {
  return {
    id,
    chapterIndex,
    paragraphIndex: 0,
    sentenceIndex: 0,
    displayText: 'Hello world.',
    ttsText: 'Hello world.',
    words: [],
    chunks: [],
    charCount: 12,
    wordCount: 2,
    estimatedDuration: 1,
  };
}

function paragraph(id: string, chapterIndex: number, count: number): ParagraphNode {
  return {
    id,
    kind: 'paragraph',
    displayText: '',
    sentences: Array.from({ length: count }, (_, index) =>
      sentence(`${id}_s${index}`, chapterIndex),
    ),
  };
}

function chapter(index: number, paragraphs: number[]): ChapterNode {
  return {
    id: `ch${index}`,
    index,
    title: `Chapter ${index + 1}`,
    paragraphs: paragraphs.map((count, position) =>
      paragraph(`ch${index}_p${position}`, index, count),
    ),
    wordCount: 0,
    charCount: 0,
    estimatedDuration: 10,
    startSentenceId: `ch${index}_p0_s0`,
  };
}

const book = {
  chapters: [chapter(0, [2, 3]), chapter(1, [1])],
} as unknown as BookDocument;

describe('chapterSentenceCounts', () => {
  it('sums sentences across paragraphs for every chapter', () => {
    const counts = chapterSentenceCounts(book);
    expect(counts.get(0)).toBe(5);
    expect(counts.get(1)).toBe(1);
  });

  it('returns an empty map for a book with no chapters', () => {
    expect(chapterSentenceCounts({ chapters: [] } as unknown as BookDocument).size).toBe(0);
  });
});

describe('cacheRatio', () => {
  it('reports progress for partially cached chapters', () => {
    expect(cacheRatio({ cached: 2, total: 5 })).toBeCloseTo(0.4);
  });

  it('clamps and guards empty chapters', () => {
    expect(cacheRatio({ cached: 9, total: 5 })).toBe(1);
    expect(cacheRatio({ cached: 0, total: 0 })).toBe(0);
    expect(cacheRatio(undefined)).toBe(0);
  });
});
