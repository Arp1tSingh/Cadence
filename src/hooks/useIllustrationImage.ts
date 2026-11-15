import { useEffect, useState } from 'react';
import type { BookIllustration } from '@/types/domain';
import { readBookIllustration } from '@/core/storage/opfs';

/**
 * Loads one illustration from OPFS as an object URL. The URL is revoked when
 * the active page changes or the player closes.
 */
export function useIllustrationImage(
  illustration: BookIllustration | null | undefined,
): string | null {
  const [source, setSource] = useState<string | null>(null);
  const path = illustration?.path;
  const mimeType = illustration?.mimeType;

  useEffect(() => {
    setSource(null);
    if (!path) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    void readBookIllustration(path, mimeType)
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mimeType, path]);

  return source;
}