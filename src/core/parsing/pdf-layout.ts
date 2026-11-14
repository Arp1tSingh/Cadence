import type { RawBlock } from './sentences';
import { countWords } from './sentences';
import {
  joinPdfLines,
  looksLikeChapterHeading,
  looksLikePageNumber,
  normalizeWhitespace,
} from './text';

export type PdfTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfRawTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

/**
 * Converts a PDF.js text run into baseline coordinates, dropping rotated runs
 * (margin watermarks, vertical figure labels) that would corrupt reading order.
 */
export function textItemToLayoutItem(item: PdfRawTextItem): PdfTextItem | null {
  if (!item.str || !item.str.trim()) return null;
  const x = item.transform[4];
  const y = item.transform[5];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const scale = Math.hypot(item.transform[2], item.transform[3]);
  const height = item.height || scale;

  if (Math.abs(item.transform[1]) > scale * 0.2 || Math.abs(item.transform[2]) > scale * 0.2) {
    return null;
  }

  return {
    text: item.str,
    x,
    y,
    width: Number.isFinite(item.width) ? item.width : 0,
    height: Number.isFinite(height) && height > 0 ? height : 10,
  };
}

export type PdfLine = PdfTextItem & {
  pageIndex: number;
  column: number;
};

export type PdfParagraph = {
  text: string;
  pageIndex: number;
  isHeading: boolean;
  level: number;
};

export type PdfChapterDraft = {
  title: string;
  blocks: RawBlock[];
};

