import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Key } from 'ink';
import {
  folderColor,
  folderColorRequest,
  folderPaths,
  folderTreeStep,
  isInFolder,
  itemColorRequest,
  normalizeFolder,
  searchTerms,
  setFolderColor,
  shortcutKey,
  type FolderColorMap,
  type FolderRow,
  type FolderTreeKey,
  type FolderTreeRow,
} from '@fomo/core';
import type { AuditLog } from '../../audit.js';
import { editText } from '../editText.js';
import type { OpenColorPicker } from './useColorPicker.js';

/** Something filed in a folder tree (a bookmark, a todo). */
export interface FolderItem {
  id: string;
  folder: string;
  color?: string;
}

export interface FolderTreeOptions<T extends FolderItem> {
  /** Area for the audit log (`reference`, `todo`). */
  area: string;
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
  /** Opens the color picker (c); without it, colors can't be changed. */
  pickColor?: OpenColorPicker;
  /** Color of a folder when neither it nor a parent has one. */
  defaultFolderColor: string;
  /** Color an item shows when neither it nor its folders have one. */
  defaultItemColor: string;
  audit: AuditLog;
  /** Shows a short message in the status bar, so the tree below never shifts. */
  notify(message: string, ms?: number): void;
  /** Rows Shift+↑/↓ moves (5, or 10 on a tall terminal). */
  jump: number;
}

export interface FolderRename {
  from: string;
  value: string;
  error?: string;
}

/** Handles a view's own keys before the shared ones; returns true when it used the key. */
export type TreeKeyHandler<T> = (input: string, key: Key, row: FolderTreeRow<T> | undefined) => boolean;

const PAGE = 10;
export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * A folder tree of items, shared by Bookmarks and Todos: loading, selection, open and closed
 * folders, search (/), renaming or moving a folder (e), deleting an item (d twice) and colors (c).
 */
