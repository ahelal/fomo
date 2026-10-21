import type { ScrapedItem } from '../../../types.js';
import { fetchAnthropic } from './anthropic.js';
import { fetchCopilotCli } from './copilot-cli.js';

/** Fetches the items of a custom source; `options` come from its `CustomSourceSpec`. */
export type CustomFetcher = (options: Record<string, string>) => Promise<ScrapedItem[]>;

/**
 * Code-backed sources, keyed by the `module` of a `CustomSourceSpec` (the file name in this folder).
 * Build them on the shared helpers in `scraper/` (`http`, `text`, `feed`, `github`).
 */
export const CUSTOM_MODULES: Readonly<Record<string, CustomFetcher>> = {
  anthropic: fetchAnthropic,
  'copilot-cli': fetchCopilotCli,
};
