import { EXPERIMENTAL_SOURCE_INFOS, type SourceInfo } from '@fomo/core';
import { copilotTokenEnv, DEFAULT_COPILOT_MODEL } from '../copilot.js';
import {
  autoFetchInterval,
  CONFIG_FILE,
  connectionStringProblem,
  DEFAULT_AUTO_FETCH_MINUTES,
  DEFAULT_DIGEST_MAX_ITEMS,
  DEFAULT_LINK_DAYS,
  DEFAULT_PROFILE,
  defaultBackupDir,
  envSource,
  isAutoFetchMinutes,
  MAX_AUTO_FETCH_MINUTES,
  MIN_AUTO_FETCH_MINUTES,
  maskConnectionString,
  maskSecret,
  tildify,
  untildify,
  youtubeApiKeyProblem,
  type LocalConfig,
} from '../config.js';

export type ConfigField = keyof LocalConfig;
export type ActionId = 'link' | 'webapp' | 'regroup' | 'backup' | 'restore' | 'profiles';

export type SettingsRow =
  | { kind: 'header'; key: string; label: string; collapsed: boolean; count: number }
  | { kind: 'source-columns'; key: string }
  | { kind: 'action'; key: string; action: ActionId; label: string; hint: string }
  | { kind: 'source'; key: string; source: SourceInfo }
  | { kind: 'add-source'; key: string }
  | { kind: 'restore-sources'; key: string; count: number }
  | { kind: 'experimental'; key: string; source: SourceInfo }
  | { kind: 'preview'; key: string }
  | { kind: 'config'; key: string; field: ConfigField; label: string };

const ACTIONS: { action: ActionId; label: string; hint: string }[] = [
  { action: 'link', label: 'Link a device', hint: 'magic link + QR code that connects the web app' },
  { action: 'webapp', label: 'Show web app QR', hint: 'QR code of the web app URL to open it on your phone · o opens it here' },
  { action: 'regroup', label: 'Regroup all topics', hint: 'rerun Copilot on every unread and saved update (takes a few minutes)' },
  { action: 'backup', label: 'Back up updates', hint: 'save all updates as JSON in the backup folder' },
  { action: 'restore', label: 'Restore from backup', hint: 'pick a backup file from the backup folder' },
  { action: 'profiles', label: 'Switch profile', hint: 'another storage account, or add one · w from anywhere' },
];

const CONFIG_FIELDS: { field: ConfigField; label: string }[] = [
  { field: 'connectionString', label: 'Connection string' },
  { field: 'webUrl', label: 'Web app URL' },
  { field: 'copilotModel', label: 'Copilot model' },
  { field: 'copilotAccount', label: 'Copilot account' },
  { field: 'interests', label: 'Interests' },
  { field: 'groupingHints', label: 'Grouping hints' },
  { field: 'youtubeApiKey', label: 'YouTube API key' },
  { field: 'autoFetch', label: 'Auto-fetch (minutes)' },
  { field: 'autoDigest', label: 'Group after fetch' },
  { field: 'digestMaxItems', label: 'Max items per run' },
  { field: 'linkDays', label: 'Link valid (days)' },
  { field: 'backupDir', label: 'Backup folder' },
];

export const ADD_SOURCE_KEY = 'add-source';

/** Section header keys, used to collapse a section. */
export const SECTION_KEYS = ['h-actions', 'h-sources', 'h-experimental', 'h-display', 'h-local'] as const;

/** Whether this profile turned an experimental source on. */
export const experimentalOn = (config: LocalConfig, id: string): boolean => !!config.experimentalSources?.includes(id);

/** What the running fetch covers: every source that is on (`all`), or only these. */
export type FetchScope = 'all' | readonly string[];

/** Whether the running fetch covers this source; `on` tells whether a fetch of every source includes it. */
export const fetchCovers = (scope: FetchScope | undefined, id: string, on: boolean): boolean =>
  scope === 'all' ? on : !!scope?.includes(id);

/**
 * Config screen rows; rows of the sections in `collapsed` (header keys) are left out.
 * With `matches`, only matching rows are kept (all of a section whose title matches), sections without
 * any are dropped, and every section is shown open.
 */
