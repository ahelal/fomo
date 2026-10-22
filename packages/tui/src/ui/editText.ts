import type { Key } from 'ink';

/** `value` after a keystroke in a one-line text field, or undefined when the key isn't text. */
export function editText(value: string, input: string, key: Key): string | undefined {
  if (key.backspace || key.delete) return value.slice(0, -1);
  if (key.ctrl && input === 'u') return '';
  if (!input || key.ctrl || key.meta || key.tab || key.escape) return undefined;
  return value + input.replace(/[\r\n]+/g, ' ');
}

/** The line the cursor ends, or undefined while the cursor is inside the line. */
export function cursorLine(value: string, cursor = value.length): { start: number; end: number; text: string } | undefined {
  cursor = Math.max(0, Math.min(cursor, value.length));
  if (cursor < value.length && value[cursor] !== '\n') return undefined;
  const start = value.slice(0, cursor).lastIndexOf('\n') + 1;
  return { start, end: cursor, text: value.slice(start, cursor) };
}

/** A multiline field keeps a cursor; Tab and save/cancel keys belong to its form. */
export function editMultiline(value: string, cursor: number, input: string, key: Key): { value: string; cursor: number } | undefined {
  cursor = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const previous = [...before].at(-1)?.length ?? 0;
  const next = [...after][0]?.length ?? 0;
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineEnd = value.indexOf('\n', cursor);
  const end = lineEnd < 0 ? value.length : lineEnd;
  if (key.ctrl && input === 'u') return { value: '', cursor: 0 };
  if (key.ctrl && input === 'a') return { value, cursor: lineStart };
  if (key.ctrl && input === 'e') return { value, cursor: end };
  if (key.leftArrow) return { value, cursor: cursor - previous };
  if (key.rightArrow) return { value, cursor: cursor + next };
  if (key.upArrow || key.downArrow) {
    const column = [...value.slice(lineStart, cursor)].length;
    if (key.upArrow) {
      if (lineStart === 0) return { value, cursor: 0 };
      const start = value.slice(0, lineStart - 1).lastIndexOf('\n') + 1;
      return { value, cursor: start + [...value.slice(start, lineStart - 1)].slice(0, column).join('').length };
    }
    if (end === value.length) return { value, cursor: value.length };
    const start = end + 1;
    const following = value.indexOf('\n', start);
    return { value, cursor: start + [...value.slice(start, following < 0 ? value.length : following)].slice(0, column).join('').length };
  }
  // Ink reports the common terminal backspace byte as `delete`.
  if (key.backspace || key.delete) return { value: before.slice(0, before.length - previous) + after, cursor: cursor - previous };
  const inserted = key.return || (key.ctrl && input === 'j')
    ? '\n'
    : !key.ctrl && !key.meta && !key.escape && !key.tab && !key.pageUp && !key.pageDown
      ? input.replace(/\r\n?/g, '\n').replace(/\t/g, '  ')
      : '';
  if (!inserted) return undefined;
  return { value: before + inserted + after, cursor: cursor + inserted.length };
}
