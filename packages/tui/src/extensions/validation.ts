import type { KeyedChange, ScrapedItem } from '@fomo/core';

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const MAX_ITEMS = 1000;
export const cleanMessage = (value: unknown) => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 1000);
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function text(value: unknown, max = 1000): value is string {
  return typeof value === 'string' && value.length <= max;
}
export function httpsUrl(value: unknown): value is string {
  if (!text(value, 8192)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
function date(value: unknown): value is string {
  return text(value, 30) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
const seconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 31_536_000;
const fields = ['title', 'url', 'content', 'datePublished', 'durationSeconds'];

export function decodeMerge(value: unknown): KeyedChange | undefined {
  if (value === null) return undefined;
  if (!object(value) || Object.keys(value).some((key) => !fields.includes(key))
    || ('title' in value && (!text(value.title) || !value.title.trim()))
    || ('url' in value && !httpsUrl(value.url))
    || ('content' in value && !text(value.content, 64_000))
    || ('datePublished' in value && !date(value.datePublished))
    || ('durationSeconds' in value && !seconds(value.durationSeconds))) {
    throw new Error('Invalid extension merge: protected fields or invalid content');
  }
  return value;
}

export function decodeItems(value: unknown): ScrapedItem[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Error('Invalid extension item count');
  return value.map((item) => {
    if (!object(item)
      || Object.keys(item).some((key) => ![...fields, 'key', 'readingTimeMinutes'].includes(key))
      || !text(item.title) || !item.title.trim() || !httpsUrl(item.url) || !date(item.datePublished)
      || ('content' in item && !text(item.content, 64_000))
      || ('key' in item && (!text(item.key, 2048) || !item.key))
      || ('durationSeconds' in item && !seconds(item.durationSeconds))
      || ('readingTimeMinutes' in item && !seconds(item.readingTimeMinutes))) {
      throw new Error('Invalid extension item: expected bounded title, HTTPS URL, ISO date and content');
    }
    return {
      title: item.title, url: item.url, datePublished: new Date(item.datePublished),
      ...(typeof item.content === 'string' ? { content: item.content } : {}),
      ...(typeof item.key === 'string' ? { key: item.key } : {}),
      ...(typeof item.durationSeconds === 'number' ? { durationSeconds: item.durationSeconds } : {}),
      ...(typeof item.readingTimeMinutes === 'number' ? { readingTimeMinutes: item.readingTimeMinutes } : {}),
    };
  });
}
