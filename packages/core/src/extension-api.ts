import type { ScrapedItem } from './types.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Version 1 of the worker API. Every capability is bound by the host, not by extension input. */
export interface ExtensionContext {
  options: Readonly<Record<string, string>>;
  signal: AbortSignal;
  http: {
    text(url: string): Promise<string>;
    json<T = unknown>(url: string): Promise<T>;
  };
  mcp: { call(binding: string, tool: string, args: Record<string, Json>): Promise<unknown> };
  state: { get(key: string): Promise<Json | undefined>; set(key: string, value: Json): Promise<void> };
  log(message: string): void;
}

export type { ScrapedItem };
export { TEAMS_MEETINGS_SOURCE } from './experimental.js';
export { decodeEntities, dedupByUrl, htmlToText, parseDate } from './scraper/text.js';
export { releaseItems, type GithubRelease } from './scraper/github.js';
