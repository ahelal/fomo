// ─── Domain types ────────────────────────────────────────────────────────────

export type Status = 'unread' | 'read';

/** Source identifier, e.g. 'github', 'azure', 'vscode'. Extensible string. */
export type SourceId = string;

export interface Update {
  /**
   * Opaque ID: `${source}__${sha256(url).slice(0,32)}`
   * Encodes both the Table Storage PartitionKey (source) and RowKey (hash)
   * so the API can do direct O(1) lookups.
   */
  id: string;
  source: SourceId;
  title: string;
  url: string;
  /** ISO 8601 */
  datePublished: string;
  /** ISO 8601 */
  dateAdded: string;
  status: Status;
  /** Whether this update is bookmarked. Independent of read/unread status. */
  saved: boolean;
  /** Empty when listed with `includeContent: false` — load via `getUpdate()`. */
  content: string;
  /** Digest topic this update was grouped into (set by the Copilot digest). */
  topicId?: string;
  /** One-sentence Copilot summary written when the update joins a topic. */
  summary?: string;
  /** Copilot summary of the full post, written on request in the TUI (`g`) and kept. */
  gist?: PostGist;
}

/** The gist of one post: what the feature or change is, plus its key facts. */
export interface PostGist {
  /** One sentence: what the feature or change is and why it matters. */
  summary: string;
  /** 3–5 short facts: what it does, who it's for, how to get it, limits or deadlines. */
  points: string[];
}

// ─── Plugin contract ─────────────────────────────────────────────────────────

/** Declares what a source plugin is capable of. */
export interface SourceCapabilities {
  /** Whether the source provides inline content preview (e.g. article summary). */
  preview: boolean;
}

/** A single item returned by a source plugin's `fetch()` method. */
export interface ScrapedItem {
  title: string;
  url: string;
  datePublished: Date;
  /** Content/summary for preview. Only meaningful when the source has `capabilities.preview`. */
  content?: string;
}

/**
 * Interface every source plugin must implement.
 *
 * Create a file in `sources/`, implement this interface, and register it
 * in the registry — no other changes required.
 */
export interface SourcePlugin {
  /** Unique slug, e.g. 'github', 'azure'. Used as PartitionKey in Table Storage. */
  readonly id: string;
  /** Human-readable name shown in the UI. */
  readonly displayName: string;
  /** Declares what this source is capable of. */
  readonly capabilities: SourceCapabilities;
  /** Fetch and return scraped items. Should return `[]` on failure rather than throwing. */
  fetch(): Promise<ScrapedItem[]>;
}

/** Source metadata exposed to the UI and API consumers. */
export interface SourceInfo {
  id: SourceId;
  displayName: string;
  capabilities: SourceCapabilities;
}

// ─── Request / Response shapes ───────────────────────────────────────────────

export interface ListOptions {
  status?: Status | 'all';
  saved?: boolean;
  source?: SourceId;
  limit?: number;
  offset?: number;
  /** Include the (potentially large) `content` field. Default: true. */
  includeContent?: boolean;
  /** Only updates whose title, summary or content contain every word (case-insensitive). */
  search?: string;
}

export interface ListResponse {
  updates: Update[];
  total: number;
  hasMore: boolean;
}

export interface FetchRequest {
  /** Which source IDs to fetch. Omit for all registered sources. */
  sources?: SourceId[];
}

export interface SourceFetchResult {
  fetched: number;
  added: number;
  error?: string;
}

export interface FetchResponse {
  added: number;
  results: Record<SourceId, SourceFetchResult>;
}

export interface StatsResponse {
  total: number;
  byStatus: Record<Status, number>;
  bySource: Record<SourceId, number>;
  saved: number;
}

// ─── Digest (AI topic grouping) ──────────────────────────────────────────────

/** How worth reading a topic is, as judged by the digest model. */
export type TopicImportance = 'high' | 'medium' | 'low';

export const TOPIC_IMPORTANCE: readonly TopicImportance[] = ['high', 'medium', 'low'];

export interface Topic {
  /** RowKey in the `topics` table. Synthetic entries use `item:<updateId>`. */
  id: string;
  title: string;
  /** One-sentence summary of what happened. */
  summary: string;
  /** Short bullet points with the key facts. */
  highlights: string[];
  /** Unset for topics not rated yet (and for items not digested yet). */
  importance?: TopicImportance;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
}

