import { describe, expect, it } from 'vitest';
import type { Key } from 'ink';
import { cursorLine, editMultiline } from '../src/ui/editText.js';
import { textRows } from '../src/ui/text.js';
import { formKey, type FolderForm } from '../src/ui/hooks/folderForm.js';

const k = (patch: Partial<Key> = {}): Key => ({
  upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false,
  return: false, escape: false, ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false,
  ...patch,
});

describe('cursorLine', () => {
  it('returns the line the cursor ends', () => {
    expect(cursorLine('https://a\n~/Doc')).toEqual({ start: 10, end: 15, text: '~/Doc' });
    expect(cursorLine('~/a\n~/b', 3)).toEqual({ start: 0, end: 3, text: '~/a' });
    expect(cursorLine('\nabc', 0)).toEqual({ start: 0, end: 0, text: '' });
  });

  it('is undefined while the cursor is inside a line', () => {
    expect(cursorLine('~/Doc', 2)).toBeUndefined();
  });
});

describe('multiline editing', () => {
  it('inserts newlines and pasted text at the cursor', () => {
    expect(editMultiline('ab', 1, '', k({ return: true }))).toEqual({ value: 'a\nb', cursor: 2 });
    expect(editMultiline('ab', 1, 'x\r\ny', k())).toEqual({ value: 'ax\nyb', cursor: 4 });
    expect(editMultiline('ab', 1, 'j', k({ ctrl: true }))).toEqual({ value: 'a\nb', cursor: 2 });
  });

  it('moves and deletes without breaking surrogate pairs', () => {
    expect(editMultiline('a😀b', 3, '', k({ leftArrow: true }))?.cursor).toBe(1);
    expect(editMultiline('a😀b', 1, '', k({ rightArrow: true }))?.cursor).toBe(3);
    expect(editMultiline('a😀b', 3, '', k({ backspace: true }))).toEqual({ value: 'ab', cursor: 1 });
    expect(editMultiline('a\nb', 2, '', k({ delete: true }))).toEqual({ value: 'ab', cursor: 1 });
  });

  it('moves between lines, including empty first and last lines', () => {
    expect(editMultiline('first\nsecond', 10, '', k({ upArrow: true }))?.cursor).toBe(4);
    expect(editMultiline('first\nsecond', 3, '', k({ downArrow: true }))?.cursor).toBe(9);
    expect(editMultiline('\ntext', 3, '', k({ upArrow: true }))?.cursor).toBe(0);
    expect(editMultiline('text\n', 2, '', k({ downArrow: true }))?.cursor).toBe(5);
    expect(editMultiline('text', 2, 'a', k({ ctrl: true }))?.cursor).toBe(0);
    expect(editMultiline('text\nrest', 2, 'e', k({ ctrl: true }))?.cursor).toBe(4);
    expect(editMultiline('text', 2, 'u', k({ ctrl: true }))).toEqual({ value: '', cursor: 0 });
  });

  it('lets the form own Tab, save and cancel', () => {
    type Field = 'subject' | 'description';
    const fields: Field[] = ['subject', 'description'];
    const f: FolderForm<Field> = { values: { subject: 'A', description: 'notes' }, field: 'description', touched: new Set(), folderQuery: '', pick: -1, saving: false };
    expect(formKey(f, fields, [], '', k({ return: true }), ['description'])).toMatchObject({ form: { values: { description: 'notes\n' } } });
    expect(formKey(f, fields, [], 's', k({ ctrl: true }), ['description'])).toEqual({ action: 'save' });
    expect(formKey(f, fields, [], '', k({ escape: true }), ['description'])).toEqual({ action: 'cancel' });
    expect(formKey(f, fields, [], '', k({ tab: true }), ['description'])).toMatchObject({ form: { field: 'subject', cursor: undefined } });
    expect(formKey(f, fields, [], '', k({ return: true }))).toEqual({ action: 'save' });
  });
});

describe('multiline layout', () => {
  it('wraps by terminal width, preserving blank lines and cursor offsets', () => {
    expect(textRows('ab😀c\n\nend', 4)).toEqual([
      { text: 'ab😀', start: 0, end: 4 },
      { text: 'c', start: 4, end: 5 },
      { text: '', start: 6, end: 6 },
      { text: 'end', start: 7, end: 10 },
    ]);
    expect(textRows('', 0)).toEqual([{ text: '', start: 0, end: 0 }]);
    expect(textRows('a\n', 1)).toEqual([{ text: 'a', start: 0, end: 1 }, { text: '', start: 2, end: 2 }]);
  });
});
