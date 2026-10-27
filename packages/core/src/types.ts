import type { UpdateSort } from './sort.js';
import type { YoutubeApi } from './scraper/youtube-api.js';

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
  /** Approximate minutes to read, derived from full article content in the feed. */
  readingTimeMinutes?: number;
  /** Exact video length in seconds, when available from the video page. */
  durationSeconds?: number;
  /** Digest topic this update was grouped into (set by the Copilot digest). */
  topicId?: string;
  /** One-sentence Copilot summary written when the update joins a topic. */
  summary?: string;
  /** Copilot summary of the full post, written on request in the TUI (`g`) and kept. */
  gist?: PostGist;
  /** Id of the earlier update this one repeats (same page or same title), set at fetch. */
  duplicateOf?: string;
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
  /** Approximate minutes to read, derived from full article content in the feed. */
  readingTimeMinutes?: number;
  /** Exact video length in seconds, when available from the video page. */
  durationSeconds?: number;
  /**
   * Stable identity used instead of `url` for the stored row, for items whose link changes or is
   * shared by several items (e.g. one Teams meeting chat for every occurrence of a recurring meeting).
   * A keyed item that is fetched again updates its stored row (see `ExperimentalProvider.merge`).
   */
  key?: string;
}

/**
 * A source is described by data (`SourceSpec`) and turned into a `SourcePlugin` by
 * `createSource()` in `scraper/factory.ts`. Built-ins live in `scraper/specs.ts`;
 * users add `feed`, `github-releases` and `youtube` sources from the app (`AppSettings.userSources`).
 */
export interface SourcePlugin {
  /** Unique slug, e.g. 'github', 'azure'. Used as PartitionKey in Table Storage. */
  readonly id: string;
  /** Human-readable name shown in the UI. */
  readonly displayName: string;
  /** Declares what this source is capable of. */
  readonly capabilities: SourceCapabilities;
  /** Fetch scraped items. Throw on failure so the service can report per-source errors. */
  fetch(): Promise<ScrapedItem[]>;
}

/** Host-controlled adapter for fetching through an approved, isolated extension. */
export interface SourceExtension {
  fetch(input: {
    sourceId: SourceId;
    options: Readonly<Record<string, string>>;
  }): Promise<ScrapedItem[]>;
}

/** Optional host clients. Code-backed sources require an extension adapter; they have no in-process fallback. */
export interface SourceDeps {
  /** YouTube Data API client (the TUI makes one when a key is set). */
  youtube?: YoutubeApi;
  /** Host-approved extension adapters, keyed by immutable extension ID. */
  extensions?: Readonly<Record<string, SourceExtension>>;
}

interface SourceSpecBase {
  /** Unique slug; the PartitionKey of the source's updates, so it never changes. */
  id: SourceId;
  displayName: string;
}

/** One or more RSS/Atom feeds, merged and deduplicated by URL. */
export interface FeedSourceSpec extends SourceSpecBase {
  kind: 'feed';
  urls: string[];
  /** Keep only items whose title or content matches this case-insensitive regex. */
  include?: string;
  /** Keep only items tagged with this category (RSS `<category>` or Atom `term`). */
  category?: string;
}

/** Releases of a GitHub repository. */
export interface GithubReleasesSourceSpec extends SourceSpecBase {
  kind: 'github-releases';
  /** `owner/name` */
  repo: string;
  /** Optional repository-relative Markdown changelog used in place of release bodies. */
  changelogPath?: string;
}

/**
 * Uploads of a YouTube channel, or one playlist. Only the TUI fetches it: with a YouTube Data API
 * key from the YouTube Data API v3 (with video lengths), otherwise from YouTube's public Atom feeds.
 * `@handle` and legacy channel paths are resolved to a `UC…` id at fetch time.
 */
export interface YoutubeSourceSpec extends SourceSpecBase {
  kind: 'youtube';
  /** `UC…` channel id, `@handle`, `c/Name` or `user/Name`. Unused with `playlist`. */
  channel?: string;
  /** `PL…` playlist id. */
  playlist?: string;
  /** Include Shorts. Off (the default) keeps regular videos and past live streams. */
  shorts?: boolean;
  /** Keep only videos whose title or description matches this case-insensitive regex. */
  include?: string;
}

