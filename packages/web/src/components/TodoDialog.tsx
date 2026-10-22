import React, { useState } from 'react';
import {
  dueDateError,
  dueHint,
  itemColorFallback,
  itemColorRequest,
  normalizeFolder,
  parseDueDate,
  type FolderColorMap,
  type FomoService,
  type Todo,
} from '@fomo/core';
import { useColorPicker } from './ColorPicker.js';
import { ColorField, DialogField, FolderField, ItemDialog } from './ItemDialog.js';
import { errorText } from '../hooks/useFolderTree.js';

export interface TodoDraft {
  subject: string;
  /** As typed: a date, `today`, `fri`, `+3`, `2w`… ('' for none). */
  due: string;
  folder: string;
  description: string;
  /** `#rrggbb`, or '' for none (it shows its folder's). */
  color: string;
}

interface Props {
  service: FomoService;
  /** The todo being edited; a new one is added otherwise. */
  todo?: Todo;
  /** Starting values for a new todo. */
  initial?: Partial<TodoDraft>;
  /** Folders to suggest, and their colors. */
  folders: readonly string[];
  folderColors: FolderColorMap;
  onSaved(todo: Todo, created: boolean): void;
  onClose(): void;
}

/** Add or edit a todo: subject, due date (typed or picked), folder, description and color. */
export function TodoDialog({ service, todo, initial, folders, folderColors, onSaved, onClose }: Props) {
  const [values, setValues] = useState<TodoDraft>(() => ({
    subject: todo?.subject ?? initial?.subject ?? '',
    due: todo?.dueDate ?? initial?.due ?? '',
    folder: todo?.folder ?? initial?.folder ?? '',
    description: todo?.description ?? initial?.description ?? '',
    color: todo?.color ?? initial?.color ?? '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const picker = useColorPicker();
  const due = parseDueDate(values.due);
  const hint = dueHint(values.due);

  const set = (field: keyof TodoDraft) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setError(undefined);
  };
  const onInput = (field: keyof TodoDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(field)(e.target.value);

  const pickColor = () => {
    const subject = values.subject.trim();
    picker.open(itemColorRequest({
      title: subject ? `“${subject}”` : 'this todo',
      sample: subject || 'Todo',
      folder: values.folder,
      color: values.color,
      onPick: set('color'),
    }, folderColors));
  };

  async function submit() {
    if (saving) return;
    const subject = values.subject.trim();
    if (!subject) { setError('Subject is required'); return; }
    if (due === undefined) { setError(dueDateError(values.due)); return; }
    setSaving(true);
    setError(undefined);
    try {
      const req = { subject, description: values.description.trim(), folder: normalizeFolder(values.folder) };
      const saved = todo
        ? await service.updateTodo(todo.id, { ...req, dueDate: due, color: values.color })
        : await service.createTodo({ ...req, ...(due ? { dueDate: due } : {}), ...(values.color ? { color: values.color } : {}) });
      onSaved(saved, !todo);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <ItemDialog
      title={todo ? '✓ Edit todo' : '✓ Add a todo'}
      error={error}
      saving={saving}
      picker={picker}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <DialogField label="Subject">
        <input autoFocus value={values.subject} onChange={onInput('subject')} placeholder="What needs doing" />
      </DialogField>
      <DialogField
        label="Due"
        aside={hint && <span className={`item-dialog__due-hint${hint.error ? ' item-dialog__due-hint--error' : ''}`}>{hint.text}</span>}
      >
        <span className="item-dialog__due">
          <input value={values.due} onChange={onInput('due')} placeholder="none — 2026-03-06, today, fri, +3, 2w" autoComplete="off" />
          <input type="date" aria-label="Pick the due date" value={due || ''} onChange={onInput('due')} />
        </span>
      </DialogField>
      <FolderField value={values.folder} folders={folders} folderColors={folderColors} onChange={set('folder')} />
      <DialogField label="Description">
        <textarea value={values.description} onChange={onInput('description')} rows={3} placeholder="Notes (optional)" />
      </DialogField>
      <ColorField color={values.color} {...itemColorFallback(values.folder, folderColors)} onClick={pickColor} />
    </ItemDialog>
  );
}
