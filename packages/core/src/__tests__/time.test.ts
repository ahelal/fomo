import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatUpdateTime } from '../time.js';

describe('formatUpdateTime', () => {
  it('marks estimated article reading times', () => {
    expect(formatUpdateTime({ readingTimeMinutes: 5 })).toBe('~5m');
  });

  it('shows video durations in whole minutes, rounding part minutes up', () => {
    expect(formatUpdateTime({ durationSeconds: 849 })).toBe('15m');
    expect(formatUpdateTime({ durationSeconds: 5475 })).toBe('92m');
    expect(formatUpdateTime({ durationSeconds: 600 })).toBe('10m');
    expect(formatUpdateTime({ durationSeconds: 1 })).toBe('1m');
  });

  it('returns blank when no estimate is available', () => {
    expect(formatUpdateTime({})).toBe('');
  });
});

describe('formatDate', () => {
  it('drops the century of a stored date', () => {
    expect(formatDate('2026-10-24T09:05:00.000Z')).toBe('26-10-24');
    expect(formatDate('2026-10-24')).toBe('26-10-24');
  });

  it('keeps anything that is not a date as it is', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('soon')).toBe('soon');
  });
});

describe('formatDateTime', () => {
  it('shows a moment as local short date and time', () => {
    const at = new Date(2026, 9, 24, 9, 5, 42);
    expect(formatDateTime(at.toISOString())).toBe('26-10-24 09:05');
    expect(formatDateTime(at.getTime())).toBe('26-10-24 09:05');
    expect(formatDateTime(new Date(2005, 0, 2, 23, 59))).toBe('05-01-02 23:59');
  });

  it('is empty when missing or invalid', () => {
    expect(formatDateTime(undefined)).toBe('');
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('not a date')).toBe('');
  });
});
