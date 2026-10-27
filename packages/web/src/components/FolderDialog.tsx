import React, { useEffect, useRef, useState } from 'react';
import { folderColorFallback, folderColorRequest, normalizeFolder, parentFolder, shortcutKey, type DeleteFolderMode, normalizeFolderMetadata, type FolderColorMap, type FolderMetadata, type FolderMetadataMap } from '@fomo/core';
import { useColorPicker } from './ColorPicker.js';
import { ColorField, DialogField, FolderField, ItemDialog } from './ItemDialog.js';
import { errorText, plural, type FolderDeletePrompt } from '../hooks/useFolderTree.js';

interface Props {
  moveFolder(from: string, to: string): Promise<number>;
  saveMetadata(path: string, metadata: FolderMetadata): Promise<FolderMetadataMap>;
  saveColor(path: string, color: string): Promise<FolderColorMap>;
  /** The folder being edited. */
  path: string;
  metadata?: FolderMetadata;
  folders: readonly string[];
  folderColors: FolderColorMap;
  /** Saved: `path` is where the folder is now. */
  onSaved(path: string, moved: number | undefined): void;
  onMoved?(path: string): void;
  onClose(): void;
}

export function FolderMetadataEditor({ path, metadata, onSave }: {
  path: string;
  metadata?: FolderMetadata;
  onSave(metadata: FolderMetadata): void;
}) {
  const [localPath, setLocalPath] = useState(metadata?.localPath ?? '');
  const [githubRepo, setGithubRepo] = useState(metadata?.githubRepo ?? '');
  const [copyMessage, setCopyMessage] = useState('');
  const savedPath = metadata?.localPath;
  useEffect(() => {
    setLocalPath(metadata?.localPath ?? '');
    setGithubRepo(metadata?.githubRepo ?? '');
  }, [path, metadata?.localPath, metadata?.githubRepo]);
  return (
    <form className="folder-metadata" onSubmit={(e) => {
      e.preventDefault();
      onSave({ localPath, githubRepo });
    }}>
      <label>Local directory
        <input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/path/to/folder" />
      </label>
      <label>GitHub repository
        <input value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} placeholder="owner/repo" />
      </label>
      {savedPath && (
        <button type="button" className="btn" onClick={() => {
          if (!navigator.clipboard?.writeText) { setCopyMessage('Clipboard access is unavailable in this browser'); return; }
          void navigator.clipboard.writeText(savedPath).then(
            () => setCopyMessage('Path copied'),
            (err: unknown) => setCopyMessage(`Copy failed: ${err instanceof Error ? err.message : String(err)}`),
          );
        }}>Copy path</button>
      )}
      {metadata?.githubRepo && (
        <a href={`https://github.com/${metadata.githubRepo}`} target="_blank" rel="noopener noreferrer">Open {metadata.githubRepo}</a>
      )}
      <button type="submit" className="btn">Save folder metadata</button>
      <span className="folder-metadata__hint">Metadata only; FOMO does not access this directory or repository.</span>
      {copyMessage && <span className="folder-metadata__hint">{copyMessage}</span>}
    </form>
  );
}