export interface DigestEntry {
  topic: Topic;
  /** Updates in this topic shown in the view (unread, or saved for the Saved view), newest first. */
  items: Update[];
  /** Newest `datePublished` among `items`. */
  latestDate: string;
  /** Distinct sources across `items`. */
  sources: SourceId[];
  /** True when the item has not been summarised yet (topic mirrors the single item). */
  synthetic: boolean;
}

export interface DigestQuery {
  /** Only updates (or topics) whose text contains every word (case-insensitive). */
  search?: string;
  /** Group saved updates (read or unread) instead of unread ones. */
  saved?: boolean;
  /** Only updates from this source. */
  source?: SourceId;
}

export interface DigestResponse {
  entries: DigestEntry[];
  /** Updates in the view not yet grouped into a topic (press f in the TUI). */
  pending: number;
}

// ─── Storage connection ──────────────────────────────────────────────────────

/**
 * How to reach Azure Table Storage.
 * - A full connection string (TUI; can create tables).
 * - A Table endpoint + SAS token (browser/PWA; entity access only).
 */
export type StoreConnection = string | SasConnection;

export interface SasConnection {
  /** e.g. `https://<account>.table.core.windows.net` */
  tableEndpoint: string;
  /** SAS token (with or without leading `?`). */
  sas: string;
}

// ─── Service contract ────────────────────────────────────────────────────────

/**
 * Storage-backed operations shared by the web app (SAS) and the TUI (connection string).
 * Node-only operations (scraping, summarising, backup) live on `FomoDirectService`.
 */
export interface FomoService {
  listUpdates(options?: ListOptions): Promise<ListResponse>;
  getUpdate(id: string): Promise<Update>;
  setStatus(id: string, status: Status): Promise<Update>;
  /** Set status on many updates (e.g. every item in a digest topic). */
  setStatusMany(ids: string[], status: Status): Promise<void>;
  setSaved(id: string, saved: boolean): Promise<Update>;
  getStats(): Promise<StatsResponse>;
  getDigest(query?: DigestQuery): Promise<DigestResponse>;
  getSources(): Promise<SourceInfo[]>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  listTodos(opts?: ListTodosOptions): Promise<ListTodosResponse>;
  getTodo(id: string): Promise<Todo>;
  createTodo(req: CreateTodoRequest): Promise<Todo>;
  updateTodo(id: string, patch: UpdateTodoRequest): Promise<Todo>;
  deleteTodo(id: string): Promise<void>;
}

// ─── Todos ───────────────────────────────────────────────────────────────────

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface Todo {
  /** Opaque ID: stored as RowKey in Azure Table Storage. */
  id: string;
  subject: string;
  description: string;
  /** ISO 8601 date string, e.g. '2024-12-31'. Optional. */
  dueDate?: string;
  status: TodoStatus;
  /** ISO 8601 datetime */
  createdAt: string;
  /** ISO 8601 datetime */
  updatedAt: string;
}

export interface CreateTodoRequest {
  subject: string;
  description?: string;
  dueDate?: string;
}

export interface UpdateTodoRequest {
  subject?: string;
  description?: string;
  dueDate?: string;
  status?: TodoStatus;
}

export interface ListTodosOptions {
  status?: TodoStatus | 'all';
}

export interface ListTodosResponse {
  todos: Todo[];
}

// ─── Centralised settings ────────────────────────────────────────────────────

export type PreviewPosition = 'right' | 'bottom' | 'off';

export interface AppSettings {
  /** Source IDs to skip during fetch (unless explicitly requested). */
  disabledSources: SourceId[];
  /** Where to show the preview panel in the UI. */
  previewPosition: PreviewPosition;
  /** Default page size for listing updates. */
  pageSize: number;
  /** Custom display labels per source (e.g. { github: "🐙 GH" }). Falls back to source id. */
  sourceLabels: Record<SourceId, string>;
  /** Custom display colors per source (e.g. { github: "#58a6ff" }). Falls back to default cyan. */
  sourceColors: Record<SourceId, string>;
}

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  disabledSources: [],
  previewPosition: 'right',
  pageSize: 50,
  sourceLabels: {},
  sourceColors: {},
};

