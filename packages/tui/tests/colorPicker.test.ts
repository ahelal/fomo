import { describe, expect, it, vi } from 'vitest';
import type { Key } from 'ink';
import { COLOR_PALETTE, DEFAULT_COLOR, PALETTE_COLUMNS } from '@fomo/core';
import { pickerColor, pickerKey, pickerState, type ColorPickerState, type PickerStep } from '../src/ui/hooks/useColorPicker.js';

const NO_KEY: Key = {
  upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false,
  return: false, escape: false, ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false,
};
const k = (patch: Partial<Key> = {}): Key => ({ ...NO_KEY, ...patch });

const open = (color?: string, fallback?: string) => pickerState({ title: 't', color, fallback, onPick: vi.fn() });

function state(step: PickerStep): ColorPickerState {
  if (!('state' in step)) throw new Error(`expected a state, got ${JSON.stringify(step)}`);
  return step.state;
}

/** Feed keys one by one; stops at a pick or a cancel. */
function press(s: ColorPickerState, ...keys: [string, Partial<Key>?][]): PickerStep {
  let step: PickerStep = { state: s };
  for (const [raw, key] of keys) {
    if (!('state' in step)) break;
    step = pickerKey(step.state, raw, k(key));
  }
  return step;
}

describe('pickerState', () => {
  it('highlights its own color', () => {
    const s = open('#E3B341');
    expect(s.color).toBe('#e3b341');
    expect(pickerColor(s)).toBe('#e3b341');
    expect(s.moved).toBe(false);
  });

  it('highlights the fallback when it has no color of its own', () => {
    const s = open('', '#3fb950');
    expect(s.color).toBe('');
    expect(pickerColor(s)).toBe('#3fb950');
  });

  it('starts on the default color without a fallback', () => {
    expect(pickerColor(open())).toBe(DEFAULT_COLOR);
  });

  it('keeps a color outside the palette as custom', () => {
    const s = open('#123456');
    expect(s.index).toBe(-1);
    expect(s.custom).toBe('#123456');
    expect(pickerColor(s)).toBe('#123456');
  });
});

describe('pickerKey', () => {
  it('moves over the grid with arrows and h j k l, then applies with ↵', () => {
    const s = open(COLOR_PALETTE[0]);
    const right = state(press(s, ['', { rightArrow: true }]));
    expect(pickerColor(right)).toBe(COLOR_PALETTE[1]);
    const down = state(press(right, ['j']));
    expect(pickerColor(down)).toBe(COLOR_PALETTE[1 + PALETTE_COLUMNS]);
    const back = state(press(down, ['h'], ['k']));
    expect(pickerColor(back)).toBe(COLOR_PALETTE[0]);
    expect(press(back, ['', { return: true }])).toEqual({ pick: COLOR_PALETTE[0] });
  });

  it('wraps around the edges', () => {
    const s = open(COLOR_PALETTE[0]);
    expect(pickerColor(state(press(s, ['', { leftArrow: true }])))).toBe(COLOR_PALETTE.at(-1));
    expect(pickerColor(state(press(s, ['', { upArrow: true }])))).toBe(COLOR_PALETTE[COLOR_PALETTE.length - PALETTE_COLUMNS]);
  });

  it('moves from a custom color onto the palette', () => {
    const moved = state(press(open('#123456'), ['', { rightArrow: true }]));
    expect(moved.custom).toBeUndefined();
    expect(pickerColor(moved)).toBe(COLOR_PALETTE[0]);
  });

  it('keeps the color unchanged on ↵ or space without moving', () => {
    expect(press(open('', '#3fb950'), ['', { return: true }])).toEqual({ pick: '' });
    expect(press(open('#e3b341'), [' '])).toEqual({ pick: '#e3b341' });
  });

  it('goes back to the fallback with d (in either case)', () => {
    expect(press(open('#e3b341'), ['d'])).toEqual({ pick: '' });
    expect(press(open('#e3b341'), ['D'])).toEqual({ pick: '' });
  });

  it('cancels with Esc or ⌫', () => {
    expect(press(open('#e3b341'), ['', { escape: true }])).toEqual({ cancel: true });
    expect(press(open('#e3b341'), ['', { backspace: true }])).toEqual({ cancel: true });
  });

  it('types a hex color after #, selecting it once complete', () => {
    const typing = state(press(open('#e3b341'), ['#']));
    expect(typing.hexDraft).toBe('#e3b341');
    const cleared = state(press(typing, ['u', { ctrl: true }]));
    expect(cleared.hexDraft).toBe('');
    const typed = state(press(cleared, ['#12'], ['34'], ['56']));
    expect(typed.hexDraft).toBe('#123456');
    expect(pickerColor(typed)).toBe('#123456');
    expect(press(typed, ['', { return: true }])).toEqual({ pick: '#123456' });
  });

  it('caps the hex at 7 characters and rejects a bad one', () => {
    const typing = state(press(open(), ['', { tab: true }], ['u', { ctrl: true }], ['#abcdef99']));
    expect(typing.hexDraft).toBe('#abcdef');
    const bad = state(press(state(press(typing, ['u', { ctrl: true }], ['zz'])), ['', { return: true }]));
    expect(bad.error).toMatch(/Not a color: zz/);
    expect(bad.hexDraft).toBe('zz');
  });

  it('previews a typed color with Tab and leaves hex mode with Esc', () => {
    const typing = state(press(open('#e3b341'), ['#'], ['u', { ctrl: true }], ['#0000ff']));
    const previewed = state(press(typing, ['', { tab: true }]));
    expect(previewed.hexDraft).toBeUndefined();
    expect(pickerColor(previewed)).toBe('#0000ff');
    expect(previewed.moved).toBe(true);
    const escaped = state(press(state(press(open('#e3b341'), ['#'])), ['', { escape: true }]));
    expect(escaped.hexDraft).toBeUndefined();
    expect(pickerColor(escaped)).toBe('#e3b341');
  });
});
