import stringWidth from 'string-width';

const segmenter = new Intl.Segmenter();

/** Terminal display width (emoji and CJK take two columns). */
export const textWidth = stringWidth;

export interface TextRow {
  text: string;
  start: number;
  end: number;
}

/** Soft-wrapped text with string offsets, so an editor can keep its cursor in view. */
export function textRows(text: string, columns: number): TextRow[] {
  const width = Math.max(1, columns);
  const rows: TextRow[] = [];
  let row: TextRow = { text: '', start: 0, end: 0 };
  let used = 0;
  for (const { segment, index } of segmenter.segment(text)) {
    if (/^\r?\n$|^\r$/.test(segment)) {
      rows.push(row);
      row = { text: '', start: index + segment.length, end: index + segment.length };
      used = 0;
      continue;
    }
    const size = textWidth(segment);
    if (used + size > width && row.text) {
      rows.push(row);
      row = { text: '', start: index, end: index };
      used = 0;
    }
    row.text += segment;
    row.end = index + segment.length;
    used += size;
  }
  rows.push(row);
  return rows;
}

/** Truncates `text` to at most `width` terminal columns, ending with `…` when cut. */
export function fit(text: string, width: number): string {
  if (width <= 0) return '';
  if (stringWidth(text) <= width) return text;
  let out = '';
  let used = 0;
  for (const { segment } of segmenter.segment(text)) {
    const w = stringWidth(segment);
    if (used + w > width - 1) break;
    out += segment;
    used += w;
  }
  return `${out}…`;
}
