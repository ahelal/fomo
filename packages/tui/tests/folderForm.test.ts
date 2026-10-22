import { describe, expect, it } from 'vitest';
import type { Key } from 'ink';
import { applyFormColor, formKey, setFormValue, type FolderForm, type FormStep } from '../src/ui/hooks/folderForm.js';

type Field = 'title' | 'folder' | 'color';
const FIELDS: readonly Field[] = ['title', 'folder', 'color'];
type Form = FolderForm<Field>;

const NO_KEY: Key = {
  upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false,
  return: false, escape: false, ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false,
};
const k = (patch: Partial<Key> = {}): Key => ({ ...NO_KEY, ...patch });

const blank = (patch: Partial<Form> = {}): Form => ({
  values: { title: '', folder: '', color: '' },
  field: 'title',
  touched: new Set(),
  folderQuery: '',
  pick: -1,
  saving: false,
  ...patch,
});

function form(step: FormStep<Form>): Form {
  if (!step || !('form' in step)) throw new Error(`expected a form, got ${JSON.stringify(step)}`);
  return step.form;
}

describe('formKey', () => {
  it('types into the focused field and marks it touched', () => {
    const f = form(formKey(blank(), FIELDS, [], 'Hi', k()));
    expect(f.values.title).toBe('Hi');
    expect(f.touched.has('title')).toBe(true);
  });

  it('moves between fields with Tab, Shift+Tab and ↑↓, wrapping around', () => {
    expect(form(formKey(blank(), FIELDS, [], '', k({ tab: true }))).field).toBe('folder');
    expect(form(formKey(blank(), FIELDS, [], '', k({ tab: true, shift: true }))).field).toBe('color');
    expect(form(formKey(blank(), FIELDS, [], '', k({ downArrow: true }))).field).toBe('folder');
    expect(form(formKey(blank(), FIELDS, [], '', k({ upArrow: true }))).field).toBe('color');
  });

  it('saves with ↵, cancels with Esc, asks Copilot with ^G', () => {
    expect(formKey(blank(), FIELDS, [], '', k({ return: true }))).toEqual({ action: 'save' });
    expect(formKey(blank(), FIELDS, [], '', k({ escape: true }))).toEqual({ action: 'cancel' });
    expect(formKey(blank(), FIELDS, [], 'g', k({ ctrl: true }))).toEqual({ action: 'suggest' });
  });

  it('ignores keys while saving, except Esc', () => {
    const saving = blank({ saving: true });
    expect(formKey(saving, FIELDS, [], 'x', k())).toBeUndefined();
    expect(formKey(saving, FIELDS, [], '', k({ return: true }))).toBeUndefined();
    expect(formKey(saving, FIELDS, [], '', k({ escape: true }))).toEqual({ action: 'cancel' });
  });

  it('picks among matching folders with ↑↓ in the folder field', () => {
    const typed = form(formKey(blank({ field: 'folder' }), FIELDS, [], 'ai', k()));
    expect(typed.folderQuery).toBe('ai');
    const matches = ['ai', 'ai/agents'];
    const first = form(formKey(typed, FIELDS, matches, '', k({ downArrow: true })));
    expect(first.pick).toBe(0);
    expect(first.values.folder).toBe('ai');
    const second = form(formKey(first, FIELDS, matches, '', k({ downArrow: true })));
    expect(second.values.folder).toBe('ai/agents');
    expect(form(formKey(second, FIELDS, matches, '', k({ downArrow: true }))).pick).toBe(1);
    const back = form(formKey(form(formKey(second, FIELDS, matches, '', k({ upArrow: true }))), FIELDS, matches, '', k({ upArrow: true })));
    expect(back.pick).toBe(-1);
    expect(back.values.folder).toBe('ai');
    expect(back.folderQuery).toBe('ai');
  });

  it('moves on from the folder field with ↓ when nothing matches', () => {
    expect(form(formKey(blank({ field: 'folder' }), FIELDS, [], '', k({ downArrow: true }))).field).toBe('color');
  });

  it('opens the color picker from the color field instead of typing', () => {
    const color = blank({ field: 'color', values: { title: 'x', folder: '', color: '#e3b341' } });
    expect(formKey(color, FIELDS, [], '', k({ return: true }))).toEqual({ action: 'color' });
    expect(formKey(color, FIELDS, [], ' ', k())).toEqual({ action: 'color' });
    expect(formKey(color, FIELDS, [], 'a', k())).toBeUndefined();
    expect(form(formKey(color, FIELDS, [], '', k({ backspace: true }))).values.color).toBe('');
    expect(form(formKey(color, FIELDS, [], '', k({ tab: true }))).field).toBe('title');
  });
});

describe('setFormValue', () => {
  it('resets the folder pick when the folder is typed', () => {
    const f = setFormValue(blank({ pick: 2, error: 'oops' }), 'folder', 'work');
    expect(f.folderQuery).toBe('work');
    expect(f.pick).toBe(-1);
    expect(f.error).toBeUndefined();
  });
});

describe('applyFormColor', () => {
  it('sets the picked color and moves on so ↵ saves next', () => {
    const f = applyFormColor(blank({ field: 'color' }), FIELDS, '#3fb950');
    expect(f.values.color).toBe('#3fb950');
    expect(f.touched.has('color')).toBe(true);
    expect(f.field).toBe('title');
    expect(formKey(f, FIELDS, [], '', k({ return: true }))).toEqual({ action: 'save' });
  });

  it('moves to the field after color when it is not the last one', () => {
    expect(applyFormColor(blank({ field: 'color' }), ['color', 'title'] as const, '').field).toBe('title');
  });
});
