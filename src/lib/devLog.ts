const PREFIX = '[Cadence]';

export function devLog(label: string, details?: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  if (details) console.info(PREFIX, label, details);
  else console.info(PREFIX, label);
}

export function realTimeFactor(audioSeconds: number, wallMs: number): number {
  if (!Number.isFinite(audioSeconds) || !Number.isFinite(wallMs) || wallMs <= 0) return 0;
  return audioSeconds / (wallMs / 1000);
}
