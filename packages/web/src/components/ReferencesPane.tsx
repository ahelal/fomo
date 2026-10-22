import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  REFERENCE_SORTS,
  buildReferenceRows,
  isDefaultSort,
  nextSort,
  normalizeFolder,
  sortLabel,
  parentRowIndex,
  referenceFolders,
  rowFolder,
  shortcutKey,
  jumpStep,
  type FomoService,
  type Reference,
  type ReferenceRow,
  type ReferenceSort,
} from '@fomo/core';
import { ReferenceDialog, type ReferenceDraft } from './ReferenceDialog.js';

interface Props {
  service: FomoService;
  /** Keyboard shortcuts are on (no overlay is open above the pane). */
  active: boolean;
}

interface DialogState {
  reference?: Reference;
  initial?: Partial<ReferenceDraft>;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function openUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Links filed into folders: browse the tree, search, add, edit, move folders and delete. */
/** The References sort survives closing the pane, but not a reload. */
let lastSort: ReferenceSort | undefined;

export function ReferencesPane({ service, active }: Props) {
  const [refs, setRefs] = useState<Reference[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  /** Folders are open unless closed here. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [dialog, setDialog] = useState<DialogState | undefined>();
  const [rename, setRename] = useState<{ from: string; value: string; error?: string } | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [sort, setSort] = useState<ReferenceSort | undefined>(lastSort);
  const messageTimer = useRef<ReturnType<typeof setTimeout>>();
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const say = useCallback((msg: string, ms = 3000) => {
    setMessage(msg);
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(undefined), ms);
  }, []);
  useEffect(() => () => clearTimeout(messageTimer.current), []);

  const load = useCallback(async () => {
    try {
      const { references } = await service.listReferences();
      setRefs(references);
      setError(undefined);
    } catch (err) {
      setError(errorText(err));
      setRefs((r) => r ?? []);
    }
  }, [service]);

  useEffect(() => { void load(); }, [load]);

  const folders = useMemo(() => referenceFolders(refs ?? []), [refs]);
  const rows = useMemo(() => {
    const expanded = new Set(folders.filter((f) => !collapsed.has(f)));
    return buildReferenceRows(refs ?? [], expanded, search, sort);
  }, [refs, folders, collapsed, search, sort]);


  const found = selectedKey ? rows.findIndex((r) => r.key === selectedKey) : -1;
  const index = found >= 0 ? found : rows.length > 0 ? 0 : -1;
  const cycleSort = useCallback(() => {
    // Keep the selected row selected as the links move.
    if (!selectedKey && rows[index]) setSelectedKey(rows[index]!.key);
    setSort((current) => (lastSort = nextSort(REFERENCE_SORTS, current)));
  }, [selectedKey, rows, index]);
  const row: ReferenceRow | undefined = rows[index];

  useEffect(() => {
    if (row) rowRefs.current.get(row.key)?.scrollIntoView({ block: 'nearest' });
  }, [row]);

  const select = useCallback((i: number) => {
    const next = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (next) setSelectedKey(next.key);
    setConfirmDelete(undefined);
  }, [rows]);

  const setOpen = useCallback((path: string, open: boolean) => {
    setCollapsed((prev) => {
      if (prev.has(path) === !open) return prev;
      const next = new Set(prev);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** Open every folder on the way to `folder`. */
  const reveal = useCallback((folder: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      const parts = folder ? folder.split('/') : [];
      for (let i = 1; i <= parts.length; i++) next.delete(parts.slice(0, i).join('/'));
      return next;
    });
  }, []);

  const addLink = useCallback((folder: string) => setDialog({ initial: { folder } }), []);
  const editLink = useCallback((reference: Reference) => setDialog({ reference }), []);

  const onSaved = useCallback((saved: Reference, created: boolean) => {
    setDialog(undefined);
    reveal(saved.folder);
    setSelectedKey(`ref:${saved.id}`);
    void load();
    say(`✓ ${created ? 'Filed' : 'Updated'} in ${saved.folder || 'the top level'}`);
  }, [reveal, load, say]);

  const deleteLink = useCallback((ref: Reference) => {
    const i = rows.findIndex((r) => r.key === `ref:${ref.id}`);
    const next = rows[i + 1] ?? rows[i - 1];
    setSelectedKey(next?.key);
    setConfirmDelete(undefined);
    setRefs((list) => list?.filter((r) => r.id !== ref.id));
    say(`Deleted “${ref.title}”`);
    service.deleteReference(ref.id)
      .catch((err) => say(`Error: ${errorText(err)}`, 5000))
      .finally(() => void load());
  }, [rows, service, load, say]);

