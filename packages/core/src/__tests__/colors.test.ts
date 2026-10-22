import { describe, it, expect } from 'vitest';
import {
  COLOR_PALETTE,
  DEFAULT_COLOR,
  PALETTE,
  PALETTE_COLUMNS,
  cleanColor,
  colorName,
  isHexColor,
  moveInGrid,
  normalizeHexColor,
  paletteIndex,
  readableTextColor,
} from '../colors.js';

describe('palette', () => {
  it('is a full grid of distinct, named hex colors', () => {
    expect(PALETTE.length % PALETTE_COLUMNS).toBe(0);
    expect(new Set(COLOR_PALETTE).size).toBe(PALETTE.length);
    expect(new Set(PALETTE.map((c) => c.name)).size).toBe(PALETTE.length);
    for (const { hex } of PALETTE) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(COLOR_PALETTE).toContain(DEFAULT_COLOR);
  });

  it('names palette colors and spells out others', () => {
    expect(colorName('#58A6FF')).toBe('Blue');
    expect(paletteIndex('58a6ff')).toBe(COLOR_PALETTE.indexOf('#58a6ff'));
    expect(paletteIndex('#123456')).toBe(-1);
    expect(paletteIndex(undefined)).toBe(-1);
    expect(colorName('#123')).toBe('#112233');
    expect(colorName('nope')).toBe('nope');
  });
});

describe('hex colors', () => {
  it('normalizes short, long and unprefixed forms', () => {
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc');
    expect(normalizeHexColor(' 58a6ff ')).toBe('#58a6ff');
    expect(normalizeHexColor('#58a6f')).toBeUndefined();
    expect(normalizeHexColor('blue')).toBeUndefined();
    expect(normalizeHexColor(undefined)).toBeUndefined();
  });

  it('only calls #rrggbb a hex color', () => {
    expect(isHexColor('#58a6ff')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor('58a6ff')).toBe(false);
  });

  it('cleans a color for storage', () => {
    expect(cleanColor(undefined)).toBe('');
    expect(cleanColor('  ')).toBe('');
    expect(cleanColor('#F00')).toBe('#ff0000');
    expect(() => cleanColor(' red ')).toThrow('Not a color: red (use #rrggbb)');
  });

  it('picks the readable text color for a background', () => {
    expect(readableTextColor('#ffffff')).toBe('#0d1117');
    expect(readableTextColor('#f2cc60')).toBe('#0d1117');
    expect(readableTextColor('#000000')).toBe('#f0f6fc');
    expect(readableTextColor('#1f6feb')).toBe('#f0f6fc');
    expect(readableTextColor('nope')).toBe('#f0f6fc');
  });
});

describe('moveInGrid', () => {
  it('runs left and right through the cells in reading order, wrapping', () => {
    expect(moveInGrid(0, 'right')).toBe(1);
    expect(moveInGrid(7, 'right')).toBe(8);
    expect(moveInGrid(0, 'left')).toBe(PALETTE.length - 1);
    expect(moveInGrid(PALETTE.length - 1, 'right')).toBe(0);
  });

  it('keeps the column going up and down, wrapping', () => {
    expect(moveInGrid(2, 'down')).toBe(2 + PALETTE_COLUMNS);
    expect(moveInGrid(2, 'up')).toBe(PALETTE.length - PALETTE_COLUMNS + 2);
    expect(moveInGrid(PALETTE.length - 1, 'down')).toBe(PALETTE_COLUMNS - 1);
  });

  it('skips a short last row in columns it does not reach', () => {
    // 10 cells, 4 wide: the last row only has columns 0 and 1.
    expect(moveInGrid(6, 'down', 10, 4)).toBe(2);
    expect(moveInGrid(2, 'up', 10, 4)).toBe(6);
    expect(moveInGrid(5, 'down', 10, 4)).toBe(9);
    expect(moveInGrid(9, 'down', 10, 4)).toBe(1);
  });

  it('starts at the first cell from no selection', () => {
    expect(moveInGrid(-1, 'down')).toBe(0);
    expect(moveInGrid(99, 'left', 10, 4)).toBe(0);
    expect(moveInGrid(0, 'left', 0, 4)).toBe(-1);
  });
});
