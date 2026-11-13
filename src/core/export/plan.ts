import type { BookDocument, SentenceNode } from '@/types/domain';
import type { ExportFormat, ExportScope } from '@/types/export';

export type PlannedChapter = {
  index: number;
  title: string;
  sentences: SentenceNode[];
};

export type ExportPlan = {
  chapters: PlannedChapter[];
  totalSentences: number;
  /** Naive 1x duration from the parser's per-sentence estimate. */
  estimatedDuration: number;
  /** Media title: the book, or the chapter for a chapter export. */
  title: string;
  artist: string;
  album: string;
};

function chapterTitle(title: string, index: number): string {
  const trimmed = title.replace(/\s+/g, ' ').trim();
  return trimmed || `Chapter ${index + 1}`;
}

/**
 * Builds the ordered chapter/sentence work list for an export. Empty chapters
 * are skipped so the M4B chapter list never contains duplicate markers.
 */
export function buildExportPlan(
  book: BookDocument,
  scope: ExportScope,
  chapterIndex?: number,
): ExportPlan {
  const source =
    scope === 'chapter'
      ? book.chapters.filter((chapter) => chapter.index === chapterIndex)
      : book.chapters;

  const chapters: PlannedChapter[] = [];
  let totalSentences = 0;
  let estimatedDuration = 0;

  for (const chapter of source) {
    const sentences: SentenceNode[] = [];
    for (const paragraph of chapter.paragraphs) {
      for (const sentence of paragraph.sentences) {
        if (sentence.ttsText.trim().length === 0) continue;
        sentences.push(sentence);
        estimatedDuration += sentence.estimatedDuration;
      }
    }
    if (sentences.length === 0) continue;
    totalSentences += sentences.length;
    chapters.push({ index: chapter.index, title: chapterTitle(chapter.title, chapter.index), sentences });
  }

  const onlyChapter = scope === 'chapter' ? chapters[0] : undefined;

  return {
    chapters,
    totalSentences,
    estimatedDuration,
    title: onlyChapter ? onlyChapter.title : book.metadata.title,
    artist: book.metadata.author?.trim() || 'Unknown author',
    album: book.metadata.title,
  };
}

/** Keeps file names portable across Windows, macOS, and Android. */
export function sanitizeFileStem(text: string, fallback = 'Audiobook'): string {
  const cleaned = Array.from(text)
    // Windows rejects every C0 control character in a file name.
    .map((character) => (character.charCodeAt(0) < 0x20 ? ' ' : character))
    .join('')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 96)
    .trim();
  return cleaned || fallback;
}

export function suggestedExportName(
  plan: Pick<ExportPlan, 'title'>,
  format: ExportFormat,
): string {
  return `${sanitizeFileStem(plan.title)}.${format}`;
}

export function coverMimeType(path?: string): string {
  const extension = path?.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
}
