import { UpdateStore, TodoStore } from './store/tables.js';
import { TopicStore } from './store/topics.js';
import { ReferenceStore } from './store/references.js';
import { FolderColorStore } from './store/folder-colors.js';
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
  FolderColorMap,
} from './types.js';

/** How long the list of duplicate copies is reused before it is read again. */
const DUPLICATES_TTL_MS = 30_000;

/** Oldest first, like the original of a group is the first one added. */
const byAdded = (a: Update, b: Update) =>
  a.dateAdded.localeCompare(b.dateAdded) || a.datePublished.localeCompare(b.datePublished) || a.id.localeCompare(b.id);

/**
 * Talks to Azure Table Storage directly. Browser-safe: used by the web/PWA with a
 * SAS token and by the TUI (via `FomoDirectService`) with a connection string.
 */
export class FomoStorageService implements FomoService {
  protected readonly store: UpdateStore;
  protected readonly todoStore: TodoStore;
  protected readonly topicStore: TopicStore;
  protected readonly referenceStore: ReferenceStore;
  protected readonly todoFolderColors: FolderColorStore;
  protected readonly referenceFolderColors: FolderColorStore;
  private initPromise: Promise<void> | undefined;
  private duplicateCopies: { loadedAt: number; list: Promise<Update[]> } | undefined;

  constructor(conn: StoreConnection) {
    this.store = new UpdateStore(conn);
    this.todoStore = new TodoStore(conn);
    this.topicStore = new TopicStore(conn);
    this.referenceStore = new ReferenceStore(conn);
    // Each tree keeps its folder colors in its own table, next to the items.
    this.todoFolderColors = new FolderColorStore(conn, 'todos');
    this.referenceFolderColors = new FolderColorStore(conn, 'references');
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
    try {
      return await this.store.deleteSourceUpdates(source);
    } finally {
      this.forgetDuplicates();
    }
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

  async getDuplicates(id: string): Promise<Update[]> {
    await this.ensureInit();
    const copies = await this.loadDuplicateCopies();
    const own = copies.find((u) => u.id === id);
    const root = own?.duplicateOf ?? id;
    const others = copies.filter((u) => u.duplicateOf === root && u.id !== id).sort(byAdded);
    if (!own && others.length === 0) return [];
    // The original is not flagged, so it is not among the copies.
    const original = root === id ? undefined : await this.store.getUpdate(root);
    return [...(original ? [{ ...original, content: '' }] : []), ...others];
  }

  /** Drop the cached duplicate copies, after something that adds, removes or re-flags updates. */
  protected forgetDuplicates(): void {
    this.duplicateCopies = undefined;
  }

  private loadDuplicateCopies(): Promise<Update[]> {
    const cached = this.duplicateCopies;
    if (cached && Date.now() - cached.loadedAt < DUPLICATES_TTL_MS) return cached.list;
    const entry = { loadedAt: Date.now(), list: this.store.listDuplicateCopies() };
    this.duplicateCopies = entry;
    // A failed read is not kept.
    entry.list.catch(() => {
      if (this.duplicateCopies === entry) this.duplicateCopies = undefined;
    });
    return entry.list;
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
    const [list, folderColors] = await Promise.all([this.todoStore.listTodos(opts), this.todoFolderColors.get()]);
    return { ...list, folderColors };
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

  async moveTodoFolder(from: string, to: string): Promise<number> {
    await this.ensureInit();
    const moved = await this.todoStore.moveFolder(from, to);
    await this.todoFolderColors.move(from, to);
    return moved;
  }

  async setTodoFolderColor(folder: string, color: string): Promise<FolderColorMap> {
    await this.ensureInit();
    return this.todoFolderColors.set(folder, color);
  }

  // ─── References ────────────────────────────────────────────────────────────

  async listReferences(): Promise<ListReferencesResponse> {
    await this.ensureInit();
    const [references, folderColors] = await Promise.all([
      this.referenceStore.listReferences(),
      this.referenceFolderColors.get(),
    ]);
    return { references, folderColors };
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
    const moved = await this.referenceStore.moveFolder(from, to);
    await this.referenceFolderColors.move(from, to);
    return moved;
  }

  async setReferenceFolderColor(folder: string, color: string): Promise<FolderColorMap> {
    await this.ensureInit();
    return this.referenceFolderColors.set(folder, color);
  }
}
