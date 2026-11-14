import { describe, expect, it } from 'vitest';
import type { PdfParagraph, PdfTextItem } from './pdf-layout';
import {
  buildOutlineChapters,
  buildParagraphs,
  buildPdfChapters,
  collectFurniture,
  detectBodyFontSize,
  estimateLineGap,
  groupPageItems,
  selectOutlineChapterRanges,
  stripChapterTitleParagraphs,
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

  it('measures a drop-cap line at body size, not the initial', () => {
    const lines = groupPageItems(
      [
        item('T', 72, 700, 30, 20),
        item('WO DAYS HAD PASSED', 92.1, 700, 11, 126),
        item('since I summoned our Guardian Beast. I had', 220, 700, 15, 250),
        item('A normal body line follows.', 72, 682, 15, 180),
      ],
      0,
      612,
    );

    expect(lines[0].text).toContain('TWO DAYS HAD PASSED');
    expect(lines[0].height).toBe(15);
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

describe('selectOutlineChapterRanges', () => {
  const entries = [
    { title: 'Table of Contents', pageIndex: 1 },
    { title: 'Color Inserts', pageIndex: 3 },
    { title: 'Title Page', pageIndex: 5 },
    { title: 'Copyrights and Credits', pageIndex: 6 },
    { title: 'Table of Contents Page', pageIndex: 7 },
    { title: 'Chapter 1: The First Mission', pageIndex: 9 },
    { title: 'Chapter 2: Guardian Beast', pageIndex: 30 },
    { title: 'Chapter 3: Opening Move', pageIndex: 44 },
    { title: 'Extra Chapter: The Black Wolf Sword King', pageIndex: 220 },
    { title: 'About the Author: Rifujin na Magonote', pageIndex: 231 },
    { title: 'Newsletter', pageIndex: 232 },
  ];

  it('uses chapter entries and stops the last chapter at back matter', () => {
    const ranges = selectOutlineChapterRanges(entries, 233);

    expect(ranges.map((range) => range.title)).toEqual([
      'Chapter 1: The First Mission',
      'Chapter 2: Guardian Beast',
      'Chapter 3: Opening Move',
      'Extra Chapter: The Black Wolf Sword King',
    ]);
    expect(ranges[0]).toMatchObject({ startPage: 9, endPage: 30 });
    expect(ranges[1]).toMatchObject({ startPage: 30, endPage: 44 });
    expect(ranges[3]).toMatchObject({ startPage: 220, endPage: 231 });
  });

  it('keeps the more specific title when a part and chapter share a page', () => {
    const ranges = selectOutlineChapterRanges(
      [
        { title: 'Part One', pageIndex: 2, depth: 0 },
        { title: 'Chapter 1: Arrival', pageIndex: 2, depth: 1 },
        { title: 'Chapter 2: Departure', pageIndex: 20, depth: 1 },
      ],
      40,
    );

    expect(ranges.map((range) => range.title)).toEqual([
      'Chapter 1: Arrival',
      'Chapter 2: Departure',
    ]);
  });

  it('falls back when the outline has fewer than two chapters', () => {
    expect(
      selectOutlineChapterRanges(
        [
          { title: 'Title Page', pageIndex: 0 },
          { title: 'Chapter 1: Only', pageIndex: 4 },
        ],
        20,
      ),
    ).toEqual([]);
  });
});

describe('outline chapter bodies', () => {
  const body =
    'The road curved through the valley and the travelers followed it without speaking, ' +
    'watching the light fade behind the mountains as evening settled over the plain.';

  it('drops printed title fragments before the body', () => {
    const paragraphs: PdfParagraph[] = [
      { text: 'Chapter 3:', pageIndex: 0, isHeading: true, level: 2 },
      { text: 'Opening Move', pageIndex: 0, isHeading: false, level: 3 },
      { text: body, pageIndex: 0, isHeading: false, level: 3 },
    ];

    expect(stripChapterTitleParagraphs(paragraphs, 'Chapter 3: Opening Move')).toEqual([
      paragraphs[2],
    ]);
    expect(stripChapterTitleParagraphs(paragraphs, 'Chapter 4: Mind Made Up')).toEqual(paragraphs);
  });

  it('builds chapters from page ranges with outline titles', () => {
    const pages = [
      groupPageItems(
        [
          item('Chapter 1:', 250, 700, 17, 80),
          item('The First Mission', 250, 680, 17, 120),
          item('T', 72, 640, 30, 20),
          item('HE ROAD curved through the valley.', 94, 640, 15, 220),
          item(body, 72, 620, 15, 400),
        ],
        0,
        612,
      ),
      groupPageItems(
        [
          item('The travelers made camp before dark.', 72, 700, 15, 260),
          item('Chapter 2:', 250, 660, 17, 80),
          item('Guardian Beast', 250, 640, 17, 120),
          item(body, 72, 600, 15, 400),
        ],
        1,
        612,
      ),
    ];
    const bodySize = detectBodyFontSize(pages.flat());
    const drafts = buildOutlineChapters(
      pages,
      [
        { title: 'Chapter 1: The First Mission', startPage: 0, endPage: 1 },
        { title: 'Chapter 2: Guardian Beast', startPage: 1, endPage: 2 },
      ],
      bodySize,
      18,
    );

    expect(drafts.map((draft) => draft.title)).toEqual([
      'Chapter 1: The First Mission',
      'Chapter 2: Guardian Beast',
    ]);
    expect(drafts[0].blocks[0].text).toContain('HE ROAD curved');
    expect(drafts[0].blocks.some((block) => block.text === 'Chapter 1:')).toBe(false);
    expect(drafts[1].blocks[0].text).toContain('The travelers made camp');
  });
});
