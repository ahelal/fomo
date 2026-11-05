import React, { useCallback, useEffect, useState } from 'react';
import { formatDate, type FomoService, type Update } from '@fomo/core';
import { DialogField, ItemDialog } from './ItemDialog.js';

interface Draft {
  title: string;
  body: string;
}

function ManualDialog({ service, entry, onSaved, onClose }: {
  service: FomoService;
  entry?: Update;
  onSaved(): void;
  onClose(): void;
}) {
  const [values, setValues] = useState<Draft>(() => ({ title: entry?.title ?? '', body: entry?.content ?? '' }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      if (entry) await service.updateManualEntry(entry.id, values);
      else await service.createManualEntry(values);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <ItemDialog
      title={`📖 ${entry ? 'Edit manual entry' : 'Add to Learning Manual'}`}
      error={error}
      saving={saving}
      multiline
      picker={{ active: false, element: null }}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <DialogField label="Title">
        <input autoFocus value={values.title} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} required />
      </DialogField>
      <DialogField label="Body">
        <textarea value={values.body} onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))} rows={10} required />
      </DialogField>
    </ItemDialog>
  );
}

/** User-authored learning entries, also listed as unread Manual updates when created. */
export function ManualPane({ service, onDialogOpenChange }: { service: FomoService; onDialogOpenChange(open: boolean): void }) {
  const [entries, setEntries] = useState<Update[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [dialog, setDialog] = useState<Update | null | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await service.listManualEntries();
      setEntries(next);
      setSelectedId((id) => id && next.some((entry) => entry.id === id) ? id : next[0]?.id);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => { void load(); }, [load]);

  const selected = entries.find((entry) => entry.id === selectedId);
  const openDialog = (entry?: Update) => {
    setDialog(entry ?? null);
    onDialogOpenChange(true);
  };
  const closeDialog = () => {
    setDialog(undefined);
    onDialogOpenChange(false);
  };

  async function remove(entry: Update) {
    if (confirmDelete !== entry.id) { setConfirmDelete(entry.id); return; }
    try {
      await service.deleteManualEntry(entry.id);
      setConfirmDelete(undefined);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="tree-pane manual-pane">
      <div className="tree-header">
        <span className="tree-title">📖 Learning Manual <span className="tree-count">· {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span></span>
        <button type="button" className="tree-add" onClick={() => openDialog()}>+ Add entry</button>
      </div>
      {error && <p className="tree-error" role="alert">⚠ {error}</p>}
      <div className="manual-pane__body">
        <ul className="tree" aria-label="Learning Manual entries">
          {!loading && entries.length === 0 && <li className="tree-empty">No entries yet. Add a title and body to start your manual.</li>}
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={`tree-row tree-row--item${entry.id === selectedId ? ' tree-row--selected' : ''}`}
              aria-current={entry.id === selectedId ? 'true' : undefined}
              onClick={() => { setSelectedId(entry.id); setConfirmDelete(undefined); }}
            >
              <span className="manual-pane__status" title={entry.status}>{entry.status === 'unread' ? '●' : '○'}</span>
              <span className="manual-pane__title">{entry.title}</span>
              <span className="tree-row__count">{formatDate(entry.dateAdded)}</span>
            </li>
          ))}
          {loading && <li className="tree-empty">Loading…</li>}
        </ul>
        {selected && (
          <section className="manual-pane__detail" aria-label={selected.title}>
            <p className="tree-details__title">{selected.title}</p>
            <p className="manual-pane__content">{selected.content}</p>
            <p className="tree-details__meta">Manual · {selected.status} · added {formatDate(selected.dateAdded)}</p>
            <div className="tree-details__actions">
              <button type="button" className="btn" onClick={() => openDialog(selected)}>Edit</button>
              <button type="button" className="btn" onClick={() => void remove(selected)}>
                {confirmDelete === selected.id ? 'Confirm delete' : 'Delete'}
              </button>
            </div>
          </section>
        )}
      </div>
      {dialog !== undefined && (
        <ManualDialog
          service={service}
          entry={dialog ?? undefined}
          onSaved={() => { closeDialog(); void load(); }}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
