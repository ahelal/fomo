import type { Key } from 'ink';

/** `value` after a keystroke in a one-line text field, or undefined when the key isn't text. */
export function editText(value: string, input: string, key: Key): string | undefined {
  if (key.backspace || key.delete) return value.slice(0, -1);
  if (key.ctrl && input === 'u') return '';
  if (!input || key.ctrl || key.meta || key.tab || key.escape) return undefined;
  return value + input.replace(/[\r\n]+/g, ' ');
}
