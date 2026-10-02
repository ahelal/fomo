import stringWidth from 'string-width';

const segmenter = new Intl.Segmenter();

/** Terminal display width (emoji and CJK take two columns). */
export const textWidth = stringWidth;

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