export function buildSettingsRows(
  sources: SourceInfo[],
  collapsed: ReadonlySet<string> = new Set(),
  matches?: (row: SettingsRow) => boolean,
  removedSources = 0,
  /** Removed sources whose updates are still stored, shown greyed out after “Add source”. */
  retired: SourceInfo[] = [],
  /** Profile in use; named in the local section's title when given (only when there is more than one). */
  profile?: string,
  /** The experimental sources, with the names the user gave them. */
  experimental: readonly SourceInfo[] = EXPERIMENTAL_SOURCE_INFOS,
): SettingsRow[] {
  const sourceRows: SettingsRow[] = [
    ...sources.map((source) => ({ kind: 'source' as const, key: `s-${source.id}`, source })),
    { kind: 'add-source', key: ADD_SOURCE_KEY },
    ...retired.map((source) => ({ kind: 'source' as const, key: `s-${source.id}`, source })),
    ...(removedSources > 0 ? [{ kind: 'restore-sources' as const, key: 'restore-sources', count: removedSources }] : []),
  ];
  const section = (key: string, label: string, all: SettingsRow[], columnHeader?: SettingsRow): SettingsRow[] => {
    let rows = all;
    if (matches) {
      const header: SettingsRow = { kind: 'header', key, label, collapsed: false, count: all.length };
      if (!matches(header)) rows = all.filter(matches);
      if (rows.length === 0) return [];
    }
    const folded = !matches && collapsed.has(key);
    return [
      { kind: 'header', key, label, collapsed: folded, count: rows.length },
      ...(folded ? [] : [...(columnHeader ? [columnHeader] : []), ...rows]),
    ];
  };
  return [
    ...section('h-actions', 'Actions', ACTIONS.map((a) => ({ kind: 'action' as const, key: `a-${a.action}`, ...a }))),
    ...section('h-sources', 'Sources · shared with the web app', sourceRows, { kind: 'source-columns', key: 'source-columns' }),
    ...section('h-experimental', 'Experimental sources · this computer', experimental.map((source) => ({ kind: 'experimental' as const, key: `x-${source.id}`, source }))),
    ...section('h-display', 'Display · shared with the web app', [{ kind: 'preview', key: 'preview' }]),
    ...section('h-local', `This computer${profile ? ` · profile ${profile}` : ''} · ${tildify(CONFIG_FILE)}`, CONFIG_FIELDS.map((f) => ({ kind: 'config' as const, key: `c-${f.field}`, ...f }))),
  ];
}

/** The first row that is not a section header (or the first header when every section is collapsed). */
export function firstFocusable(rows: SettingsRow[]): number {
  return Math.max(0, rows.findIndex((r) => r.kind !== 'header' && r.kind !== 'source-columns'));
}

/** Move the focus by `delta` rows (headers included, so sections can be collapsed), staying in range. */
export function moveFocus(rows: SettingsRow[], index: number, delta: number): number {
  const direction = Math.sign(delta);
  let next = Math.max(0, Math.min(rows.length - 1, index + delta));
  while (direction && rows[next]?.kind === 'source-columns') {
    next = Math.max(0, Math.min(rows.length - 1, next + direction));
  }
  return next;
}

/** Index of the header of the section `index` is in. */
export function sectionHeaderIndex(rows: SettingsRow[], index: number): number {
  for (let i = Math.min(index, rows.length - 1); i >= 0; i--) if (rows[i]!.kind === 'header') return i;
  return 0;
}

/** Header key of the section that holds the row `key` (rows of collapsed sections included). */
export function sectionOf(sources: SourceInfo[], key: string): string | undefined {
  const rows = buildSettingsRows(sources);
  const i = findRow(rows, key);
  return i < 0 ? undefined : rows[sectionHeaderIndex(rows, i)]!.key;
}

export function findRow(rows: SettingsRow[], key: string): number {
  return rows.findIndex((r) => r.key === key);
}

/** What Copilot uses when no Copilot account is chosen. */
export function automaticAccount(): string {
  const tokenEnv = copilotTokenEnv();
  return tokenEnv ? `token in ${tokenEnv}` : 'gh’s active account';
}