/** An installed extension source. The extension ID is stable; display names live in settings. */
export interface ExtensionSourceSpec extends SourceSpecBase {
  kind: 'custom';
  extension: string;
  /** Manifest name used until the user sets an extension display-name override. */
  extensionName?: string;
  options?: Record<string, string>;
  /** Defaults to true. */
  preview?: boolean;
}

/** Legacy source spec retained while older settings and built-ins are migrated. */
export interface LegacyCustomSourceSpec extends SourceSpecBase {
  kind: 'custom';
  module: string;
  options?: Record<string, string>;
  preview?: boolean;
}

export type CustomSourceSpec = ExtensionSourceSpec | LegacyCustomSourceSpec;
export type SourceSpec = FeedSourceSpec | GithubReleasesSourceSpec | YoutubeSourceSpec | CustomSourceSpec;
export type SourceKind = SourceSpec['kind'];
/** Kinds users can add from the app; `custom` needs code. */
export type UserSourceSpec = FeedSourceSpec | GithubReleasesSourceSpec | YoutubeSourceSpec;

/** Source metadata exposed to the UI and API consumers. */
export interface SourceInfo {
  id: SourceId;
  displayName: string;
  capabilities: SourceCapabilities;
  kind: SourceKind;
  /** Shipped with the app (removing it hides it) rather than added by the user. */
  builtin: boolean;
  /** Feed URLs, the GitHub repo or the YouTube channel, for display. */
  location?: string;
  /** What a feed keeps, for display: its keyword regex and/or category. */
  filter?: string;
  /** Immutable code identity; display names are independently configurable. */
  extensionId?: string;
  /** User-facing extension name, used in the source type label. */
  extensionName?: string;
  /** Removed, but some of its updates are still stored (see `retiredSources`). */
  removed?: boolean;
  /** An experimental source fetched by the terminal app only, when turned on there (see `experimental.ts`). */
  experimental?: boolean;
}

// ─── Request / Response shapes ───────────────────────────────────────────────

export interface ListOptions {
  status?: Status | 'all';
  saved?: boolean;
  /** Only updates from these sources; an empty list matches nothing. */
  sources?: SourceId[];
  limit?: number;
  offset?: number;
  /** Include the (potentially large) `content` field. Default: true. */
  includeContent?: boolean;
  /** Only updates whose title, summary or content contain every word (case-insensitive). */
  search?: string;
  /** Order before `offset`/`limit` are applied. Default: newest first. */
  sort?: UpdateSort;
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
  /** Items skipped because the same page is already stored (under another URL or source). */
  duplicates?: number;
  error?: string;
  /**
   * The source was turned off while it was fetched (an experimental source): the rest of what it fetched was
   * dropped and its fetch history kept as it was. Not an error.
   */
  stopped?: boolean;
}

export interface FetchResponse {
  added: number;
  results: Record<SourceId, SourceFetchResult>;
}

/** Fetch history of one source, kept in storage across runs. */
export interface SourceFetchStatus {
  /** ISO 8601 time of the last fetch attempt. */
  lastFetchAt?: string;
  /** ISO 8601 time the newest update from this source was added. */
  lastAddedAt?: string;
  /** Error of the last fetch attempt; unset when it succeeded. */
  lastError?: string;
}

export interface StatsResponse {
  total: number;
  byStatus: Record<Status, number>;
  bySource: Record<SourceId, number>;
  /** Saved updates per source (only sources that have some). */
  savedBySource?: Record<SourceId, number>;
  saved: number;
  /** Fetch history per source. */
  sourceStatus?: Record<SourceId, SourceFetchStatus>;
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
  /** Only updates from these sources; an empty list matches nothing. */
  sources?: SourceId[];
}

