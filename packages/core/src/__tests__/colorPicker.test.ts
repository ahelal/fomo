import { describe, it, expect, vi } from 'vitest';
import { COLOR_PALETTE, DEFAULT_COLOR, DEFAULT_FOLDER_COLOR, DEFAULT_ITEM_COLOR, PALETTE_COLUMNS } from '../colors.js';
import {
  folderColorFallback,
  folderColorRequest,
  hexColorError,
  itemColorFallback,
  itemColorRequest,
  pickerColor,
  pickerFallback,
  pickerMove,
  pickerResult,
  pickerSelect,
  pickerState,
  pickerTyped,
  typedHexColor,
  vimMove,
} from '../colorPicker.js';

const open = (color?: string, fallback?: string) => pickerState({ title: 't', color, fallback, onPick: vi.fn() });

describe('pickerState', () => {
  it('highlights its own color, normalized', () => {
    const s = open('#E3B341', '#3fb950');
    expect(s.color).toBe('#e3b341');
    expect(pickerColor(s)).toBe('#e3b341');
    expect(s.index).toBe(COLOR_PALETTE.indexOf('#e3b341'));
    expect(s.moved).toBe(false);
  });

  it('highlights the fallback when it has no color of its own', () => {
    const s = open('', '#3fb950');
    expect(s.color).toBe('');
    expect(pickerColor(s)).toBe('#3fb950');
  });

  it('falls back to the default color', () => {
    expect(pickerColor(open())).toBe(DEFAULT_COLOR);
    expect(pickerColor(open('nope', 'nope'))).toBe(DEFAULT_COLOR);
  });

  it('keeps a color that is not in the palette as a custom one', () => {
    const s = open('#123456');
    expect(s.index).toBe(-1);
    expect(s.custom).toBe('#123456');
    expect(pickerColor(s)).toBe('#123456');
  });

  it('keeps the request around for the popup', () => {
    const onPick = vi.fn();
    const s = pickerState({ title: 'folder ai/', sample: '▾ ai/', fallbackLabel: 'parent folder', onPick });
    expect(s).toMatchObject({ title: 'folder ai/', sample: '▾ ai/', fallbackLabel: 'parent folder' });
    s.onPick('#f85149');
    expect(onPick).toHaveBeenCalledWith('#f85149');
  });
});

describe('pickerFallback', () => {
  it('is the fallback, else the default', () => {
    expect(pickerFallback({ fallback: '#ABC' })).toBe('#aabbcc');
    expect(pickerFallback({})).toBe(DEFAULT_COLOR);
  });
});

describe('pickerMove and pickerSelect', () => {
  it('moves over the grid and marks the highlight as moved', () => {
    const s = pickerMove(open(COLOR_PALETTE[0]), 'down');
    expect(s.index).toBe(PALETTE_COLUMNS);
    expect(s.moved).toBe(true);
    expect(pickerColor(pickerMove(s, 'left'))).toBe(COLOR_PALETTE[PALETTE_COLUMNS - 1]);
  });

  it('starts at the first swatch from a custom color', () => {
    const s = pickerMove(open('#123456'), 'right');
    expect(s.index).toBe(0);
    expect(s.custom).toBeUndefined();
  });

  it('selects a swatch or a custom color', () => {
    const swatch = pickerSelect(open(), '#F85149');
    expect(swatch.index).toBe(COLOR_PALETTE.indexOf('#f85149'));
    expect(swatch.custom).toBeUndefined();
    expect(swatch.moved).toBe(true);
    const custom = pickerSelect(swatch, '#abc');
    expect(custom.index).toBe(-1);
    expect(pickerColor(custom)).toBe('#aabbcc');
  });

  it('ignores something that is not a color', () => {
    const s = pickerSelect(open('#f85149'), 'red');
    expect(pickerColor(s)).toBe('#f85149');
  });

  it('keeps extra state fields', () => {
    const s = { ...open(), hexDraft: '#12' };
    expect(pickerMove(s, 'up').hexDraft).toBe('#12');
    expect(pickerSelect(s, '#3fb950').hexDraft).toBe('#12');
  });
});

describe('pickerResult', () => {
  it('keeps what it had when the highlight did not move', () => {
    expect(pickerResult(open('#f85149'))).toBe('#f85149');
    // An inherited color doesn't become its own.
    expect(pickerResult(open('', '#3fb950'))).toBe('');
  });

  it('is the highlighted color once it moved', () => {
    expect(pickerResult(pickerSelect(open('', '#3fb950'), '#3fb950'))).toBe('#3fb950');
    expect(pickerResult(pickerMove(open(COLOR_PALETTE[0]), 'right'))).toBe(COLOR_PALETTE[1]);
  });
});