/** What the config screen shows for a local setting. `file` is the profile's stored config. */
export function configDisplay(
  config: LocalConfig,
  field: ConfigField,
  file: LocalConfig,
  profile: string = DEFAULT_PROFILE,
): { value: string; muted: boolean; env?: string } {
  const env = envSource(field, file);
  const muted = (value: string) => ({ value, muted: true, env });
  switch (field) {
    case 'connectionString':
      return config.connectionString ? { value: maskConnectionString(config.connectionString), muted: false, env } : muted('(not set)');
    case 'webUrl':
      return config.webUrl ? { value: config.webUrl, muted: false, env } : muted('(not set — needed to link a device)');
    case 'copilotModel':
      return config.copilotModel ? { value: config.copilotModel, muted: false, env } : muted(`${DEFAULT_COPILOT_MODEL} (default)`);
    case 'copilotAccount':
      return config.copilotAccount ? { value: config.copilotAccount, muted: false } : muted(`automatic — ${automaticAccount()}`);
    case 'interests':
      return config.interests ? { value: config.interests, muted: false, env } : muted('(none)');
    case 'groupingHints':
      return config.groupingHints ? { value: config.groupingHints, muted: false, env } : muted('(none — e.g. one topic per Copilot surface)');
    case 'youtubeApiKey':
      return config.youtubeApiKey ? { value: maskSecret(config.youtubeApiKey), muted: false, env } : muted('(not set · public feeds, no video lengths)');
    case 'autoFetch':
    case 'autoFetchMinutes': {
      const minutes = autoFetchInterval(config);
      if (minutes === undefined) return muted('off — fetch only with f');
      const value = `every ${minutes} minute${minutes === 1 ? '' : 's'} while open`;
      return config.autoFetchMinutes ? { value, muted: false } : muted(`${value} (default)`);
    }
    case 'autoDigest':
      return { value: config.autoDigest === false ? 'off — fetch only' : 'on', muted: false };
    case 'digestMaxItems':
      return config.digestMaxItems ? { value: String(config.digestMaxItems), muted: false } : muted(`${DEFAULT_DIGEST_MAX_ITEMS} (default)`);
    case 'linkDays':
      return config.linkDays ? { value: String(config.linkDays), muted: false } : muted(`${DEFAULT_LINK_DAYS} (default)`);
    case 'backupDir':
      return config.backupDir ? { value: tildify(config.backupDir), muted: false } : muted(`${tildify(defaultBackupDir(profile))} (default)`);
    case 'experimentalSources':
      return config.experimentalSources?.length ? { value: config.experimentalSources.join(', '), muted: false } : muted('(none)');
  }
}

/** Settings never shown in full: masked while typed, in the list and in the audit log. */
export const isSecretField = (field: string): boolean => field === 'connectionString' || field === 'youtubeApiKey';

/** A secret setting's value for display. */
export const maskSetting = (field: string, value: string): string =>
  field === 'connectionString' ? maskConnectionString(value) : maskSecret(value);

/** On/off settings toggled with ↵ instead of edited as text. */
export const TOGGLE_FIELDS = ['autoDigest'] as const;
export type ToggleField = (typeof TOGGLE_FIELDS)[number];
export const isToggleField = (field: ConfigField): field is ToggleField =>
  (TOGGLE_FIELDS as readonly ConfigField[]).includes(field);

/** Settings chosen from a list (opened with ↵) instead of typed. */
export const PICKER_FIELDS = ['copilotAccount'] as const;
export type PickerField = (typeof PICKER_FIELDS)[number];
export const isPickerField = (field: ConfigField): field is PickerField =>
  (PICKER_FIELDS as readonly ConfigField[]).includes(field);

/** Steps of adding a source: what is typed, and the footer prompt. */
export type AddSourceStep = 'url' | 'name' | 'include' | 'changelog';
export interface AddSourceDraft { step: AddSourceStep; url: string; name: string; changelogPath?: string }

export const ADD_SOURCE_PROMPTS: Record<AddSourceStep, string> = {
  url: 'feed URL(s) or github.com/owner/repo — several feeds: separate with spaces',
  name: 'a name   (empty keeps the suggestion)',
  include: 'keywords to keep, as a regex, e.g. copilot|agents   (empty keeps everything)',
  changelog: 'changelog file path (empty uses GitHub release notes)',
};

/** Starting text when editing a field, from the profile's stored config `file`. Secrets start empty so they are never shown. */
export function editStartValue(field: ConfigField, file: LocalConfig): string {
  if (isSecretField(field) || isToggleField(field)) return '';
  if (field === 'autoFetch') {
    return file.autoFetch === false ? 'off' : file.autoFetchMinutes ? String(file.autoFetchMinutes) : '';
  }
  const value = file[field];
  if (value === undefined) return '';
  return field === 'backupDir' ? tildify(String(value)) : String(value);
}

