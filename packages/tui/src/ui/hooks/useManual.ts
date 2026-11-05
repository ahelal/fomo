import { useCallback, useState } from 'react';
import type { Key } from 'ink';
import { MANUAL_SOURCE_ID, shortcutKey, type Update } from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import type { AuditLog } from '../../audit.js';
import { editMultiline, editText } from '../editText.js';

interface ManualForm {
  id?: string;
  title: string;
  body: string;
  field: 'title' | 'body';
  cursor: number;
  error?: string;
  saving?: boolean;
}

interface Options {
  service: FomoDirectService;
  audit: AuditLog;
  notify(message: string, ms?: number): void;
}

const errorText = (err: unknown) => err instanceof Error ? err.message : String(err);

export function useManual({ service, audit, notify }: Options) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Update[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [form, setForm] = useState<ManualForm>();
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (selectId?: string) => {
    setLoading(true);
    try {
      const next = await service.listManualEntries();
      setEntries(next);
      setSelectedIndex(selectId ? Math.max(0, next.findIndex((entry) => entry.id === selectId)) : (i) => Math.min(i, Math.max(0, next.length - 1)));
    } catch (err) {
      audit.error('manual', `load: ${errorText(err)}`);
      notify(`Learning Manual error: ${errorText(err)}`);
    } finally {
      setLoading(false);
    }
  }, [service, audit, notify]);

  const openView = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);

  const close = useCallback(() => {
    setOpen(false);
    setForm(undefined);
    setConfirmDelete(undefined);
  }, []);

  const save = useCallback(async (current: ManualForm) => {
    if (!current.title.trim() || !current.body.trim()) {
      setForm({ ...current, error: !current.title.trim() ? 'Title is required' : 'Body is required' });
      return;
    }
    setForm({ ...current, saving: true, error: undefined });
    try {
      const saved = current.id
        ? await service.updateManualEntry(current.id, { title: current.title, body: current.body })
        : await service.createManualEntry({ title: current.title, body: current.body });
      audit.log('manual', `${current.id ? 'updated' : 'created'} “${saved.title}”`);
      setForm(undefined);
      await load(saved.id);
      notify(`✓ ${current.id ? 'Updated' : 'Added'} “${saved.title}” · unread in Manual`);
    } catch (err) {
      audit.error('manual', `save “${current.title}”: ${errorText(err)}`);
      setForm({ ...current, saving: false, error: errorText(err) });
    }
  }, [service, audit, load, notify]);

  const remove = useCallback(async (entry: Update) => {
    if (confirmDelete !== entry.id) { setConfirmDelete(entry.id); return; }
    try {
      await service.deleteManualEntry(entry.id);
      audit.log('manual', `deleted “${entry.title}”`);
      setConfirmDelete(undefined);
      await load();
    } catch (err) {
      audit.error('manual', `delete “${entry.title}”: ${errorText(err)}`);
      notify(`Learning Manual error: ${errorText(err)}`);
    }
  }, [service, audit, confirmDelete, load, notify]);

  const handleInput = (raw: string, key: Key) => {
    const input = shortcutKey(raw);
    if (form) {
      if (key.escape) { setForm(undefined); return; }
      if (key.ctrl && input === 's') { if (!form.saving) void save(form); return; }
      if (key.tab) {
        setForm({ ...form, field: form.field === 'title' ? 'body' : 'title', cursor: form.field === 'title' ? form.body.length : form.title.length });
        return;
      }
      if (form.field === 'title') {
        const title = editText(form.title, raw, key);
        if (title !== undefined) setForm({ ...form, title, cursor: title.length, error: undefined });
      } else {
        const edited = editMultiline(form.body, form.cursor, raw, key);
        if (edited) setForm({ ...form, ...edited, error: undefined });
      }
      return;
    }
    if (key.escape) { close(); return; }
    if (confirmDelete && input !== 'd') setConfirmDelete(undefined);
    if (input === 'a') { setForm({ title: '', body: '', field: 'title', cursor: 0 }); return; }
    const entry = entries[selectedIndex];
    if (input === 'e' || key.return) {
      if (entry?.source === MANUAL_SOURCE_ID) setForm({ id: entry.id, title: entry.title, body: entry.content, field: 'title', cursor: entry.title.length });
      return;
    }
    if (input === 'd' && entry) { void remove(entry); return; }
    if (input === 'j' || key.downArrow) { setSelectedIndex((i) => Math.max(0, Math.min(i + 1, entries.length - 1))); setConfirmDelete(undefined); return; }
    if (input === 'k' || key.upArrow) { setSelectedIndex((i) => Math.max(0, i - 1)); setConfirmDelete(undefined); }
  };

  return {
    active: open || form !== undefined,
    typing: form !== undefined,
    openView,
    close,
    handleInput,
    view: { entries, selectedIndex, form, confirmDelete, loading },
  };
}

export type ManualViewState = ReturnType<typeof useManual>['view'];
