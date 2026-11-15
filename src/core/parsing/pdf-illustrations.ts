export type PdfImageDimensions = {
  width: number;
  height: number;
};

/**
 * A full-page illustration is at least a few hundred kilopixels. Logos,
 * icons, and decorative rules are far smaller, so this keeps them out of the
 * reader while accepting typical manga/light-novel art pages.
 */
export const ILLUSTRATION_MIN_IMAGE_AREA = 250_000;

/**
 * Art pages can carry a page number or a short caption. Ordinary text pages
 * have far more characters, which lets the parser skip the expensive
 * operator-list inspection for most of the book.
 */
export const ILLUSTRATION_MAX_TEXT_CHARS = 200;

export function isIllustrationCandidate(pageIndex: number, textChars: number): boolean {
  return pageIndex > 0 && textChars <= ILLUSTRATION_MAX_TEXT_CHARS;
}

export function hasLargeIllustrationImage(
  images: ReadonlyArray<PdfImageDimensions>,
): boolean {
  return images.some(
    ({ width, height }) =>
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0 &&
      width * height >= ILLUSTRATION_MIN_IMAGE_AREA,
  );
}