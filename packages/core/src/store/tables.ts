import { TableClient, odata, type TableEntity } from '@azure/data-tables';
import { createHash } from 'node:crypto';
import type {
  Update,
  Status,
  ListOptions,
  ListResponse,
  StatsResponse,
  AppSettings,
} from '../types.js';
import { DEFAULT_SETTINGS } from '../types.js';

const TABLE_NAME = 'updates';
const SETTINGS_TABLE = 'settings';
const SETTINGS_PK = 'app';
const SETTINGS_RK = 'global';

// ─── Entity shape stored in Azure Table Storage ────────────────────────────
type UpdateEntity = TableEntity<{
  title: string;
  url: string;
  datePublished: string;
  dateAdded: string;
  status: string;
  saved: boolean;
  content: string;
}>;

// ─── ID helpers ────────────────────────────────────────────────────────────
/**
 * The REST-facing ID encodes both the Table Storage PartitionKey (source)
 * and RowKey (sha256 of url), enabling O(1) lookups in every handler.
 *
 * Format: `${source}__${sha256(url).slice(0, 32)}`
 */
export function makeId(source: string, url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 32);
  return `${source}__${hash}`;
}

export function parseId(id: string): { source: string; rowKey: string } {
  const sep = id.indexOf('__');
  if (sep === -1) throw new Error(`Invalid update id: ${id}`);
  return { source: id.slice(0, sep), rowKey: id.slice(sep + 2) };
}

function entityToUpdate(e: UpdateEntity): Update {
  return {
    id: makeId(e.partitionKey, e.url),
    source: e.partitionKey,
    title: e.title,
    url: e.url,
    datePublished: e.datePublished,
    dateAdded: e.dateAdded,
    // Legacy migration: v1 used 'saved' as a status value; v2+ uses separate flag
    status: (e.status === 'saved' ? 'read' : e.status) as Status,
    saved: e.saved ?? (e.status as string) === 'saved',
    content: e.content,
  };
}

// ─── Backup / Restore ──────────────────────────────────────────────────────

/** Shape of a single row in a backup file. */
export interface BackupEntity {
  partitionKey: string;
  rowKey: string;
  title: string;
  url: string;
  datePublished: string;
  dateAdded: string;
  status: string;
  saved: boolean;
  content: string;
}

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  count: number;
  entities: BackupEntity[];
}

// ─── Store ─────────────────────────────────────────────────────────────────
export class UpdateStore {
  private readonly client: TableClient;
  private readonly settingsClient: TableClient;

  constructor(connectionString: string) {
    const allowInsecureConnection = connectionString.includes('devstoreaccount1');
    this.client = TableClient.fromConnectionString(connectionString, TABLE_NAME, { allowInsecureConnection });
    this.settingsClient = TableClient.fromConnectionString(connectionString, SETTINGS_TABLE, { allowInsecureConnection });
  }

  /** Create the tables if they do not already exist. */
  async init(): Promise<void> {
    await Promise.all([
      this.client.createTable(),
      this.settingsClient.createTable(),
    ]);
  }

  /**
   * Insert a new update.  Returns true if inserted, false if the URL already exists.
   * If the URL already exists and new content is provided, backfills content
   * on the existing entity (preserving status and other fields).
   */
  async insertUpdate(
    update: Omit<Update, 'id' | 'dateAdded' | 'status' | 'saved'>,
  ): Promise<boolean> {
    const rowKey = createHash('sha256').update(update.url).digest('hex').slice(0, 32);

    try {
      await this.client.createEntity<UpdateEntity>({
        partitionKey: update.source,
        rowKey,
        title: update.title,
        url: update.url,
        datePublished: update.datePublished,
        dateAdded: new Date().toISOString(),
        status: 'unread',
        saved: false,
        content: update.content ?? '',
      });
      return true;
    } catch (err: unknown) {
      // EntityAlreadyExists → URL was already ingested
      if (isTableError(err, 409)) {
        // Backfill content if the existing entity has none
        if (update.content) {
          await this.backfillContent(update.source, rowKey, update.content);
        }
        return false;
      }
      throw err;
    }
  }

  /** Update content on an existing entity only if it currently has no content. */
  private async backfillContent(
    partitionKey: string,
    rowKey: string,
    content: string,
  ): Promise<void> {
    try {
      const entity = await this.client.getEntity<UpdateEntity>(partitionKey, rowKey);
      if (entity.content && entity.content.length > 0) return; // already has content

      const updated: UpdateEntity = { ...entity, content };
      await this.client.updateEntity(updated, 'Replace', { etag: entity.etag });
    } catch {
      // best-effort — don't fail the whole fetch for a backfill miss
    }
  }

  /** Update the content field on an existing entity. */
  async updateContent(id: string, content: string): Promise<Update> {
    const { source, rowKey } = parseId(id);
    const entity = await this.client.getEntity<UpdateEntity>(source, rowKey);
    const updated: UpdateEntity = { ...entity, content };
    await this.client.updateEntity(updated, 'Replace', { etag: entity.etag });
    return entityToUpdate(updated);
  }

  /**
   * Set status on an entity using ETag optimistic concurrency.
   * Retries up to 5 times on 412 Precondition Failed (concurrent write).
   */
  async setStatus(id: string, status: Status): Promise<Update> {
    const { source, rowKey } = parseId(id);
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const entity = await this.client.getEntity<UpdateEntity>(source, rowKey);

      try {
        const updated: UpdateEntity = { ...entity, status };
        await this.client.updateEntity(updated, 'Replace', {
          etag: entity.etag,
        });
        return entityToUpdate(updated);
      } catch (err: unknown) {
        if (isTableError(err, 412) && attempt < maxAttempts - 1) {
          // Concurrent write — another process updated the entity; retry
          continue;
        }
        throw err;
      }
    }

