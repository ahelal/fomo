import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Key } from 'ink';
import {
  buildReferenceRows,
  isDefaultSort,
  isInFolder,
  nextSort,
  normalizeFolder,
  REFERENCE_SORTS,
  parentRowIndex,
  referenceFolders,
  rowFolder,
  searchTerms,
  shortcutKey,
  sortLabel,
  type Reference,
  type ReferenceRow,
  type ReferenceSort,
  type ReferenceSuggestion,
  type Update,
} from '@fomo/core';
import type { FomoDirectService, SuggestReferenceRequest } from '@fomo/core/service';
import type { AuditLog } from '../../audit.js';

export type RefField = 'title' | 'url' | 'folder' | 'description';
export const REF_FIELDS: RefField[] = ['title', 'url', 'folder', 'description'];
/** Existing folders listed under the folder field. */
export const MAX_FOLDER_MATCHES = 6;

export interface RefForm {
  /** Set when editing an existing reference. */
  id?: string;
  /** The feed update being filed, if any. */
  updateId?: string;
  values: Record<RefField, string>;
  field: RefField;
  /** Fields typed in by hand; an automatic Copilot suggestion leaves them alone. */
  touched: ReadonlySet<RefField>;
  /** What was typed into the folder field; ↑↓ pick among existing folders matching it. */
  folderQuery: string;
  /** Index into the folder matches (-1: the typed text). */
  pick: number;
  suggesting: boolean;
  saving: boolean;
  note?: string;
  error?: string;
  /** Opened from the feed (b): closing it returns there instead of to the Bookmarks view. */
  fromFeed: boolean;
}