/** A view (as listed or grouped) whose updates are counted per source, ignoring any source filter. */
export interface SourceCountQuery {
  status?: Status | 'all';
  saved?: boolean;
  search?: string;
  /** Count the topic view (search also matches topic text) instead of the plain list. */
  grouped?: boolean;
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
  /** Delete every stored update of a source (saved ones too); the next fetch adds them back as new. Returns how many. */
  deleteSourceUpdates(source: SourceId): Promise<number>;
  getStats(): Promise<StatsResponse>;
  getDigest(query?: DigestQuery): Promise<DigestResponse>;
  /**
   * The other updates that repeat the same post as `id`: its original first, then its copies,
   * without content. Empty when `id` is not part of a duplicate group.
   */
  getDuplicates(id: string): Promise<Update[]>;
  /** Updates per source in a view, to pick which sources to show. */
  countSources(query: SourceCountQuery): Promise<Record<SourceId, number>>;
  getSources(): Promise<SourceInfo[]>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  listTodos(opts?: ListTodosOptions): Promise<ListTodosResponse>;
  getTodo(id: string): Promise<Todo>;
  createTodo(req: CreateTodoRequest): Promise<Todo>;
  updateTodo(id: string, patch: UpdateTodoRequest): Promise<Todo>;
  deleteTodo(id: string): Promise<void>;
  listReferences(): Promise<ListReferencesResponse>;
  getReference(id: string): Promise<Reference>;
  /** Throws when a reference with the same URL already exists. */
  createReference(req: CreateReferenceRequest): Promise<Reference>;
  updateReference(id: string, patch: UpdateReferenceRequest): Promise<Reference>;
  deleteReference(id: string): Promise<void>;
  /** Rename a folder: every reference in it (and its subfolders) moves under `to`. Returns how many moved. */
  moveReferenceFolder(from: string, to: string): Promise<number>;
  /** Color a Bookmarks folder (`''` clears it); returns every folder color. */
  setReferenceFolderColor(folder: string, color: string): Promise<FolderColorMap>;
  /** Set or clear metadata on a Bookmarks folder. */
  setReferenceFolderMetadata(folder: string, metadata: FolderMetadata): Promise<FolderMetadataMap>;
  /**
   * Delete a Bookmarks folder: `parent` lifts its bookmarks and subfolders into the parent folder,
   * `all` deletes them too. Returns how many bookmarks moved or were deleted.
   */
  deleteReferenceFolder(folder: string, mode: DeleteFolderMode): Promise<number>;
  /** Rename a Todos folder, like `moveReferenceFolder`. Returns how many todos moved. */
  moveTodoFolder(from: string, to: string): Promise<number>;
  /** Color a Todos folder (`''` clears it); returns every folder color. */
  setTodoFolderColor(folder: string, color: string): Promise<FolderColorMap>;
  /** Set or clear metadata on a Todos/Ideas folder. */
  setTodoFolderMetadata(folder: string, metadata: FolderMetadata): Promise<FolderMetadataMap>;
  /** Delete a Todos folder, like `deleteReferenceFolder`. */
  deleteTodoFolder(folder: string, mode: DeleteFolderMode): Promise<number>;
}

/** How a folder is deleted: `parent` lifts its contents into the parent folder; `all` deletes them. */
export type DeleteFolderMode = 'parent' | 'all';

/** Folder path → `#rrggbb`; a folder without a color shows its parent's. */
export type FolderColorMap = Record<string, string>;

// ─── References (bookmarks filed into folders) ───────────────────────────────

export interface Reference {
  /** Opaque ID: stored as RowKey in Azure Table Storage. */
  id: string;
  title: string;
  url: string;
  /** Folder path, segments joined with `/` (e.g. `ai/agents`); `''` is the top level. */
  folder: string;
  /** Your own note, or the one Copilot suggested. */
  description: string;
  /** The feed update this was filed from, if any. */
  updateId?: string;
  /** `#rrggbb` tag color, if one was picked. */
  color?: string;
  /** ISO 8601 datetime */
  createdAt: string;
  /** ISO 8601 datetime */
  updatedAt: string;
}

export interface CreateReferenceRequest {
  title: string;
  url: string;
  folder?: string;
  description?: string;
  updateId?: string;
  /** `#rrggbb`; `''` or omitted for none. */
  color?: string;
}

export interface UpdateReferenceRequest {
  title?: string;
  url?: string;
  folder?: string;
  description?: string;
  /** `#rrggbb`, or `''` to clear it. */
  color?: string;
}