/** Turn edited text into a config patch. An empty value restores the default. */
export function parseConfigEdit(field: ConfigField, text: string): { patch: Partial<LocalConfig> } | { error: string } {
  const value = text.trim();
  if (field === 'autoFetch' || field === 'autoFetchMinutes') {
    if (!value) return { patch: { autoFetch: undefined, autoFetchMinutes: undefined } };
    if (/^(off|no|0)$/i.test(value)) return { patch: { autoFetch: false } };
    const n = Number(value);
    if (!isAutoFetchMinutes(n)) {
      return { error: `Auto-fetch takes whole minutes from ${MIN_AUTO_FETCH_MINUTES} to ${MAX_AUTO_FETCH_MINUTES}, or off` };
    }
    return { patch: { autoFetch: undefined, autoFetchMinutes: n === DEFAULT_AUTO_FETCH_MINUTES ? undefined : n } };
  }
  if (!value) {
    if (field === 'connectionString') return { error: 'Connection string can’t be empty' };
    return { patch: { [field]: undefined } };
  }
  switch (field) {
    case 'linkDays':
    case 'digestMaxItems': {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) return { error: `${field === 'linkDays' ? 'Link validity' : 'Max items'} must be a whole number above 0` };
      return { patch: { [field]: n } };
    }
    case 'webUrl':
      if (!/^https?:\/\//i.test(value)) return { error: 'Web app URL must start with http:// or https://' };
      return { patch: { webUrl: value } };
    case 'backupDir':
      return { patch: { backupDir: untildify(value) } };
    case 'connectionString': {
      const problem = connectionStringProblem(value);
      return problem ? { error: problem } : { patch: { connectionString: value } };
    }
    case 'youtubeApiKey': {
      const problem = youtubeApiKeyProblem(value);
      return problem ? { error: problem } : { patch: { youtubeApiKey: value } };
    }
    case 'autoDigest':
      return { error: 'Press ↵ to toggle' };
    default:
      return { patch: { [field]: value } };
  }
}

/** The text of a row that `/` searches. `file` and `profile` are the profile's stored config and name; `sourceLabel` gives a source's custom label. */
export function settingsRowText(
  row: SettingsRow,
  config: LocalConfig,
  file: LocalConfig,
  profile: string,
  sourceLabel: (id: string) => string = () => '',
): string {
  switch (row.kind) {
    case 'header': return row.label;
    case 'source-columns': return '';
    case 'action': return `${row.label} ${row.hint}`;
    case 'source': return `${row.source.displayName} ${row.source.id} ${sourceLabel(row.source.id)} ${row.source.kind} ${row.source.location ?? ''}`;
    case 'add-source': return 'Add source feed rss atom github releases youtube';
    case 'restore-sources': return 'Restore removed sources';
    case 'experimental': return `${row.source.displayName} ${row.source.id} ${sourceLabel(row.source.id)} experimental ${row.source.extensionName ?? ''} ${row.source.location ?? ''} ${experimentalOn(config, row.source.id) ? 'on' : 'off'}`;
    case 'preview': return 'Preview position right bottom off';
    case 'config': return `${row.label} ${row.field} ${configDisplay(config, row.field, file, profile).value}`;
  }
}

/** One-line key hint for the focused row. */
export function rowHint(row: SettingsRow | undefined): string {
  switch (row?.kind) {
    case 'header': return row.collapsed ? '↵/→ expand' : '↵/← collapse';
    case 'action':
      if (row.action === 'webapp') return '↵ show QR   o open in browser';
      return row.action === 'profiles' ? '↵ open the profile list' : '↵ run';
    case 'source': return row.source.removed
      ? '↵ details   v show its updates   x delete its items (removes it for good)'
      : '↵ details & edit   space on/off   e label (max 10)   d color   f fetch now   v show its updates   x remove';
    case 'add-source': return '↵ add an RSS/Atom feed, a GitHub repository or a YouTube channel';
    case 'restore-sources': return '↵ bring back the removed built-in sources';
    case 'experimental': return '↵ details & edit   space on/off (on signs in; space twice cancels a sign-in)   e label (max 10)   d color   l sign in again   f fetch now   v show its updates   x delete its items';
    case 'preview': return '↵ cycle';
    case 'config':
      if (isToggleField(row.field)) return '↵ toggle';
      if (row.field === 'autoFetch') return `↵ edit   minutes ${MIN_AUTO_FETCH_MINUTES}–${MAX_AUTO_FETCH_MINUTES} or off   (save empty for every ${DEFAULT_AUTO_FETCH_MINUTES} minutes)`;
      if (row.field === 'webUrl') return '↵ edit   o open in browser   (save empty to reset to the default)';
      if (row.field === 'youtubeApiKey') return '↵ edit   a YouTube Data API v3 key fetches YouTube with video lengths   (save empty to use the public feeds)';
      return isPickerField(row.field) ? '↵ choose' : '↵ edit   (save empty to reset to the default)';
    default: return '';
  }
}
