import React, { useId, useRef } from 'react';
import { DEFAULT_FOLDER_COLOR, folderColor, normalizeFolder, type FolderColorMap } from '@fomo/core';
import { ColorButton } from './ColorPicker.js';
import { FolderIcon } from './FolderTree.js';
import { useDialogKeys } from '../hooks/useKeys.js';

interface ItemDialogProps {
  title: string;
  note?: string;
  error?: string;
  saving: boolean;
  /** Text areas use Enter for new lines and Ctrl/Cmd+S to save. */
  multiline?: boolean;
  /** The dialog's color picker (useColorPicker): its keys come first while it's open. */
  picker: { active: boolean; element: React.ReactNode };
  onSubmit(): void;
  onClose(): void;
  children: React.ReactNode;
}

/**
 * A dialog that adds or edits something filed in a folder (a bookmark, a todo): ↵ saves (⇧↵ adds a
 * line to a text area), Esc cancels, and no key reaches the app behind it. Multiline forms use
 * Enter for new lines and Ctrl/Cmd+S to save.
 */
export function ItemDialog({ title, note, error, saving, multiline = false, picker, onSubmit, onClose, children }: ItemDialogProps) {
  const formRef = useRef<HTMLFormElement>(null);
  useDialogKeys(formRef, onClose, picker.active, multiline);
  return (
    <>
      <div className="help-overlay" onClick={onClose}>
        <form
          ref={formRef}
          className="help-panel item-dialog"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        >
          <div className="help-panel__header">
            <h2>{title}</h2>
            <button type="button" className="btn" onClick={onClose} aria-label="Close">✕</button>
          </div>
          {note && <p className="item-dialog__note">{note}</p>}
          {children}
          {error && <p className="item-dialog__error" role="alert">⚠ {error}</p>}
          <div className="item-dialog__actions">
            <span className="item-dialog__hint">
              <kbd>{multiline ? 'Ctrl/Cmd+S' : '↵'}</kbd> save · <kbd>{multiline ? '↵' : '⇧↵'}</kbd> new line · <kbd>Esc</kbd> cancel
            </span>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
      {picker.element}
    </>
  );
}

/** A labelled field; `aside` sits next to the label (a hint about what was typed). */
export function DialogField({ label, aside, children }: { label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="item-dialog__field">
      <span className="item-dialog__label">{label}{aside}</span>
      {children}
    </label>
  );
}

interface FolderFieldProps {
  value: string;
  folders: readonly string[];
  folderColors: FolderColorMap;
  inputRef?: React.RefObject<HTMLInputElement>;
  autoFocus?: boolean;
  onChange(value: string): void;
}

/** The folder an item is filed in, suggesting the existing ones; the icon shows the folder's color. */
export function FolderField({ value, folders, folderColors, inputRef, autoFocus, onChange }: FolderFieldProps) {
  const listId = useId();
  const folder = normalizeFolder(value);
  return (
    <DialogField label="Folder">
      <span className="item-dialog__folder">
        <FolderIcon color={folder ? folderColor(folderColors, folder) ?? DEFAULT_FOLDER_COLOR : undefined} />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Top level — nest with /, e.g. work/fomo"
          list={listId}
          autoComplete="off"
        />
      </span>
      <datalist id={listId}>{folders.map((f) => <option key={f} value={f} />)}</datalist>
    </DialogField>
  );
}

/** An item's own color: the chip opens the color picker popup. */
export function ColorField({ color, fallback, fallbackLabel, onClick }: { color: string; fallback: string; fallbackLabel: string; onClick(): void }) {
  return (
    <div className="item-dialog__field item-dialog__field--row">
      <span className="item-dialog__label">Color</span>
      <ColorButton color={color} fallback={fallback} fallbackLabel={fallbackLabel} onClick={onClick} />
    </div>
  );
}
