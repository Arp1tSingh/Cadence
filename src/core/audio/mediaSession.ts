export type MediaSessionHandlers = {
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (seconds: number) => void;
  seekBy: (delta: number) => void;
};

export type MediaMetadataInput = {
  title: string;
  author?: string;
  album?: string;
  artworkUrl?: string;
  artworkType?: string;
};

type MediaSessionNavigator = Navigator & {
  mediaSession?: MediaSession;
};

function mediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as MediaSessionNavigator).mediaSession ?? null;
}

function setHandler(
  session: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    session.setActionHandler(action, handler);
  } catch {
    // Older browsers reject unsupported actions; the others still register.
  }
}

/** Wires hardware keys, lock-screen controls, and headset buttons. */
export function configureMediaSession(handlers: MediaSessionHandlers): void {
  const session = mediaSession();
  if (!session) return;

  setHandler(session, 'play', handlers.play);
  setHandler(session, 'pause', handlers.pause);
  setHandler(session, 'nexttrack', handlers.next);
  setHandler(session, 'previoustrack', handlers.previous);
  setHandler(session, 'seekbackward', () => handlers.seekBy(-15));
  setHandler(session, 'seekforward', () => handlers.seekBy(15));
  setHandler(session, 'seekto', (details) => {
    if (typeof details.seekTime === 'number') handlers.seekTo(details.seekTime);
  });
}

export function updateMediaMetadata(input: MediaMetadataInput): void {
  if (typeof MediaMetadata === 'undefined') return;
  const session = mediaSession();
  if (!session) return;

  session.metadata = new MediaMetadata({
    title: input.title,
    artist: input.author ?? 'Cadence',
    album: input.album ?? 'Cadence Audiobooks',
    artwork: input.artworkUrl
      ? [{ src: input.artworkUrl, type: input.artworkType ?? 'image/jpeg' }]
      : undefined,
  });
}

export function updatePositionState(duration: number, position: number): void {
  const session = mediaSession();
  if (!session || !Number.isFinite(duration) || duration <= 0) return;

  const safePosition = Math.min(duration, Math.max(0, position));
  try {
    session.setPositionState({
      duration,
      playbackRate: 1,
      position: safePosition,
    });
  } catch {
    // Position state is best effort.
  }
}

export function setPlaybackState(state: MediaSessionPlaybackState): void {
  const session = mediaSession();
  if (session) session.playbackState = state;
}

export function clearMediaSession(): void {
  const session = mediaSession();
  if (!session) return;
  setHandler(session, 'play', null);
  setHandler(session, 'pause', null);
  setHandler(session, 'nexttrack', null);
  setHandler(session, 'previoustrack', null);
  setHandler(session, 'seekbackward', null);
  setHandler(session, 'seekforward', null);
  setHandler(session, 'seekto', null);
  session.metadata = null;
  session.playbackState = 'none';
}
