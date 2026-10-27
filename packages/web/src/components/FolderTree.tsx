import React, { useId } from 'react';
import type { FolderRow, FolderTreeRow } from '@fomo/core';
import { ColorButton } from './ColorPicker.js';
import type { FolderRename, TreeStatus } from '../hooks/useFolderTree.js';

const ROW_PAD = 8;
const DEPTH_PAD = 18;

/** A folder, in its color (`currentColor` without one). */
export function FolderIcon({ color }: { color?: string }) {
  return (
    <svg className="tree-icon" viewBox="0 0 16 16" aria-hidden="true" style={color ? { color } : undefined}>
      <path fill="currentColor" d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.4l1.6 1.6h6A1.5 1.5 0 0 1 15 5.1v7.4a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z" />
    </svg>
  );
}

/** How many of a folder's items are done, as a bar and `done/count` (or `label`). */
export function Progress({ done, count, label }: { done: number; count: number; label?: string }) {
  const complete = count > 0 && done === count;
  return (
    <span className={`tree-progress${complete ? ' tree-progress--complete' : ''}`} title={`${done} of ${count} done`}>
      <span className="tree-progress__bar" role="progressbar" aria-label={`${done} of ${count} done`} aria-valuemin={0} aria-valuemax={count} aria-valuenow={done}>
        <span className="tree-progress__fill" style={{ width: `${count ? Math.round((done / count) * 100) : 0}%` }} />
      </span>
      <span className="tree-progress__text">{label ?? `${done}/${count}`}</span>
    </span>
  );
}

interface TreeSearchProps {
  inputRef: React.RefObject<HTMLInputElement>;
  value: string;
  placeholder: string;
  /** How many items match, shown while searching. */
  matches?: number;
  onChange(text: string): void;
}

/** The pane's search: / focuses it, Esc clears it, ↵ or ↓ goes back to the list. */
export function TreeSearch({ inputRef, value, placeholder, matches, onChange }: TreeSearchProps) {
  return (
    <span className="tree-search">
      <input
        ref={inputRef}
        className="tree-search__input"
        type="search"
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { onChange(''); e.currentTarget.blur(); }
          else if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.blur(); }
        }}
      />
      {matches !== undefined && <span className="tree-search__count">{matches === 1 ? '1 match' : `${matches} matches`}</span>}
    </span>
  );
}

/** A header toggle (sort, filter), lit up when it isn't on its default. */
export function Pill({ active, title, onClick, children }: { active?: boolean; title: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button type="button" className={`tree-pill${active ? ' tree-pill--active' : ''}`} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

/** The status line, kept even when empty so the list doesn't jump. */
export function TreeMessage({ status }: { status?: TreeStatus }) {
  return (
    <p className={`tree-message${status ? ` tree-message--${status.tone}` : ''}`} role="status">
      {status?.text ?? ''}
    </p>
  );
}

interface RenameBarProps {
  rename: FolderRename;
  folders: readonly string[];
  onChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}

/** Renaming or moving a folder (e): everything in it goes along, and an existing folder merges them. */
export function RenameBar({ rename, folders, onChange, onSubmit, onCancel }: RenameBarProps) {
  const listId = useId();
  return (
    <form className="tree-rename" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <span>Move <strong>{rename.from}/</strong> to</span>
      <input
        autoFocus
        value={rename.value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
        list={listId}
        autoComplete="off"
        placeholder="the top level"
        aria-label={`Move ${rename.from}/ to`}
      />
      <datalist id={listId}>{folders.map((f) => <option key={f} value={f} />)}</datalist>
      <button type="submit" className="btn btn--primary">Move</button>
      <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      {rename.error && <span className="tree-error">⚠ {rename.error}</span>}
    </form>
  );
}

function FolderLabel({ row, color, progress }: { row: FolderRow; color: string; progress?: boolean }) {
  return (
    <>
      <span className="tree-row__caret" aria-hidden="true">{row.open ? '▾' : '▸'}</span>
      <FolderIcon color={color} />
      <span className="tree-row__folder" style={{ color }}>{row.name}/</span>
      {progress ? <Progress done={row.done} count={row.progressCount} /> : <span className="tree-row__count">{row.count}</span>}
    </>
  );
}

interface FolderTreeListProps<T> {
  /** What the tree holds, for screen readers. */
  label: string;
  rows: readonly FolderTreeRow<T>[];
  /** The selected row (-1 for none). */
  index: number;
  /** Shown instead of rows when there are none. */
  empty?: React.ReactNode;
  folderColorOf(path: string): string;
  /** Folders show how many of their items are done. */
  progress?: boolean;
  rowRef?(key: string): (el: HTMLElement | null) => void;
  onSelect(index: number): void;
  onToggle(path: string, open: boolean): void;
  /** A double-click on an item. */
  onActivate?(item: T): void;
  renderItem(item: T, selected: boolean): React.ReactNode;
  /** An item row's tooltip. */
  itemTitle?(item: T): string | undefined;
}

/** A folder tree's rows: folders (click to open or close) and the items in them, indented by depth. */
export function FolderTreeList<T>({
  label, rows, index, empty, folderColorOf, progress, rowRef, onSelect, onToggle, onActivate, renderItem, itemTitle,
}: FolderTreeListProps<T>) {
  return (
    <ul className="tree" role="tree" aria-label={label}>
      {rows.length === 0 && empty && <li className="tree-empty" role="none">{empty}</li>}
      {rows.map((row, i) => {
        const selected = i === index;
        const common = {
          ref: rowRef?.(row.key),
          role: 'treeitem',
          'aria-level': row.depth + 1,
          'aria-selected': selected,
          className: `tree-row tree-row--${row.kind}${selected ? ' tree-row--selected' : ''}`,
          style: { paddingLeft: ROW_PAD + row.depth * DEPTH_PAD },
        };
        if (row.kind === 'folder') {
          return (
            <li key={row.key} {...common} aria-expanded={row.open} onClick={() => { onSelect(i); onToggle(row.path, !row.open); }}>
              <FolderLabel row={row} color={folderColorOf(row.path)} progress={progress} />
            </li>
          );
        }
        return (
          <li
            key={row.key}
            {...common}
            title={itemTitle?.(row.item)}
            onClick={() => onSelect(i)}
            onDoubleClick={onActivate && (() => onActivate(row.item))}
          >
            {renderItem(row.item, selected)}
          </li>
        );
      })}
    </ul>
  );
}

interface FolderDetailsProps {
  path: string;
  color: string;
  /** Its ColorButton props: its own color and what it shows without one. */
  colorButton: { color: string; fallback: string; fallbackLabel: string };
  meta: React.ReactNode;
  onColor(): void;
  /** Its action buttons, before the color. */
  children?: React.ReactNode;
}

/** The details of the selected folder: its path in its color, a summary and what can be done with it. */
export function FolderDetails({ path, color, colorButton, meta, onColor, children }: FolderDetailsProps) {
  return (
    <>
      <p className="tree-details__title" style={{ color }}><FolderIcon /> {path}/</p>
      <div className="tree-details__meta">{meta}</div>
      <div className="tree-details__actions">
        {children}
        <ColorButton {...colorButton} title="c · Color the folder (what's in it follows, unless it has its own)" onClick={onColor} />
      </div>
    </>
  );
}

/** d · Delete, then d · Confirm delete once armed. */
export function DeleteButton({ armed, onClick }: { armed: boolean; onClick(): void }) {
  return (
    <button type="button" className={`btn${armed ? ' btn--danger' : ''}`} onClick={onClick}>
      {armed ? 'd · Confirm delete' : 'd · Delete'}
    </button>
  );
}