/** Shared folder editor for Todos and Bookmarks. */
export function FolderDialog({ moveFolder, saveMetadata, saveColor, path, metadata, folders, folderColors, onSaved, onMoved, onClose }: Props) {
  const [currentPath, setCurrentPath] = useState(path);
  const [movedCount, setMovedCount] = useState<number | undefined>();
  const [location, setLocation] = useState(path);
  const [localPath, setLocalPath] = useState(metadata?.localPath ?? '');
  const [githubRepo, setGithubRepo] = useState(metadata?.githubRepo ?? '');
  const [color, setColor] = useState(folderColors[path] ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const picker = useColorPicker();

  async function submit() {
    if (saving) return;
    const dest = normalizeFolder(location);
    let next: FolderMetadata;
    try {
      next = normalizeFolderMetadata({ localPath, githubRepo });
    } catch (err) {
      setError(errorText(err));
      return;
    }
    const hasMetadata = !!(next.localPath || next.githubRepo);
    if (!dest && (hasMetadata || color)) { setError('The top level has no folder metadata or color — give the folder a name'); return; }
    const before = normalizeFolderMetadata(metadata ?? {});
    const metadataChanged = (before.localPath ?? '') !== (next.localPath ?? '') || (before.githubRepo ?? '') !== (next.githubRepo ?? '');
    setSaving(true);
    setError(undefined);
    const colorChanged = color !== (folderColors[currentPath] ?? '');
    let current = currentPath;
    let moved = movedCount;
    try {
      if (dest !== current) {
        moved = await moveFolder(current, dest);
        current = dest;
        setCurrentPath(current);
        setMovedCount(moved);
        onMoved?.(current);
      }
      if (metadataChanged && current) await saveMetadata(current, next);
      if (colorChanged && current) await saveColor(current, color);
      onSaved(current, moved);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  const change = (set: (value: string) => void) => (value: string) => {
    set(value);
    setError(undefined);
  };

  return (
    <ItemDialog
      title={`✓ Edit folder ${currentPath}/`}
      note="Renaming moves the folder with its subfolders and contents. The directory and repository are metadata only; FOMO does not access them."
      error={error}
      saving={saving}
      picker={picker}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      <FolderField value={location} folders={folders} folderColors={folderColors} onChange={change(setLocation)} autoFocus />
      <DialogField label="Local directory (optional)">
        <input value={localPath} onChange={(e) => change(setLocalPath)(e.target.value)} placeholder="/path/to/folder" autoComplete="off" spellCheck={false} />
      </DialogField>
      <DialogField label="GitHub repository (optional)">
        <input value={githubRepo} onChange={(e) => change(setGithubRepo)(e.target.value)} placeholder="owner/repo" autoComplete="off" spellCheck={false} />
      </DialogField>
      <ColorField
        color={color}
        {...folderColorFallback(location, folderColors)}
        onClick={() => picker.open({
          ...folderColorRequest({ path: location, onPick: change(setColor) }, folderColors),
          color,
        })}
      />
    </ItemDialog>
  );
}

/**
 * How to delete a folder (d on a folder): p moves its contents up into the parent folder, a deletes
 * everything in it, Esc cancels. No key reaches the app behind it.
 */
export function DeleteFolderDialog({ prompt, noun, onDelete, onClose }: {
  prompt: FolderDeletePrompt;
  noun: readonly [string, string];
  onDelete(mode: DeleteFolderMode): void;
  onClose(): void;
}) {
  const latest = useRef({ prompt, onDelete, onClose });
  latest.current = { prompt, onDelete, onClose };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = shortcutKey(e.key);
      const { prompt: p, onDelete: del, onClose: close } = latest.current;
      if (k === 'Escape') { e.preventDefault(); close(); }
      else if (k === 'p' || k === 'a') {
        e.preventDefault();
        if (!e.repeat && !p.busy) del(k === 'p' ? 'parent' : 'all');
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  const parent = parentFolder(prompt.path);
  const inside = [plural(prompt.count, noun), ...(prompt.subfolders ? [plural(prompt.subfolders, ['subfolder', 'subfolders'])] : [])].join(' and ');
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-panel item-dialog" role="dialog" aria-label={`Delete ${prompt.path}/`} onClick={(e) => e.stopPropagation()}>
        <div className="help-panel__header">
          <h2>Delete {prompt.path}/</h2>
          <button type="button" className="btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="item-dialog__note">It holds {inside}. What should happen to them?</p>
        {prompt.error && <p className="item-dialog__error" role="alert">⚠ {prompt.error}</p>}
        <div className="item-dialog__actions">
          <span className="item-dialog__hint"><kbd>p</kbd> move up · <kbd>a</kbd> delete all · <kbd>Esc</kbd> cancel</span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" disabled={prompt.busy} onClick={() => onDelete('parent')}>
            p · Move contents to {parent ? `${parent}/` : 'the top level'}
          </button>
          <button type="button" className="btn btn--danger" disabled={prompt.busy} onClick={() => onDelete('all')}>
            a · Delete all
          </button>
        </div>
      </div>
    </div>
  );
}
