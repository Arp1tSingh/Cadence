/** Human-readable byte sizes shared by the shelf, player, and export studio. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/** Short relative timestamp for job history rows. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  const minute = 60_000;
  if (delta < minute) return 'Just now';
  if (delta < 60 * minute) {
    const minutes = Math.floor(delta / minute);
    return `${minutes} min ago`;
  }
  if (delta < 24 * 60 * minute) {
    const hours = Math.floor(delta / (60 * minute));
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(delta / (24 * 60 * minute));
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
