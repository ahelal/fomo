import type { SourceInfo } from '@fomo/core';
import { DEFAULT_COPILOT_MODEL } from '../copilot.js';
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
export type ActionId = 'link' | 'regroup' | 'backup' | 'restore';

export type SettingsRow =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'action'; key: string; action: ActionId; label: string; hint: string }
  | { kind: 'source'; key: string; source: SourceInfo }
  | { kind: 'preview'; key: string }
  | { kind: 'config'; key: string; field: ConfigField; label: string };

const ACTIONS: { action: ActionId; label: string; hint: string }[] = [
  { action: 'link', label: 'Link a device', hint: 'magic link + QR code that connects the web app' },
  { action: 'regroup', label: 'Regroup all topics', hint: 'rerun Copilot on every unread and saved update (takes a few minutes)' },
  { action: 'backup', label: 'Back up updates', hint: 'save all updates as JSON in the backup folder' },
  { action: 'restore', label: 'Restore from backup', hint: 'pick a backup file from the backup folder' },
];

const CONFIG_FIELDS: { field: ConfigField; label: string }[] = [
  { field: 'connectionString', label: 'Connection string' },
  { field: 'webUrl', label: 'Web app URL' },
  { field: 'copilotModel', label: 'Copilot model' },
  { field: 'interests', label: 'Interests' },
  { field: 'groupingHints', label: 'Grouping hints' },
  { field: 'autoDigest', label: 'Group after fetch' },
  { field: 'digestMaxItems', label: 'Max items per run' },
  { field: 'linkDays', label: 'Link valid (days)' },
  { field: 'backupDir', label: 'Backup folder' },
];

export function buildSettingsRows(sources: SourceInfo[]): SettingsRow[] {
  return [
    { kind: 'header', key: 'h-actions', label: 'Actions' },
    ...ACTIONS.map((a) => ({ kind: 'action' as const, key: `a-${a.action}`, ...a })),
    { kind: 'header', key: 'h-sources', label: 'Sources · shared with the web app' },
    ...sources.map((source) => ({ kind: 'source' as const, key: `s-${source.id}`, source })),
    { kind: 'header', key: 'h-display', label: 'Display · shared with the web app' },
    { kind: 'preview', key: 'preview' },
    { kind: 'header', key: 'h-local', label: `This computer · ${tildify(CONFIG_FILE)}` },
    ...CONFIG_FIELDS.map((f) => ({ kind: 'config' as const, key: `c-${f.field}`, ...f })),
  ];
}

export function firstFocusable(rows: SettingsRow[]): number {
  return Math.max(0, rows.findIndex((r) => r.kind !== 'header'));
}

/** Move the focus by `delta`, skipping section headers. */
export function moveFocus(rows: SettingsRow[], index: number, delta: 1 | -1): number {
  for (let i = index + delta; i >= 0 && i < rows.length; i += delta) {
    if (rows[i]!.kind !== 'header') return i;
  }
  return index;
}

export function findRow(rows: SettingsRow[], key: string): number {
  return rows.findIndex((r) => r.key === key);
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
    case 'interests':
      return config.interests ? { value: config.interests, muted: false, env } : muted('(none)');
    case 'groupingHints':
      return config.groupingHints ? { value: config.groupingHints, muted: false, env } : muted('(none — e.g. one topic per Copilot surface)');
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

/** Starting text when editing a field. The connection string starts empty so the key is never shown. */
export function editStartValue(field: ConfigField): string {
  if (field === 'connectionString' || field === 'autoDigest') return '';
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
      return { error: 'Press ↵ to toggle' };
    default:
      return { patch: { [field]: value } };
  }
}

/** One-line key hint for the focused row. */
export function rowHint(row: SettingsRow | undefined): string {
  switch (row?.kind) {
    case 'action': return '↵ run';
    case 'source': return '↵ enable/disable   e label   d color   f fetch now   v show its updates';
    case 'preview': return '↵ cycle';
    case 'config': return row.field === 'autoDigest' ? '↵ toggle' : '↵ edit   (save empty to reset to the default)';
    default: return '';
  }
}
