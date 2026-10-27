import React, { useCallback, useEffect, useState } from 'react';
import {
  REFERENCE_SORTS,
  buildReferenceRows,
  formatDate,
  isDefaultSort,
  nextSort,
  rowFolder,
  sortLabel,
  type FomoService,
  type FolderMetadataMap,
  type Reference,
  type ReferenceSort,
} from '@fomo/core';
import { ColorButton } from './ColorPicker.js';
import { ReferenceDialog, type ReferenceDraft } from './ReferenceDialog.js';
import { DeleteFolderDialog, FolderDialog, FolderMetadataEditor } from './FolderDialog.js';
import { DeleteButton, FolderDetails, FolderTreeList, Pill, RenameBar, TreeMessage, TreeSearch } from './FolderTree.js';
import { plural, useFolderTree, type PaneKeyHandler } from '../hooks/useFolderTree.js';
import { useWindowKeys } from '../hooks/useKeys.js';

interface Props {
  service: FomoService;
  /** Keyboard shortcuts are on (no overlay is open above the pane). */
  active: boolean;
}

interface DialogState {
  reference?: Reference;
  initial?: Partial<ReferenceDraft>;
}

const NOUN = ['link', 'links'] as const;

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function openUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** The Bookmarks sort survives closing the pane, but not a reload. */
let lastSort: ReferenceSort | undefined;

