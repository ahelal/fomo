import { TableClient, odata, type TableEntity } from '@azure/data-tables';
import { createTableClient, isSasConnection } from './connection.js';
import { mapLimit } from '../util.js';
import { matchesSearch, searchTerms } from '../search.js';
import type {
  StoreConnection,
  Update,
  PostGist,
  Status,
  ListOptions,
  ListResponse,
  StatsResponse,
  AppSettings,
  Todo,
  TodoStatus,
  CreateTodoRequest,
  UpdateTodoRequest,
  ListTodosOptions,
  ListTodosResponse,
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
  topicId?: string;
  summary?: string;
  /** `PostGist` as JSON. */
  gist?: string;
}>;

const LIST_COLUMNS = ['PartitionKey', 'RowKey', 'title', 'url', 'datePublished', 'dateAdded', 'status', 'saved', 'topicId', 'summary', 'gist'];

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
    ...(e.topicId ? { topicId: e.topicId } : {}),
    ...(e.summary ? { summary: e.summary } : {}),
    ...(gist ? { gist } : {}),
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
  topicId?: string;
  summary?: string;
  gist?: string;
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
   * Insert a new update.  Returns true if inserted, false if the URL already exists.
   * If the URL already exists and new content is provided, backfills content
   * on the existing entity (preserving status and other fields).
   */
  async insertUpdate(
    update: Omit<Update, 'id' | 'dateAdded' | 'status' | 'saved'>,
  ): Promise<boolean> {
    const rowKey = await hashUrl(update.url);

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

  /** Unconditional merge of `status` on many entities (no read round-trip). */
  async setStatusMany(ids: string[], status: Status): Promise<void> {
    await mapLimit(ids, 8, async (id) => {
      const { source, rowKey } = parseId(id);
      await this.client.updateEntity({ partitionKey: source, rowKey, status }, 'Merge');
    });
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
    const iter = this.client.listEntities<UpdateEntity>({
      queryOptions: { select: ['PartitionKey', 'RowKey', 'status', 'saved'] },
    });

    const byStatus: Record<string, number> = { unread: 0, read: 0 };
    const bySource: Record<string, number> = {};
    let saved = 0;
    let total = 0;

    for await (const e of iter) {
      const status = e.status === 'saved' ? 'read' : e.status;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      bySource[e.partitionKey] = (bySource[e.partitionKey] ?? 0) + 1;
      if (e.saved ?? e.status === 'saved') saved++;
      total++;
    }

    return {
      total,
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
        ...(e.topicId ? { topicId: e.topicId } : {}),
        ...(e.summary ? { summary: e.summary } : {}),
        ...(e.gist ? { gist: e.gist } : {}),
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
          ...(e.topicId ? { topicId: e.topicId } : {}),
          ...(e.summary ? { summary: e.summary } : {}),
          ...(e.gist ? { gist: e.gist } : {}),
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
  dueDate: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}>;

function entityToTodo(e: TodoEntity): Todo {
  return {
    id: e.rowKey,
    subject: e.subject,
    description: e.description ?? '',
    dueDate: e.dueDate || undefined,
    status: e.status as TodoStatus,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
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
      dueDate: req.dueDate ?? '',
      status: 'pending',
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

    // Sort: pending first, then in_progress, then done; within group by dueDate asc
    const statusOrder: Record<TodoStatus, number> = { pending: 0, in_progress: 1, done: 2 };
    todos.sort((a, b) => {
      const sd = statusOrder[a.status] - statusOrder[b.status];
      if (sd !== 0) return sd;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });

    return { todos };
  }

  async updateTodo(id: string, patch: UpdateTodoRequest): Promise<Todo> {
    const entity = await this.client.getEntity<TodoEntity>(TODO_PK, id);
    const updated: TodoEntity = {
      ...entity,
      subject: patch.subject ?? entity.subject,
      description: patch.description !== undefined ? patch.description : entity.description,
      dueDate: patch.dueDate !== undefined ? (patch.dueDate ?? '') : entity.dueDate,
      status: patch.status ?? entity.status,
      updatedAt: new Date().toISOString(),
    };
    await this.client.updateEntity(updated, 'Replace', { etag: entity.etag });
    return entityToTodo(updated);
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
