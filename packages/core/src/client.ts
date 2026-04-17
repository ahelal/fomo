import type {
  Update,
  ListOptions,
  ListResponse,
  FetchRequest,
  FetchResponse,
  StatsResponse,
  Status,
  SourceInfo,
  AppSettings,
} from './types.js';

export interface FomoClientConfig {
  baseUrl: string;
  /** Optional bearer token. When omitted, relies on session cookies (SSO). */
  token?: string;
}

/**
 * Common service interface for the FOMO backend.
 * Implemented by FomoClient (HTTP) and FomoDirectService (local store + scrapers).
 */
export interface FomoService {
  listUpdates(options?: ListOptions): Promise<ListResponse>;
  getUpdate(id: string): Promise<Update>;
  setStatus(id: string, status: Status): Promise<Update>;
  setSaved(id: string, saved: boolean): Promise<Update>;
  fetchContent(id: string): Promise<Update>;
  getStats(): Promise<StatsResponse>;
  fetch(req?: FetchRequest): Promise<FetchResponse>;
  getSources(): Promise<SourceInfo[]>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
}

export class FomoApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'FomoApiError';
  }
}

/**
 * Typed HTTP client for the FOMO API.
 * Works in both Node.js (>=18) and the browser — uses the global `fetch`.
 */
export class FomoClient implements FomoService {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(config: FomoClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> ?? {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: 'same-origin',
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new FomoApiError(res.status, body || res.statusText);
    }

    const text = await res.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  // ─── Updates ──────────────────────────────────────────────────────────────

  async listUpdates(options: ListOptions = {}): Promise<ListResponse> {
    const params = new URLSearchParams();
    if (options.status && options.status !== 'all') params.set('status', options.status);
    if (options.saved !== undefined) params.set('saved', String(options.saved));
    if (options.source) params.set('source', options.source);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    const qs = params.toString();
    return this.request<ListResponse>(`/updates${qs ? `?${qs}` : ''}`);
  }

  async getUpdate(id: string): Promise<Update> {
    return this.request<Update>(`/updates/${encodeURIComponent(id)}`);
  }

  async setStatus(id: string, status: Status): Promise<Update> {
    return this.request<Update>(`/updates/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async setSaved(id: string, saved: boolean): Promise<Update> {
    return this.request<Update>(`/updates/${encodeURIComponent(id)}/saved`, {
      method: 'PATCH',
      body: JSON.stringify({ saved }),
    });
  }

  async fetchContent(id: string): Promise<Update> {
    return this.request<Update>(`/updates/${encodeURIComponent(id)}/fetch-content`, {
      method: 'POST',
    });
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getStats(): Promise<StatsResponse> {
    return this.request<StatsResponse>('/stats');
  }

  // ─── Fetch (trigger scraping) ─────────────────────────────────────────────

  async fetch(req: FetchRequest = {}): Promise<FetchResponse> {
    return this.request<FetchResponse>('/fetch', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  // ─── Sources ──────────────────────────────────────────────────────────────

  async getSources(): Promise<SourceInfo[]> {
    return this.request<SourceInfo[]>('/sources');
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  async getSettings(): Promise<AppSettings> {
    return this.request<AppSettings>('/settings');
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.request<AppSettings>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  // ─── Health ───────────────────────────────────────────────────────────────

  async health(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('/health');
  }
}
