import { describe, expect, it } from 'vitest';
import type { PdfParagraph, PdfTextItem } from './pdf-layout';
import {
  buildParagraphs,
  buildPdfChapters,
  collectFurniture,
  detectBodyFontSize,
  estimateLineGap,
  groupPageItems,
  stripFurniture,
} from './pdf-layout';

function item(
  text: string,
  x: number,
  y: number,
  height = 10,
  width = text.length * 5,
): PdfTextItem {
  return { text, x, y, width, height };
}

describe('groupPageItems', () => {
  it('groups baseline-aligned items into lines', () => {
    const lines = groupPageItems(
      [item('Hello', 72, 700), item('world', 110, 700), item('Next line', 72, 686)],
      0,
      612,
    );

    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('Hello world');
    expect(lines[0].pageIndex).toBe(0);
  });

  it('separates two-column pages and reads left before right', () => {
    const items: PdfTextItem[] = [];
    for (let index = 0; index < 12; index += 1) {
      items.push(item(`Left row ${index} continues.`, 40, 720 - index * 14, 10, 250));
      items.push(item(`Right row ${index} continues.`, 320, 720 - index * 14, 10, 240));
    }

    const lines = groupPageItems(items, 0, 600);
    expect(lines).toHaveLength(24);
    expect(lines[0].column).toBe(0);
    expect(lines[12].column).toBe(1);
    expect(lines[0].text).toContain('Left row 0');
    expect(lines[12].text).toContain('Right row 0');
  });
});

describe('furniture detection', () => {
  it('removes repeated headers and page numbers', () => {
    const pages = Array.from({ length: 3 }, (_, pageIndex) => {
      const lines = groupPageItems(
        [
          item('The Glass Horizon', 200, 760, 9),
          item(`Body line one on page ${pageIndex}`, 72, 700),
          item(`Body line two on page ${pageIndex}`, 72, 686),
          item(`Page ${pageIndex + 1}`, 290, 40, 9),
        ],
        pageIndex,
        612,
      );
      return lines;
    });

    const furniture = collectFurniture(pages);
    expect(furniture.has('the glass horizon')).toBe(true);

    const stripped = pages.map((page) => stripFurniture(page, furniture));
    expect(stripped.flat()).toHaveLength(6);
    expect(stripped.flat().some((line) => line.text.includes('Glass Horizon'))).toBe(false);
    expect(stripped.flat().some((line) => line.text.startsWith('Page '))).toBe(false);
  });
});

describe('paragraph grouping', () => {
  it('joins wrapped lines and starts a new paragraph after a blank gap', () => {
    const lines = groupPageItems(
      [
        item('Chapter One', 72, 720, 20, 120),
        item('The rain had stopped.', 72, 690),
        item('Elena stepped outside.', 72, 676),
        item('A new paragraph begins here.', 72, 650),
        item('It has another line.', 72, 636),
      ],
      0,
      612,
    );

    const bodySize = detectBodyFontSize(lines);
    expect(bodySize).toBe(10);
    const gap = estimateLineGap(lines, bodySize);
    expect(gap).toBe(14);

    const paragraphs = buildParagraphs(lines, bodySize, gap);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0].isHeading).toBe(true);
    expect(paragraphs[0].text).toBe('Chapter One');
    expect(paragraphs[1].text).toBe('The rain had stopped. Elena stepped outside.');
    expect(paragraphs[2].text).toBe('A new paragraph begins here. It has another line.');
  });

  it('keeps two-column reading order', () => {
    const items: PdfTextItem[] = [];
    for (let index = 0; index < 10; index += 1) {
      items.push(item(`Left sentence ${index}.`, 40, 720 - index * 14, 10, 250));
      items.push(item(`Right sentence ${index}.`, 320, 720 - index * 14, 10, 240));
    }

    const lines = groupPageItems(items, 0, 600);
    const paragraphs = buildParagraphs(lines, 10, 14);
    const joined = paragraphs.map((paragraph) => paragraph.text).join(' ');

    expect(joined.indexOf('Left sentence 0')).toBeLessThan(joined.indexOf('Right sentence 0'));
    expect(joined).toContain('Left sentence 9');
    expect(joined).toContain('Right sentence 9');
  });
});

describe('buildPdfChapters', () => {
  const longBody =
    'This paragraph contains enough words to represent real body text in a converted book. ' +
    'It keeps going for a few more words so the chapter is not empty.';

  it('starts chapters at chapter-like and top-level headings', () => {
    const paragraphs: PdfParagraph[] = [
      { text: 'Chapter One', pageIndex: 0, isHeading: true, level: 1 },
      { text: longBody, pageIndex: 0, isHeading: false, level: 3 },
      { text: 'Chapter Two', pageIndex: 1, isHeading: true, level: 1 },
      { text: longBody, pageIndex: 1, isHeading: false, level: 3 },
    ];

    const chapters = buildPdfChapters(paragraphs);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe('Chapter One');
    expect(chapters[1].title).toBe('Chapter Two');
    expect(chapters[0].blocks[0].kind).toBe('heading');
  });

  it('detects numbered section headings', () => {
    const paragraphs: PdfParagraph[] = [
      { text: 'Abstract', pageIndex: 0, isHeading: true, level: 2 },
      { text: longBody, pageIndex: 0, isHeading: false, level: 3 },
      { text: '1 Introduction', pageIndex: 1, isHeading: true, level: 2 },
      { text: longBody, pageIndex: 1, isHeading: false, level: 3 },
      { text: '2 Methods', pageIndex: 2, isHeading: true, level: 2 },
      { text: longBody, pageIndex: 2, isHeading: false, level: 3 },
    ];

    const chapters = buildPdfChapters(paragraphs);
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      '1 Introduction',
      '2 Methods',
    ]);
  });

  it('falls back to word-budget parts when there are no headings', () => {
    const paragraphs: PdfParagraph[] = Array.from({ length: 9 }, (_, index) => ({
      text: `${longBody} Paragraph ${index}.`,
      pageIndex: Math.floor(index / 3),
      isHeading: false,
      level: 3,
    }));

    const chapters = buildPdfChapters(paragraphs, 30);
    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters[0].title).toBe('Part 1');
    expect(chapters[1].title).toBe('Part 2');
  });
});
