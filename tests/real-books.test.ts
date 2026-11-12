// @vitest-environment node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { parseEpub } from '@/core/parsing/epub';
import {
  buildParagraphs,
  buildPdfChapters,
  collectFurniture,
  detectBodyFontSize,
  estimateLineGap,
  groupPageItems,
  stripFurniture,
  textItemToLayoutItem,
  type PdfLine,
} from '@/core/parsing/pdf-layout';
import { buildChapter } from '@/core/parsing/sentences';
import { MAX_TTS_CHUNK_CHARS } from '@/core/parsing/constants';

const samples = join(process.cwd(), 'samples');
const epubPath = join(samples, 'pride-and-prejudice.epub');
const pdfPath = join(samples, 'attention-is-all-you-need.pdf');

async function readArrayBuffer(path: string): Promise<ArrayBuffer> {
  const buffer = await readFile(path);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function validateBook(chapters: ReturnType<typeof buildChapter>[], label: string) {
  expect(chapters.length).toBeGreaterThan(0);

  let sentences = 0;
  let words = 0;
  let chars = 0;

  for (const chapter of chapters) {
    if (!chapter) continue;
    for (const paragraph of chapter.paragraphs) {
      for (const sentence of paragraph.sentences) {
        sentences += 1;
        words += sentence.wordCount;
        chars += sentence.charCount;

        expect(sentence.displayText.length).toBeGreaterThan(0);
        expect(sentence.ttsText.length).toBeGreaterThan(0);
        expect(sentence.words.length).toBeGreaterThan(0);
        expect(sentence.chunks.length).toBeGreaterThan(0);

        for (const word of sentence.words) {
          expect(word.ttsEnd).toBeGreaterThan(word.ttsStart);
          expect(sentence.ttsText.slice(word.ttsStart, word.ttsEnd).length).toBeGreaterThan(0);
        }

        for (const chunk of sentence.chunks) {
          const oversizedMultiWordChunk =
            chunk.wordIds.length > 1 && chunk.text.length > MAX_TTS_CHUNK_CHARS + 80;
          expect(oversizedMultiWordChunk).toBe(false);
        }

        const covered = sentence.chunks.flatMap((chunk) => chunk.wordIds);
        expect(covered).toEqual(sentence.words.map((word) => word.id));
      }
    }
  }

  console.log(
    `[QA] ${label}: ${chapters.length} chapters, ${sentences} sentences, ${words} words, ${chars} chars`,
  );

  expect(sentences).toBeGreaterThan(100);
  expect(words).toBeGreaterThan(1000);
}

describe.runIf(existsSync(epubPath))('real Gutenberg EPUB', () => {
  it('parses Pride and Prejudice into timed chapters', async () => {
    const bytes = await readArrayBuffer(epubPath);
    const result = await parseEpub(bytes, 'pride-and-prejudice.epub');

    console.log('[QA] EPUB metadata:', result.metadata);

    expect(result.metadata.title.toLowerCase()).toContain('pride and prejudice');
    expect(result.metadata.author?.toLowerCase()).toContain('austen');
    expect(result.chapters.length).toBeGreaterThan(10);
    expect(result.cover).toBeDefined();
    validateBook(result.chapters, 'Pride and Prejudice');
  }, 120_000);
});

describe.runIf(existsSync(pdfPath))('real arXiv PDF', () => {
  it('reconstructs readable chapters from a two-column-style paper', async () => {
    const bytes = await readArrayBuffer(pdfPath);
    const pdf = await getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useWorkerFetch: false,
    }).promise;

    const pages: PdfLine[][] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const text = await page.getTextContent();
      const items = text.items
        .filter((item): item is Extract<typeof item, { str: string }> => 'str' in item)
        .map((item) => textItemToLayoutItem(item))
        .filter((item) => item !== null);

      pages.push(groupPageItems(items, pageNumber - 1, viewport.width));
      page.cleanup();
    }

    await pdf.destroy();

    const furniture = collectFurniture(pages);
    const lines = pages.flatMap((page) => stripFurniture(page, furniture));
    const bodySize = detectBodyFontSize(lines);
    const gap = estimateLineGap(lines, bodySize);
    const paragraphs = buildParagraphs(lines, bodySize, gap);
    const drafts = buildPdfChapters(paragraphs);
    const chapters = drafts
      .map((draft, index) => buildChapter({ index, title: draft.title, blocks: draft.blocks }))
      .filter((chapter) => chapter !== null);

    console.log('[QA] PDF layout:', {
      pages: pages.length,
      lines: lines.length,
      bodySize,
      gap,
      paragraphs: paragraphs.length,
      furniture: [...furniture],
      chapterTitles: drafts.map((draft) => draft.title),
    });

    expect(pdf.numPages).toBeGreaterThan(10);
    expect(lines.length).toBeGreaterThan(200);
    expect(paragraphs.length).toBeGreaterThan(40);
    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters[0]?.paragraphs.length).toBeGreaterThan(2);
    validateBook(chapters, 'Attention Is All You Need');
  }, 120_000);
});
