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
  content: string;
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
}

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  disabledSources: [],
  previewPosition: 'right',
  pageSize: 50,
  sourceLabels: {},
};

