import { TableClient, odata, type TableEntity } from '@azure/data-tables';
import { createTableClient, isSasConnection } from './connection.js';
import { mapLimit } from '../util.js';
import { matchesSearch, searchTerms } from '../search.js';
import { compareUpdates, sortTodos } from '../sort.js';
import { folderMove, isInFolder, moveFolderPath, normalizeFolder } from '../folders.js';
import { cleanColor } from '../colors.js';
import { normalizeAttachments } from '../attachments.js';
import type {
  StoreConnection,
  Update,
  PostGist,
  Status,
  ListOptions,
  ListResponse,
  StatsResponse,
  SourceFetchStatus,
  AppSettings,
  Todo,
  TodoStatus,
  CreateTodoRequest,
  UpdateTodoRequest,
  ListTodosOptions,
  ListTodosResponse,
} from '../types.js';
import { DEFAULT_SETTINGS } from '../types.js';
import { LEGACY_BUILTIN_SOURCES, LEGACY_COPILOT_CLI_SOURCE, LEGACY_USER_SOURCES } from '../scraper/specs.js';
import type { DuplicateRow } from '../duplicates.js';

const TABLE_NAME = 'updates';
const SETTINGS_TABLE = 'settings';
const SETTINGS_PK = 'app';
const SETTINGS_RK = 'global';
/** Settings-table partition with one row per source: its last fetch time and error. */
const FETCH_STATUS_PK = 'fetch';

type FetchStatusEntity = TableEntity<{ lastFetchAt: string; lastError: string }>;

// ─── Entity shape stored in Azure Table Storage ────────────────────────────
type UpdateEntity = TableEntity<{
  title: string;
  url: string;
  datePublished: string;
  dateAdded: string;
  status: string;
  saved: boolean;
  content: string;
  readingTimeMinutes?: number;
  durationSeconds?: number;
  topicId?: string;
  summary?: string;
  /** `PostGist` as JSON. */
  gist?: string;
  /** Id of the update this one repeats; `''` or unset when it is not a duplicate. */
  duplicateOf?: string;
}>;

const LIST_COLUMNS = ['PartitionKey', 'RowKey', 'title', 'url', 'datePublished', 'dateAdded', 'status', 'saved', 'readingTimeMinutes', 'durationSeconds', 'topicId', 'summary', 'gist', 'duplicateOf'];

/**
 * Table Storage caps a string property at 64 KiB of UTF-16 (32,768 code units) and rejects the
 * whole entity with `PropertyValueTooLarge` above it, so long posts are cut to stay under it.
 */
export const MAX_CONTENT_CHARS = 32_000;

/** `content` cut to `MAX_CONTENT_CHARS` (ending in `…`), never splitting a surrogate pair. */
export function clampContent(content: string): string {
  if (content.length <= MAX_CONTENT_CHARS) return content;
  let end = MAX_CONTENT_CHARS - 1;
  const last = content.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return `${content.slice(0, end)}…`;
}

// ─── ID helpers ────────────────────────────────────────────────────────────
/**
 * The REST-facing ID encodes both the Table Storage PartitionKey (source)
 * and RowKey (sha256 of url), enabling O(1) lookups in every handler.
 *
 * Format: `${source}__${sha256(url).slice(0, 32)}`
 */
export async function hashUrl(url: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export async function makeId(source: string, url: string): Promise<string> {
  return `${source}__${await hashUrl(url)}`;
}

export function parseId(id: string): { source: string; rowKey: string } {
  const sep = id.indexOf('__');
  if (sep === -1) throw new Error(`Invalid update id: ${id}`);
  return { source: id.slice(0, sep), rowKey: id.slice(sep + 2) };
}

/** Parse a stored `gist` column; anything malformed is ignored. */
function parseGistColumn(raw: string | undefined | null): PostGist | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as { summary?: unknown; points?: unknown };
    if (typeof value.summary !== 'string' || !value.summary) return undefined;
    const points = Array.isArray(value.points) ? value.points.filter((p): p is string => typeof p === 'string') : [];
    return { summary: value.summary, points };
  } catch {
    return undefined;
  }
}

