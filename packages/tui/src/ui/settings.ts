import type { SourceInfo } from '@fomo/core';
import { copilotTokenEnv, DEFAULT_COPILOT_MODEL } from '../copilot.js';
import {
  CONFIG_FILE,
  connectionStringProblem,
  DEFAULT_BACKUP_DIR,
  DEFAULT_DIGEST_MAX_ITEMS,
  DEFAULT_LINK_DAYS,
  envSource,
  maskConnectionString,
  readConfigFile,
  tildify,
  untildify,
  type LocalConfig,
} from '../config.js';

export type ConfigField = keyof LocalConfig;
export type ActionId = 'link' | 'webapp' | 'regroup' | 'backup' | 'restore';

export type SettingsRow =
  | { kind: 'header'; key: string; label: string; collapsed: boolean; count: number }
  | { kind: 'action'; key: string; action: ActionId; label: string; hint: string }
  | { kind: 'source'; key: string; source: SourceInfo }
  | { kind: 'preview'; key: string }
  | { kind: 'config'; key: string; field: ConfigField; label: string };

const ACTIONS: { action: ActionId; label: string; hint: string }[] = [
  { action: 'link', label: 'Link a device', hint: 'magic link + QR code that connects the web app' },
  { action: 'webapp', label: 'Show web app QR', hint: 'QR code of the web app URL to open it on your phone · o opens it here' },
  { action: 'regroup', label: 'Regroup all topics', hint: 'rerun Copilot on every unread and saved update (takes a few minutes)' },
  { action: 'backup', label: 'Back up updates', hint: 'save all updates as JSON in the backup folder' },
  { action: 'restore', label: 'Restore from backup', hint: 'pick a backup file from the backup folder' },
];

const CONFIG_FIELDS: { field: ConfigField; label: string }[] = [
  { field: 'connectionString', label: 'Connection string' },
  { field: 'webUrl', label: 'Web app URL' },
  { field: 'copilotModel', label: 'Copilot model' },
  { field: 'copilotAccount', label: 'Copilot account' },
  { field: 'interests', label: 'Interests' },
  { field: 'groupingHints', label: 'Grouping hints' },
  { field: 'autoFetch', label: 'Auto-fetch (15 min)' },
  { field: 'autoDigest', label: 'Group after fetch' },
  { field: 'digestMaxItems', label: 'Max items per run' },
  { field: 'linkDays', label: 'Link valid (days)' },
  { field: 'backupDir', label: 'Backup folder' },
];

/** Section header keys, used to collapse a section. */
export const SECTION_KEYS = ['h-actions', 'h-sources', 'h-display', 'h-local'] as const;

/** Config screen rows; rows of the sections in `collapsed` (header keys) are left out. */
export function buildSettingsRows(sources: SourceInfo[], collapsed: ReadonlySet<string> = new Set()): SettingsRow[] {
  const section = (key: string, label: string, rows: SettingsRow[]): SettingsRow[] => [
    { kind: 'header', key, label, collapsed: collapsed.has(key), count: rows.length },
    ...(collapsed.has(key) ? [] : rows),
  ];
  return [
    ...section('h-actions', 'Actions', ACTIONS.map((a) => ({ kind: 'action' as const, key: `a-${a.action}`, ...a }))),
    ...section('h-sources', 'Sources · shared with the web app', sources.map((source) => ({ kind: 'source' as const, key: `s-${source.id}`, source }))),
    ...section('h-display', 'Display · shared with the web app', [{ kind: 'preview', key: 'preview' }]),
    ...section('h-local', `This computer · ${tildify(CONFIG_FILE)}`, CONFIG_FIELDS.map((f) => ({ kind: 'config' as const, key: `c-${f.field}`, ...f }))),
  ];
}

/** The first row that is not a section header (or the first header when every section is collapsed). */
export function firstFocusable(rows: SettingsRow[]): number {
  return Math.max(0, rows.findIndex((r) => r.kind !== 'header'));
}

/** Move the focus by `delta` rows (headers included, so sections can be collapsed), staying in range. */
export function moveFocus(rows: SettingsRow[], index: number, delta: number): number {
  return Math.max(0, Math.min(rows.length - 1, index + delta));
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

/** What the config screen shows for a local setting. */
export function configDisplay(
  config: LocalConfig,
  field: ConfigField,
  file: LocalConfig = readConfigFile(),
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
    case 'autoFetch':
      return { value: config.autoFetch === false ? '[ ] off' : '[x] on — every 15 minutes while open', muted: false };
    case 'autoDigest':
      return { value: config.autoDigest === false ? 'off — fetch only' : 'on', muted: false };
    case 'digestMaxItems':
      return config.digestMaxItems ? { value: String(config.digestMaxItems), muted: false } : muted(`${DEFAULT_DIGEST_MAX_ITEMS} (default)`);
    case 'linkDays':
      return config.linkDays ? { value: String(config.linkDays), muted: false } : muted(`${DEFAULT_LINK_DAYS} (default)`);
    case 'backupDir':
      return config.backupDir ? { value: tildify(config.backupDir), muted: false } : muted(`${tildify(DEFAULT_BACKUP_DIR)} (default)`);
  }
}

/** On/off settings toggled with ↵ instead of edited as text. */
export const TOGGLE_FIELDS = ['autoFetch', 'autoDigest'] as const;
export type ToggleField = (typeof TOGGLE_FIELDS)[number];
export const isToggleField = (field: ConfigField): field is ToggleField =>
  (TOGGLE_FIELDS as readonly ConfigField[]).includes(field);

/** Settings chosen from a list (opened with ↵) instead of typed. */
export const PICKER_FIELDS = ['copilotAccount'] as const;
export type PickerField = (typeof PICKER_FIELDS)[number];
export const isPickerField = (field: ConfigField): field is PickerField =>
  (PICKER_FIELDS as readonly ConfigField[]).includes(field);

/** Starting text when editing a field. The connection string starts empty so the key is never shown. */
export function editStartValue(field: ConfigField): string {
  if (field === 'connectionString' || isToggleField(field)) return '';
  const value = readConfigFile()[field];
  if (value === undefined) return '';
  return field === 'backupDir' ? tildify(String(value)) : String(value);
}

/** Turn edited text into a config patch. An empty value restores the default. */
export function parseConfigEdit(field: ConfigField, text: string): { patch: Partial<LocalConfig> } | { error: string } {
  const value = text.trim();
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
    case 'autoDigest':
    case 'autoFetch':
      return { error: 'Press ↵ to toggle' };
    default:
      return { patch: { [field]: value } };
  }
}

/** One-line key hint for the focused row. */
export function rowHint(row: SettingsRow | undefined): string {
  switch (row?.kind) {
    case 'header': return row.collapsed ? '↵/→ expand' : '↵/← collapse';
    case 'action': return row.action === 'webapp' ? '↵ show QR   o open in browser' : '↵ run';
    case 'source': return '↵ enable/disable   e label   d color   f fetch now   v show its updates';
    case 'preview': return '↵ cycle';
    case 'config':
      if (isToggleField(row.field)) return '↵ toggle';
      if (row.field === 'webUrl') return '↵ edit   o open in browser   (save empty to reset to the default)';
      return isPickerField(row.field) ? '↵ choose' : '↵ edit   (save empty to reset to the default)';
    default: return '';
  }
}
