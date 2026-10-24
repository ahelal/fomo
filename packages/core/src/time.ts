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

/** A stored date (ISO, `2026-10-24…`) as shown in the apps: `26-10-24`, without the century. */
export function formatDate(iso: string | undefined): string {
  const day = (iso ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(2) : day;
}

/** A moment as local `26-10-24 14:02` (e.g. when an update was fetched); `''` when missing or invalid. */
export function formatDateTime(at: string | number | Date | undefined): string {
  if (at === undefined || at === '') return '';
  const date = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getFullYear() % 100)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
