import React, { useState } from 'react';
import type { FomoService } from '@fomo/core';
import { DialogField, ItemDialog } from './ItemDialog.js';

export function ManualDialog({ service, onSaved, onClose }: {
  service: FomoService;
  onSaved(): void;
  onClose(): void;
}) {
  const [values, setValues] = useState({ title: '', body: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await service.createManualEntry(values);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <ItemDialog
      title="Add manual item"
      note="Source: Manual · starts unread"
      error={error}
      saving={saving}
      multiline
      picker={{ active: false, element: null }}
      onSubmit={() => void submit()}
      onClose={() => { if (!saving) onClose(); }}
    >
      <DialogField label="Title">
        <input autoFocus value={values.title} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} required disabled={saving} />
      </DialogField>
      <DialogField label="Body">
        <textarea value={values.body} onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))} rows={10} required disabled={saving} />
      </DialogField>
    </ItemDialog>
  );
}
