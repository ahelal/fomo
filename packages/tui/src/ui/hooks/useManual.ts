import { useCallback, useState } from 'react';
import type { Key } from 'ink';
import { shortcutKey } from '@fomo/core';
import type { FomoDirectService } from '@fomo/core/service';
import type { AuditLog } from '../../audit.js';
import { editMultiline, editText } from '../editText.js';

interface ManualForm {
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
  onSaved(): Promise<void>;
}

const errorText = (err: unknown) => err instanceof Error ? err.message : String(err);

export function useManual({ service, audit, notify, onSaved }: Options) {
  const [form, setForm] = useState<ManualForm>();
  const open = useCallback(() => {
    setForm({ title: '', body: '', field: 'title', cursor: 0 });
  }, []);

  const save = useCallback(async (current: ManualForm) => {
    if (!current.title.trim() || !current.body.trim()) {
      setForm({ ...current, error: !current.title.trim() ? 'Title is required' : 'Body is required' });
      return;
    }
    setForm({ ...current, saving: true, error: undefined });
    try {
      const saved = await service.createManualEntry({ title: current.title, body: current.body });
      audit.log('manual', `created “${saved.title}”`);
      setForm(undefined);
      await onSaved();
      notify(`✓ Added “${saved.title}” · unread in Manual`);
    } catch (err) {
      audit.error('manual', `save “${current.title}”: ${errorText(err)}`);
      setForm({ ...current, saving: false, error: errorText(err) });
    }
  }, [service, audit, onSaved, notify]);

  const handleInput = (raw: string, key: Key) => {
    const input = shortcutKey(raw);
    if (form && !form.saving) {
      if (key.escape) { setForm(undefined); return; }
      if (key.ctrl && input === 's') { void save(form); return; }
      if (key.tab) {
        setForm({ ...form, field: form.field === 'title' ? 'body' : 'title', cursor: form.field === 'title' ? form.body.length : form.title.length });
        return;
      }
      if (form.field === 'title') {
        const title = editText(form.title, raw, key);
        if (title !== undefined) setForm({ ...form, title, cursor: title.length, error: undefined });
      } else {
        const edited = editMultiline(form.body, form.cursor, raw, key);
        if (edited) setForm({ ...form, body: edited.value, cursor: edited.cursor, error: undefined });
      }
      return;
    }
  };

  return {
    open,
    handleInput,
    view: form,
  };
}

export type ManualViewState = ReturnType<typeof useManual>['view'];