export interface ListReferencesResponse {
  references: Reference[];
  folderColors?: FolderColorMap;
  folderMetadata?: FolderMetadataMap;
}

/** Copilot's proposal for filing a link (TUI only). */
export interface ReferenceSuggestion {
  title: string;
  folder: string;
  description: string;
}

// ─── Todos ───────────────────────────────────────────────────────────────────

export type TodoStatus = 'pending' | 'in_progress' | 'done';
export type TodoKind = 'todo' | 'idea';

export interface Todo {
  /** Opaque ID: stored as RowKey in Azure Table Storage. */
  id: string;
  subject: string;
  /** Missing on records created before todo/idea support; those are todos. */
  kind?: TodoKind;
  /** Optional multiline notes, stored as plain text; empty when not supplied. */
  description: string;
  /** URL or filesystem path references, not uploaded files. */
  attachments?: string[];
  /** ISO 8601 date string, e.g. '2024-12-31'. Optional. */
  dueDate?: string;
  status: TodoStatus;
  /** Folder path, segments joined with `/` (e.g. `work/fomo`); `''` is the top level. */
  folder: string;
  /** `#rrggbb` tag color, if one was picked. */
  color?: string;
  /** ISO 8601 datetime */
  createdAt: string;
  /** ISO 8601 datetime */
  updatedAt: string;
}

export interface CreateTodoRequest {
  subject: string;
  kind?: TodoKind;
  description?: string;
  attachments?: string[];
  dueDate?: string;
  folder?: string;
  /** `#rrggbb`; `''` or omitted for none. */
  color?: string;
}

export interface UpdateTodoRequest {
  subject?: string;
  kind?: TodoKind;
  description?: string;
  /** Replaces the references; `[]` removes them all. Omit to keep them unchanged. */
  attachments?: string[];
  /** ISO date, or `''` to clear it. */
  dueDate?: string;
  status?: TodoStatus;
  folder?: string;
  /** `#rrggbb`, or `''` to clear it. */
  color?: string;
}

export interface ListTodosOptions {
  status?: TodoStatus | 'all';
}

export interface ListTodosResponse {
  todos: Todo[];
  folderColors?: FolderColorMap;
  folderMetadata?: FolderMetadataMap;
}

/** Optional folder metadata, without granting access to either target. */
export interface FolderMetadata {
  localPath?: string;
  githubRepo?: string;
}

/** Folder path → its optional local directory and GitHub repository. */
export type FolderMetadataMap = Record<string, FolderMetadata>;

// ─── Centralised settings ────────────────────────────────────────────────────

export type PreviewPosition = 'right' | 'bottom' | 'off';

export interface AppSettings {
  /** Source IDs to skip during fetch (unless explicitly requested). */
  disabledSources: SourceId[];
  /** Where to show the preview panel in the UI. */
  previewPosition: PreviewPosition;
  /** Default page size for listing updates. */
  pageSize: number;
  /** Short display labels per source (e.g. { github: "🐙 GH" }). Falls back to its configured name. */
  sourceLabels: Record<SourceId, string>;
  /** Custom source names, independent of the optional short labels. */
  sourceNames: Record<SourceId, string>;
  /** Custom extension display names, independent of stable extension IDs. */
  extensionNames: Record<string, string>;
  /** Custom display colors per source (e.g. { github: "#58a6ff" }). Falls back to default cyan. */
  sourceColors: Record<SourceId, string>;
  /** Sources added by the user from the app. */
  userSources: UserSourceSpec[];
  /** Former built-ins retained for accounts that existed before the default source list changed. */
  installedLegacySources: SourceId[];
  /** Version of the shipped default-source list used to initialize this account. */
  sourceDefaultsVersion: number;
  /** Built-in sources the user removed. */
  removedSources: SourceId[];
}

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  disabledSources: [],
  previewPosition: 'right',
  pageSize: 50,
  sourceLabels: {},
  sourceNames: {},
  extensionNames: {},
  sourceColors: {},
  userSources: [],
  installedLegacySources: [],
  sourceDefaultsVersion: 3,
  removedSources: [],
};