    throw new Error('Too many concurrent status-update conflicts; please retry.');
  }

  /** Toggle the saved/bookmark flag independently of read/unread status. */
  async setSaved(id: string, saved: boolean): Promise<Update> {
    const { source, rowKey } = parseId(id);
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const entity = await this.client.getEntity<UpdateEntity>(source, rowKey);

      try {
        const updated: UpdateEntity = { ...entity, saved };
        await this.client.updateEntity(updated, 'Replace', {
          etag: entity.etag,
        });
        return entityToUpdate(updated);
      } catch (err: unknown) {
        if (isTableError(err, 412) && attempt < maxAttempts - 1) {
          continue;
        }
        throw err;
      }
    }

    throw new Error('Too many concurrent saved-update conflicts; please retry.');
  }

  async getUpdate(id: string): Promise<Update | null> {
    const { source, rowKey } = parseId(id);
    try {
      const entity = await this.client.getEntity<UpdateEntity>(source, rowKey);
      return entityToUpdate(entity as UpdateEntity);
    } catch (err: unknown) {
      if (isTableError(err, 404)) return null;
      throw err;
    }
  }

  async listUpdates(options: ListOptions = {}): Promise<ListResponse> {
    const filters: string[] = [];

    if (options.source) {
      filters.push(odata`PartitionKey eq ${options.source}`);
    }
    if (options.status && options.status !== 'all') {
      filters.push(odata`status eq ${options.status}`);
    }
    if (options.saved !== undefined) {
      filters.push(odata`saved eq ${options.saved}`);
    }

    const filter = filters.length > 0 ? filters.join(' and ') : undefined;

    const iter = this.client.listEntities<UpdateEntity>({ queryOptions: { filter } });

    const updates: Update[] = [];
    for await (const entity of iter) {
      updates.push(entityToUpdate(entity as UpdateEntity));
    }

    // Sort newest-first in application (Table Storage has no ORDER BY)
    updates.sort((a, b) => b.datePublished.localeCompare(a.datePublished));

    const total = updates.length;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;

    return {
      updates: updates.slice(offset, offset + limit),
      total,
      hasMore: offset + limit < total,
    };
  }

  async getStats(): Promise<StatsResponse> {
    const { updates } = await this.listUpdates({ limit: 100_000 });

    const byStatus: Record<string, number> = { unread: 0, read: 0 };
    const bySource: Record<string, number> = {};
    let saved = 0;

    for (const u of updates) {
      byStatus[u.status] = (byStatus[u.status] ?? 0) + 1;
      bySource[u.source] = (bySource[u.source] ?? 0) + 1;
      if (u.saved) saved++;
    }

    return {
      total: updates.length,
      byStatus: byStatus as Record<Status, number>,
      bySource,
      saved,
    };
  }

  /** Export every entity from the table as a serializable backup payload. */
  async backup(): Promise<BackupPayload> {
    const iter = this.client.listEntities<UpdateEntity>();
    const entities: BackupEntity[] = [];

    for await (const e of iter) {
      entities.push({
        partitionKey: e.partitionKey,
        rowKey: e.rowKey,
        title: e.title,
        url: e.url,
        datePublished: e.datePublished,
        dateAdded: e.dateAdded,
        status: e.status,
        saved: e.saved ?? false,
        content: e.content ?? '',
      });
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      count: entities.length,
      entities,
    };
  }

  /**
   * Restore entities from a backup payload.
   * Uses upsert (merge) so existing entities are updated and missing ones are created.
   * Returns the number of entities restored.
   */
  async restore(payload: BackupPayload): Promise<number> {
    let restored = 0;

    for (const e of payload.entities) {
      await this.client.upsertEntity<UpdateEntity>(
        {
          partitionKey: e.partitionKey,
          rowKey: e.rowKey,
          title: e.title,
          url: e.url,
          datePublished: e.datePublished,
          dateAdded: e.dateAdded,
          status: e.status,
          saved: e.saved,
          content: e.content,
        },
        'Replace',
      );
      restored++;
    }

    return restored;
  }

  // ─── Settings ──────────────────────────────────────────────────────────────

  /** Read centralised app settings. Returns defaults for any missing fields. */
  async getSettings(): Promise<AppSettings> {
    try {
      const entity = await this.settingsClient.getEntity<TableEntity<{ data: string }>>(
        SETTINGS_PK,
        SETTINGS_RK,
      );
      const stored = JSON.parse(entity.data) as Partial<AppSettings>;
      return { ...DEFAULT_SETTINGS, ...stored };
    } catch (err: unknown) {
      if (isTableError(err, 404)) return { ...DEFAULT_SETTINGS };
      throw err;
    }
  }

  /** Merge partial settings into the stored settings. */
  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const merged: AppSettings = { ...current, ...patch };

    await this.settingsClient.upsertEntity<TableEntity<{ data: string }>>(
      {
        partitionKey: SETTINGS_PK,
        rowKey: SETTINGS_RK,
        data: JSON.stringify(merged),
      },
      'Replace',
    );

    return merged;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function isTableError(err: unknown, statusCode: number): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    (err as { statusCode: number }).statusCode === statusCode
  );
}