function entityToUpdate(e: UpdateEntity): Update {
  const gist = parseGistColumn(e.gist);
  return {
    id: `${e.partitionKey}__${e.rowKey}`,
    source: e.partitionKey,
    title: e.title,
    url: e.url,
    datePublished: e.datePublished,
    dateAdded: e.dateAdded,
    // Legacy migration: v1 used 'saved' as a status value; v2+ uses separate flag
    status: (e.status === 'saved' ? 'read' : e.status) as Status,
    saved: e.saved ?? (e.status as string) === 'saved',
    content: e.content ?? '',
    ...(typeof e.readingTimeMinutes === 'number' && e.readingTimeMinutes > 0 ? { readingTimeMinutes: e.readingTimeMinutes } : {}),
    ...(typeof e.durationSeconds === 'number' && e.durationSeconds > 0 ? { durationSeconds: e.durationSeconds } : {}),
    ...(e.topicId ? { topicId: e.topicId } : {}),
    ...(e.summary ? { summary: e.summary } : {}),
    ...(gist ? { gist } : {}),
    ...(e.duplicateOf ? { duplicateOf: e.duplicateOf } : {}),
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
  readingTimeMinutes?: number;
  durationSeconds?: number;
  topicId?: string;
  summary?: string;
  gist?: string;
  duplicateOf?: string;
}

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  count: number;
  entities: BackupEntity[];
}

/** What re-reading a post's page corrects (`UpdateStore.setPageInfo`). */
export type PageInfo = Partial<Pick<Update, 'content' | 'readingTimeMinutes' | 'durationSeconds'>>;

/** What a keyed item changes on its stored row when it is fetched again. */
export type KeyedChange = Partial<Pick<Update, 'title' | 'url' | 'content' | 'datePublished' | 'durationSeconds'>>;

export interface InsertOptions {
  /** Identity of the row instead of the URL (`ScrapedItem.key`). */
  key?: string;
  /**
   * For a keyed row that already exists: the fields to change, given what is stored, or undefined to
   * leave it as it is. Default: the fetched title, URL, content and date. Status, saved flag and topic stay.
   */
  merge?: (existing: Update) => KeyedChange | undefined | Promise<KeyedChange | undefined>;
}

// ─── Store ─────────────────────────────────────────────────────────────────
export class UpdateStore {
  private readonly client: TableClient;
  private readonly settingsClient: TableClient;
  private readonly canCreateTables: boolean;

  constructor(conn: StoreConnection) {
    this.client = createTableClient(conn, TABLE_NAME);
    this.settingsClient = createTableClient(conn, SETTINGS_TABLE);
    this.canCreateTables = !isSasConnection(conn);
  }

  /** Create the tables if they do not already exist (no-op for SAS connections). */
  async init(): Promise<void> {
    if (!this.canCreateTables) return;
    await Promise.all([
      this.client.createTable(),
      this.settingsClient.createTable(),
    ]);
  }