describe('vimMove', () => {
  it('maps h j k l', () => {
    expect(['h', 'j', 'k', 'l'].map(vimMove)).toEqual(['left', 'down', 'up', 'right']);
    expect(vimMove('x')).toBeUndefined();
  });
});

describe('typed hex colors', () => {
  it('previews only a complete six-digit color', () => {
    expect(typedHexColor('#3FB950')).toBe('#3fb950');
    expect(typedHexColor('3fb950 ')).toBe('#3fb950');
    expect(typedHexColor('#3fb')).toBeUndefined();
    expect(typedHexColor('#3fb95')).toBeUndefined();
    expect(typedHexColor('green')).toBeUndefined();
  });

  it('highlights a typed color once it is complete', () => {
    const s = open('#f85149');
    const partial = pickerTyped(s, ' #3f b9');
    expect(partial.draft).toBe('#3fb9');
    expect(partial.state).toBe(s);
    const full = pickerTyped(s, '#3FB950');
    expect(full.draft).toBe('#3FB950');
    expect(pickerColor(full.state)).toBe('#3fb950');
    expect(full.state.moved).toBe(true);
    expect(pickerTyped(s, '#1234567890').draft).toBe('#123456');
    expect(pickerColor(pickerTyped(s, '123456').state)).toBe('#123456');
  });

  it('explains a bad color', () => {
    expect(hexColorError('#zz')).toBe('Not a color: #zz — use #rrggbb');
    expect(hexColorError(' ')).toBe('Not a color: (empty) — use #rrggbb');
  });
});

describe('folder tree color requests', () => {
  const colors = { ai: '#f85149', 'ai/agents': '#3fb950' };
  const onPick = vi.fn();

  it('opens a folder on its own color, falling back to its parent’s', () => {
    expect(folderColorRequest({ path: 'ai/agents', onPick }, colors)).toEqual({
      title: 'folder ai/agents/',
      color: '#3fb950',
      fallback: '#f85149',
      fallbackLabel: 'parent folder',
      sample: '▾ agents/',
      onPick,
    });
    const tools = folderColorRequest({ path: ' ai/agents/tools/ ', onPick }, colors);
    expect(tools).toMatchObject({ title: 'folder ai/agents/tools/', color: '', fallback: '#3fb950', sample: '▾ tools/' });
  });

  it('falls back to the default at the top level', () => {
    expect(folderColorRequest({ path: 'ai', onPick }, colors)).toMatchObject({
      color: '#f85149',
      fallback: DEFAULT_FOLDER_COLOR,
      fallbackLabel: 'default',
    });
    expect(folderColorRequest({ path: 'ml', onPick }, undefined, '#000000')).toMatchObject({ color: '', fallback: '#000000' });
  });

  it('opens an item on its own color, falling back to its folder’s', () => {
    const req = itemColorRequest({ title: '“Docs”', sample: 'Docs', folder: 'ai/agents/tools', color: '#d2a8ff', onPick }, colors);
    expect(req).toEqual({
      title: '“Docs”',
      sample: 'Docs',
      color: '#d2a8ff',
      fallback: '#3fb950',
      fallbackLabel: 'folder color',
      onPick,
    });
    expect(itemColorRequest({ title: 't', folder: 'ml', onPick }, colors)).toMatchObject({
      color: '',
      fallback: DEFAULT_ITEM_COLOR,
      fallbackLabel: 'default',
    });
    // A folder typed into a form is read as it will be saved.
    expect(itemColorRequest({ title: 't', folder: ' ai / ', onPick }, colors).fallback).toBe('#f85149');
  });

  it('tells what an item without a color shows', () => {
    expect(itemColorFallback('ai/agents/tools', colors)).toEqual({ fallback: '#3fb950', fallbackLabel: 'folder color' });
    expect(itemColorFallback('', colors)).toEqual({ fallback: DEFAULT_ITEM_COLOR, fallbackLabel: 'default' });
    expect(itemColorFallback('ml', undefined, '#000000')).toEqual({ fallback: '#000000', fallbackLabel: 'default' });
  });

  it('tells what a folder without a color shows', () => {
    expect(folderColorFallback('ai/agents', colors)).toEqual({ fallback: '#f85149', fallbackLabel: 'parent folder' });
    expect(folderColorFallback(' ai/agents/tools/ ', colors)).toEqual({ fallback: '#3fb950', fallbackLabel: 'parent folder' });
    expect(folderColorFallback('ai', colors)).toEqual({ fallback: DEFAULT_FOLDER_COLOR, fallbackLabel: 'default' });
    expect(folderColorFallback('ml', undefined, '#000000')).toEqual({ fallback: '#000000', fallbackLabel: 'default' });
  });
});
