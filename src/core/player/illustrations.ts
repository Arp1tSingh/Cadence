import type { BookDocument, BookIllustration, SentenceNode } from '@/types/domain';

/**
 * The player reveals the artwork on the page after the one being read, so an
 * illustration faces its preceding text page instead of arriving with the next
 * page's prose.
 */
export function illustrationForPage<T extends Pick<BookIllustration, 'pageIndex'>>(
  illustrations: ReadonlyArray<T> | undefined,
  pageIndex: number | undefined,
): T | undefined {
  if (pageIndex === undefined || !illustrations || illustrations.length === 0) {
    return undefined;
  }
  const target = pageIndex + 1;
  return illustrations.find((entry) => entry.pageIndex === target);
}

export function illustrationForSentence(
  book: BookDocument,
  sentence: SentenceNode | null,
): BookIllustration | undefined {
  return illustrationForPage(book.illustrations, sentence?.pageIndex);
}