import React, { useEffect, useRef, useState } from 'react';
import {
  itemColorFallback,
  itemColorRequest,
  normalizeFolder,
  referenceFolders,
  type FolderColorMap,
  type FomoService,
  type Reference,
} from '@fomo/core';
import { useColorPicker } from './ColorPicker.js';
import { ColorField, DialogField, FolderField, ItemDialog } from './ItemDialog.js';
import { errorText } from '../hooks/useFolderTree.js';

export interface ReferenceDraft {
  title: string;
  url: string;
  folder: string;
  description: string;
  /** `#rrggbb`, or '' for none (it shows its folder's). */
  color: string;
}

interface Props {
  service: FomoService;
  /** The reference being edited; a new one is filed otherwise. */
  reference?: Reference;
  /** Starting values for a new reference. */
  initial?: Partial<ReferenceDraft>;
  /** The feed update a new reference is filed from. */
  updateId?: string;
  /** Folders to suggest and their colors; loaded from the store when omitted. */
  folders?: readonly string[];
  folderColors?: FolderColorMap;
  note?: string;
  onSaved(ref: Reference, created: boolean): void;
  onClose(): void;
}

/** Add or edit a reference: title, URL, folder (nested with `/`), description and color. */
export function ReferenceDialog({ service, reference, initial, updateId, folders: givenFolders, folderColors: givenColors, note, onSaved, onClose }: Props) {
  const [values, setValues] = useState<ReferenceDraft>(() => ({
    title: reference?.title ?? initial?.title ?? '',
    url: reference?.url ?? initial?.url ?? '',
    folder: reference?.folder ?? initial?.folder ?? '',
    description: reference?.description ?? initial?.description ?? '',
    color: reference?.color ?? initial?.color ?? '',
  }));
  const [loaded, setLoaded] = useState<{ folders: string[]; folderColors: FolderColorMap }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const picker = useColorPicker();
  const urlRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const folders = givenFolders ?? loaded?.folders ?? [];
  const folderColors = givenColors ?? loaded?.folderColors ?? {};

  useEffect(() => {
    if (givenFolders) return;
    let live = true;
    service.listReferences()
      .then(({ references, folderColors: colors }) => {
        if (live) setLoaded({ folders: referenceFolders(references), folderColors: colors ?? {} });
      })
      .catch(() => { /* suggestions only */ });
    return () => { live = false; };
  }, [service, givenFolders]);

  // Start where there is something to decide: the URL for a new link, otherwise the folder.
  useEffect(() => {
    (values.url ? folderRef.current : urlRef.current)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (field: keyof ReferenceDraft) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setError(undefined);
  };
  const onInput = (field: keyof ReferenceDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(field)(e.target.value);

  const pickColor = () => {
    const title = values.title.trim();
    picker.open(itemColorRequest({
      title: title ? `“${title}”` : 'this link',
      sample: title || values.url.trim() || 'Link',
      folder: values.folder,
      color: values.color,
      onPick: set('color'),
    }, folderColors));
  };

  async function submit() {
    if (saving) return;
    if (!values.url.trim()) { setError('URL is required'); return; }
    setSaving(true);
    setError(undefined);
    try {
      const { color, ...fields } = values;
      const req = { ...fields, folder: normalizeFolder(fields.folder) };
      const saved = reference
        ? await service.updateReference(reference.id, { ...req, color })
        : await service.createReference({ ...req, updateId, ...(color ? { color } : {}) });
      onSaved(saved, !reference);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <ItemDialog
      title={`🔖 ${reference ? 'Edit bookmark' : 'File in Bookmarks'}`}
      note={note}
      error={error}
      saving={saving}
      picker={picker}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <DialogField label="Title">
        <input value={values.title} onChange={onInput('title')} placeholder="Defaults to the URL" />
      </DialogField>
      <DialogField label="URL">
        <input ref={urlRef} value={values.url} onChange={onInput('url')} placeholder="https://…" inputMode="url" required />
      </DialogField>
      <FolderField value={values.folder} folders={folders} folderColors={folderColors} inputRef={folderRef} onChange={set('folder')} />
      <DialogField label="Description">
        <textarea value={values.description} onChange={onInput('description')} rows={3} placeholder="Why it's worth keeping (optional)" />
      </DialogField>
      <ColorField color={values.color} {...itemColorFallback(values.folder, folderColors)} onClick={pickColor} />
    </ItemDialog>
  );
}