  /**
   * Insert a new update.  Returns true if inserted, false if the URL (or `options.key`) already exists.
   * If the URL already exists and new content is provided, backfills content
   * on the existing entity (preserving status and other fields). An existing keyed row is merged
   * instead (see `InsertOptions.merge`).
   */
  async insertUpdate(
    update: Omit<Update, 'id' | 'dateAdded' | 'status' | 'saved'>,
    options: InsertOptions = {},
  ): Promise<boolean> {
    const rowKey = await hashUrl(options.key ?? update.url);
    const content = clampContent(update.content ?? '');

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
        content,
        ...(update.readingTimeMinutes ? { readingTimeMinutes: update.readingTimeMinutes } : {}),
        ...(update.durationSeconds ? { durationSeconds: update.durationSeconds } : {}),
        ...(update.duplicateOf ? { duplicateOf: update.duplicateOf } : {}),
      });
      return true;
    } catch (err: unknown) {
      // EntityAlreadyExists → URL was already ingested
      if (isTableError(err, 409)) {
        if (options.key) {
          const fetched: KeyedChange = {
            title: update.title,
            url: update.url,
            content,
            datePublished: update.datePublished,
            ...(update.durationSeconds ? { durationSeconds: update.durationSeconds } : {}),
          };
          await this.mergeKeyed(update.source, rowKey, options.merge ?? (() => fetched));
          return false;
        }
        // Backfill content or duration the existing entity lacks
        if (content || update.durationSeconds) {
          await this.backfill(update.source, rowKey, content, update.durationSeconds);
        }
        return false;
      }
      throw err;
    }
  }

  /** Apply what `merge` changes to an existing keyed row. */
  private async mergeKeyed(
    partitionKey: string,
    rowKey: string,
    merge: NonNullable<InsertOptions['merge']>,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const entity = await this.client.getEntity<UpdateEntity>(partitionKey, rowKey);
      const change = await merge(entityToUpdate(entity));
      if (!change) return;
      if (Object.keys(change).some((key) => !['title', 'url', 'content', 'datePublished', 'durationSeconds'].includes(key))) {
        throw new Error('Keyed merge attempted to change a protected field');
      }
      const patch: KeyedChange = {};
      if (change.title && change.title !== entity.title) patch.title = change.title;
      if (change.url && change.url !== entity.url) patch.url = change.url;
      if (change.datePublished && change.datePublished !== entity.datePublished) patch.datePublished = change.datePublished;
      if (change.durationSeconds && change.durationSeconds !== entity.durationSeconds) patch.durationSeconds = change.durationSeconds;
      if (change.content !== undefined) {
        const next = clampContent(change.content);
        if (next !== (entity.content ?? '')) patch.content = next;
      }
      if (Object.keys(patch).length === 0) return;
      try {
        await this.client.updateEntity({ partitionKey, rowKey, ...patch }, 'Merge', { etag: entity.etag });
        return;
      } catch (error) {
        if (!isTableError(error, 412) || attempt === 2) throw error;
      }
    }
  }

  /** Fill in the content and duration an existing entity lacks, leaving everything else as it is. */
  private async backfill(
    partitionKey: string,
    rowKey: string,
    content: string,
    durationSeconds: number | undefined,
  ): Promise<void> {
    try {
      const entity = await this.client.getEntity<UpdateEntity>(partitionKey, rowKey);
      const addContent = !!content && !entity.content;
      const addDuration = !!durationSeconds && !(typeof entity.durationSeconds === 'number' && entity.durationSeconds > 0);
      if (!addContent && !addDuration) return;

      const updated: UpdateEntity = {
        ...entity,
        ...(addContent ? { content } : {}),
        ...(addDuration ? { durationSeconds } : {}),
      };
      await this.client.updateEntity(updated, 'Replace', { etag: entity.etag });
    } catch {
      // best-effort — don't fail the whole fetch for a backfill miss
    }
  }

  /** Overwrite what was read from the post's page; fields left out stay as they are. */
  async setPageInfo(id: string, info: PageInfo): Promise<void> {
    const { source, rowKey } = parseId(id);
    await this.client.updateEntity(
      {
        partitionKey: source,
        rowKey,
        ...(info.content !== undefined ? { content: clampContent(info.content) } : {}),
        ...(info.readingTimeMinutes ? { readingTimeMinutes: info.readingTimeMinutes } : {}),
        ...(info.durationSeconds ? { durationSeconds: info.durationSeconds } : {}),
      },
      'Merge',
    );
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

  /** Unconditional merge of `status` on many entities (no read round-trip). */
  async setStatusMany(ids: string[], status: Status): Promise<void> {
    await mapLimit(ids, 8, async (id) => {
      const { source, rowKey } = parseId(id);
      await this.client.updateEntity({ partitionKey: source, rowKey, status }, 'Merge');
    });
  }

  /** Delete every update of `source`, in batches of 100 (one partition per transaction). Returns how many. */
  async deleteSourceUpdates(source: string): Promise<number> {
    const keys: string[] = [];
    const iter = this.client.listEntities<UpdateEntity>({
      queryOptions: { filter: odata`PartitionKey eq ${source}`, select: ['RowKey'] },
    });
    for await (const e of iter) keys.push(e.rowKey!);
    const batches: string[][] = [];
    for (let i = 0; i < keys.length; i += 100) batches.push(keys.slice(i, i + 100));
    await mapLimit(batches, 4, async (batch) => {
      await this.client.submitTransaction(batch.map((rowKey) => ['delete', { partitionKey: source, rowKey }]));
    });
    return keys.length;
  }

  /** Assign (or clear, with `''`) the digest topic of an update, optionally with its one-line summary. */
  async setTopicId(id: string, topicId: string, summary?: string): Promise<void> {
    const { source, rowKey } = parseId(id);
    await this.client.updateEntity(
      { partitionKey: source, rowKey, topicId, ...(summary ? { summary } : {}) },
      'Merge',
    );
  }

  /** Save the post's gist (Copilot summary of the full post). */
  async setGist(id: string, gist: PostGist): Promise<void> {
    const { source, rowKey } = parseId(id);
    await this.client.updateEntity({ partitionKey: source, rowKey, gist: JSON.stringify(gist) }, 'Merge');
  }

  /** Mark an update as repeating `duplicateOf` (`''` clears it). */
  async setDuplicateOf(id: string, duplicateOf: string): Promise<void> {
    const { source, rowKey } = parseId(id);
    await this.client.updateEntity({ partitionKey: source, rowKey, duplicateOf }, 'Merge');
  }

  /** Every update with just what duplicate detection needs. */
  async listDuplicateRows(): Promise<DuplicateRow[]> {
    const iter = this.client.listEntities<UpdateEntity>({
      queryOptions: { select: ['PartitionKey', 'RowKey', 'title', 'url', 'datePublished', 'dateAdded', 'duplicateOf'] },
    });
    const rows: DuplicateRow[] = [];
    for await (const e of iter) {
      rows.push({
        id: `${e.partitionKey}__${e.rowKey}`,
        url: e.url ?? '',
        title: e.title ?? '',
        datePublished: e.datePublished ?? '',
        dateAdded: e.dateAdded ?? '',
        ...(e.duplicateOf ? { duplicateOf: e.duplicateOf } : {}),
      });
    }
    return rows;
  }

  /** Every update flagged as a repeat of another, without content. */
  async listDuplicateCopies(): Promise<Update[]> {
    // The filter only keeps the response small; the check below guards against a store matching rows that lack the property.
    const iter = this.client.listEntities<UpdateEntity>({ queryOptions: { filter: "duplicateOf gt ''", select: LIST_COLUMNS } });
    const copies: Update[] = [];
    for await (const entity of iter) {
      if (entity.duplicateOf) copies.push({ ...entityToUpdate(entity as UpdateEntity), content: '' });
    }
    return copies;
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

    if (options.sources) {
      if (options.sources.length === 0) return { updates: [], total: 0, hasMore: false };
      filters.push(`(${options.sources.map((s) => odata`PartitionKey eq ${s}`).join(' or ')})`);
    }
    if (options.status && options.status !== 'all') {
      filters.push(odata`status eq ${options.status}`);
    }
    if (options.saved !== undefined) {
      filters.push(odata`saved eq ${options.saved}`);
    }

    const filter = filters.length > 0 ? filters.join(' and ') : undefined;
    // Table Storage can't search text, so a search reads content and filters here.
    const searching = searchTerms(options.search).length > 0;
    const withContent = options.includeContent !== false;
    const select = withContent || searching ? undefined : LIST_COLUMNS;

    const iter = this.client.listEntities<UpdateEntity>({ queryOptions: { filter, select } });

    const updates: Update[] = [];
    for await (const entity of iter) {
      const update = entityToUpdate(entity as UpdateEntity);
      if (searching && !matchesSearch(update, options.search)) continue;
      updates.push(withContent ? update : { ...update, content: '' });
    }

    // Sort in application (Table Storage has no ORDER BY), before paging
    updates.sort(compareUpdates(options.sort));

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
    const iter = this.client.listEntities<UpdateEntity>({
      queryOptions: { select: ['PartitionKey', 'RowKey', 'status', 'saved', 'dateAdded'] },
    });

    const byStatus: Record<string, number> = { unread: 0, read: 0 };
    const bySource: Record<string, number> = {};
    const savedBySource: Record<string, number> = {};
    const fetchStatus = this.getFetchStatus();
    const lastAdded: Record<string, string> = {};
    let saved = 0;
    let total = 0;

    for await (const e of iter) {
      const status = e.status === 'saved' ? 'read' : e.status;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      bySource[e.partitionKey] = (bySource[e.partitionKey] ?? 0) + 1;
      if (e.saved ?? e.status === 'saved') {
        saved++;
        savedBySource[e.partitionKey] = (savedBySource[e.partitionKey] ?? 0) + 1;
      }
      total++;
      const prev = lastAdded[e.partitionKey];
      if (e.dateAdded && (!prev || e.dateAdded > prev)) lastAdded[e.partitionKey] = e.dateAdded;
    }

    const sourceStatus = await fetchStatus;
    for (const [source, at] of Object.entries(lastAdded)) (sourceStatus[source] ??= {}).lastAddedAt = at;

    return {
      total,
      byStatus: byStatus as Record<Status, number>,
      bySource,
      savedBySource,
      saved,
      sourceStatus,
    };
  }

  /** Remember the outcome of fetching `source` (no `error` means it succeeded). */
  async recordFetch(source: string, error?: string): Promise<void> {
    await this.settingsClient.upsertEntity<FetchStatusEntity>(
      { partitionKey: FETCH_STATUS_PK, rowKey: source, lastFetchAt: new Date().toISOString(), lastError: error ?? '' },
      'Merge',
    );
  }

  /** Last fetch time and error per source, as written by `recordFetch` (best-effort: `{}` on failure). */
  private async getFetchStatus(): Promise<Record<string, SourceFetchStatus>> {
    const out: Record<string, SourceFetchStatus> = {};
    try {
      const iter = this.settingsClient.listEntities<FetchStatusEntity>({
        queryOptions: { filter: odata`PartitionKey eq ${FETCH_STATUS_PK}` },
      });
      for await (const e of iter) {
        out[e.rowKey] = { lastFetchAt: e.lastFetchAt, ...(e.lastError ? { lastError: e.lastError } : {}) };
      }
    } catch {
      // missing table or no access — show no fetch history
    }
    return out;
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
        ...(e.readingTimeMinutes ? { readingTimeMinutes: e.readingTimeMinutes } : {}),
        ...(e.durationSeconds ? { durationSeconds: e.durationSeconds } : {}),
        ...(e.topicId ? { topicId: e.topicId } : {}),
        ...(e.summary ? { summary: e.summary } : {}),
        ...(e.gist ? { gist: e.gist } : {}),
        ...(e.duplicateOf ? { duplicateOf: e.duplicateOf } : {}),
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
          content: clampContent(e.content ?? ''),
          ...(e.readingTimeMinutes ? { readingTimeMinutes: e.readingTimeMinutes } : {}),
          ...(e.durationSeconds ? { durationSeconds: e.durationSeconds } : {}),
          ...(e.topicId ? { topicId: e.topicId } : {}),
          ...(e.summary ? { summary: e.summary } : {}),
          ...(e.gist ? { gist: e.gist } : {}),
          ...(e.duplicateOf ? { duplicateOf: e.duplicateOf } : {}),
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
    let stored: Partial<AppSettings>;
    let existingAccount = true;
    try {
      const entity = await this.settingsClient.getEntity<TableEntity<{ data: string }>>(
        SETTINGS_PK,
        SETTINGS_RK,
      );
      stored = JSON.parse(entity.data) as Partial<AppSettings>;
    } catch (err: unknown) {
      if (!isTableError(err, 404)) throw err;
      stored = {};
      existingAccount = await this.hasStoredUpdates();
    }

    const needsMigration = (stored.sourceDefaultsVersion ?? 0) < DEFAULT_SETTINGS.sourceDefaultsVersion;
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      ...(needsMigration && existingAccount ? migrateLegacySources(stored) : {}),
      sourceDefaultsVersion: DEFAULT_SETTINGS.sourceDefaultsVersion,
    };

    if (needsMigration) {
      await this.settingsClient.upsertEntity<TableEntity<{ data: string }>>(
        { partitionKey: SETTINGS_PK, rowKey: SETTINGS_RK, data: JSON.stringify(settings) },
        'Replace',
      );
    }

    return settings;
  }

  private async hasStoredUpdates(): Promise<boolean> {
    const iter = this.client.listEntities<UpdateEntity>({ queryOptions: { select: ['PartitionKey'] } });
    for await (const _ of iter) return true;
    return false;
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
export function isTableError(err: unknown, statusCode: number): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    (err as { statusCode: number }).statusCode === statusCode
  );
}

