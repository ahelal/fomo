/**
 * The color picker's state, shared by the TUI and web popups: a highlight moving over the palette
 * grid (or a typed custom color), and what ↵ picks.
 */
import {
  COLOR_PALETTE,
  DEFAULT_COLOR,
  DEFAULT_FOLDER_COLOR,
  DEFAULT_ITEM_COLOR,
  moveInGrid,
  normalizeHexColor,
  paletteIndex,
  type GridMove,
} from './colors.js';
import { folderColor, normalizeFolder, parentFolder } from './folders.js';
import type { FolderColorMap } from './types.js';

/** What the color picker is opened for. */
export interface ColorRequest {
  /** What gets the color, for the popup's title (`folder ai/`, `“Read the docs”`). */
  title: string;
  /** Its own color now ('' or unset: none, so it shows `fallback`). */
  color?: string;
  /** The color it shows without one of its own (its folder's, a source's default). */
  fallback?: string;
  /** What that fallback is called (`default`, `folder color`). */
  fallbackLabel?: string;
  /** Text previewed in the color. */
  sample?: string;
  /** Called with the picked `#rrggbb`, or '' to go back to the fallback. */
  onPick(color: string): void;
}

export interface ColorPickerState extends ColorRequest {
  /** Its own color when the picker opened: `#rrggbb`, or '' for none. */
  color: string;
  /** The highlighted swatch, or -1 for `custom`. */
  index: number;
  /** A typed color that isn't in the palette. */
  custom?: string;
  /** The highlight moved away from where it opened, so ↵ applies it. */
  moved: boolean;
}

/** The color shown for '' (no color of its own): the fallback, else the default. */
export function pickerFallback(request: Pick<ColorRequest, 'fallback'>): string {
  return normalizeHexColor(request.fallback) ?? DEFAULT_COLOR;
}

/** The picker opened on the request's color (or its fallback, when it has none). */
export function pickerState(request: ColorRequest): ColorPickerState {
  const own = normalizeHexColor(request.color);
  const shown = own ?? pickerFallback(request);
  const index = paletteIndex(shown);
  return { ...request, color: own ?? '', index, custom: index < 0 ? shown : undefined, moved: false };
}

/** The highlighted color. */
export function pickerColor(s: Pick<ColorPickerState, 'index' | 'custom'>): string {
  return s.index >= 0 ? COLOR_PALETTE[s.index]! : s.custom ?? DEFAULT_COLOR;
}

/** Highlight `hex` (a swatch, or a custom color). */
export function pickerSelect<S extends ColorPickerState>(s: S, hex: string): S {
  const color = normalizeHexColor(hex) ?? pickerColor(s);
  const index = paletteIndex(color);
  return { ...s, index, custom: index < 0 ? color : undefined, moved: true };
}

/** Move the highlight over the swatches; from a custom color it starts at the first one. */
export function pickerMove<S extends ColorPickerState>(s: S, move: GridMove): S {
  return { ...s, index: moveInGrid(s.index, move), custom: undefined, moved: true };
}

/**
 * What ↵ picks: the highlighted color once the highlight moved, else what it had — so opening the
 * picker and pressing ↵ never turns an inherited color into its own.
 */
export function pickerResult(s: ColorPickerState): string {
  return s.moved ? pickerColor(s) : s.color;
}

const VIM_MOVES: Partial<Record<string, GridMove>> = { h: 'left', l: 'right', k: 'up', j: 'down' };

/** The move for h j k l (vim-style arrows), if `input` is one. */
export function vimMove(input: string): GridMove | undefined {
  return VIM_MOVES[input];
}

/** A typed `#rrggbb` (or `rrggbb`) once all six digits are in, for a live preview; shorter input waits. */
export function typedHexColor(draft: string): string | undefined {
  return /^#?[0-9a-f]{6}$/i.test(draft.trim()) ? normalizeHexColor(draft) : undefined;
}

/**
 * Typing a hex color: the text without spaces (at most `#rrggbb` long), and the highlight on the
 * color once all six digits are in.
 */
export function pickerTyped<S extends ColorPickerState>(s: S, text: string): { state: S; draft: string } {
  const draft = text.replace(/\s+/g, '').slice(0, 7);
  const full = typedHexColor(draft);
  return { state: full ? pickerSelect(s, full) : s, draft };
}

/** Why a typed color can't be applied. */
export function hexColorError(draft: string): string {
  return `Not a color: ${draft.trim() || '(empty)'} — use #rrggbb`;
}

// ─── Folder trees (Bookmarks, Todos) ─────────────────────────────────────────

/**
 * The picker for folder `path`'s own color. Without one, a folder shows its closest parent's
 * color (`parent folder`), else `defaultColor`.
 */
export function folderColorRequest(
  { path, onPick }: { path: string; onPick(color: string): void },
  folderColors: FolderColorMap | undefined,
  defaultColor = DEFAULT_FOLDER_COLOR,
): ColorRequest {
  const folder = normalizeFolder(path);
  return {
    title: `folder ${folder}/`,
    color: folderColors?.[folder] ?? '',
    ...folderColorFallback(folder, folderColors, defaultColor),
    sample: `▾ ${folder.slice(folder.lastIndexOf('/') + 1)}/`,
    onPick,
  };
}

/** The color a folder without one of its own shows: its closest parent's, else the default. */
export function folderColorFallback(
  path: string,
  folderColors: FolderColorMap | undefined,
  defaultColor = DEFAULT_FOLDER_COLOR,
): { fallback: string; fallbackLabel: string } {
  const inherited = folderColor(folderColors, parentFolder(normalizeFolder(path)));
  return { fallback: inherited ?? defaultColor, fallbackLabel: inherited ? 'parent folder' : 'default' };
}

/**
 * The picker for something filed in `folder` (a bookmark, a todo). Without a color of its own, it
 * shows its folder's (`folder color`), else `defaultColor`.
 */
export function itemColorRequest(
  { folder, color, ...request }: Pick<ColorRequest, 'title' | 'sample' | 'onPick'> & { folder: string; color?: string },
  folderColors: FolderColorMap | undefined,
  defaultColor = DEFAULT_ITEM_COLOR,
): ColorRequest {
  return { ...request, color: color ?? '', ...itemColorFallback(folder, folderColors, defaultColor) };
}

/** What an item without a color of its own shows: its folder's color (or a parent's), else the default. */
export function itemColorFallback(
  folder: string,
  folderColors: FolderColorMap | undefined,
  defaultColor = DEFAULT_ITEM_COLOR,
): { fallback: string; fallbackLabel: string } {
  const inherited = folderColor(folderColors, normalizeFolder(folder));
  return { fallback: inherited ?? defaultColor, fallbackLabel: inherited ? 'folder color' : 'default' };
}
