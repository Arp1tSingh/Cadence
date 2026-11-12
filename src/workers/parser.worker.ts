import { expose } from 'comlink';
import type { BookDocument, BookFormat } from '@/types/domain';
import type {
  ParseOutcome,
  ParseProgress,
  ParseRequest,
  ParserWorkerApi,
} from '@/types/parser';
import { MAX_IMPORT_BYTES, PARSER_VERSION } from '@/core/parsing/constants';
import { EpubParseError, parseEpub } from '@/core/parsing/epub';
import { parsePdf, PdfParseError } from '@/core/parsing/pdf';
import { resolvePalette } from '@/core/parsing/palette';
import { saveBookCover, saveBookSource, deleteBookBlobs } from '@/core/storage/opfs';

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function fingerprint(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

function detectFormat(file: File): BookFormat | null {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.epub')) return 'epub';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (file.type === 'application/epub+zip') return 'epub';
  if (file.type === 'application/pdf') return 'pdf';
  return null;
}

function summarize(chapters: BookDocument['chapters']): {
  totalWords: number;
  totalChars: number;
  estimatedDuration: number;
} {
  return chapters.reduce(
    (totals, chapter) => ({
      totalWords: totals.totalWords + chapter.wordCount,
      totalChars: totals.totalChars + chapter.charCount,
      estimatedDuration: totals.estimatedDuration + chapter.estimatedDuration,
    }),
    { totalWords: 0, totalChars: 0, estimatedDuration: 0 },
  );
}

function unknownError(error: unknown): ParseOutcome {
  if (error instanceof EpubParseError) {
    return { status: 'error', code: error.code, message: error.message };
  }
  if (error instanceof PdfParseError) {
    return { status: 'error', code: error.code, message: error.message };
  }
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return {
      status: 'error',
      code: 'storage',
      message: 'This device ran out of storage while saving the book.',
    };
  }
  return {
    status: 'error',
    code: 'unknown',
    message:
      error instanceof Error
        ? error.message
        : 'Cadence could not read this file. It may be damaged or unsupported.',
  };
}

async function parse(
  request: ParseRequest,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParseOutcome> {
  const { file, knownBooks } = request;
  const report = (
    stage: ParseProgress['stage'],
    progress: number,
    message: string,
    extra?: Pick<ParseProgress, 'chapter' | 'chapterCount'>,
  ) => onProgress?.({ stage, progress, message, ...extra });

  try {
    const format = detectFormat(file);
    if (!format) {
      return {
        status: 'error',
        code: 'unsupported',
        message: 'Cadence imports DRM-free EPUB and PDF books only.',
      };
    }
    if (file.size === 0) {
      return { status: 'error', code: 'invalid', message: 'This file is empty.' };
    }
    if (file.size > MAX_IMPORT_BYTES) {
      return {
        status: 'error',
        code: 'too-large',
        message: 'This book is larger than 512 MB. Import a smaller edition.',
      };
    }

    report('hashing', 0.02, 'Fingerprinting file…');
    const bytes = await file.arrayBuffer();
    const hash = await fingerprint(bytes);

    const duplicate = knownBooks.find((book) => book.fingerprint === hash);
    if (duplicate) {
      return { status: 'duplicate', bookId: duplicate.id, fingerprint: hash };
    }

    const id = crypto.randomUUID();
    const extension = format;

    report('chapters', 0.06, 'Reading the book…');
    const sourcePath = await saveBookSource(id, extension, bytes.slice(0));

    let metadata;
    let chapters;
    let cover: { bytes: Uint8Array; mimeType: string; extension: string } | undefined;

    try {
      if (format === 'epub') {
        const result = await parseEpub(bytes, file.name, (chapter, total) => {
          report('chapters', 0.06 + (chapter / Math.max(1, total)) * 0.7, 'Extracting chapters…', {
            chapter,
            chapterCount: total,
          });
        });
        metadata = result.metadata;
        chapters = result.chapters;
        cover = result.cover;
      } else {
        const result = await parsePdf(bytes, {
          fileName: file.name,
          onPageProgress: (page, total) => {
            report('chapters', 0.06 + (page / Math.max(1, total)) * 0.7, 'Extracting pages…', {
              chapter: page,
              chapterCount: total,
            });
          },
        });
        metadata = result.metadata;
        chapters = result.chapters;
        cover = result.cover;
      }
    } catch (error) {
      await deleteBookBlobs(id).catch(() => undefined);
      return unknownError(error);
    }

    if (chapters.length === 0) {
      return {
        status: 'error',
        code: 'invalid',
        message: 'No readable text was found in this book.',
      };
    }

    report('palette', 0.82, cover ? 'Sampling cover colors…' : 'Choosing a palette…');
    const palette = await resolvePalette(cover, `${metadata.title}:${file.name}`);

    let coverPath: string | undefined;
    if (cover) {
      report('cover', 0.88, 'Saving cover…');
      coverPath = await saveBookCover(id, cover.extension, cover.bytes, cover.mimeType);
    }

    report('sentences', 0.92, 'Building timed sentences…');
    const totals = summarize(chapters);
    const now = Date.now();

    const book: BookDocument = {
      id,
      fingerprint: hash,
      format,
      metadata,
      chapters,
      palette,
      ...(coverPath ? { coverPath } : {}),
      sourcePath,
      byteSize: file.size,
      createdAt: now,
      updatedAt: now,
      ...totals,
      parserVersion: PARSER_VERSION,
    };

    report('done', 1, 'Ready to narrate.');
    return { status: 'created', book };
  } catch (error) {
    return unknownError(error);
  }
}

const api: ParserWorkerApi = { parse };
expose(api);