// ─── Todo Store ────────────────────────────────────────────────────────────

const TODO_TABLE = 'todos';
const TODO_PK = 'todo';

type TodoEntity = TableEntity<{
  subject: string;
  description: string;
  /** JSON array; missing on todos stored before attachments. */
  attachments?: string;
  dueDate: string;
  status: string;
  /** Missing on todos stored before folders. */
  folder?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}>;

function entityToTodo(e: TodoEntity): Todo {
  const stored: unknown = JSON.parse(e.attachments || '[]');
  if (!Array.isArray(stored) || !stored.every((value): value is string => typeof value === 'string')) {
    throw new Error(`Invalid attachments stored for todo ${e.rowKey}`);
  }
  const attachments = normalizeAttachments(stored);
  const todo: Todo = {
    id: e.rowKey,
    subject: e.subject,
    description: e.description ?? '',
    dueDate: e.dueDate || undefined,
    status: e.status as TodoStatus,
    folder: e.folder ?? '',
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
  if (attachments.length) todo.attachments = attachments;
  if (e.color) todo.color = e.color;
  return todo;
}

export class TodoStore {
  private readonly client: TableClient;
  private readonly canCreateTables: boolean;

  constructor(conn: StoreConnection) {
    this.client = createTableClient(conn, TODO_TABLE);
    this.canCreateTables = !isSasConnection(conn);
  }

  async init(): Promise<void> {
    if (!this.canCreateTables) return;
    await this.client.createTable();
  }

  async createTodo(req: CreateTodoRequest): Promise<Todo> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const entity: TodoEntity = {
      partitionKey: TODO_PK,
      rowKey: id,
      subject: req.subject,
      description: req.description ?? '',
      attachments: JSON.stringify(normalizeAttachments(req.attachments ?? [])),
      dueDate: req.dueDate ?? '',
      status: 'pending',
      folder: normalizeFolder(req.folder),
      color: cleanColor(req.color),
      createdAt: now,
      updatedAt: now,
    };
    await this.client.createEntity(entity);
    return entityToTodo(entity);
  }

  async getTodo(id: string): Promise<Todo | null> {
    try {
      const entity = await this.client.getEntity<TodoEntity>(TODO_PK, id);
      return entityToTodo(entity as TodoEntity);
    } catch (err: unknown) {
      if (isTableError(err, 404)) return null;
      throw err;
    }
  }

  async listTodos(opts: ListTodosOptions = {}): Promise<ListTodosResponse> {
    const filters: string[] = [`PartitionKey eq '${TODO_PK}'`];
    if (opts.status && opts.status !== 'all') {
      filters.push(odata`status eq ${opts.status}`);
    }
    const filter = filters.join(' and ');

    const iter = this.client.listEntities<TodoEntity>({ queryOptions: { filter } });
    const todos: Todo[] = [];
    for await (const entity of iter) {
      todos.push(entityToTodo(entity as TodoEntity));
    }

    // Pending first, then in_progress, then done; within a status by due date
    return { todos: sortTodos(todos) };
  }

  async updateTodo(id: string, patch: UpdateTodoRequest): Promise<Todo> {
    const entity = await this.client.getEntity<TodoEntity>(TODO_PK, id);
    const updated: TodoEntity = {
      ...entity,
      subject: patch.subject ?? entity.subject,
      description: patch.description !== undefined ? patch.description : entity.description,
      attachments: patch.attachments !== undefined ? JSON.stringify(normalizeAttachments(patch.attachments)) : (entity.attachments ?? '[]'),
      dueDate: patch.dueDate !== undefined ? (patch.dueDate ?? '') : entity.dueDate,
      status: patch.status ?? entity.status,
      folder: patch.folder !== undefined ? normalizeFolder(patch.folder) : (entity.folder ?? ''),
      color: patch.color !== undefined ? cleanColor(patch.color) : (entity.color ?? ''),
      updatedAt: new Date().toISOString(),
    };
    await this.client.updateEntity(updated, 'Replace', { etag: entity.etag });
    return entityToTodo(updated);
  }

  /** Rename a folder: every todo in it (and its subfolders) moves under `to`. Returns how many moved. */
  async moveFolder(from: string, to: string): Promise<number> {
    const move = folderMove(from, to);
    if (!move) return 0;
    const { todos } = await this.listTodos();
    const inside = todos.filter((t) => isInFolder(t.folder, move.from));
    const now = new Date().toISOString();
    await Promise.all(
      inside.map((t) =>
        this.client.updateEntity(
          { partitionKey: TODO_PK, rowKey: t.id, folder: moveFolderPath(t.folder, move.from, move.to), updatedAt: now },
          'Merge',
        ),
      ),
    );
    return inside.length;
  }

  async deleteTodo(id: string): Promise<void> {
    try {
      await this.client.deleteEntity(TODO_PK, id);
    } catch (err: unknown) {
      if (isTableError(err, 404)) return; // idempotent
      throw err;
    }
  }
}

