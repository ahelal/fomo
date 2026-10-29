import type { KeyedChange } from './store/tables.js';
import type { AppSettings, ScrapedItem, SharePointSourceDescriptor, SourceInfo, Update } from './types.js';

export type { KeyedChange };

/**
 * Experimental sources are not `SourceSpec`s: their items come from an `ExperimentalProvider` that the
 * terminal app plugs into `FomoDirectService` when the user turns the source on there (it needs a
 * local sign-in). They are never fetched by default and the web app only shows what was stored.
 */

/** Teams meetings I missed, or that have a recording or a transcript (TUI, via WorkIQ). */
export const TEAMS_MEETINGS_SOURCE = 'teams-meetings';
export const SHAREPOINT_SOURCE_PREFIX = 'sharepoint-';
const SHAREPOINT_SOURCE_ID = /^sharepoint-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isSharePointSourceId = (id: string): boolean => SHAREPOINT_SOURCE_ID.test(id);

export const EXPERIMENTAL_SOURCE_INFOS: readonly SourceInfo[] = [
  {
    id: TEAMS_MEETINGS_SOURCE,
    displayName: 'Teams meetings',
    capabilities: { preview: true },
    kind: 'custom',
    builtin: false,
    experimental: true,
    extensionId: 'teams-meetings',
    extensionName: 'Teams meetings',
    location: 'UNSANDBOXED WorkIQ; host filesystem and network access',
    filter: 'missed, recorded or transcribed meetings of the last 7 days',
  },
];

/** The experimental sources with the names the user gave them and their extensions. */
export function experimentalSourceInfos(settings: Partial<Pick<AppSettings, 'sourceNames' | 'extensionNames' | 'sharePointSources'>> = {}): SourceInfo[] {
  const teams = EXPERIMENTAL_SOURCE_INFOS.map((info) => ({
    ...info,
    displayName: settings.sourceNames?.[info.id] || info.displayName,
    ...(info.extensionId ? { extensionName: settings.extensionNames?.[info.extensionId] || info.extensionName || info.extensionId } : {}),
  }));
  const sharepoint = (settings.sharePointSources ?? []).filter((source) => source.lifecycle !== 'purged').map((source): SourceInfo => ({
    id: source.id,
    displayName: settings.sourceNames?.[source.id] || source.displayName,
    capabilities: { preview: true },
    kind: 'custom',
    builtin: false,
    experimental: true,
    extensionId: 'sharepoint',
    extensionName: settings.extensionNames?.sharepoint || 'SharePoint',
    location: `UNSANDBOXED WorkIQ; page text from ${source.listName} at ${source.siteHost}`,
    filter: 'page-text revisions from the selected list',
    ...(source.lifecycle !== 'active' ? { removed: true } : {}),
  }));
  return [...teams, ...sharepoint];
}

export function experimentalSourceInfo(id: string, sources: readonly SharePointSourceDescriptor[] = []): SourceInfo | undefined {
  return experimentalSourceInfos({ sharePointSources: [...sources] }).find((s) => s.id === id);
}

export function isExperimentalSource(id: string): boolean {
  return EXPERIMENTAL_SOURCE_INFOS.some((s) => s.id === id) || isSharePointSourceId(id);
}

/** Fetches the items of one experimental source. Node-only implementations live in the terminal app. */
export interface ExperimentalProvider {
  /** One of `EXPERIMENTAL_SOURCE_INFOS`. */
  readonly id: string;
  fetch(signal?: AbortSignal): Promise<ScrapedItem[]>;
  /**
   * What a keyed item that is already stored changes, or undefined to leave it as it is.
   * Default: the fetched title, URL, content and date.
   */
  merge?(existing: Update, fetched: ScrapedItem): KeyedChange | undefined | Promise<KeyedChange | undefined>;
  /** One operation's worker, kept alive through its keyed merges. */
  open?(): Promise<ExperimentalProvider>;
  assertActive?(): void;
  close?(): Promise<void>;
  acknowledge?(key: string): Promise<void>;
}
