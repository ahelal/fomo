/** The color palette offered by every color picker, and helpers for `#rrggbb` colors. */

export interface PaletteColor {
  hex: string;
  name: string;
}

/** Swatches per row of the picker grid: light, base and deep shades of each hue, then extras. */
export const PALETTE_COLUMNS = 8;

export const PALETTE: readonly PaletteColor[] = [
  { hex: '#ff7b72', name: 'Light red' },
  { hex: '#ffa657', name: 'Light orange' },
  { hex: '#f2cc60', name: 'Light yellow' },
  { hex: '#7ee787', name: 'Light green' },
  { hex: '#5eead4', name: 'Light teal' },
  { hex: '#79c0ff', name: 'Light blue' },
  { hex: '#d2a8ff', name: 'Light purple' },
  { hex: '#ff9bce', name: 'Light pink' },

  { hex: '#f85149', name: 'Red' },
  { hex: '#fb923c', name: 'Orange' },
  { hex: '#e3b341', name: 'Yellow' },
  { hex: '#3fb950', name: 'Green' },
  { hex: '#2dd4bf', name: 'Teal' },
  { hex: '#58a6ff', name: 'Blue' },
  { hex: '#bc8cff', name: 'Purple' },
  { hex: '#f472b6', name: 'Pink' },

  { hex: '#da3633', name: 'Dark red' },
  { hex: '#db6d28', name: 'Dark orange' },
  { hex: '#bb8009', name: 'Dark yellow' },
  { hex: '#238636', name: 'Dark green' },
  { hex: '#0d9488', name: 'Dark teal' },
  { hex: '#1f6feb', name: 'Dark blue' },
  { hex: '#8957e5', name: 'Dark purple' },
  { hex: '#bf4b8a', name: 'Dark pink' },

  { hex: '#f78166', name: 'Coral' },
  { hex: '#fbbf24', name: 'Amber' },
  { hex: '#a3e635', name: 'Lime' },
  { hex: '#34d399', name: 'Emerald' },
  { hex: '#06b6d4', name: 'Cyan' },
  { hex: '#818cf8', name: 'Indigo' },
  { hex: '#e879f9', name: 'Fuchsia' },
  { hex: '#94a3b8', name: 'Slate' },
];

/** The palette's hex values, in grid order. */
export const COLOR_PALETTE: readonly string[] = PALETTE.map((c) => c.hex);

/** Shown when nothing picked a color. */
export const DEFAULT_COLOR = '#58a6ff';
/** A folder's color in Bookmarks and Todos when neither it nor a parent folder has one. */
export const DEFAULT_FOLDER_COLOR = '#e3b341';
/** A bookmark's or todo's color when neither it nor its folders have one (the text color). */
export const DEFAULT_ITEM_COLOR = '#c9d1d9';

/** `#rrggbb` (lowercase) from `#rgb`, `rgb`, `#rrggbb` or `rrggbb`; undefined when it isn't a hex color. */
export function normalizeHexColor(value: string | undefined): string | undefined {
  const m = (value ?? '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return undefined;
  const hex = m[1]!.toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`;
}

/** True for a `#rrggbb` color. */
export function isHexColor(value: string | undefined): value is string {
  return /^#[0-9a-f]{6}$/i.test(value ?? '');
}

/** A color as stored: `''` (none) or `#rrggbb`. Throws on anything else. */
export function cleanColor(value: string | undefined): string {
  if (!value?.trim()) return '';
  const hex = normalizeHexColor(value);
  if (!hex) throw new Error(`Not a color: ${value.trim()} (use #rrggbb)`);
  return hex;
}

/** Position of `color` in the palette, or -1. */
export function paletteIndex(color: string | undefined): number {
  const hex = normalizeHexColor(color);
  return hex ? COLOR_PALETTE.indexOf(hex) : -1;
}

/** The palette name of `color`, or its hex value. */
export function colorName(color: string): string {
  const i = paletteIndex(color);
  return i >= 0 ? PALETTE[i]!.name : (normalizeHexColor(color) ?? color);
}

export type GridMove = 'up' | 'down' | 'left' | 'right';

/**
 * Cursor position after an arrow key in a grid of `size` cells, `columns` wide: left and right run
 * through the cells in reading order, up and down stay in the column; both wrap around.
 */
export function moveInGrid(index: number, move: GridMove, size = COLOR_PALETTE.length, columns = PALETTE_COLUMNS): number {
  if (size <= 0) return -1;
  if (index < 0 || index >= size) return 0;
  if (move === 'left') return (index - 1 + size) % size;
  if (move === 'right') return (index + 1) % size;
  const rows = Math.ceil(size / columns);
  const col = index % columns;
  let row = Math.floor(index / columns);
  // A short last row is skipped by columns it doesn't reach.
  do row = (row + (move === 'down' ? 1 : -1) + rows) % rows;
  while (row * columns + col >= size);
  return row * columns + col;
}

/** Relative luminance (0 black – 1 white) of a `#rrggbb` color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Dark or light text, whichever reads better on `background`. */
export function readableTextColor(background: string): '#0d1117' | '#f0f6fc' {
  const hex = normalizeHexColor(background);
  if (!hex) return '#f0f6fc';
  // Above this, black text has the higher contrast ratio.
  return luminance(hex) > 0.179 ? '#0d1117' : '#f0f6fc';
}
