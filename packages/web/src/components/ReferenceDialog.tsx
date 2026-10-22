import React, { useEffect, useRef, useState } from 'react';
import { normalizeFolder, referenceFolders, type FomoService, type Reference } from '@fomo/core';

export interface ReferenceDraft {
  title: string;
  url: string;
  folder: string;
  description: string;
}

interface Props {
  service: FomoService;
  /** The reference being edited; a new one is filed otherwise. */
  reference?: Reference;
  /** Starting values for a new reference. */
  initial?: Partial<ReferenceDraft>;
  /** The feed update a new reference is filed from. */
  updateId?: string;
  /** Folders to suggest; loaded from the store when omitted. */
  folders?: string[];
  note?: string;
  onSaved(ref: Reference, created: boolean): void;
  onClose(): void;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Add or edit a reference: title, URL, folder (nested with `/`) and description. */
export function ReferenceDialog({ service, reference, initial, updateId, folders: givenFolders, note, onSaved, onClose }: Props) {
  const [values, setValues] = useState<ReferenceDraft>(() => ({
    title: reference?.title ?? initial?.title ?? '',
    url: reference?.url ?? initial?.url ?? '',
    folder: reference?.folder ?? initial?.folder ?? '',
    description: reference?.description ?? initial?.description ?? '',
  }));
  const [folders, setFolders] = useState<string[]>(givenFolders ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const formRef = useRef<HTMLFormElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (givenFolders) return;
    let live = true;
    service.listReferences()
      .then(({ references }) => { if (live) setFolders(referenceFolders(references)); })
      .catch(() => { /* suggestions only */ });
    return () => { live = false; };
  }, [service, givenFolders]);

  // Start where there is something to decide: the URL for a new link, otherwise the folder.
  useEffect(() => {
    (values.url ? folderRef.current : firstRef.current)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Capture so the app's shortcuts don't run while typing in the dialog.
    const handler = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      const target = e.target as HTMLElement;
      if (e.key === 'Enter' && !e.shiftKey && target.tagName === 'TEXTAREA') {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const set = (field: keyof ReferenceDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    setError(undefined);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!values.url.trim()) { setError('URL is required'); return; }
    setSaving(true);
    setError(undefined);
    try {
      const req = { ...values, folder: normalizeFolder(values.folder) };
      const saved = reference
        ? await service.updateReference(reference.id, req)
        : await service.createReference({ ...req, updateId });
      onSaved(saved, !reference);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <div className="help-overlay" onClick={onClose}>
      <form ref={formRef} className="help-panel ref-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="help-panel__header">
          <h2>🔖 {reference ? 'Edit bookmark' : 'File in Bookmarks'}</h2>
          <button type="button" className="btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {note && <p className="ref-dialog__note">{note}</p>}
        <label className="ref-dialog__field">
          <span>Title</span>
          <input value={values.title} onChange={set('title')} placeholder="Defaults to the URL" />
        </label>
        <label className="ref-dialog__field">
          <span>URL</span>
          <input ref={firstRef} value={values.url} onChange={set('url')} placeholder="https://…" inputMode="url" required />
        </label>
        <label className="ref-dialog__field">
          <span>Folder</span>
          <input
            ref={folderRef}
            value={values.folder}
            onChange={set('folder')}
            placeholder="Top level — nest with /, e.g. ai/agents"
            list="ref-dialog-folders"
            autoComplete="off"
          />
          <datalist id="ref-dialog-folders">
            {folders.map((f) => <option key={f} value={f} />)}
          </datalist>
        </label>
        <label className="ref-dialog__field">
          <span>Description</span>
          <textarea value={values.description} onChange={set('description')} rows={3} placeholder="Why it's worth keeping (optional)" />
        </label>
        {error && <p className="ref-dialog__error">⚠ {error}</p>}
        <div className="ref-dialog__actions">
          <span className="ref-dialog__hint"><kbd>↵</kbd> save · <kbd>⇧↵</kbd> new line · <kbd>Esc</kbd> cancel</span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
