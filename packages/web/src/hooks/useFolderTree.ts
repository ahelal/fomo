import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_FOLDER_COLOR,
  folderColor,
  folderColorFallback,
  folderColorRequest,
  folderPaths,
  folderTreeStep,
  isInFolder,
  itemColorFallback,
  itemColorRequest,
  jumpStep,
  normalizeFolder,
  searchTerms,
  setFolderColor,
  shortcutKey,
  type FolderColorMap,
  type FolderTreeKey,
  type FolderTreeRow,
} from '@fomo/core';
import { useColorPicker } from '../components/ColorPicker.js';

/** Something filed in a folder tree (a bookmark, a todo). */
export interface FolderItem {
  id: string;
  folder: string;
  color?: string;
}

export interface FolderTreeOptions<T extends FolderItem> {
  /** What one and several items are called (`link`, `links`). */
  noun: readonly [string, string];
  itemKey(item: T): string;
  /** An item's name in messages and the color picker. */
  itemName(item: T): string;
  /** The rows shown; must keep its identity while the order and filter stay the same (useCallback). */
  buildRows(items: T[], expanded: ReadonlySet<string>, search: string): FolderTreeRow<T>[];
  fetch(): Promise<{ items: T[]; folderColors?: FolderColorMap }>;
  moveFolder(from: string, to: string): Promise<number>;
  saveFolderColor(folder: string, color: string): Promise<FolderColorMap>;
  saveItemColor(item: T, color: string): Promise<unknown>;
  remove(item: T): Promise<void>;
}

export interface FolderRename {
  from: string;
  value: string;
  error?: string;
}

/** The pane's status line: a delete waiting for confirmation (`warn`), an error, something done (`ok`) or a note. */
export interface TreeStatus {
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'error';
}

/** A pane's own keys, tried before the shared ones (`key` from shortcutKey); true when it used the key. */
export type PaneKeyHandler<T> = (key: string, row: FolderTreeRow<T> | undefined, e: KeyboardEvent) => boolean;

const PAGE = 10;
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'OS']);

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `3 links`, `1 link`. */
export function plural(n: number, [one, many]: readonly [string, string]): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Keys typed into a field, or meant for a focused button or link, aren't shortcuts. */
function ownedByTarget(e: KeyboardEvent): boolean {
  const el = e.target instanceof HTMLElement ? e.target : null;
  if (!el) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return true;
  return (e.key === 'Enter' || e.key === ' ') && el.closest('button, a[href]') !== null;
}

/**
 * A folder tree of items in the web app, shared by Bookmarks and Todos, the same as the TUI's:
 * selection, open and closed folders, search (/), renaming or moving a folder (e), deleting an
 * item (d twice) and colors (c, in the color picker popup). Call `load` to (re)load the items, and
 * route keys to `handleKey` (see useWindowKeys).
 */
