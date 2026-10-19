import { describe, expect, it } from 'vitest';
import { jumpStep, shortcutKey } from '../keys.js';

describe('shortcutKey', () => {
  it('lower-cases single letters so Shift does not change a shortcut', () => {
    expect(shortcutKey('B')).toBe('b');
    expect(shortcutKey('g')).toBe('g');
  });

  it('keeps named keys and symbols as they are', () => {
    expect(shortcutKey('ArrowDown')).toBe('ArrowDown');
    expect(shortcutKey('Enter')).toBe('Enter');
    expect(shortcutKey('/')).toBe('/');
    expect(shortcutKey('6')).toBe('6');
  });
});

describe('jumpStep', () => {
  it('jumps 5 rows on small screens and 10 on tall ones', () => {
    expect(jumpStep(24)).toBe(5);
    expect(jumpStep(39)).toBe(5);
    expect(jumpStep(40)).toBe(10);
    expect(jumpStep(60)).toBe(10);
  });
});
