import { UpdateStore, TodoStore } from './store/tables.js';
import { TopicStore } from './store/topics.js';
import { ReferenceStore } from './store/references.js';
import { sourceInfos } from './scraper/specs.js';
import { buildDigest } from './digest/view.js';
import { searchDigest, searchTerms } from './search.js';
import type {
  FomoService,
  DigestQuery,
  StoreConnection,
  Update,
  ListOptions,
  ListResponse,
  StatsResponse,
  Status,
  SourceInfo,
  SourceCountQuery,
  SourceId,
  AppSettings,
  DigestResponse,
  Todo,
  CreateTodoRequest,
  UpdateTodoRequest,
  ListTodosOptions,
  ListTodosResponse,
  Reference,
  CreateReferenceRequest,
  UpdateReferenceRequest,
  ListReferencesResponse,
} from './types.js';

/**
 * Talks to Azure Table Storage directly. Browser-safe: used by the web/PWA with a
 * SAS token and by the TUI (via `FomoDirectService`) with a connection string.
 */
export class FomoStorageService implements FomoService {
  protected readonly store: UpdateStore;
  protected readonly todoStore: TodoStore;
  protected readonly topicStore: TopicStore;
  protected readonly referenceStore: ReferenceStore;
  private initPromise: Promise<void> | undefined;

  constructor(conn: StoreConnection) {
    this.store = new UpdateStore(conn);
    this.todoStore = new TodoStore(conn);
    this.topicStore = new TopicStore(conn);
    this.referenceStore = new ReferenceStore(conn);
  }

  protected async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = Promise.all([
        this.store.init(),
        this.todoStore.init(),
        this.topicStore.init(),
        this.referenceStore.init(),
      ]).then(() => undefined);
    }
    await this.initPromise;
  }

  async listUpdates(options: ListOptions = {}): Promise<ListResponse> {
    await this.ensureInit();
    return this.store.listUpdates(options);
  }

  async getUpdate(id: string): Promise<Update> {
    await this.ensureInit();
    const update = await this.store.getUpdate(id);
    if (!update) throw new Error(`Update not found: ${id}`);
    return update;
  }

  async setStatus(id: string, status: Status): Promise<Update> {
    await this.ensureInit();
    return this.store.setStatus(id, status);
  }

  async setStatusMany(ids: string[], status: Status): Promise<void> {
    await this.ensureInit();
    await this.store.setStatusMany(ids, status);
  }

  async setSaved(id: string, saved: boolean): Promise<Update> {
    await this.ensureInit();
    return this.store.setSaved(id, saved);
  }

  async deleteSourceUpdates(source: SourceId): Promise<number> {
    await this.ensureInit();
    return this.store.deleteSourceUpdates(source);
  }

    async getStats(): Promise<StatsResponse> {
    await this.ensureInit();
    return this.store.getStats();
  }

  async getDigest(query: DigestQuery = {}): Promise<DigestResponse> {
    await this.ensureInit();
    const searching = searchTerms(query.search).length > 0;
    const { updates } = await this.store.listUpdates({
      ...(query.saved ? { saved: true } : { status: 'unread' as const }),
      ...(query.sources ? { sources: query.sources } : {}),
      limit: Number.MAX_SAFE_INTEGER,
      includeContent: searching,
    });
    const topics = await this.topicStore.getTopics(updates.map((u) => u.topicId ?? '').filter(Boolean));
    const digest = buildDigest(updates, topics, { saved: query.saved });
    if (!searching) return digest;
    // Content was only needed to match; digest lists stay light like the unfiltered ones.
    const entries = searchDigest(digest.entries, query.search).map((e) => ({
      ...e,
      items: e.items.map((u) => ({ ...u, content: '' })),
    }));
    return { entries, pending: entries.filter((e) => e.synthetic).length };
  }

  async countSources(query: SourceCountQuery): Promise<Record<SourceId, number>> {
    const counts: Record<SourceId, number> = {};
    const add = (u: Update) => { counts[u.source] = (counts[u.source] ?? 0) + 1; };
    if (query.grouped) {
      const { entries } = await this.getDigest({ search: query.search, saved: query.saved });
      for (const e of entries) e.items.forEach(add);
      return counts;
    }
    await this.ensureInit();
    const { updates } = await this.store.listUpdates({
      ...(query.saved ? { saved: true } : { status: query.status ?? 'all' }),
      search: query.search,
      limit: Number.MAX_SAFE_INTEGER,
      includeContent: false,
    });
    updates.forEach(add);
    return counts;
  }

  async getSources(): Promise<SourceInfo[]> {
    await this.ensureInit();
    return sourceInfos(await this.store.getSettings());
  }

  // ─── Settings ──────────────────────────────────────────────────────────────

  async getSettings(): Promise<AppSettings> {
    await this.ensureInit();
    return this.store.getSettings();
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    await this.ensureInit();
    return this.store.updateSettings(patch);
  }

  // ─── Todos ─────────────────────────────────────────────────────────────────

  async listTodos(opts: ListTodosOptions = {}): Promise<ListTodosResponse> {
    await this.ensureInit();
    return this.todoStore.listTodos(opts);
  }

  async getTodo(id: string): Promise<Todo> {
    await this.ensureInit();
    const todo = await this.todoStore.getTodo(id);
    if (!todo) throw new Error(`Todo not found: ${id}`);
    return todo;
  }

  async createTodo(req: CreateTodoRequest): Promise<Todo> {
    await this.ensureInit();
    return this.todoStore.createTodo(req);
  }

  async updateTodo(id: string, patch: UpdateTodoRequest): Promise<Todo> {
    await this.ensureInit();
    return this.todoStore.updateTodo(id, patch);
  }

  async deleteTodo(id: string): Promise<void> {
    await this.ensureInit();
    return this.todoStore.deleteTodo(id);
  }

  // ─── References ────────────────────────────────────────────────────────────

  async listReferences(): Promise<ListReferencesResponse> {
    await this.ensureInit();
    return { references: await this.referenceStore.listReferences() };
  }

  async getReference(id: string): Promise<Reference> {
    await this.ensureInit();
    const ref = await this.referenceStore.getReference(id);
    if (!ref) throw new Error(`Reference not found: ${id}`);
    return ref;
  }

  async createReference(req: CreateReferenceRequest): Promise<Reference> {
    await this.ensureInit();
    return this.referenceStore.createReference(req);
  }

  async updateReference(id: string, patch: UpdateReferenceRequest): Promise<Reference> {
    await this.ensureInit();
    return this.referenceStore.updateReference(id, patch);
  }

  async deleteReference(id: string): Promise<void> {
    await this.ensureInit();
    return this.referenceStore.deleteReference(id);
  }

  async moveReferenceFolder(from: string, to: string): Promise<number> {
    await this.ensureInit();
    return this.referenceStore.moveFolder(from, to);
  }
}
