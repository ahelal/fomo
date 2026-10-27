import { useCallback, useState } from 'react';
import type { Key } from 'ink';
import { folderColorRequest, normalizeFolder, normalizeFolderMetadata, type FolderColorMap, type FolderMetadata, type FolderMetadataMap } from '@fomo/core';
import type { AuditLog } from '../../audit.js';
import { editText } from '../editText.js';
import { errorText } from './useFolderTree.js';
import type { OpenColorPicker } from './useColorPicker.js';

type FolderEditField = 'name' | 'localPath' | 'githubRepo' | 'color';
const FIELDS: FolderEditField[] = ['name', 'localPath', 'githubRepo', 'color'];

export interface FolderEditForm {
  path: string;
  field: FolderEditField;
  values: Record<FolderEditField, string>;
  saving?: boolean;
  error?: string;
}

interface Options {
  area: string;
  noun: readonly [string, string];
  folderMetadata: FolderMetadataMap;
  folderColors: FolderColorMap;
  moveFolder(from: string, to: string): Promise<number>;
  saveMetadata(path: string, metadata: FolderMetadata): Promise<FolderMetadataMap>;
  saveColor(path: string, color: string): Promise<FolderColorMap>;
  revealFolder(path: string): void;
  load(): Promise<unknown>;
  say(message: string): void;
  audit: AuditLog;
  pickColor?: OpenColorPicker;
}

/** Shared draft and keyboard behavior for editing folders in Bookmarks and Todos. */
export function useFolderEditor(options: Options) {
  const [form, setForm] = useState<FolderEditForm>();
  const { folderColors, folderMetadata, moveFolder, saveMetadata, saveColor, revealFolder, load, say, audit, area, noun, pickColor } = options;
  const close = useCallback(() => setForm(undefined), []);

  const open = (path: string, field: FolderEditField = 'name') => {
    const metadata = folderMetadata[path];
    setForm({ path, field, values: {
      name: path, localPath: metadata?.localPath ?? '', githubRepo: metadata?.githubRepo ?? '', color: folderColors[path] ?? '',
    } });
  };

  const save = async (current: FolderEditForm) => {
    if (current.saving) return;
    const dest = normalizeFolder(current.values.name);
    let next: FolderMetadata;
    try {
      next = normalizeFolderMetadata({ localPath: current.values.localPath, githubRepo: current.values.githubRepo });
    } catch (err) {
      setForm({ ...current, error: errorText(err) });
      return;
    }
    if (!dest && (next.localPath || next.githubRepo || current.values.color)) {
      setForm({ ...current, field: 'name', error: 'The top level has no folder metadata or color — give the folder a name' });
      return;
    }
    const before = normalizeFolderMetadata(folderMetadata[current.path] ?? {});
    const metadataChanged = (before.localPath ?? '') !== (next.localPath ?? '') || (before.githubRepo ?? '') !== (next.githubRepo ?? '');
    const colorChanged = current.values.color !== (folderColors[current.path] ?? '');
    setForm({ ...current, saving: true, error: undefined });
    let path = current.path;
    let moved: number | undefined;
    try {
      if (dest !== path) {
        moved = await moveFolder(path, dest);
        path = dest;
      }
      if (metadataChanged && path) await saveMetadata(path, next);
      if (colorChanged && path) await saveColor(path, current.values.color);
      setForm(undefined);
      revealFolder(path);
      await load();
      say(moved === undefined ? `✓ Saved ${path}/` : `✓ Moved ${moved} ${moved === 1 ? noun[0] : noun[1]} to ${path || 'the top level'}`);
    } catch (err) {
      audit.error(area, `edit folder “${current.path}”: ${errorText(err)}`);
      if (path !== current.path) {
        revealFolder(path);
        void load();
      }
      setForm((f) => f && {
        ...f, path, values: { ...f.values, name: path !== current.path ? path : f.values.name }, saving: false, error: errorText(err),
      });
    }
  };

  const handleInput = (raw: string, key: Key) => {
    if (!form || form.saving) return;
    if (key.escape) { close(); return; }
    if (form.field === 'color') {
      if (key.return || raw === ' ') {
        if (pickColor) pickColor({
          ...folderColorRequest({
            path: form.values.name,
            onPick: (color) => setForm((f) => f && {
              ...f, field: 'name', values: { ...f.values, color }, error: undefined,
            }),
          }, folderColors),
          color: form.values.color,
        });
        return;
      }
      if (key.backspace || key.delete || (key.ctrl && raw === 'u')) {
        setForm({ ...form, values: { ...form.values, color: '' }, error: undefined });
        return;
      }
    }
    if ((key.ctrl && raw === 's') || key.return) { void save(form); return; }
    if (key.tab || key.upArrow || key.downArrow) {
      const back = (key.tab && key.shift) || key.upArrow;
      const i = FIELDS.indexOf(form.field);
      const field = FIELDS[(i + (back ? FIELDS.length - 1 : 1)) % FIELDS.length]!;
      setForm({ ...form, field, error: undefined });
      return;
    }
    if (form.field === 'color') return;
    const next = editText(form.values[form.field], raw, key);
    if (next !== undefined) setForm({ ...form, values: { ...form.values, [form.field]: next }, error: undefined });
  };

  return { form, open, close, handleInput };
}
