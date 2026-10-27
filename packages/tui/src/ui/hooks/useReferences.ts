import { useCallback, useMemo, useRef, useState } from 'react';
import type { Key } from 'ink';
import {
  buildReferenceRows,
  DEFAULT_FOLDER_COLOR,
  DEFAULT_ITEM_COLOR,
  folderMatches,
  isDefaultSort,
  itemColorRequest,
  nextSort,
  normalizeFolder,
  REFERENCE_SORTS,
  rowFolder,
  sortLabel,
  type Reference,
  type FolderMetadataMap,
  type ReferenceSort,
  type ReferenceSuggestion,
  type Update,
} from '@fomo/core';
import type { FomoDirectService, SuggestReferenceRequest } from '@fomo/core/service';
import type { AuditLog } from '../../audit.js';
import { applyFormColor, formKey, type FolderForm } from './folderForm.js';
import { errorText, useFolderTree, type TreeKeyHandler } from './useFolderTree.js';
import type { OpenColorPicker } from './useColorPicker.js';
import { useFolderEditor } from './useFolderEditor.js';

export { folderMatches };

export type RefField = 'title' | 'url' | 'folder' | 'description' | 'color';
/** The form's fields in Tab order; the color comes last so typing a link stays Tab, Tab, ↵. */
export const REF_FIELDS: RefField[] = ['title', 'url', 'folder', 'description', 'color'];

/** Folder color when neither a folder nor its parents have one. */
export const REF_FOLDER_COLOR = DEFAULT_FOLDER_COLOR;
/** A link's color when neither it nor its folders have one. */
export const REF_ITEM_COLOR = DEFAULT_ITEM_COLOR;

export interface RefForm extends FolderForm<RefField> {
  /** The feed update being filed, if any. */
  updateId?: string;
  suggesting: boolean;
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
  openAttachment(target: string): Promise<void>;
  copy(text: string): void;
  /** Opens the color picker popup. */
  pickColor?: OpenColorPicker;
  /** Rows Shift+↑/↓ moves (5, or 10 on a tall terminal). */
  jump: number;
}