/** Links filed into folders: browse the tree, search, add, edit, color, move folders and delete. */
export function ReferencesPane({ service, active }: Props) {
  const [dialog, setDialog] = useState<DialogState | undefined>();
  const [folderDialog, setFolderDialog] = useState<string | undefined>();
  const [sort, setSort] = useState<ReferenceSort | undefined>(lastSort);
  const buildRows = useCallback(
    (refs: Reference[], expanded: ReadonlySet<string>, search: string, metadata?: FolderMetadataMap) => buildReferenceRows(refs, expanded, search, sort, metadata),
    [sort],
  );
  const tree = useFolderTree<Reference>({
    noun: NOUN,
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
  });
  const { load, say, row, rows, search, items } = tree;

  useEffect(() => { void load(); }, [load, service]);

  const addLink = (folder: string) => setDialog({ initial: { folder } });
  const editLink = (reference: Reference) => setDialog({ reference });

  const cycleSort = () => {
    tree.keep(row?.key);
    const next = nextSort(REFERENCE_SORTS, sort);
    setSort((lastSort = next));
    say(`Sort: ${next.label}`);
  };

  const copyLink = (ref: Reference) => {
    if (!navigator.clipboard) { say('Copying needs a secure (https) page'); return; }
    navigator.clipboard.writeText(ref.url).then(() => say('✓ Copied the link'), () => say('Could not copy the link'));
  };

  const onKey: PaneKeyHandler<Reference> = (k, r) => {
    if (k === 'a') { addLink(rowFolder(r)); return true; }
    if (k === 's') { cycleSort(); return true; }
    if (r?.kind === 'folder' && (k === 'Enter' || k === 'e' || k === 'm')) { setFolderDialog(r.path); return true; }
    if (r?.kind !== 'item') return false;
    if (k === 'o') { openUrl(r.item.url); return true; }
    if (k === 'y') { copyLink(r.item); return true; }
    if (k === 'e' || k === 'Enter') { editLink(r.item); return true; }
    return false;
  };
  useWindowKeys(active && !dialog && folderDialog === undefined, (e) => tree.handleKey(e, onKey));

  const onSaved = useCallback((saved: Reference, created: boolean) => {
    setDialog(undefined);
    tree.reveal(saved);
    void load();
    say(`✓ ${created ? 'Filed' : 'Updated'} in ${saved.folder || 'the top level'}`);
  }, [tree.reveal, load, say]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = tree.searching ? rows.filter((r) => r.kind === 'item').length : undefined;

  return (
    <div className="tree-pane">
      <div className="tree-header">
        <span className="tree-title">
          🔖 Bookmarks <span className="tree-count">· {items ? plural(items.length, NOUN) : 'loading…'}</span>
        </span>
        <TreeSearch inputRef={tree.searchRef} value={search} placeholder="/ search links" matches={matches} onChange={tree.setSearch} />
        <Pill active={!isDefaultSort(REFERENCE_SORTS, sort)} title="Change the order of the links (s)" onClick={cycleSort}>
          ↕ {sortLabel(REFERENCE_SORTS, sort)}
        </Pill>
        <button type="button" className="tree-add" onClick={() => addLink(rowFolder(row))}>+ Add link</button>
      </div>

      <TreeMessage status={tree.status} />
      {tree.error && <p className="tree-error">⚠ {tree.error}</p>}

      {tree.rename && (
        <RenameBar
          rename={tree.rename}
          folders={tree.folders}
          onChange={tree.editRename}
          onSubmit={() => void tree.submitRename()}
          onCancel={tree.cancelRename}
        />
      )}

      <FolderTreeList<Reference>
        label="Bookmarks"
        rows={rows}
        index={tree.index}
        empty={items && (search ? `No links match “${search}”.` : 'No bookmarks yet. Press B on any update to file it, or a to add a link.')}
        folderColorOf={tree.folderColorOf}
        rowRef={tree.rowRef}
        onSelect={tree.select}
        onToggle={tree.setOpen}
        onActivate={editLink}
        itemTitle={(ref) => ref.url}
        renderItem={(ref) => {
          const color = tree.colorOf(ref);
          return (
            <>
              <span className="ref-row__bullet" style={color ? { color } : undefined} aria-hidden="true">{color ? '●' : '•'}</span>
              <span className="ref-row__title" style={color ? { color } : undefined}>{ref.title}</span>
              <span className="ref-row__host">{host(ref.url)}</span>
            </>
          );
        }}
      />

      {row && (
        <div className="tree-details">
          {row.kind === 'folder' ? (
            <FolderDetails
              path={row.path}
              color={tree.folderColorOf(row.path)}
              colorButton={tree.folderColorButton(row.path)}
              meta={`${plural(row.count, NOUN)}${tree.searching ? ' matching' : ''}`}
              onColor={() => tree.pickFolderColor(row.path)}
            >
              <button type="button" className="btn" onClick={() => addLink(row.path)}>a · Add link here</button>
              <button type="button" className="btn" onClick={() => setFolderDialog(row.path)}>↵ · Edit folder</button>
              <button type="button" className="btn" onClick={() => tree.startFolderDelete(row.path)}>d · Delete folder</button>
              <FolderMetadataEditor key={row.path} path={row.path} metadata={tree.folderMetadata[row.path]}
                onSave={(metadata) => tree.saveFolderMetadata(row.path, metadata)} />
            </FolderDetails>
          ) : (
            <>
              <p className="tree-details__title" style={tree.colorOf(row.item) ? { color: tree.colorOf(row.item) } : undefined}>{row.item.title}</p>
              <a className="tree-details__url" href={row.item.url} target="_blank" rel="noreferrer noopener">{row.item.url}</a>
              {row.item.description && <p className="tree-details__desc">{row.item.description}</p>}
              <p className="tree-details__meta">{row.item.folder || 'top level'} · filed {formatDate(row.item.createdAt)}</p>
              <div className="tree-details__actions">
                <button type="button" className="btn btn--primary" onClick={() => openUrl(row.item.url)}>o · Open ↗</button>
                <button type="button" className="btn" onClick={() => editLink(row.item)}>e · Edit</button>
                <button type="button" className="btn" onClick={() => copyLink(row.item)}>y · Copy</button>
                <ColorButton
                  {...tree.itemColorButton(row.item.folder, row.item.color)}
                  title="c · Color the link"
                  onClick={() => tree.pickItemColor(row.item)}
                />
                <DeleteButton armed={tree.confirmDelete === row.item.id} onClick={() => tree.askDelete(row.item)} />
              </div>
            </>
          )}
        </div>
      )}

      {dialog && (
        <ReferenceDialog
          service={service}
          reference={dialog.reference}
          initial={dialog.initial}
          folders={tree.folders}
          folderColors={tree.folderColors}
          onSaved={onSaved}
          onClose={() => setDialog(undefined)}
        />
      )}
      {tree.picker.element}
      {tree.folderDelete && (
        <DeleteFolderDialog
          prompt={tree.folderDelete}
          noun={NOUN}
          onDelete={(mode) => void tree.submitFolderDelete(mode)}
          onClose={tree.cancelFolderDelete}
        />
      )}
      {folderDialog !== undefined && (
        <FolderDialog
          moveFolder={(from, to) => service.moveReferenceFolder(from, to)}
          saveMetadata={(path, metadata) => service.setReferenceFolderMetadata(path, metadata)}
          saveColor={(path, color) => service.setReferenceFolderColor(path, color)}
          path={folderDialog}
          metadata={tree.folderMetadata[folderDialog]}
          folders={tree.folders}
          folderColors={tree.folderColors}
          onMoved={(path) => { tree.revealFolder(path); void load(); }}
          onSaved={(path, moved) => {
            setFolderDialog(undefined);
            tree.revealFolder(path);
            void load();
            say(moved === undefined ? `✓ Saved ${path}/` : `✓ Moved ${plural(moved, NOUN)} to ${path || 'the top level'}`);
          }}
          onClose={() => setFolderDialog(undefined)}
        />
      )}
    </div>
  );
}