export function useFolderTree<T extends FolderItem>(options: FolderTreeOptions<T>) {
  const cfg = useRef(options);
  cfg.current = options;
  const { buildRows } = options;
  /** Undefined until loaded. */
  const [items, setItems] = useState<T[] | undefined>();
  const [folderColors, setFolderColors] = useState<FolderColorMap>({});
  const [error, setError] = useState<string | undefined>();
  /** Folders are open unless collapsed. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearchText] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [rename, setRename] = useState<FolderRename | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const picker = useColorPicker();
  const searchRef = useRef<HTMLInputElement>(null);
  const rowEls = useRef(new Map<string, HTMLElement>());
  /** Where the selection was, for when its row goes away (deleted, filtered out). */
  const lastIndex = useRef(0);

  const folders = useMemo(() => folderPaths(items ?? []), [items]);
  const expanded = useMemo(() => new Set(folders.filter((f) => !collapsed.has(f))), [folders, collapsed]);
  const rows = useMemo(() => buildRows(items ?? [], expanded, search), [buildRows, items, expanded, search]);
  const searching = searchTerms(search).length > 0;

  const found = selectedKey ? rows.findIndex((r) => r.key === selectedKey) : -1;
  const index = rows.length === 0 ? -1 : found >= 0 ? found : Math.min(lastIndex.current, rows.length - 1);
  lastIndex.current = Math.max(0, index);
  const row: FolderTreeRow<T> | undefined = rows[index];

  useEffect(() => {
    if (row) rowEls.current.get(row.key)?.scrollIntoView({ block: 'nearest' });
  }, [row?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const timer = useRef<ReturnType<typeof setTimeout>>();
  const say = useCallback((msg: string, ms = 3000) => {
    setMessage(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(undefined), ms);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const fail = useCallback((err: unknown) => say(`Error: ${errorText(err)}`, 5000), [say]);

  const load = useCallback(async () => {
    try {
      const { items: list, folderColors: colors } = await cfg.current.fetch();
      setItems(list);
      setFolderColors(colors ?? {});
      setError(undefined);
    } catch (err) {
      setError(errorText(err));
      setItems((list) => list ?? []);
    }
  }, []);

  const select = useCallback((i: number) => {
    const next = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (next) setSelectedKey(next.key);
    setConfirmDelete(undefined);
  }, [rows]);

  /** Keep the row with `key` selected as the rows change (a new order, a status change). */
  const keep = useCallback((key: string | undefined) => { if (key) setSelectedKey(key); }, []);

  const setSearch = useCallback((text: string) => {
    setSearchText(text);
    setSelectedKey(undefined);
    lastIndex.current = 0;
  }, []);

  const setOpen = useCallback((path: string, open: boolean) => {
    setCollapsed((prev) => {
      if (prev.has(path) === !open) return prev;
      const next = new Set(prev);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** Open `folder` and the folders above it. */
  const openTo = useCallback((folder: string) => {
    setCollapsed((prev) => new Set([...prev].filter((f) => !isInFolder(folder, f))));
  }, []);

  /** Open the folders of `item` and select it (once it's listed). */
  const reveal = useCallback((item: T) => {
    openTo(item.folder);
    setSelectedKey(cfg.current.itemKey(item));
  }, [openTo]);


  /** The color an item shows: its own, else its folder's. */
  const colorOf = useCallback((item: T) => item.color || folderColor(folderColors, item.folder), [folderColors]);
  /** The color a folder shows: its own, a parent's, else the default. */
  const folderColorOf = useCallback((path: string) => folderColor(folderColors, path) ?? DEFAULT_FOLDER_COLOR, [folderColors]);
  /** A folder's ColorButton props: its own color and what it shows without one. */
  const folderColorButton = useCallback(
    (path: string) => ({ color: folderColors[path] ?? '', ...folderColorFallback(path, folderColors) }),
    [folderColors],
  );
  /** The ColorButton props of an item (or a form) in `folder`. */
  const itemColorButton = useCallback(
    (folder: string, color: string | undefined) => ({ color: color ?? '', ...itemColorFallback(folder, folderColors) }),
    [folderColors],
  );

  const pickFolderColor = (path: string) => {
    const own = folderColors[path] ?? '';
    const onPick = (color: string) => {
      if (color === own) return;
      setFolderColors((map) => setFolderColor(map, path, color));
      say(color ? `✓ Colored ${path}/` : `✓ ${path}/ has no color of its own now`);
      cfg.current.saveFolderColor(path, color).then(setFolderColors, (err) => {
        fail(err);
        void load();
      });
    };
    picker.open(folderColorRequest({ path, onPick }, folderColors));
  };

  const pickItemColor = (item: T) => {
    const own = item.color ?? '';
    const name = cfg.current.itemName(item);
    const onPick = (color: string) => {
      if (color === own) return;
      setItems((list) => list?.map((i) => (i.id === item.id ? { ...i, color: color || undefined } : i)));
      say(color ? `✓ Colored “${name}”` : `✓ “${name}” has no color of its own now`);
      cfg.current.saveItemColor(item, color).catch((err) => {
        fail(err);
        void load();
      });
    };
    picker.open(itemColorRequest({ title: `“${name}”`, sample: name, folder: item.folder, color: own, onPick }, folderColors));
  };

  const startRename = useCallback((path: string) => setRename({ from: path, value: path }), []);
  const editRename = useCallback((value: string) => setRename((r) => r && { ...r, value, error: undefined }), []);
  const cancelRename = useCallback(() => setRename(undefined), []);

  const submitRename = async () => {
    if (!rename) return;
    const { from, value } = rename;
    try {
      const moved = await cfg.current.moveFolder(from, value);
      const dest = normalizeFolder(value);
      setRename(undefined);
      openTo(dest);
      setSelectedKey(dest ? `folder:${dest}` : undefined);
      await load();
      say(`✓ Moved ${plural(moved, cfg.current.noun)} to ${dest || 'the top level'}`);
    } catch (err) {
      setRename((r) => r && { ...r, error: errorText(err) });
    }
  };

  const doDelete = (item: T) => {
    const { itemKey, itemName, remove } = cfg.current;
    const i = rows.findIndex((r) => r.key === itemKey(item));
    // Select the row after it (else the one before), not the top.
    const next = rows[i + 1] ?? rows[i - 1];
    if (next) setSelectedKey(next.key);
    setConfirmDelete(undefined);
    setItems((list) => list?.filter((x) => x.id !== item.id));
    say(`Deleted “${itemName(item)}”`);
    remove(item).catch(fail).finally(() => void load());
  };

  /** d twice deletes an item: the first press (or click) arms it. */
  const askDelete = (item: T, armed = confirmDelete) => {
    if (armed === item.id) { doDelete(item); return; }
    setConfirmDelete(item.id);
    setMessage(undefined);
  };

  /** What the status line shows: the delete waiting for a second d, else the last message. */
  const armedItem = confirmDelete ? items?.find((i) => i.id === confirmDelete) : undefined;
  const status: TreeStatus | undefined = armedItem
    ? { text: `d again to delete “${cfg.current.itemName(armedItem)}” · any other key keeps it`, tone: 'warn' }
    : message
      ? { text: message, tone: message.startsWith('Error') ? 'error' : message.startsWith('✓') ? 'ok' : 'info' }
      : undefined;

  /** Runs the shortcut for a key: true when it was one, so the browser leaves the key alone. */
  const runKey = (e: KeyboardEvent, onKey?: PaneKeyHandler<T>): boolean => {
    const k = shortcutKey(e.key);
    if (rename) {
      if (k !== 'Escape') return false;
      setRename(undefined);
      return true;
    }
    // A held d mustn't confirm its own delete.
    if (k === 'd' && e.repeat) return true;
    // Any key but the second d leaves a delete unconfirmed.
    const armed = confirmDelete;
    if (armed) setConfirmDelete(undefined);

    if (k === '/') {
      searchRef.current?.focus();
      searchRef.current?.select();
      return true;
    }
    if (k === 'Escape') {
      if (armed) return true;
      if (!search) return false;
      setSearch('');
      say('Search cleared');
      return true;
    }
    // Shift+↑/↓ jumps several rows (more on a tall window).
    const step = e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown') ? jumpStep(Math.floor(window.innerHeight / 20)) : 1;
    const moveBy = k === 'j' || k === 'ArrowDown' ? step : k === 'k' || k === 'ArrowUp' ? -step : k === 'PageDown' ? PAGE : k === 'PageUp' ? -PAGE : 0;
    if (moveBy) {
      select(index + moveBy);
      return true;
    }
    if (onKey?.(k, row, e)) return true;
    if (!row) return false;

    // ↵ on a folder, → / l and ← move around the tree.
    const move: FolderTreeKey | undefined =
      k === 'Enter' && row.kind === 'folder' ? 'toggle' : k === 'ArrowRight' || k === 'l' ? 'in' : k === 'ArrowLeft' ? 'out' : undefined;
    if (move) {
      const nav = folderTreeStep(rows, index, move, searching);
      if (nav?.kind === 'select') select(nav.index);
      else if (nav) setOpen(nav.path, nav.kind === 'open');
      return true;
    }

    if (row.kind === 'folder') {
      if (k === 'e') startRename(row.path);
      else if (k === 'c') pickFolderColor(row.path);
      else if (k === 'd') say(`Folders go away with their last ${cfg.current.noun[0]} — rename (e) to merge one into another`, 4000);
      else return false;
      return true;
    }
    if (k === 'c') pickItemColor(row.item);
    else if (k === 'd') askDelete(row.item, armed);
    else return false;
    return true;
  };

  /** A key in the pane: moving around first, then the pane's own keys (`onKey`), then the tree's. */
  const handleKey = (e: KeyboardEvent, onKey?: PaneKeyHandler<T>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || MODIFIER_KEYS.has(e.key) || picker.active || ownedByTarget(e)) return;
    if (runKey(e, onKey)) e.preventDefault();
  };

  /** Registers a row's element, to scroll the selection into view. */
  const rowRef = useCallback((key: string) => (el: HTMLElement | null) => {
    if (el) rowEls.current.set(key, el);
    else rowEls.current.delete(key);
  }, []);

  return {
    /** Undefined until loaded. */
    items,
    setItems,
    error,
    folders,
    folderColors,
    rows,
    /** The selected row's index (-1 with no rows). */
    index,
    row,
    search,
    setSearch,
    searching,
    searchRef,
    select,
    keep,
    setOpen,
    reveal,
    rename,
    startRename,
    editRename,
    cancelRename,
    submitRename,
    confirmDelete,
    askDelete,
    status,
    say,
    fail,
    load,
    colorOf,
    folderColorOf,
    folderColorButton,
    itemColorButton,
    pickFolderColor,
    pickItemColor,
    /** Render `picker.element`; `picker.open` opens the color picker popup. */
    picker,
    handleKey,
    rowRef,
  };
}

export type FolderTree<T extends FolderItem> = ReturnType<typeof useFolderTree<T>>;