function newForm(values: Partial<Record<RefField, string>>, extra: Partial<RefForm> = {}): RefForm {
  const all = { title: '', url: '', folder: '', description: '', color: '', ...values };
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
    { title: ref.title, url: ref.url, folder: ref.folder, description: ref.description, color: ref.color ?? '' },
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
export function useReferences({ service, audit, suggest, notify, openUrl, openAttachment, copy, pickColor, jump }: Options) {
  const [open, setOpen] = useState(false);
  /** Order of links within a folder (cycled with s). */
  const [sort, setSort] = useState<ReferenceSort | undefined>();
  const [form, setForm] = useState<RefForm | undefined>();
  /** Bumped whenever a form opens or closes, so late Copilot replies are dropped. */
  const formSeq = useRef(0);

  const buildRows = useCallback(
    (refs: Reference[], expanded: ReadonlySet<string>, search: string, metadata?: FolderMetadataMap) => buildReferenceRows(refs, expanded, search, sort, metadata),
    [sort],
  );
  const tree = useFolderTree<Reference>({
    area: 'reference',
    noun: ['link', 'links'],
    itemKey: (ref) => `ref:${ref.id}`,
    itemName: (ref) => ref.title,
    buildRows,
    fetch: async () => {
      const { references, folderColors, folderMetadata } = await service.listReferences();
      return { items: references, folderColors, folderMetadata };
    },
    moveFolder: (from, to) => service.moveReferenceFolder(from, to),
    deleteFolder: (folder, mode) => service.deleteReferenceFolder(folder, mode),
    saveFolderColor: (folder, color) => service.setReferenceFolderColor(folder, color),
    saveFolderMetadata: (folder, metadata) => service.setReferenceFolderMetadata(folder, metadata),
    saveItemColor: (ref, color) => service.updateReference(ref.id, { color }),
    remove: (ref) => service.deleteReference(ref.id),
    pickColor,
    defaultFolderColor: REF_FOLDER_COLOR,
    defaultItemColor: REF_ITEM_COLOR,
    audit,
    notify,
    jump,
  });
  const { load, reveal, say, folders, folderColors, folderMetadata } = tree;
  const folderEditor = useFolderEditor({
    area: 'reference', noun: ['link', 'links'], folderMetadata, folderColors, audit, pickColor,
    revealFolder: tree.revealFolder, load, say,
    moveFolder: (from, to) => service.moveReferenceFolder(from, to),
    saveMetadata: (path, metadata) => service.setReferenceFolderMetadata(path, metadata),
    saveColor: (path, color) => service.setReferenceFolderColor(path, color),
  });
  const matches = useMemo(() => (form ? folderMatches(folders, form.folderQuery) : []), [folders, form]);

  const openView = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);

  const closeAll = useCallback(() => {
    formSeq.current++;
    setForm(undefined);
    folderEditor.close();
    tree.reset();
    setOpen(false);
  }, [tree.reset, folderEditor.close]);

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
    const { title, url, folder, description, color } = current.values;
    if (!url.trim()) { setForm({ ...current, error: 'URL is required', field: 'url' }); return; }
    setForm({ ...current, saving: true, error: undefined });
    try {
      const req = { title, url, folder: normalizeFolder(folder), description };
      const saved = current.id
        ? await service.updateReference(current.id, { ...req, color })
        : await service.createReference({ ...req, ...(color ? { color } : {}), updateId: current.updateId });
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

  const pickFormColor = (f: RefForm) => {
    if (!pickColor) return;
    const title = f.values.title.trim();
    pickColor(itemColorRequest({
      title: title ? `“${title}”` : 'this link',
      sample: title || f.values.url.trim() || 'Bookmark',
      folder: f.values.folder,
      color: f.values.color,
      onPick: (color) => setForm((cur) => cur && applyFormColor(cur, REF_FIELDS, color)),
    }, folderColors, REF_ITEM_COLOR));
  };

  const formInput = (f: RefForm, raw: string, key: Key) => {
    const step = formKey(f, REF_FIELDS, matches, raw, key);
    if (!step) return;
    if ('form' in step) { setForm(step.form); return; }
    if (step.action === 'cancel') closeForm(f);
    else if (step.action === 'save') void save(f);
    else if (step.action === 'color') pickFormColor(f);
    else if (step.action === 'suggest' && !f.suggesting) runSuggest(f, true);
  };

  const onKey: TreeKeyHandler<Reference> = (input, key, row) => {
    if (input === 's') {
      const next = nextSort(REFERENCE_SORTS, sort);
      tree.keep(row?.key);
      setSort(next);
      say(`Sort: ${next.label}`);
      return true;
    }
    if (input === 'a') {
      formSeq.current++;
      setForm(newForm({ folder: rowFolder(row) }, { field: 'url', note: suggest ? 'Paste a link, then ^G to let Copilot file it' : undefined }));
      return true;
    }
    if (row?.kind === 'folder' && (key.return || input === 'e' || input === 'm')) {
      folderEditor.open(row.path, input === 'm' ? 'localPath' : 'name');
      return true;
    }
    if (row?.kind === 'folder' && (input === 'o' || input === 'g')) {
      const metadata = folderMetadata[row.path];
      const target = input === 'o' ? metadata?.localPath : metadata?.githubRepo ? `https://github.com/${metadata.githubRepo}` : undefined;
      if (!target) say(input === 'o' ? 'No local directory is associated with this folder' : 'No GitHub repository is associated with this folder');
      else void openAttachment(target).then(() => say(`Opened ${target}`), (err) => tree.fail(`open folder association “${target}”`, err));
      return true;
    }
    if (row?.kind !== 'item') return false;
    const ref = row.item;
    if (input === 'o') {
      openUrl(ref.url).catch((err) => {
        audit.error('open', `${ref.url}: ${errorText(err)}`);
        say('Could not open browser');
      });
      return true;
    }
    if (input === 'y') { copy(ref.url); say('✓ Link copied'); return true; }
    if (input === 'e' || key.return) { formSeq.current++; setForm(editForm(ref)); return true; }
    return false;
  };

  /** Handle a key while Bookmarks (or its form) is shown; `raw` keeps its case for typing. */
  const handleInput = (raw: string, key: Key) => {
    if (folderEditor.form) { folderEditor.handleInput(raw, key); return; }
    if (form) { formInput(form, raw, key); return; }
    tree.handleInput(raw, key, onKey);
  };

  return {
    /** The Bookmarks view or the file-a-link form is shown. */
    active: open || form !== undefined,
    /** Keys are text (form, rename or search prompt), so global keys like q must not fire. */
    typing: form !== undefined || folderEditor.form !== undefined || tree.typing,
    openView,
    close: closeAll,
    fileUpdate,
    handleInput,
    /** The links' sort, when it isn't the default order. */
    sortLabel: isDefaultSort(REFERENCE_SORTS, sort) ? undefined : sortLabel(REFERENCE_SORTS, sort),
    view: {
      ...tree.view,
      form,
      folderMetadataForm: folderEditor.form,
      folderMatches: matches,
      canSuggest: !!suggest,
    },
  };
}

export type ReferencesViewState = ReturnType<typeof useReferences>['view'];