  const askDelete = useCallback((ref: Reference) => {
    if (confirmDelete === ref.id) deleteLink(ref);
    else setConfirmDelete(ref.id);
  }, [confirmDelete, deleteLink]);

  const copyLink = useCallback((ref: Reference) => {
    if (!navigator.clipboard) { say('Copying needs a secure (https) page'); return; }
    navigator.clipboard.writeText(ref.url).then(() => say('Copied the link'), () => say('Could not copy the link'));
  }, [say]);

  const submitRename = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rename) return;
    try {
      const moved = await service.moveReferenceFolder(rename.from, rename.value);
      const dest = normalizeFolder(rename.value);
      setRename(undefined);
      reveal(dest);
      setSelectedKey(dest ? `folder:${dest}` : undefined);
      await load();
      say(`✓ Moved ${plural(moved, 'link')} to ${dest || 'the top level'}`);
    } catch (err) {
      setRename((r) => r && { ...r, error: errorText(err) });
    }
  }, [rename, service, reveal, load, say]);

  const activate = useCallback((r: ReferenceRow) => {
    if (r.kind === 'folder') setOpen(r.path, !r.open);
    else openUrl(r.ref.url);
  }, [setOpen]);

  // ── Keyboard (aligned with the TUI's Bookmarks view) ──
  useEffect(() => {
    if (!active || dialog) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (rename) return;
      const k = shortcutKey(e.key);
      // Shift+↑/↓ jumps several rows (more on a tall window).
      const step = e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown') ? jumpStep(Math.floor(window.innerHeight / 20)) : 1;
      if (k === '/') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return; }
      if (k === 'Escape') {
        if (confirmDelete) setConfirmDelete(undefined);
        else if (search) setSearch('');
        return;
      }
      if (k === 'a') { addLink(rowFolder(row)); return; }
      if (k === 's') { cycleSort(); return; }
      if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); select(index + step); return; }
      if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); select(index - step); return; }
      if (k === 'PageDown') { e.preventDefault(); select(index + 10); return; }
      if (k === 'PageUp') { e.preventDefault(); select(index - 10); return; }
      if (!row) return;
      if (k === 'Enter') { e.preventDefault(); activate(row); return; }
      if (row.kind === 'folder') {
        if (k === 'ArrowRight' || k === 'l') {
          if (!row.open) setOpen(row.path, true);
          else if (rows[index + 1]?.depth === row.depth + 1) select(index + 1);
          return;
        }
        if (k === 'ArrowLeft') {
          if (row.open && !search) setOpen(row.path, false);
          else select(parentRowIndex(rows, index));
          return;
        }
        if (k === 'e') { setRename({ from: row.path, value: row.path }); return; }
        if (k === 'd') { say('Folders hold links: move or delete the links, or press e to move the whole folder'); return; }
        return;
      }
      if (k === 'ArrowLeft') { const p = parentRowIndex(rows, index); if (p >= 0) select(p); return; }
      if (k === 'o') { openUrl(row.ref.url); return; }
      if (k === 'y') { copyLink(row.ref); return; }
      if (k === 'e') { editLink(row.ref); return; }
      if (k === 'd') { askDelete(row.ref); return; }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, dialog, rename, row, rows, index, search, confirmDelete, select, setOpen, activate, addLink, editLink, askDelete, copyLink, say, cycleSort]);

  const total = refs?.length ?? 0;
  const matches = search ? rows.filter((r) => r.kind === 'ref').length : undefined;

  return (
    <div className="refs-pane">
      <div className="refs-header">
        <span className="refs-title">
          🔖 Bookmarks <span className="refs-count">· {refs ? plural(total, 'link') : 'loading…'}</span>
        </span>
        <input
          ref={searchRef}
          className="refs-search"
          type="search"
          placeholder="/ search links"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelectedKey(undefined); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur(); }
            else if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.blur(); }
          }}
        />
        {matches !== undefined && <span className="refs-count">{plural(matches, 'match')}</span>}
        <button
          className={['todos-filter-pill', isDefaultSort(REFERENCE_SORTS, sort) ? '' : 'todos-filter-pill--active'].join(' ')}
          onClick={cycleSort}
          title="Change the sort order (s)"
        >
          ↕ {sortLabel(REFERENCE_SORTS, sort)}
        </button>
        <button className="todos-add-btn" onClick={() => addLink(rowFolder(row))}>+ Add link</button>
      </div>

      {message && <p className="refs-message">{message}</p>}
      {error && <p className="todos-error">{error}</p>}

      {rename && (
        <form className="refs-rename" onSubmit={submitRename}>
          <span>Move <strong>{rename.from}/</strong> to</span>
          <input
            autoFocus
            value={rename.value}
            onChange={(e) => setRename({ ...rename, value: e.target.value, error: undefined })}
            onKeyDown={(e) => { if (e.key === 'Escape') setRename(undefined); }}
            list="refs-rename-folders"
            autoComplete="off"
          />
          <datalist id="refs-rename-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
          <button type="submit" className="btn btn--primary">Move</button>
          <button type="button" className="btn" onClick={() => setRename(undefined)}>Cancel</button>
          {rename.error && <span className="ref-dialog__error">⚠ {rename.error}</span>}
        </form>
      )}

      <ul className="refs-tree" role="tree">
        {refs && rows.length === 0 && (
          <li className="todos-empty">
            {search ? `No links match “${search}”.` : 'No bookmarks yet. Press B on any update to file it, or a to add a link.'}
          </li>
        )}
        {rows.map((r, i) => {
          const selected = i === index;
          const className = ['refs-row', `refs-row--${r.kind}`, selected ? 'refs-row--selected' : ''].join(' ');
          const ref = (el: HTMLLIElement | null) => {
            if (el) rowRefs.current.set(r.key, el);
            else rowRefs.current.delete(r.key);
          };
          const style = { paddingLeft: 8 + r.depth * 18 };
          if (r.kind === 'folder') {
            return (
              <li
                key={r.key}
                ref={ref}
                role="treeitem"
                aria-expanded={r.open}
                aria-selected={selected}
                className={className}
                style={style}
                onClick={() => { select(i); setOpen(r.path, !r.open); }}
              >
                <span className="refs-row__caret">{r.open ? '▾' : '▸'}</span>
                <span className="refs-row__folder">{r.name}/</span>
                <span className="refs-row__count">{r.count}</span>
              </li>
            );
          }
          return (
            <li
              key={r.key}
              ref={ref}
              role="treeitem"
              aria-selected={selected}
              className={className}
              style={style}
              onClick={() => select(i)}
              onDoubleClick={() => openUrl(r.ref.url)}
              title={r.ref.url}
            >
              <span className="refs-row__bullet">•</span>
              <span className="refs-row__title">{r.ref.title}</span>
              <span className="refs-row__host">{host(r.ref.url)}</span>
            </li>
          );
        })}
      </ul>

      {row && (
        <div className="refs-details">
          {row.kind === 'folder' ? (
            <>
              <p className="refs-details__title">📁 {row.path}/</p>
              <p className="refs-details__meta">{plural(row.count, 'link')}{search ? ' matching' : ''}</p>
              <div className="refs-details__actions">
                <button className="btn" onClick={() => addLink(row.path)}>a · Add link here</button>
                <button className="btn" onClick={() => setRename({ from: row.path, value: row.path })}>e · Rename / move</button>
              </div>
            </>
          ) : (
            <>
              <p className="refs-details__title">{row.ref.title}</p>
              <a className="refs-details__url" href={row.ref.url} target="_blank" rel="noreferrer noopener">{row.ref.url}</a>
              {row.ref.description && <p className="refs-details__desc">{row.ref.description}</p>}
              <p className="refs-details__meta">
                {row.ref.folder || 'top level'} · filed {row.ref.createdAt.slice(0, 10)}
              </p>
              <div className="refs-details__actions">
                <button className="btn btn--primary" onClick={() => openUrl(row.ref.url)}>o · Open ↗</button>
                <button className="btn" onClick={() => editLink(row.ref)}>e · Edit</button>
                <button className="btn" onClick={() => copyLink(row.ref)}>y · Copy</button>
                <button
                  className={['btn', confirmDelete === row.ref.id ? 'btn--danger' : ''].join(' ')}
                  onClick={() => askDelete(row.ref)}
                >
                  {confirmDelete === row.ref.id ? 'd · Confirm delete' : 'd · Delete'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {dialog && (
        <ReferenceDialog
          service={service}
          reference={dialog.reference}
          initial={dialog.initial}
          folders={folders}
          onSaved={onSaved}
          onClose={() => setDialog(undefined)}
        />
      )}
    </div>
  );
}
