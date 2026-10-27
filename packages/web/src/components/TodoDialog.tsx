import React, { useState } from 'react';
import {
  dueDateError,
  dueHint,
  itemColorFallback,
  itemColorRequest,
  normalizeFolder,
  parseAttachments,
  parseDueDate,
  type FolderColorMap,
  type FomoService,
  type Todo,
  type TodoKind,
} from '@fomo/core';
import { useColorPicker } from './ColorPicker.js';
import { ColorField, DialogField, FolderField, ItemDialog } from './ItemDialog.js';
import { errorText } from '../hooks/useFolderTree.js';

export interface TodoDraft {
  kind: TodoKind;
  subject: string;
  /** As typed: a date, `today`, `fri`, `+3`, `2w`… ('' for none). */
  due: string;
  folder: string;
  description: string;
  /** One URL or file path per line. */
  attachments: string;
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

/** Add or edit a todo, with optional multiline notes and URL/path references. */
export function TodoDialog({ service, todo, initial, folders, folderColors, onSaved, onClose }: Props) {
  const [values, setValues] = useState<TodoDraft>(() => ({
    kind: todo?.kind ?? initial?.kind ?? 'todo',
    subject: todo?.subject ?? initial?.subject ?? '',
    due: todo?.dueDate ?? initial?.due ?? '',
    folder: todo?.folder ?? initial?.folder ?? '',
    description: todo?.description ?? initial?.description ?? '',
    attachments: todo?.attachments?.join('\n') ?? initial?.attachments ?? '',
    color: todo?.color ?? initial?.color ?? '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const picker = useColorPicker();
  const due = values.kind === 'idea' ? '' : parseDueDate(values.due);
  const hint = values.kind === 'idea' ? undefined : dueHint(values.due);

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
    if (values.kind === 'todo' && due === undefined) { setError(dueDateError(values.due)); return; }
    let attachments: string[];
    try {
      attachments = parseAttachments(values.attachments);
    } catch (err) {
      setError(errorText(err));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const originalKind = todo?.kind ?? 'todo';
      const req = {
        subject,
        description: values.description,
        folder: normalizeFolder(values.folder),
        ...(values.kind === 'idea' || (todo && originalKind !== values.kind) ? { kind: values.kind } : {}),
      };
      const saved = todo
        ? await service.updateTodo(todo.id, { ...req, dueDate: values.kind === 'todo' ? due ?? '' : '', color: values.color, attachments })
        : await service.createTodo({ ...req, ...(attachments.length ? { attachments } : {}), ...(values.kind === 'todo' && due ? { dueDate: due } : {}), ...(values.color ? { color: values.color } : {}) });
      onSaved(saved, !todo);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <ItemDialog
      title={todo ? `✓ Edit ${values.kind}` : `✓ Add ${values.kind === 'idea' ? 'an idea' : 'a todo'}`}
      error={error}
      saving={saving}
      multiline
      picker={picker}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <DialogField label="Type">
        <select value={values.kind} onChange={(e) => set('kind')(e.target.value as TodoKind)}>
          <option value="todo">Todo</option>
          <option value="idea">Idea</option>
        </select>
      </DialogField>
      <DialogField label="Subject">
        <input autoFocus value={values.subject} onChange={onInput('subject')} placeholder="What needs doing" />
      </DialogField>
      {values.kind === 'todo' && (
        <DialogField
          label="Due"
          aside={hint && <span className={`item-dialog__due-hint${hint.error ? ' item-dialog__due-hint--error' : ''}`}>{hint.text}</span>}
        >
          <span className="item-dialog__due">
            <input value={values.due} onChange={onInput('due')} placeholder="none — 2026-03-06, today, fri, +3, 2w" autoComplete="off" />
            <input type="date" aria-label="Pick the due date" value={due || ''} onChange={onInput('due')} />
          </span>
        </DialogField>
      )}
      <FolderField value={values.folder} folders={folders} folderColors={folderColors} onChange={set('folder')} />
      <DialogField label="Notes (optional)">
        <textarea value={values.description} onChange={onInput('description')} rows={5} placeholder="Add notes — Enter starts a new line" />
      </DialogField>
      <DialogField label="Attachments (optional)">
        <textarea value={values.attachments} onChange={onInput('attachments')} rows={3} placeholder={'One URL or file path per line\nhttps://example.com/report\n~/Documents/report.pdf'} spellCheck={false} />
        <span>References only; files are not uploaded. Local paths open in the TUI.</span>
      </DialogField>
      <ColorField color={values.color} {...itemColorFallback(values.folder, folderColors)} onClick={pickColor} />
    </ItemDialog>
  );
}