interface Options {
  service: FomoDirectService;
  audit: AuditLog;
  /** Ask Copilot for a title, folder and description (TUI only); omitted when unavailable. */
  suggest?(req: SuggestReferenceRequest): Promise<ReferenceSuggestion>;
  /** Show a message in the main status bar (used after filing from the feed). */
  notify(message: string, ms?: number): void;
  openUrl(url: string): Promise<void>;
  copy(text: string): void;
  /** Rows Shift+↑/↓ moves (5, or 10 on a tall terminal). */
  jump: number;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const PAGE = 10;

/** Existing folders containing `query` (case-insensitive), closest first. */
export function folderMatches(folders: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const hits = q ? folders.filter((f) => f.toLowerCase().includes(q)) : folders;
  return hits
    .map((f) => ({ f, rank: f.toLowerCase().startsWith(q) ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_FOLDER_MATCHES)
    .map((h) => h.f);
}

/** `value` after a keystroke in a one-line text field, or undefined when the key isn't text. */
export function editText(value: string, input: string, key: Key): string | undefined {
  if (key.backspace || key.delete) return value.slice(0, -1);
  if (key.ctrl && input === 'u') return '';
  if (!input || key.ctrl || key.meta || key.tab || key.escape) return undefined;
  return value + input.replace(/[\r\n]+/g, ' ');
}

function newForm(values: Partial<Record<RefField, string>>, extra: Partial<RefForm> = {}): RefForm {
  const all = { title: '', url: '', folder: '', description: '', ...values };
  return {
    values: all,
    field: 'title',
    touched: new Set(),
    folderQuery: all.folder,
    pick: -1,
    suggesting: false,
    saving: false,
    fromFeed: false,
    ...extra,
  };
}

function editForm(ref: Reference, extra: Partial<RefForm> = {}): RefForm {
  return newForm(
    { title: ref.title, url: ref.url, folder: ref.folder, description: ref.description },
    { id: ref.id, updateId: ref.updateId, field: 'folder', ...extra },
  );
}

function applySuggestion(form: RefForm, s: ReferenceSuggestion, explicit: boolean): RefForm {
  const values = { ...form.values };
  const filled: string[] = [];
  if (s.folder && (explicit || !form.touched.has('folder'))) { values.folder = s.folder; filled.push('folder'); }
  if (s.description && (explicit || !form.touched.has('description'))) { values.description = s.description; filled.push('description'); }
  // Feed items keep their own title; links typed in take Copilot's unless you wrote one.
  if (s.title && !form.touched.has('title') && (!form.updateId || !values.title.trim())) { values.title = s.title; filled.push('title'); }
  return {
    ...form,
    values,
    folderQuery: values.folder,
    pick: -1,
    suggesting: false,
    error: undefined,
    note: filled.length ? `✨ Copilot suggested the ${filled.join(', ')}` : 'Copilot kept what you typed (^G to replace it)',
  };
}

/** State and keys of the Bookmarks view (5) and the file-a-link form (b, a, e). */
export function useReferences({ service, audit, suggest, notify, openUrl, copy, jump }: Options) {
  const [open, setOpen] = useState(false);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  /** Folders are open unless collapsed. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');
  /** Order of links within a folder (cycled with s). */
  const [sort, setSort] = useState<ReferenceSort | undefined>();
  const [searchDraft, setSearchDraft] = useState<string | undefined>();
  const [form, setForm] = useState<RefForm | undefined>();
  const [rename, setRename] = useState<{ from: string; value: string; error?: string } | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  /** Row to select once the rows are rebuilt (after a save or rename). */
  const pendingKey = useRef<string | undefined>();
  /** Bumped whenever a form opens or closes, so late Copilot replies are dropped. */
  const formSeq = useRef(0);
  const refsRef = useRef(refs);
  refsRef.current = refs;

  const folders = useMemo(() => referenceFolders(refs), [refs]);
  const expanded = useMemo(() => new Set(folders.filter((f) => !collapsed.has(f))), [folders, collapsed]);
  const rows = useMemo(() => buildReferenceRows(refs, expanded, search, sort), [refs, expanded, search, sort]);
  const matches = useMemo(() => (form ? folderMatches(folders, form.folderQuery) : []), [folders, form]);

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

  const messageTimer = useRef<ReturnType<typeof setTimeout>>();
  const say = useCallback((msg: string, ms = 2500) => {
    setMessage(msg);
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(undefined), ms);
  }, []);
  useEffect(() => () => clearTimeout(messageTimer.current), []);

  const load = useCallback(async (): Promise<Reference[]> => {
    setLoading(true);
    try {
      const { references } = await service.listReferences();
      setRefs(references);
      return references;
    } catch (err) {
      audit.error('reference', `load: ${errorText(err)}`);
      say(`Error: ${errorText(err)}`, 5000);
      return refsRef.current;
    } finally {
      setLoading(false);
    }
  }, [service, audit, say]);

  /** Reveal a reference: open its folders and select it. */
  const reveal = useCallback((ref: Reference) => {
    setCollapsed((c) => new Set([...c].filter((f) => !isInFolder(ref.folder, f))));
    pendingKey.current = `ref:${ref.id}`;
  }, []);

  const openView = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);

  const closeAll = useCallback(() => {
    formSeq.current++;
    setForm(undefined);
    setRename(undefined);
    setSearchDraft(undefined);
    setConfirmDelete(undefined);
    setOpen(false);
  }, []);

  const runSuggest = useCallback((current: RefForm, explicit: boolean) => {
    if (!suggest) { setForm((f) => f && { ...f, error: 'Copilot is not available' }); return; }
    const req: SuggestReferenceRequest = current.updateId
      ? { updateId: current.updateId }
      : { url: current.values.url, title: current.values.title };
    if (!current.updateId && !current.values.url.trim()) {
      setForm((f) => f && { ...f, error: 'Enter the URL first', field: 'url' });
      return;
    }
    const seq = formSeq.current;
    setForm((f) => f && { ...f, suggesting: true, error: undefined, note: undefined });
    suggest(req).then(
      (s) => { if (formSeq.current === seq) setForm((f) => f && applySuggestion(f, s, explicit)); },
      (err) => {
        audit.error('reference', `Copilot suggestion: ${errorText(err)}`);
        if (formSeq.current === seq) setForm((f) => f && { ...f, suggesting: false, error: `Copilot: ${errorText(err)}` });
      },
    );
  }, [suggest, audit]);

  /** File a feed update (B): a prefilled form; Copilot fills in the folder and description. */
  const fileUpdate = useCallback((update: Update) => {
    const seq = ++formSeq.current;
    const draft = newForm(
      { title: update.title, url: update.url, description: update.gist?.summary ?? update.summary ?? '' },
      { updateId: update.id, field: 'folder', fromFeed: true },
    );
    setForm(draft);
    void load().then((list) => {
      if (formSeq.current !== seq) return;
      const existing = list.find((r) => r.url === update.url || r.updateId === update.id);
      if (existing) {
        setForm(editForm(existing, { fromFeed: true, note: `Already in Bookmarks${existing.folder ? ` → ${existing.folder}` : ''} — editing it` }));
        return;
      }
      if (suggest) runSuggest(draft, false);
    });
  }, [load, suggest, runSuggest]);

  const closeForm = useCallback((current: RefForm) => {
    formSeq.current++;
    setForm(undefined);
    if (current.fromFeed) setOpen(false);
  }, []);

  const save = useCallback(async (current: RefForm) => {
    const { title, url, folder, description } = current.values;
    if (!url.trim()) { setForm({ ...current, error: 'URL is required', field: 'url' }); return; }
    setForm({ ...current, saving: true, error: undefined });
    try {
      const req = { title, url, folder: normalizeFolder(folder), description };
      const saved = current.id
        ? await service.updateReference(current.id, req)
        : await service.createReference({ ...req, updateId: current.updateId });
      const where = saved.folder || 'top level';
      closeForm(current);
      if (current.fromFeed) {
        notify(`🔖 ${current.id ? 'Updated' : 'Filed'} in Bookmarks → ${where}`, 4000);
        void load();
      } else {
        reveal(saved);
        await load();
        say(`✓ ${current.id ? 'Updated' : 'Filed'} in ${where}`);
      }
    } catch (err) {
      audit.error('reference', `save “${title}”: ${errorText(err)}`);
      setForm((f) => f && { ...f, saving: false, error: errorText(err) });
    }
  }, [service, audit, closeForm, notify, load, reveal, say]);

  const formInput = (f: RefForm, input: string, key: Key) => {
    if (key.escape) { closeForm(f); return; }
    if (f.saving) return;
    if (key.return) { void save(f); return; }
    if (key.ctrl && input === 'g') { if (!f.suggesting) runSuggest(f, true); return; }
    const move = (dir: 1 | -1) => {
      const i = REF_FIELDS.indexOf(f.field);
      setForm({ ...f, field: REF_FIELDS[(i + dir + REF_FIELDS.length) % REF_FIELDS.length]!, pick: -1, folderQuery: f.values.folder });
    };
    if (key.tab) { move(key.shift ? -1 : 1); return; }
    if (f.field === 'folder' && (key.upArrow || key.downArrow) && matches.length > 0) {
      const pick = key.downArrow ? Math.min(matches.length - 1, f.pick + 1) : Math.max(-1, f.pick - 1);
      const folder = pick === -1 ? f.folderQuery : matches[pick]!;
      setForm({ ...f, pick, values: { ...f.values, folder }, touched: new Set([...f.touched, 'folder']) });
      return;
    }
    if (key.upArrow) { move(-1); return; }
    if (key.downArrow) { move(1); return; }
    const next = editText(f.values[f.field], input, key);
    if (next === undefined) return;
    setForm({
      ...f,
      values: { ...f.values, [f.field]: next },
      touched: new Set([...f.touched, f.field]),
      ...(f.field === 'folder' ? { folderQuery: next, pick: -1 } : {}),
      error: undefined,
    });
  };

  const doRename = async (from: string, to: string) => {
    try {
      const moved = await service.moveReferenceFolder(from, to);
      const dest = normalizeFolder(to);
      setRename(undefined);
      pendingKey.current = dest ? `folder:${dest}` : undefined;
      await load();
      say(`✓ Moved ${moved} link${moved === 1 ? '' : 's'} to ${dest || 'the top level'}`);
    } catch (err) {
      audit.error('reference', `rename “${from}”: ${errorText(err)}`);
      setRename((r) => r && { ...r, error: errorText(err) });
    }
  };

  const doDelete = (ref: Reference) => {
    setRefs((list) => list.filter((r) => r.id !== ref.id));
    say(`Deleted “${ref.title}”`);
    void service.deleteReference(ref.id)
      .catch((err) => {
        audit.error('reference', `delete “${ref.title}”: ${errorText(err)}`);
        say(`Error: ${errorText(err)}`, 5000);
      })
      .then(() => load());
  };

  const open_ = (ref: Reference) => {
    openUrl(ref.url)
      .catch((err) => {
        audit.error('open', `${ref.url}: ${errorText(err)}`);
        say('Could not open browser');
      });
  };

  /** Handle a key while Bookmarks (or its form) is shown; `raw` keeps its case for typing. */
  const handleInput = (raw: string, key: Key) => {
    if (form) { formInput(form, raw, key); return; }

    if (searchDraft !== undefined) {
      if (key.escape) { setSearchDraft(undefined); return; }
      if (key.return) { setSearch(searchDraft.trim()); setSearchDraft(undefined); setSelectedIndex(0); return; }
      const next = editText(searchDraft, raw, key);
      if (next !== undefined) setSearchDraft(next);
      return;
    }

    if (rename) {
      if (key.escape) { setRename(undefined); return; }
      if (key.return) { void doRename(rename.from, rename.value); return; }
      const next = editText(rename.value, raw, key);
      if (next !== undefined) setRename({ ...rename, value: next, error: undefined });
      return;
    }

    const input = shortcutKey(raw);
    const row: ReferenceRow | undefined = rows[selectedIndex];
    const armed = confirmDelete;
    setConfirmDelete(undefined);

    if (key.escape || key.backspace || key.delete) {
      if (search && key.escape) { setSearch(''); say('Search cleared'); return; }
      closeAll();
      return;
    }
    if (input === '5') { closeAll(); return; }
    const last = Math.max(0, rows.length - 1);
    const step = key.shift && (key.upArrow || key.downArrow) ? jump : 1;
    if (key.upArrow || input === 'k') { setSelectedIndex((i) => Math.max(0, i - step)); return; }
    if (key.downArrow || input === 'j') { setSelectedIndex((i) => Math.min(last, i + step)); return; }
    if (key.pageUp) { setSelectedIndex((i) => Math.max(0, i - PAGE)); return; }
    if (key.pageDown) { setSelectedIndex((i) => Math.min(last, i + PAGE)); return; }
    if (input === '/') { setSearchDraft(search); return; }
    if (input === 's') {
      const next = nextSort(REFERENCE_SORTS, sort);
      pendingKey.current = row?.key;
      setSort(next);
      say(`Sort: ${next.label}`);
      return;
    }
    if (input === 'a') {
      formSeq.current++;
      setForm(newForm({ folder: rowFolder(row) }, { field: 'url', note: suggest ? 'Paste a link, then ^G to let Copilot file it' : undefined }));
      return;
    }
    if (!row) return;

    if (row.kind === 'folder') {
      const toggle = (openIt: boolean) =>
        setCollapsed((c) => {
          const next = new Set(c);
          if (openIt) next.delete(row.path);
          else next.add(row.path);
          return next;
        });
      if (searchTerms(search).length > 0 && (key.return || key.leftArrow || key.rightArrow || input === 'l')) return;
      if (key.return) { toggle(!row.open); return; }
      if (key.rightArrow || input === 'l') { toggle(true); return; }
      if (key.leftArrow) {
        if (row.open) toggle(false);
        else { const p = parentRowIndex(rows, selectedIndex); if (p >= 0) setSelectedIndex(p); }
        return;
      }
      if (input === 'e') { setRename({ from: row.path, value: row.path }); return; }
      if (input === 'd') { say('Folders go away with their last link — rename (e) to merge one into another'); return; }
      return;
    }

    const ref = row.ref;
    if (key.leftArrow) { const p = parentRowIndex(rows, selectedIndex); if (p >= 0) setSelectedIndex(p); return; }
    if (key.return || input === 'o') { open_(ref); return; }
    if (input === 'y') { copy(ref.url); say('✓ Link copied'); return; }
    if (input === 'e') { formSeq.current++; setForm(editForm(ref)); return; }
    if (input === 'd') {
      if (armed === ref.id) doDelete(ref);
      else { setConfirmDelete(ref.id); say(`d again to delete “${ref.title}”`, 4000); }
      return;
    }
  };

  return {
    /** The Bookmarks view or the file-a-link form is shown. */
    active: open || form !== undefined,
    /** Keys are text (form, rename or search prompt), so global keys like q must not fire. */
    typing: form !== undefined || rename !== undefined || searchDraft !== undefined,
    openView,
    close: closeAll,
    fileUpdate,
    handleInput,
    /** The links' sort, when it isn't the default order. */
    sortLabel: isDefaultSort(REFERENCE_SORTS, sort) ? undefined : sortLabel(REFERENCE_SORTS, sort),
    view: {
      rows,
      total: refs.length,
      selectedIndex,
      loading,
      search,
      searchDraft,
      form,
      folderMatches: matches,
      rename,
      confirmDelete,
      message,
      canSuggest: !!suggest,
    },
  };
}

export type ReferencesViewState = ReturnType<typeof useReferences>['view'];
