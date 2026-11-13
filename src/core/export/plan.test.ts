import { describe, expect, it } from 'vitest';
import type { BookDocument, ChapterNode, ParagraphNode, SentenceNode } from '@/types/domain';
import {
  buildExportPlan,
  coverMimeType,
  sanitizeFileStem,
  suggestedExportName,
} from './plan';

function sentence(id: string, text = 'A sentence.'): SentenceNode {
  return {
    id,
    chapterIndex: 0,
    paragraphIndex: 0,
    sentenceIndex: 0,
    displayText: text,
    ttsText: text,
    words: [],
    chunks: [],
    charCount: text.length,
    wordCount: text.split(/\s+/).length,
    estimatedDuration: 3,
  };
}

function paragraph(id: string, sentences: SentenceNode[]): ParagraphNode {
  return { id, kind: 'paragraph', displayText: '', sentences };
}

function chapter(index: number, title: string, sentences: SentenceNode[]): ChapterNode {
  return {
    id: `ch${index}`,
    index,
    title,
    paragraphs: sentences.length > 0 ? [paragraph(`p${index}`, sentences)] : [],
    wordCount: 0,
    charCount: 0,
    estimatedDuration: sentences.length * 3,
    startSentenceId: sentences[0]?.id ?? '',
  };
}

function book(chapters: ChapterNode[]): BookDocument {
  return {
    id: 'book-1',
    fingerprint: 'abc',
    format: 'epub',
    metadata: { title: 'Pride and Prejudice', author: 'Jane Austen' },
    chapters,
    palette: { colors: ['#111111', '#222222', '#333333'], isFallback: false },
    sourcePath: 'books/book-1.epub',
    byteSize: 1,
    createdAt: 0,
    updatedAt: 0,
    totalWords: 0,
    totalChars: 0,
    estimatedDuration: chapters.length * 3,
    parserVersion: 'test',
  };
}

describe('buildExportPlan', () => {
  it('collects every chapter for a whole-book export', () => {
    const plan = buildExportPlan(
      book([
        chapter(0, 'Chapter One', [sentence('a'), sentence('b')]),
        chapter(1, 'Chapter Two', [sentence('c')]),
      ]),
      'book',
    );

    expect(plan.chapters.map((entry) => entry.title)).toEqual(['Chapter One', 'Chapter Two']);
    expect(plan.totalSentences).toBe(3);
    expect(plan.estimatedDuration).toBe(9);
    expect(plan.title).toBe('Pride and Prejudice');
    expect(plan.artist).toBe('Jane Austen');
    expect(plan.album).toBe('Pride and Prejudice');
  });

  it('selects a single chapter and uses its title for the media title', () => {
    const plan = buildExportPlan(
      book([
        chapter(0, 'Chapter One', [sentence('a')]),
        chapter(1, 'The Letter', [sentence('b'), sentence('c')]),
      ]),
      'chapter',
      1,
    );

    expect(plan.chapters).toHaveLength(1);
    expect(plan.chapters[0].index).toBe(1);
    expect(plan.title).toBe('The Letter');
    expect(plan.totalSentences).toBe(2);
  });

  it('skips empty chapters and blank TTS sentences', () => {
    const plan = buildExportPlan(
      book([
        chapter(0, 'Cover', []),
        chapter(1, '', [sentence('a'), sentence('blank', '   ')]),
        chapter(2, 'Chapter Three', [sentence('b')]),
      ]),
      'book',
    );

    expect(plan.chapters.map((entry) => entry.title)).toEqual(['Chapter 2', 'Chapter Three']);
    expect(plan.totalSentences).toBe(2);
  });

  it('returns an empty plan when the requested chapter has no audio', () => {
    const plan = buildExportPlan(book([chapter(0, 'Empty', [])]), 'chapter', 0);
    expect(plan.chapters).toEqual([]);
    expect(plan.totalSentences).toBe(0);
    expect(plan.title).toBe('Pride and Prejudice');
  });
});

describe('file names', () => {
  it('strips characters that are illegal on common filesystems', () => {
    expect(sanitizeFileStem('  A/B: C?  ')).toBe('A B C');
    expect(sanitizeFileStem('...')).toBe('Audiobook');
    expect(sanitizeFileStem('x'.repeat(200))).toHaveLength(96);
  });

  it('uses the format as the extension', () => {
    expect(suggestedExportName({ title: 'Pride & Prejudice' }, 'm4b')).toBe(
      'Pride & Prejudice.m4b',
    );
  });
});

describe('coverMimeType', () => {
  it('maps common cover extensions', () => {
    expect(coverMimeType('covers/id.png')).toBe('image/png');
    expect(coverMimeType('covers/id.webp')).toBe('image/webp');
    expect(coverMimeType('covers/id.jpeg')).toBe('image/jpeg');
    expect(coverMimeType(undefined)).toBe('image/jpeg');
  });
});