/**
 * Former built-ins of an account from an earlier FOMO version: feeds become the user's own sources,
 * extension sources stay built-in. Version 1 kept every former built-in in `installedLegacySources`.
 */
function migrateLegacySources(stored: Partial<AppSettings>): Pick<AppSettings, 'userSources' | 'installedLegacySources'> {
  const userSources = stored.userSources ?? [];
  const own = new Set(userSources.map((source) => source.id));
  const removed = new Set(stored.removedSources ?? []);
  const kept = new Set(
    stored.sourceDefaultsVersion === undefined
      ? [...LEGACY_USER_SOURCES, ...LEGACY_BUILTIN_SOURCES, LEGACY_COPILOT_CLI_SOURCE].map((source) => source.id).filter((id) => !own.has(id))
      : stored.installedLegacySources ?? [],
  );
  const migrateCopilotCli = kept.has(LEGACY_COPILOT_CLI_SOURCE.id)
    && !own.has(LEGACY_COPILOT_CLI_SOURCE.id)
    && !removed.has(LEGACY_COPILOT_CLI_SOURCE.id);
  return {
    userSources: [
      ...LEGACY_USER_SOURCES.filter((source) => kept.has(source.id) && !own.has(source.id) && !removed.has(source.id)),
      ...(migrateCopilotCli ? [LEGACY_COPILOT_CLI_SOURCE] : []),
      ...userSources,
    ],
    installedLegacySources: LEGACY_BUILTIN_SOURCES.map((source) => source.id).filter((id) => kept.has(id)),
  };
}
