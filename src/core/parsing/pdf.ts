import { getDocument, PDFWorker, VerbosityLevel } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import PdfJsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import type { BookMetadata, ChapterNode } from '@/types/domain';
import { buildChapter } from './sentences';
import { buildParagraphs, buildPdfChapters, collectFurniture, detectBodyFontSize, estimateLineGap, groupPageItems, stripFurniture, textItemToLayoutItem } from './pdf-layout';
import type { PdfLine, PdfTextItem } from './pdf-layout';
import { normalizeWhitespace } from './text';

export class PdfParseError extends Error {
  readonly code: 'invalid' | 'scanned' | 'password';

  constructor(code: 'invalid' | 'scanned' | 'password', message: string) {
    super(message);
    this.name = 'PdfParseError';
    this.code = code;
  }
}

export type PdfCover = {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
};

export type PdfParseResult = {
  metadata: BookMetadata;
  chapters: ChapterNode[];
  cover?: PdfCover;
  pageCount: number;
  totalWords: number;
};

export type PdfParseOptions = {
  fileName: string;
  onPageProgress?: (page: number, total: number) => void;
  renderCover?: boolean;
};

type RawPdfInfo = Record<string, unknown>;

// Resolve against the deployment base so the app also works from a project
// subpath such as GitHub Pages' `/Cadence/`.
const ASSET_BASE = import.meta.env.BASE_URL;
const CMAP_URL = `${ASSET_BASE}pdfjs/cmaps/`;
const STANDARD_FONTS_URL = `${ASSET_BASE}pdfjs/standard_fonts/`;

function cleanPdfText(value: unknown): string {
  return typeof value === 'string' ? normalizeWhitespace(value) : '';
}

function looksLikeJunkTitle(title: string, fileName: string): boolean {
  if (!title) return true;
  const lower = title.toLowerCase();
  const base = fileName.replace(/\.pdf$/i, '').toLowerCase();
  if (lower === base) return true;
  if (lower.startsWith('microsoft word - ')) return true;
  if (/^untitled(?: document)?$/.test(lower)) return true;
  if (/^[0-9a-f]{16,}$/.test(lower)) return true;
  return false;
}

function readMetadata(info: RawPdfInfo, fileName: string, firstPageLine: string): BookMetadata {
  const rawTitle = cleanPdfText(info.Title);
  const title = looksLikeJunkTitle(rawTitle, fileName)
    ? firstPageLine || fileName.replace(/\.pdf$/i, '') || 'Untitled PDF'
    : rawTitle;
  const author = cleanPdfText(info.Author);
  const subject = cleanPdfText(info.Subject);
  const created = cleanPdfText(info.CreationDate);

  return {
    title,
    ...(author ? { author } : {}),
    ...(subject ? { description: subject } : {}),
    ...(created ? { publishedAt: created } : {}),
  };
}

async function renderCover(page: PDFPageProxy): Promise<PdfCover | undefined> {
  if (typeof OffscreenCanvas === 'undefined') return undefined;

  try {
    const base = page.getViewport({ scale: 1 });
    if (!base.width || !base.height) return undefined;
    const scale = Math.min(2, Math.max(0.5, 900 / base.height));
    const viewport = page.getViewport({ scale });
    const canvas = new OffscreenCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: 'image/jpeg',
      extension: 'jpg',
    };
  } catch {
    // Rendering can fail on locked-down browsers; a generated palette is enough.
    return undefined;
  }
}

export async function parsePdf(
  bytes: ArrayBuffer,
  { fileName, onPageProgress, renderCover: shouldRenderCover = true }: PdfParseOptions,
): Promise<PdfParseResult> {
  // pdf.js transfers the buffer to its worker and detaches it, so keep our own copy.
  // The generated pdf.js types mistype the constructor's `port` parameter, so
  // `fromPort` (which accepts a real Worker) is used instead.
  const workerPort = new PdfJsWorker();
  const pdfWorker: PDFWorker = PDFWorker.fromPort({ port: workerPort });
  const loadingTask = getDocument({
    data: new Uint8Array(bytes.slice(0)),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONTS_URL,
    isEvalSupported: false,
    useWorkerFetch: true,
    verbosity: VerbosityLevel.ERRORS,
    worker: pdfWorker,
  });

  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined);
    workerPort.terminate();
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new PdfParseError(
        'password',
        'This PDF is password-protected. Remove the password and import it again.',
      );
    }
    throw new PdfParseError('invalid', 'This file could not be opened as a PDF.');
  }

  try {
    const pageCount = pdf.numPages;
    if (pageCount === 0) throw new PdfParseError('invalid', 'This PDF contains no pages.');

    const pages: PdfLine[][] = [];
    let firstPageLine = '';
    let cover: PdfCover | undefined;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const text = await page.getTextContent({ includeMarkedContent: false });
        const items: PdfTextItem[] = [];
        for (const item of text.items) {
          if (!('str' in item)) continue;
          const layoutItem = textItemToLayoutItem(item);
          if (layoutItem) items.push(layoutItem);
        }

        const lines = groupPageItems(items, pageNumber - 1, viewport.width);
        pages.push(lines);
        if (!firstPageLine && pageNumber === 1) {
          firstPageLine = lines.find((line) => line.text.trim().length > 2)?.text ?? '';
        }

        if (shouldRenderCover && pageNumber === 1 && !cover) {
          cover = await renderCover(page);
        }
      } finally {
        page.cleanup();
      }

      onPageProgress?.(pageNumber, pageCount);
    }

    const furniture = collectFurniture(pages);
    const lines = pages.flatMap((page) => stripFurniture(page, furniture));
    const totalChars = lines.reduce((total, line) => total + line.text.replace(/\s+/g, '').length, 0);
    const totalWords = lines.reduce(
      (total, line) => total + line.text.split(/\s+/).filter(Boolean).length,
      0,
    );

    // A text-based PDF has roughly 700+ characters per page. Anything near
    // zero means the pages are scans without an OCR text layer.
    if (totalChars < Math.max(40, pageCount * 12) || totalWords < Math.max(8, pageCount * 3)) {
      throw new PdfParseError(
        'scanned',
        'This PDF has no selectable text layer, so it looks like a scan. Cadence cannot OCR image-only PDFs yet.',
      );
    }

    const bodySize = detectBodyFontSize(lines);
    const typicalGap = estimateLineGap(lines, bodySize);
    const paragraphs = buildParagraphs(lines, bodySize, typicalGap);
    const drafts = buildPdfChapters(paragraphs);

    const chapters: ChapterNode[] = [];
    for (const draft of drafts) {
      const chapter = buildChapter({
        index: chapters.length,
        title: draft.title,
        blocks: draft.blocks,
      });
      if (chapter) chapters.push(chapter);
    }

    if (chapters.length === 0) {
      throw new PdfParseError('invalid', 'No readable text was found in this PDF.');
    }

    const pdfInfo = (await pdf
      .getMetadata()
      .then((meta) => meta.info)
      .catch(() => null)) as RawPdfInfo | null;
    const metadata = readMetadata(pdfInfo ?? {}, fileName, firstPageLine);

    return {
      metadata,
      chapters,
      ...(cover ? { cover } : {}),
      pageCount,
      totalWords,
    };
  } finally {
    await loadingTask.destroy().catch(() => undefined);
    workerPort.terminate();
  }
}
