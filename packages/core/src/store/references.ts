import { odata, type TableClient, type TableEntity } from '@azure/data-tables';
import { createTableClient, isSasConnection } from './connection.js';
import { isTableError } from './tables.js';
import { normalizeReferenceUrl } from '../references.js';
import { folderMove, folderToDelete, isInFolder, moveFolderPath, normalizeFolder } from '../folders.js';
import { cleanColor } from '../colors.js';
import type {
  CreateReferenceRequest,
  Reference,
  StoreConnection,
  UpdateReferenceRequest,
} from '../types.js';

const REFERENCE_TABLE = 'references';
const REFERENCE_PK = 'ref';

type ReferenceEntity = TableEntity<{
  title: string;
  url: string;
  folder: string;
  description: string;
  updateId: string;
  /** Missing on links stored before colors. */
  color?: string;
  createdAt: string;
  updatedAt: string;
}>;

function entityToReference(e: ReferenceEntity): Reference {
  const ref: Reference = {
    id: e.rowKey,
    title: e.title ?? '',
    url: e.url ?? '',
    folder: e.folder ?? '',
    description: e.description ?? '',
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
  if (e.updateId) ref.updateId = e.updateId;
  if (e.color) ref.color = e.color;
  return ref;
}

function cleanTitle(title: string | undefined, url: string): string {
  return (title ?? '').replace(/\s+/g, ' ').trim() || url;
}

export class ReferenceStore {
  private readonly client: TableClient;
  private readonly canCreateTables: boolean;

  constructor(conn: StoreConnection) {
    this.client = createTableClient(conn, REFERENCE_TABLE);
    this.canCreateTables = !isSasConnection(conn);
  }

  async init(): Promise<void> {
    if (!this.canCreateTables) return;
    await this.client.createTable();
  }

  async listReferences(): Promise<Reference[]> {
    const filter = odata`PartitionKey eq ${REFERENCE_PK}`;
    const refs: Reference[] = [];
    try {
      for await (const e of this.client.listEntities<ReferenceEntity>({ queryOptions: { filter } })) {
        refs.push(entityToReference(e as ReferenceEntity));
      }
    } catch (err: unknown) {
      // The table only exists once the TUI (or a redeploy) created it.
      if (isTableError(err, 404)) return [];
      throw err;
    }
    return refs;
  }

  async getReference(id: string): Promise<Reference | null> {
    try {
      const entity = await this.client.getEntity<ReferenceEntity>(REFERENCE_PK, id);
      return entityToReference(entity as ReferenceEntity);
    } catch (err: unknown) {
      if (isTableError(err, 404)) return null;
      throw err;
    }
  }

  private async findByUrl(url: string): Promise<Reference | null> {
    const filter = odata`PartitionKey eq ${REFERENCE_PK} and url eq ${url}`;
    try {
      for await (const e of this.client.listEntities<ReferenceEntity>({ queryOptions: { filter } })) {
        return entityToReference(e as ReferenceEntity);
      }
    } catch (err: unknown) {
      if (isTableError(err, 404)) return null;
      throw err;
    }
    return null;
  }

  private async assertUnique(url: string, exceptId?: string): Promise<void> {
    const existing = await this.findByUrl(url);
    if (existing && existing.id !== exceptId) {
      throw new Error(`Already in Bookmarks${existing.folder ? ` (${existing.folder})` : ''}: ${existing.title}`);
    }
  }

  async createReference(req: CreateReferenceRequest): Promise<Reference> {
    const url = normalizeReferenceUrl(req.url);
    const color = cleanColor(req.color);
    await this.assertUnique(url);
    const now = new Date().toISOString();
    const entity: ReferenceEntity = {
      partitionKey: REFERENCE_PK,
      rowKey: crypto.randomUUID(),
      title: cleanTitle(req.title, url),
      url,
      folder: normalizeFolder(req.folder),
      description: (req.description ?? '').trim(),
      updateId: req.updateId ?? '',
      color,
      createdAt: now,
      updatedAt: now,
    };
    await this.client.createEntity(entity);
    return entityToReference(entity);
  }

  async updateReference(id: string, patch: UpdateReferenceRequest): Promise<Reference> {
    const entity = await this.client.getEntity<ReferenceEntity>(REFERENCE_PK, id);
    const url = patch.url !== undefined ? normalizeReferenceUrl(patch.url) : entity.url;
    if (url !== entity.url) await this.assertUnique(url, id);
    const updated = {
      ...entity,
      url,
      title: patch.title !== undefined ? cleanTitle(patch.title, url) : entity.title,
      folder: patch.folder !== undefined ? normalizeFolder(patch.folder) : entity.folder,
      description: patch.description !== undefined ? patch.description.trim() : entity.description,
      color: patch.color !== undefined ? cleanColor(patch.color) : (entity.color ?? ''),
      updatedAt: new Date().toISOString(),
    };
    await this.client.updateEntity(updated, 'Replace', { etag: entity.etag });
    return entityToReference(updated as ReferenceEntity);
  }

  async deleteReference(id: string): Promise<void> {
    try {
      await this.client.deleteEntity(REFERENCE_PK, id);
    } catch (err: unknown) {
      if (isTableError(err, 404)) return;
      throw err;
    }
  }

  /** Rename a folder: every reference in it (and its subfolders) moves under `to`. Returns how many moved. */
  async moveFolder(from: string, to: string): Promise<number> {
    const move = folderMove(from, to);
    if (!move) return 0;
    const refs = (await this.listReferences()).filter((r) => isInFolder(r.folder, move.from));
    const now = new Date().toISOString();
    await Promise.all(
      refs.map((r) =>
        this.client.updateEntity(
          { partitionKey: REFERENCE_PK, rowKey: r.id, folder: moveFolderPath(r.folder, move.from, move.to), updatedAt: now },
          'Merge',
        ),
      ),
    );
    return refs.length;
  }

  /** Delete every reference in `folder` and its subfolders; returns how many went. */
  async deleteFolder(folder: string): Promise<number> {
    const path = folderToDelete(folder);
    const refs = (await this.listReferences()).filter((r) => isInFolder(r.folder, path));
    await Promise.all(refs.map((r) => this.deleteReference(r.id)));
    return refs.length;
  }
}
