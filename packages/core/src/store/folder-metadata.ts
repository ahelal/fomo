import type { TableClient, TableEntity } from '@azure/data-tables';
import { createTableClient } from './connection.js';
import { isTableError } from './tables.js';
import { deleteFolderEntries, moveFolderMetadata, normalizeFolder, normalizeFolderMetadata } from '../folders.js';
import type { DeleteFolderMode, FolderMetadata, FolderMetadataMap, StoreConnection } from '../types.js';

const METADATA_PK = 'folder';
const METADATA_RK = 'metadata';
const ATTEMPTS = 4;

type MetadataEntity = TableEntity<{ data: string }>;

function parseMetadata(data: string | undefined): FolderMetadataMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data ?? '{}');
  } catch (err) {
    throw new Error(`Invalid folder metadata stored in Azure Table Storage: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid folder metadata stored in Azure Table Storage');
  const metadata: FolderMetadataMap = {};
  for (const [path, value] of Object.entries(parsed)) {
    if (!path || !value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Invalid folder metadata stored for ${path || '(empty folder)'}`);
    }
    const clean = normalizeFolderMetadata(value as FolderMetadata);
    const folder = normalizeFolder(path);
    if (folder && (clean.localPath || clean.githubRepo)) metadata[folder] = clean;
  }
  return metadata;
}

/** Optional metadata for a folder tree, stored next to its items. */
export class FolderMetadataStore {
  private readonly client: TableClient;

  constructor(conn: StoreConnection, table: string) {
    this.client = createTableClient(conn, table);
  }

  async get(): Promise<FolderMetadataMap> {
    return (await this.read()).metadata;
  }

  set(folder: string, value: FolderMetadata): Promise<FolderMetadataMap> {
    const path = normalizeFolder(folder);
    if (!path) throw new Error('The top level has no folder metadata');
    const clean = normalizeFolderMetadata(value);
    return this.change((metadata) => {
      const next = { ...metadata };
      if (clean.localPath || clean.githubRepo) next[path] = clean;
      else delete next[path];
      return next;
    });
  }

  move(from: string, to: string): Promise<FolderMetadataMap> {
    return this.change((metadata) => moveFolderMetadata(metadata, from, to));
  }

  async assertCanMove(from: string, to: string): Promise<void> {
    moveFolderMetadata(await this.get(), from, to);
  }

  /** Drop the metadata of deleted folder `path` (see `DeleteFolderMode`). */
  delete(path: string, mode: DeleteFolderMode): Promise<FolderMetadataMap> {
    return this.change((metadata) => deleteFolderEntries(metadata, path, mode, moveFolderMetadata));
  }

  /** Throws when lifting the subfolders of `path` would clash with metadata in its parent. */
  async assertCanDelete(path: string, mode: DeleteFolderMode): Promise<void> {
    deleteFolderEntries(await this.get(), path, mode, moveFolderMetadata);
  }

  private async read(): Promise<{ metadata: FolderMetadataMap; etag?: string }> {
    try {
      const entity = await this.client.getEntity<MetadataEntity>(METADATA_PK, METADATA_RK);
      return { metadata: parseMetadata(entity.data), etag: entity.etag };
    } catch (err: unknown) {
      if (isTableError(err, 404)) return { metadata: {} };
      throw err;
    }
  }

  private async change(update: (metadata: FolderMetadataMap) => FolderMetadataMap): Promise<FolderMetadataMap> {
    for (let attempt = 1; ; attempt++) {
      const { metadata, etag } = await this.read();
      const next = update(metadata);
      if (JSON.stringify(next) === JSON.stringify(metadata)) return metadata;
      const entity: MetadataEntity = { partitionKey: METADATA_PK, rowKey: METADATA_RK, data: JSON.stringify(next) };
      try {
        if (etag) await this.client.updateEntity(entity, 'Replace', { etag });
        else await this.client.createEntity(entity);
        return next;
      } catch (err: unknown) {
        if (attempt < ATTEMPTS && (isTableError(err, 412) || isTableError(err, 409))) continue;
        throw err;
      }
    }
  }
}
