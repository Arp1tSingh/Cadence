/** Playback speed bounds shared by the session, settings, and player UI. */
export const MIN_PLAYBACK_RATE = 0.5;
export const MAX_PLAYBACK_RATE = 3;

/** Speed presets shown in the player sheet. */
export const PLAYBACK_RATE_PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Rounds to the 0.05× grid and clamps into the supported range. */
export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  const clamped = Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate));
  return Math.round(clamped * 20) / 20;
}

export function formatPlaybackRate(rate: number): string {
  return `${Number(clampPlaybackRate(rate).toFixed(2))}×`;
}
