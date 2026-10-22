import type { Key } from 'ink';
import { editMultiline, editText } from '../editText.js';

/** The form that files something into a folder (a bookmark, a todo). */
export interface FolderForm<F extends string> {
  /** Set when editing an existing item. */
  id?: string;
  values: Record<F, string>;
  field: F;
  /** Cursor in the focused multiline field; undefined starts at its end. */
  cursor?: number;
  /** Fields typed in by hand. */
  touched: ReadonlySet<F>;
  /** What was typed into the folder field; ↑↓ pick among existing folders matching it. */
  folderQuery: string;
  /** Index into the folder matches (-1: the typed text). */
  pick: number;
  saving: boolean;
  note?: string;
  error?: string;
}

/** The field with the folder path: typing filters existing folders, ↑↓ pick one. */
export const FOLDER_FIELD = 'folder';
/** The field with a `#rrggbb` color (or '' for none): ↵ or space opens the color picker. */
export const COLOR_FIELD = 'color';

export type FormAction = 'save' | 'cancel' | 'color' | 'suggest';
export type FormStep<Form> = { form: Form } | { action: FormAction } | undefined;

/** `form` with `field` set to `value` (typed by hand). */
export function setFormValue<F extends string, Form extends FolderForm<F>>(form: Form, field: F, value: string): Form {
  return {
    ...form,
    values: { ...form.values, [field]: value },
    touched: new Set([...form.touched, field]),
    ...(field === FOLDER_FIELD ? { folderQuery: value, pick: -1 } : {}),
    error: undefined,
  };
}

/**
 * `form` with the color picked in the popup, focus moved on to the field after the color one so
 * the next ↵ saves instead of opening the picker again.
 */
export function applyFormColor<F extends string, Form extends FolderForm<F>>(form: Form, fields: readonly F[], color: string): Form {
  const i = fields.indexOf(COLOR_FIELD as F);
  const next = i < 0 ? form.field : fields[(i + 1) % fields.length]!;
  return { ...setFormValue(form, COLOR_FIELD as F, color), field: next };
}

/**
 * One key in a folder form: Tab / ↑↓ move between `fields` (↑↓ pick a folder in the folder field
 * when some match), ↵ saves, Esc cancels, ^G asks Copilot. Multiline fields use ↵ for new lines,
 * arrows for editing and ^S to save. The color field uses ↵/space to pick and ⌫ to clear.
 */
export function formKey<F extends string, Form extends FolderForm<F>>(
  form: Form,
  fields: readonly F[],
  matches: readonly string[],
  raw: string,
  key: Key,
  multilineFields: readonly F[] = [],
): FormStep<Form> {
  if (key.escape) return { action: 'cancel' };
  if (form.saving) return undefined;
  if (key.ctrl && raw === 's') return { action: 'save' };
  const field: string = form.field;
  if (field === COLOR_FIELD) {
    if (key.return || raw === ' ') return { action: 'color' };
    if (key.backspace || key.delete || (key.ctrl && raw === 'u')) return { form: setFormValue(form, form.field, '') };
  }
  if (key.ctrl && raw === 'g') return { action: 'suggest' };
  const move = (dir: 1 | -1): FormStep<Form> => {
    const i = fields.indexOf(form.field);
    const next = fields[(i + dir + fields.length) % fields.length]!;
    return { form: { ...form, field: next, cursor: undefined, pick: -1, folderQuery: (form.values as Record<string, string>)[FOLDER_FIELD] ?? '' } };
  };
  if (key.tab) return move(key.shift ? -1 : 1);
  if (multilineFields.includes(form.field)) {
    const value = form.values[form.field];
    const next = editMultiline(value, form.cursor ?? value.length, raw, key);
    if (!next) return undefined;
    return { form: { ...setFormValue(form, form.field, next.value), cursor: next.cursor } };
  }
  if (key.return) return { action: 'save' };
  if (field === FOLDER_FIELD && (key.upArrow || key.downArrow) && matches.length > 0) {
    const pick = key.downArrow ? Math.min(matches.length - 1, form.pick + 1) : Math.max(-1, form.pick - 1);
    const folder = pick === -1 ? form.folderQuery : matches[pick]!;
    return { form: { ...form, pick, values: { ...form.values, [form.field]: folder }, touched: new Set([...form.touched, form.field]) } };
  }
  if (key.upArrow) return move(-1);
  if (key.downArrow) return move(1);
  if (field === COLOR_FIELD) return undefined;
  const next = editText(form.values[form.field], raw, key);
  return next === undefined ? undefined : { form: setFormValue(form, form.field, next) };
}