export function useFolderTree<T extends FolderItem>(options: FolderTreeOptions<T>) {
  const cfg = useRef(options);
  cfg.current = options;
  const { buildRows } = options;
  const [items, setItems] = useState<T[]>([]);
  const [folderColors, setFolderColors] = useState<FolderColorMap>({});
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  /** Folders are open unless collapsed. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState<string | undefined>();
  const [rename, setRename] = useState<FolderRename | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  /** Row to select once the rows are rebuilt (after a save, rename or new order). */
  const pendingKey = useRef<string | undefined>();
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const folders = useMemo(() => folderPaths(items), [items]);
  const expanded = useMemo(() => new Set(folders.filter((f) => !collapsed.has(f))), [folders, collapsed]);
  const rows = useMemo(() => buildRows(items, expanded, search), [buildRows, items, expanded, search]);

  useEffect(() => {
    if (pendingKey.current) {
      const idx = rows.findIndex((r) => r.key === pendingKey.current);
      if (idx >= 0) {
        pendingKey.current = undefined;
        setSelectedIndex(idx);
        return;
      }
    }
    setSelectedIndex((i) => Math.min(i, Math.max(0, rows.length - 1)));
  }, [rows]);

  const say = useCallback((msg: string, ms = 2500) => cfg.current.notify(msg, ms), []);

  const fail = useCallback((what: string, err: unknown) => {
    cfg.current.audit.error(cfg.current.area, `${what}: ${errorText(err)}`);
    say(`Error: ${errorText(err)}`, 5000);
  }, [say]);

  const load = useCallback(async (): Promise<T[]> => {
    setLoading(true);
    try {
      const { items: list, folderColors: colors } = await cfg.current.fetch();
      setItems(list);
      setFolderColors(colors ?? {});
      return list;
    } catch (err) {
      fail('load', err);
      return itemsRef.current;
    } finally {
      setLoading(false);
    }
  }, [fail]);

  /** Open the folders of `item` and select it once it's listed. */
  const reveal = useCallback((item: T) => {
    setCollapsed((c) => new Set([...c].filter((f) => !isInFolder(item.folder, f))));
    pendingKey.current = cfg.current.itemKey(item);
  }, []);

  /** Keep the row with `key` selected when the rows are rebuilt (e.g. in a new order). */
  const keep = useCallback((key: string | undefined) => { pendingKey.current = key; }, []);

  /** Drop prompts that are half typed (search, rename, delete). */
  const reset = useCallback(() => {
    setRename(undefined);
    setSearchDraft(undefined);
    setConfirmDelete(undefined);
  }, []);

  /** The color an item shows: its own, else its folder's. */
  const colorOf = useCallback((item: T) => item.color || folderColor(folderColors, item.folder), [folderColors]);

  const pickFolderColor = (row: FolderRow) => {
    const { pickColor, saveFolderColor, defaultFolderColor } = cfg.current;
    if (!pickColor) return;
    const own = folderColors[row.path] ?? '';
    const onPick = (color: string) => {
      if (color === own) return;
      setFolderColors((map) => setFolderColor(map, row.path, color));
      say(color ? `✓ Colored ${row.path}/` : `✓ ${row.path}/ has no color of its own now`);
      saveFolderColor(row.path, color).then(setFolderColors, (err) => {
        fail(`color “${row.path}”`, err);
        void load();
      });
    };
    pickColor(folderColorRequest({ path: row.path, onPick }, folderColors, defaultFolderColor));
  };

  const pickItemColor = (item: T) => {
    const { pickColor, saveItemColor, itemName, defaultItemColor } = cfg.current;
    if (!pickColor) return;
    const own = item.color ?? '';
    const name = itemName(item);
    const onPick = (color: string) => {
      if (color === own) return;
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, color: color || undefined } : i)));
      say(color ? `✓ Colored “${name}”` : `✓ “${name}” has no color of its own now`);
      saveItemColor(item, color).catch((err) => {
        fail(`color “${name}”`, err);
        void load();
      });
    };
    pickColor(itemColorRequest({ title: `“${name}”`, sample: name, folder: item.folder, color: own, onPick }, folderColors, defaultItemColor));
  };

  const doRename = async (from: string, to: string) => {
    const { moveFolder, noun, area, audit } = cfg.current;
    try {
      const moved = await moveFolder(from, to);
      const dest = normalizeFolder(to);
      setRename(undefined);
      pendingKey.current = dest ? `folder:${dest}` : undefined;
      await load();
      say(`✓ Moved ${moved} ${moved === 1 ? noun[0] : noun[1]} to ${dest || 'the top level'}`);
    } catch (err) {
      audit.error(area, `rename “${from}”: ${errorText(err)}`);
      setRename((r) => r && { ...r, error: errorText(err) });
    }
  };

  const doDelete = (item: T) => {
    const { remove, itemName } = cfg.current;
    setItems((list) => list.filter((i) => i.id !== item.id));
    say(`Deleted “${itemName(item)}”`);
    void remove(item)
      .catch((err) => fail(`delete “${itemName(item)}”`, err))
      .then(() => load());
  };

  /**
   * A key in the tree: `onKey` (the view's own keys) goes first, after prompts being typed and
   * moving around. Escape cancels prompts or clears the search, never leaves the tab.
   */
  const handleInput = (raw: string, key: Key, onKey?: TreeKeyHandler<T>): void => {
    if (searchDraft !== undefined) {
      if (key.escape) setSearchDraft(undefined);
      else if (key.return) { setSearch(searchDraft.trim()); setSearchDraft(undefined); setSelectedIndex(0); }
      else {
        const next = editText(searchDraft, raw, key);
        if (next !== undefined) setSearchDraft(next);
      }
      return undefined;
    }
    if (rename) {
      if (key.escape) setRename(undefined);
      else if (key.return) void doRename(rename.from, rename.value);
      else {
        const next = editText(rename.value, raw, key);
        if (next !== undefined) setRename({ ...rename, value: next, error: undefined });
      }
      return undefined;
    }

    const input = shortcutKey(raw);
    const row = rows[selectedIndex];
    const armed = confirmDelete;
    setConfirmDelete(undefined);

    if (key.escape || key.backspace || key.delete) {
      if (search && key.escape) { setSearch(''); say('Search cleared'); return undefined; }
      return;
    }
    const last = Math.max(0, rows.length - 1);
    const step = key.shift && (key.upArrow || key.downArrow) ? cfg.current.jump : 1;
    if (key.upArrow || input === 'k') { setSelectedIndex((i) => Math.max(0, i - step)); return undefined; }
    if (key.downArrow || input === 'j') { setSelectedIndex((i) => Math.min(last, i + step)); return undefined; }
    if (key.pageUp) { setSelectedIndex((i) => Math.max(0, i - PAGE)); return undefined; }
    if (key.pageDown) { setSelectedIndex((i) => Math.min(last, i + PAGE)); return undefined; }
    if (input === '/') { setSearchDraft(search); return undefined; }
    if (onKey?.(input, key, row) || !row) return undefined;

    // ↵ on a folder, → / l and ← move around the tree.
    const move: FolderTreeKey | undefined =
      key.return && row.kind === 'folder' ? 'toggle' : key.rightArrow || input === 'l' ? 'in' : key.leftArrow ? 'out' : undefined;
    if (move) {
      const nav = folderTreeStep(rows, selectedIndex, move, searchTerms(search).length > 0);
      if (nav?.kind === 'select') setSelectedIndex(nav.index);
      else if (nav) {
        const { path } = nav;
        const open = nav.kind === 'open';
        setCollapsed((c) => {
          const next = new Set(c);
          if (open) next.delete(path);
          else next.add(path);
          return next;
        });
      }
      return undefined;
    }

    if (row.kind === 'folder') {
      if (input === 'e') setRename({ from: row.path, value: row.path });
      else if (input === 'c') pickFolderColor(row);
      else if (input === 'd') say(`Folders go away with their last ${cfg.current.noun[0]} — rename (e) to merge one into another`);
      return undefined;
    }

    const { item } = row;
    if (input === 'c') pickItemColor(item);
    else if (input === 'd') {
      if (armed === item.id) doDelete(item);
      else { setConfirmDelete(item.id); say(`d again to delete “${cfg.current.itemName(item)}”`, 4000); }
    }
    return undefined;
  };

  return {
    items,
    setItems,
    folders,
    folderColors,
    rows,
    selectedIndex,
    say,
    fail,
    load,
    reveal,
    keep,
    reset,
    colorOf,
    handleInput,
    /** Keys are text (search or rename prompt). */
    typing: rename !== undefined || searchDraft !== undefined,
    view: {
      rows,
      total: items.length,
      selectedIndex,
      loading,
      search,
      searchDraft,
      rename,
      confirmDelete,
      folderColors,
      defaultFolderColor: options.defaultFolderColor,
    },
  };
}

export type FolderTreeView<T extends FolderItem> = ReturnType<typeof useFolderTree<T>>['view'];
