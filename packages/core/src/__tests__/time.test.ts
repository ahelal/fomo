import { describe, expect, it } from 'vitest';
import { formatUpdateTime } from '../time.js';

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
