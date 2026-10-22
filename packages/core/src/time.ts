import type { Update } from './types.js';

/** `iso` as a short age, e.g. `just now`, `5m ago`, `3h ago`, `2d ago`. */
export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Media length in whole minutes (rounded up), or an approximate article reading time. */
export function formatUpdateTime(update: Pick<Update, 'readingTimeMinutes' | 'durationSeconds'>): string {
  if (typeof update.durationSeconds === 'number' && update.durationSeconds > 0) {
    return `${Math.ceil(update.durationSeconds / 60)}m`;
  }
  return typeof update.readingTimeMinutes === 'number' && update.readingTimeMinutes > 0
    ? `~${update.readingTimeMinutes}m`
    : '';
}