const TERMINAL_PUNCTUATION = /[.!?…]["'”’»)\]]*$/u;
const NUMBERED_HEADING =
  /^(?:\d{1,2}(?:\.\d{1,3})*|[IVXLC]{1,6})[.)]?\s+\p{Lu}[\p{L}\p{N}\s'’&:,-]{1,70}$/u;
const FIGURE_CAPTION = /^(?:figure|fig\.|table|algorithm|listing)\s*\d/i;

function cleanItemText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function detectColumnSplit(items: PdfTextItem[], pageWidth?: number): number | null {
  if (!pageWidth || pageWidth < 240) return null;

  const candidates = items.filter(
    (item) => item.width > 0 && item.width < pageWidth * 0.62 && item.text.length > 0,
  );
  if (candidates.length < 16) return null;

  let left = 0;
  let right = 0;
  let gutter = 0;

  for (const item of candidates) {
    const center = item.x + item.width / 2;
    if (center < pageWidth * 0.46) left += 1;
    else if (center > pageWidth * 0.54) right += 1;
    else gutter += 1;
  }

  const total = candidates.length;
  if (left < total * 0.22 || right < total * 0.22 || gutter > total * 0.08) return null;
  return pageWidth / 2;
}

type MutableLine = PdfLine & {
  endX: number;
  trailingSpace: boolean;
  sizeWeights: Map<number, number>;
};

/**
 * Drop caps and decorative initials share a baseline with body text but are
 * drawn much larger. Weighting sizes by character count keeps the line at the
 * body size, so a single oversized glyph cannot turn a paragraph into a
 * heading (or a false chapter break).
 */
function dominantHeight(weights: Map<number, number>, fallback: number): number {
  let best = fallback;
  let bestWeight = 0;
  for (const [size, weight] of weights) {
    if (weight > bestWeight || (weight === bestWeight && size > best)) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

function addSizeWeight(line: MutableLine, height: number, text: string): void {
  const bucket = Math.round(height * 2) / 2;
  line.sizeWeights.set(bucket, (line.sizeWeights.get(bucket) ?? 0) + Math.max(1, text.length));
  line.height = dominantHeight(line.sizeWeights, line.height);
}

function groupColumn(items: PdfTextItem[], pageIndex: number, column: number): PdfLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: MutableLine[] = [];

  for (const item of sorted) {
    const rawText = item.text;
    const text = cleanItemText(rawText);
    if (!text) continue;

    const leadingSpace = /^\s/.test(rawText);
    const trailingSpace = /\s$/.test(rawText);
    const line = lines[lines.length - 1];
    const tolerance = Math.max(2, Math.min(item.height, line?.height ?? item.height) * 0.45);

    if (line && Math.abs(line.y - item.y) <= tolerance) {
      const gap = item.x - line.endX;
      const needsSpace =
        leadingSpace ||
        line.trailingSpace ||
        (gap > Math.max(1, item.height * 0.18) &&
          !line.text.endsWith(' ') &&
          !text.startsWith(' '));
      line.text = cleanItemText(`${line.text}${needsSpace ? ' ' : ''}${text}`);
      line.x = Math.min(line.x, item.x);
      line.endX = Math.max(line.endX, item.x + item.width);
      line.width = line.endX - line.x;
      addSizeWeight(line, item.height, text);
      line.trailingSpace = trailingSpace;
      continue;
    }

    lines.push({
      text,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      pageIndex,
      column,
      endX: item.x + item.width,
      trailingSpace,
      sizeWeights: new Map([[Math.round(item.height * 2) / 2, Math.max(1, text.length)]]),
    });
  }

  return lines
    .filter((line) => line.text.length > 0)
    .map((line) => {
      const { endX, trailingSpace, sizeWeights, ...rest } = line;
      void trailingSpace;
      void sizeWeights;
      return { ...rest, width: Math.max(0, endX - rest.x) };
    });
}

/**
 * Groups PDF text items into baseline-aligned lines and orders columns
 * left-to-right. Single-column pages are left untouched.
 */
export function groupPageItems(
  items: PdfTextItem[],
  pageIndex: number,
  pageWidth?: number,
): PdfLine[] {
  const usable = items.filter(
    (item) =>
      item.text.trim().length > 0 &&
      Number.isFinite(item.x) &&
      Number.isFinite(item.y) &&
      Number.isFinite(item.height),
  );
  if (usable.length === 0) return [];

  const split = detectColumnSplit(usable, pageWidth);
  if (split == null) return groupColumn(usable, pageIndex, 0);

  const left: PdfTextItem[] = [];
  const right: PdfTextItem[] = [];
  for (const item of usable) {
    const center = item.x + Math.max(0, item.width) / 2;
    if (center < split) left.push(item);
    else right.push(item);
  }

  return [
    ...groupColumn(left, pageIndex, 0),
    ...groupColumn(right, pageIndex, 1),
  ];
}

export function furnitureKey(text: string): string {
  return normalizeWhitespace(text).toLowerCase().replace(/\d+/g, '#');
}

/**
 * Running headers and footers are the lines that repeat at the top or bottom
 * of many pages. Page numbers are handled separately.
 */
export function collectFurniture(pages: PdfLine[][]): Set<string> {
  if (pages.length < 2) return new Set();
  const counts = new Map<string, number>();

  for (const lines of pages) {
    const candidates = [lines[0], lines[lines.length - 1]].filter(
      (line): line is PdfLine => Boolean(line),
    );
    const seen = new Set<string>();

    for (const line of candidates) {
      const text = normalizeWhitespace(line.text);
      if (!text || text.length > 100) continue;
      const key = furnitureKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const threshold = Math.max(2, Math.ceil(pages.length * 0.25));
  const furniture = new Set<string>();
  for (const [key, count] of counts) {
    if (count >= threshold) furniture.add(key);
  }
  return furniture;
}

export function stripFurniture(lines: PdfLine[], furniture: Set<string>): PdfLine[] {
  return lines.filter((line) => {
    if (looksLikePageNumber(line.text)) return false;
    return !furniture.has(furnitureKey(line.text));
  });
}

export function detectBodyFontSize(lines: PdfLine[]): number {
  const weights = new Map<number, number>();

  for (const line of lines) {
    if (!Number.isFinite(line.height) || line.height <= 0) continue;
    const bucket = Math.round(line.height * 2) / 2;
    weights.set(bucket, (weights.get(bucket) ?? 0) + line.text.length);
  }

  let best = 10;
  let bestWeight = 0;
  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

export function estimateLineGap(lines: PdfLine[], bodySize: number): number {
  const gaps: number[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    if (previous.pageIndex !== current.pageIndex || previous.column !== current.column) continue;
    if (previous.height > bodySize * 1.2 || current.height > bodySize * 1.2) continue;
    const gap = previous.y - current.y;
    if (gap > 0 && gap < bodySize * 4) gaps.push(gap);
  }

  if (gaps.length === 0) return bodySize * 1.2;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor((gaps.length - 1) / 2)] ?? bodySize * 1.2;
}

function headingLevel(height: number, bodySize: number): number {
  if (height >= bodySize * 1.8) return 1;
  if (height >= bodySize * 1.35) return 2;
  return 3;
}

function isHeadingLine(line: PdfLine, bodySize: number): boolean {
  const text = normalizeWhitespace(line.text);
  if (!text || text.length > 180) return false;
  if (FIGURE_CAPTION.test(text)) return false;
  if (line.height >= bodySize * 1.15) return true;
  return looksLikeChapterHeading(text) && line.height >= bodySize * 1.02;
}

/**
 * Large-font figure labels are common in PDFs. A real chapter/section title is
 * short, does not end like a sentence, and only contains digits when they are
 * a section number at the start.
 */
function looksLikeSectionTitle(text: string): boolean {
  const clean = normalizeWhitespace(text);
  if (!clean || clean.length > 100) return false;
  if (TERMINAL_PUNCTUATION.test(clean)) return false;
  if (FIGURE_CAPTION.test(clean)) return false;
  if (/\d/.test(clean) && !NUMBERED_HEADING.test(clean)) return false;
  return clean.split(/\s+/).length <= 14;
}

type ParagraphAccumulator = {
  text: string;
  pageIndex: number;
  column: number;
  isHeading: boolean;
  level: number;
  lastLine: PdfLine;
};

export function buildParagraphs(
  lines: PdfLine[],
  bodySize: number,
  typicalGap = bodySize * 1.2,
): PdfParagraph[] {
  const ordered = [...lines]
    .filter((line) => normalizeWhitespace(line.text).length > 0)
    .sort(
      (a, b) =>
        a.pageIndex - b.pageIndex ||
        a.column - b.column ||
        b.y - a.y ||
        a.x - b.x,
    );

  const margins = new Map<string, number>();
  for (const line of ordered) {
    if (line.height > bodySize * 1.2) continue;
    const key = `${line.pageIndex}:${line.column}`;
    margins.set(key, Math.min(margins.get(key) ?? line.x, line.x));
  }

  const paragraphs: PdfParagraph[] = [];
  let current: ParagraphAccumulator | null = null;

  const makeAccumulator = (
    line: PdfLine,
    isHeading: boolean,
    level: number,
  ): ParagraphAccumulator => ({
    text: normalizeWhitespace(line.text),
    pageIndex: line.pageIndex,
    column: line.column,
    isHeading,
    level,
    lastLine: line,
  });

  const flush = () => {
    if (!current) return;
    const text = normalizeWhitespace(current.text);
    if (text.length > 1) {
      paragraphs.push({
        text,
        pageIndex: current.pageIndex,
        isHeading: current.isHeading,
        level: current.level,
      });
    }
    current = null;
  };

  for (const line of ordered) {
    const text = normalizeWhitespace(line.text);
    const heading = isHeadingLine(line, bodySize);
    const level = headingLevel(line.height, bodySize);

    if (heading) {
      const canMergeHeading =
        current !== null &&
        current.isHeading &&
        current.pageIndex === line.pageIndex &&
        current.column === line.column &&
        current.lastLine.y - line.y <= Math.max(line.height, current.lastLine.height) * 0.9;

      if (canMergeHeading && current) {
        current.text = joinPdfLines(current.text, text);
        current.lastLine = line;
      } else {
        flush();
        current = makeAccumulator(line, true, level);
      }
      continue;
    }

    if (current?.isHeading) flush();
    if (!current) {
      current = makeAccumulator(line, false, 3);
      continue;
    }

    const previous = current.lastLine;
    const sameRegion =
      previous.pageIndex === line.pageIndex && previous.column === line.column;
    const gap = previous.y - line.y;
    const maxHeight = Math.max(previous.height, line.height, bodySize);
    const key = `${line.pageIndex}:${line.column}`;
    const margin = margins.get(key) ?? line.x;
    const indented = line.x - margin > bodySize * 1.35;
    const previousTerminal = TERMINAL_PUNCTUATION.test(current.text);

    const newParagraph =
      !sameRegion
        ? previousTerminal
        : gap > typicalGap * 1.55 || (indented && previousTerminal) || gap > maxHeight * 2.4;

    if (newParagraph) {
      flush();
      current = makeAccumulator(line, false, 3);
    } else {
      current.text = joinPdfLines(current.text, text);
      current.lastLine = line;
    }
  }

  flush();
  return paragraphs;
}

function isChapterStart(paragraph: PdfParagraph): boolean {
  if (!paragraph.isHeading) return false;
  if (looksLikeChapterHeading(paragraph.text)) return true;
  if (NUMBERED_HEADING.test(paragraph.text)) return true;
  if (paragraph.level === 1 && looksLikeSectionTitle(paragraph.text)) return true;
  return false;
}

function paragraphBlocks(paragraphs: PdfParagraph[]): RawBlock[] {
  return paragraphs.map((paragraph) => {
    if (paragraph.isHeading) {
      return { kind: 'heading', text: paragraph.text, level: paragraph.level };
    }
    const text = paragraph.text.trim();
    const quoted =
      /^["“«]/.test(text) && /["”»]$/.test(text) && text.length > 2;
    return { kind: quoted ? 'quote' : 'paragraph', text };
  });
}

function splitByBudget(paragraphs: PdfParagraph[], wordBudget: number): PdfChapterDraft[] {
  if (paragraphs.length === 0) return [];

  const chunks: PdfParagraph[][] = [];
  let current: PdfParagraph[] = [];
  let words = 0;

  for (const paragraph of paragraphs) {
    current.push(paragraph);
    words += countWords(paragraph.text);
    if (words >= wordBudget) {
      chunks.push(current);
      current = [];
      words = 0;
    }
  }

  if (current.length > 0) {
    if (chunks.length === 0) chunks.push(current);
    else chunks[chunks.length - 1].push(...current);
  }

  return chunks.map((chunk, index) => {
    const firstHeading = chunk.find((paragraph) => paragraph.isHeading);
    return {
      title: firstHeading?.text || `Part ${index + 1}`,
      blocks: paragraphBlocks(chunk),
    };
  });
}

/**
 * Detects chapter boundaries from heading patterns and font size. PDFs with no
 * usable headings are split into roughly even parts at paragraph boundaries.
 */
export function buildPdfChapters(
  paragraphs: PdfParagraph[],
  wordBudget = 3500,
): PdfChapterDraft[] {
  if (paragraphs.length === 0) return [];

  const starts = paragraphs
    .map((paragraph, index) => (isChapterStart(paragraph) ? index : -1))
    .filter((index) => index >= 0);

  if (starts.length === 0) return splitByBudget(paragraphs, wordBudget);

  const chapters: PdfChapterDraft[] = [];
  const frontMatter = paragraphs.slice(0, starts[0]);
  if (frontMatter.reduce((total, paragraph) => total + countWords(paragraph.text), 0) >= 60) {
    chapters.push({
      title: 'Front Matter',
      blocks: paragraphBlocks(frontMatter),
    });
  }

  starts.forEach((start, index) => {
    const end = starts[index + 1] ?? paragraphs.length;
    const chunk = paragraphs.slice(start, end);
    if (chunk.length === 0) return;
    const firstHeading = chunk.find((paragraph) => paragraph.isHeading);
    chapters.push({
      title: firstHeading?.text || `Part ${chapters.length + 1}`,
      blocks: paragraphBlocks(chunk),
    });
  });

  return chapters;
}

export type PdfOutlineEntry = {
  title: string;
  pageIndex: number;
  depth?: number;
};

export type PdfOutlineChapterRange = {
  title: string;
  startPage: number;
  endPage: number;
};

const OUTLINE_FRONT_BACK_MATTER =
  /^(?:table of contents|contents|cover|title page|copyright|credits?|dedication|acknowledg|about the author|newsletter|index|color inserts?|illustrations?|also by|advertisement)\b/i;

/** Outline titles worth treating as narrated chapters, not front/back matter. */
export function looksLikeOutlineChapterTitle(title: string): boolean {
  const clean = normalizeWhitespace(title);
  if (!clean || clean.length > 160) return false;
  if (OUTLINE_FRONT_BACK_MATTER.test(clean)) return false;
  if (looksLikeChapterHeading(clean)) return true;
  if (/^(?:extra|bonus|special|side)\s+chapter\b/i.test(clean)) return true;
  if (/^(?:interlude|side story)\b/i.test(clean)) return true;
  if (/^\d{1,2}(?:\.\d{1,3})*[.)]?\s+\p{Lu}/u.test(clean)) return true;
  return false;
}

/**
 * Converts a PDF outline into page ranges. Front matter before the first
 * chapter is dropped, each chapter ends where the next one starts, and the
 * final chapter stops at the first back-matter outline entry.
 */
export function selectOutlineChapterRanges(
  entries: PdfOutlineEntry[],
  pageCount: number,
): PdfOutlineChapterRange[] {
  if (pageCount <= 0) return [];

  const valid = entries
    .map((entry, order) => ({
      title: normalizeWhitespace(entry.title),
      pageIndex: entry.pageIndex,
      depth: entry.depth ?? 0,
      order,
    }))
    .filter(
      (entry) =>
        entry.title.length > 0 &&
        Number.isInteger(entry.pageIndex) &&
        entry.pageIndex >= 0 &&
        entry.pageIndex < pageCount,
    )
    .sort((a, b) => a.pageIndex - b.pageIndex || a.depth - b.depth || a.order - b.order);

  // A part and its first chapter often share a page. Keep the deeper, more
  // specific entry so chapter titles win over part titles.
  const byStart = new Map<number, (typeof valid)[number]>();
  for (const entry of valid) {
    if (!looksLikeOutlineChapterTitle(entry.title)) continue;
    const existing = byStart.get(entry.pageIndex);
    if (!existing || entry.depth > existing.depth) byStart.set(entry.pageIndex, entry);
  }

  const starts = [...byStart.values()].sort((a, b) => a.pageIndex - b.pageIndex);
  if (starts.length < 2) return [];

  return starts
    .map((entry, index) => {
      const next = starts[index + 1];
      let endPage = next?.pageIndex ?? pageCount;
      if (!next) {
        const boundary = valid.find(
          (candidate) =>
            candidate.pageIndex > entry.pageIndex &&
            !looksLikeOutlineChapterTitle(candidate.title),
        );
        if (boundary) endPage = boundary.pageIndex;
      }
      return {
        title: entry.title,
        startPage: entry.pageIndex,
        endPage: Math.min(pageCount, Math.max(entry.pageIndex + 1, endPage)),
      };
    })
    .filter((range) => range.endPage > range.startPage);
}

function titleKey(text: string): string {
  return normalizeWhitespace(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Drops the printed chapter heading lines that precede the body, using the
 * outline title as the source of truth. Handles titles split across lines,
 * e.g. "Chapter 3:" + "Opening Move".
 */
export function stripChapterTitleParagraphs(
  paragraphs: PdfParagraph[],
  title: string,
): PdfParagraph[] {
  const target = titleKey(title);
  if (!target) return paragraphs;

  let index = 0;
  let matched = '';
  while (index < paragraphs.length && index < 4) {
    const key = titleKey(paragraphs[index].text);
    if (!key) break;
    const next = `${matched}${key}`;
    if (!target.startsWith(next)) break;
    matched = next;
    index += 1;
    if (matched === target) break;
  }

  return index > 0 ? paragraphs.slice(index) : paragraphs;
}

/** Builds chapters from outline page ranges, independent of heading heuristics. */
export function buildOutlineChapters(
  pages: PdfLine[][],
  ranges: PdfOutlineChapterRange[],
  bodySize: number,
  typicalGap = bodySize * 1.2,
): PdfChapterDraft[] {
  const drafts: PdfChapterDraft[] = [];

  for (const range of ranges) {
    const lines = pages.slice(range.startPage, range.endPage).flat();
    if (lines.length === 0) continue;

    const paragraphs = stripChapterTitleParagraphs(
      buildParagraphs(lines, bodySize, typicalGap),
      range.title,
    );
    if (paragraphs.length === 0) continue;

    const words = paragraphs.reduce(
      (total, paragraph) => total + countWords(paragraph.text),
      0,
    );
    if (words < 8) continue;

    drafts.push({ title: range.title, blocks: paragraphBlocks(paragraphs) });
  }

  return drafts;
}
