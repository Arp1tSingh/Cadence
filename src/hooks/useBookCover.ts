import { useEffect, useState } from 'react';
import type { BookDocument } from '@/types/domain';
import { readBookCover } from '@/core/storage/opfs';

/** Resolves the OPFS cover into a temporary object URL. */
export function useBookCover(book: BookDocument): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!book.coverPath) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    readBookCover(book.coverPath)
      .then((blob) => {
        if (!blob || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        // A missing cover falls back to the generated palette card.
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [book.coverPath]);

  return url;
}
