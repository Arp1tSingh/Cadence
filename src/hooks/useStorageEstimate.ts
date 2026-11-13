import { useEffect, useState } from 'react';
import { estimateStorage } from '@/core/storage/db';
import { formatBytes } from '@/lib/format';

export { formatBytes };

type StorageEstimate = {
  usage: number;
  quota: number;
  supported: boolean;
};

function readEstimate(): Promise<StorageEstimate> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return Promise.resolve({ usage: 0, quota: 0, supported: false });
  }
  return estimateStorage().then(({ usage, quota }) => ({ usage, quota, supported: true }));
}

/** Tracks local storage usage and refreshes after an optional trigger value. */
export function useStorageEstimate(refreshKey?: unknown): StorageEstimate {
  const [estimate, setEstimate] = useState<StorageEstimate>({
    usage: 0,
    quota: 0,
    supported: true,
  });

  useEffect(() => {
    let cancelled = false;
    readEstimate()
      .then((next) => {
        if (!cancelled) setEstimate(next);
      })
      .catch(() => {
        if (!cancelled) setEstimate({ usage: 0, quota: 0, supported: false });
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return estimate;
}

