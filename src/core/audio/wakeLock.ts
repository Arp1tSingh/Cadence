type WakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinel>;
  };
};

let sentinel: WakeLockSentinel | null = null;

export async function requestWakeLock(): Promise<void> {
  if (typeof navigator === 'undefined') return;
  if (sentinel && !sentinel.released) return;

  const wakeLock = (navigator as WakeLockNavigator).wakeLock;
  if (!wakeLock) return;

  try {
    sentinel = await wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    sentinel = null;
  }
}

export async function releaseWakeLock(): Promise<void> {
  const current = sentinel;
  sentinel = null;
  if (!current || current.released) return;
  await current.release().catch(() => undefined);
}

export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean((navigator as WakeLockNavigator).wakeLock);
}
