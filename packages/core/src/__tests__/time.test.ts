import { describe, expect, it } from 'vitest';
import { formatUpdateTime } from '../time.js';

describe('formatUpdateTime', () => {
  it('marks estimated article reading times', () => {
    expect(formatUpdateTime({ readingTimeMinutes: 5 })).toBe('~5m');
  });

  it('formats exact video durations', () => {
    expect(formatUpdateTime({ durationSeconds: 849 })).toBe('14:09');
    expect(formatUpdateTime({ durationSeconds: 3723 })).toBe('1:02:03');
  });

  it('returns blank when no estimate is available', () => {
    expect(formatUpdateTime({})).toBe('');
  });
});
