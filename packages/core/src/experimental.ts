import type { KeyedChange } from './store/tables.js';
import type { AppSettings, ScrapedItem, SourceInfo, Update } from './types.js';

export type { KeyedChange };

/**
 * Experimental sources are not `SourceSpec`s: their items come from an `ExperimentalProvider` that the
 * terminal app plugs into `FomoDirectService` when the user turns the source on there (it needs a
 * local sign-in). They are never fetched by default and the web app only shows what was stored.
 */

/** Teams meetings I missed, or that have a recording or a transcript (TUI, via WorkIQ). */
export const TEAMS_MEETINGS_SOURCE = 'teams-meetings';

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
export function experimentalSourceInfos(settings: Partial<Pick<AppSettings, 'sourceNames' | 'extensionNames'>> = {}): SourceInfo[] {
  return EXPERIMENTAL_SOURCE_INFOS.map((info) => ({
    ...info,
    displayName: settings.sourceNames?.[info.id] || info.displayName,
    ...(info.extensionId ? { extensionName: settings.extensionNames?.[info.extensionId] || info.extensionName || info.extensionId } : {}),
  }));
}

export function experimentalSourceInfo(id: string): SourceInfo | undefined {
  return EXPERIMENTAL_SOURCE_INFOS.find((s) => s.id === id);
}

export function isExperimentalSource(id: string): boolean {
  return EXPERIMENTAL_SOURCE_INFOS.some((s) => s.id === id);
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
}
