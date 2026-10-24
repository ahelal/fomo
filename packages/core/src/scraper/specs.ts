import type { AppSettings, SourceId, SourceInfo, SourceSpec, UserSourceSpec } from '../types.js';
import { EXPERIMENTAL_SOURCE_INFOS, experimentalSourceInfo, isExperimentalSource } from '../experimental.js';
import { parseYoutubeUrl, youtubeName, youtubeUrl } from './youtube.js';

const AZURE_UPDATES_FEED = 'https://www.microsoft.com/releasecommunications/api/v2/azure/rss';

/** Sources shipped with the app. Changing one here reaches every user (unless they removed it). */
export const BUILTIN_SOURCES: readonly SourceSpec[] = [
  { kind: 'feed', id: 'github', displayName: 'GitHub Changelog', urls: ['https://github.blog/changelog/feed/'] },
  { kind: 'feed', id: 'github-blog', displayName: 'GitHub Blog', urls: ['https://github.blog/feed/'] },
  { kind: 'feed', id: 'azure', displayName: 'Azure Updates', urls: [AZURE_UPDATES_FEED] },
  { kind: 'feed', id: 'vscode', displayName: 'VS Code Updates', urls: ['https://code.visualstudio.com/feed.xml'], category: 'release' },
  { kind: 'custom', id: 'copilot-cli', displayName: 'Copilot CLI Releases', extension: 'copilot-cli', extensionName: 'Copilot CLI' },
  { kind: 'feed', id: 'theregister', displayName: 'The Register', urls: ['https://www.theregister.com/headlines.atom'] },
  { kind: 'custom', id: 'anthropic-news', displayName: 'Anthropic News', extension: 'anthropic', extensionName: 'Anthropic', options: { section: 'news' }, preview: false },
  { kind: 'custom', id: 'anthropic-engineering', displayName: 'Anthropic Engineering', extension: 'anthropic', extensionName: 'Anthropic', options: { section: 'engineering' }, preview: false },
  {
    kind: 'feed',
    id: 'azure-sre-agent',
    displayName: 'Azure SRE Agent Updates',
    urls: [AZURE_UPDATES_FEED, 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=AppsonAzureBlog&count=100'],
    include: '\\bsre\\s+agents?\\b',
  },
  { kind: 'feed', id: 'github-next', displayName: 'GitHub Next', urls: ['https://githubnext.com/rss.xml'] },
];

const BUILTIN_IDS = new Set(BUILTIN_SOURCES.map((s) => s.id));

type SourceSettings = Pick<AppSettings, 'userSources' | 'removedSources'> & Partial<Pick<AppSettings, 'sourceNames' | 'extensionNames'>>;

export const MAX_SOURCE_LABEL_LENGTH = 10;

/** Built-ins the user kept, then the user's own sources. */
export function activeSourceSpecs(settings: Partial<SourceSettings> = {}): SourceSpec[] {
  const removed = new Set(settings.removedSources ?? []);
  const user = (settings.userSources ?? []).filter((s) => !BUILTIN_IDS.has(s.id));
  return [...BUILTIN_SOURCES.filter((s) => !removed.has(s.id)), ...user];
}

export function sourceInfo(
  spec: SourceSpec,
  sourceNames: Partial<AppSettings['sourceNames']> = {},
  extensionNames: Partial<AppSettings['extensionNames']> = {},
): SourceInfo {
  const extensionId = spec.kind === 'custom' ? ('extension' in spec ? spec.extension : spec.module) : undefined;
  const extensionName = extensionId
    ? extensionNames[extensionId] || ('extensionName' in spec ? spec.extensionName : undefined) || extensionId
    : undefined;
  return {
    id: spec.id,
    displayName: sourceNames[spec.id] || spec.displayName,
    capabilities: { preview: spec.kind === 'custom' ? spec.preview !== false : true },
    kind: spec.kind,
    builtin: BUILTIN_IDS.has(spec.id),
    ...(extensionId ? { extensionId, extensionName } : {}),
    location: spec.kind === 'feed' ? spec.urls.join(' ') : spec.kind === 'github-releases' ? `github.com/${spec.repo}` : spec.kind === 'youtube' ? youtubeUrl(spec) : undefined,
    filter: sourceFilter(spec),
  };
}

function sourceFilter(spec: SourceSpec): string | undefined {
  const keywords = (spec.kind === 'feed' || spec.kind === 'youtube') && spec.include ? `keywords /${spec.include}/` : undefined;
  if (spec.kind === 'feed') return [keywords, spec.category && `category “${spec.category}”`].filter(Boolean).join(', ') || undefined;
  if (spec.kind === 'youtube' && !spec.playlist) return [keywords, spec.shorts ? undefined : 'no Shorts'].filter(Boolean).join(', ') || undefined;
  return spec.kind === 'youtube' ? keywords : undefined;
}

export function sourceInfos(settings: Partial<SourceSettings> = {}): SourceInfo[] {
  return activeSourceSpecs(settings).map((spec) => sourceInfo(spec, settings.sourceNames, settings.extensionNames));
}

/** What the user types to add a source. */
export interface NewSourceInput {
  /** Feed URL(s), separated by spaces or commas, a GitHub repository URL for its releases, or a YouTube channel or playlist URL. */
  url: string;
  /** Defaults to the feed's host or the repository. */
  name?: string;
  /** Optional keyword filter (case-insensitive regex) for feeds and YouTube. */
  include?: string;
  /** Include Shorts of a YouTube channel. */
  shorts?: boolean;
}

const GITHUB_REPO_URL = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?(?:releases\/?)?$/i;

/** Build a validated spec for a new user source, with an id not used by any other source. */
export function newUserSource(input: NewSourceInput, settings: Partial<SourceSettings> = {}): { spec: UserSourceSpec } | { error: string } {
  const urls = input.url.split(/[\s,]+/).filter(Boolean);
  if (urls.length === 0) return { error: 'Enter a feed URL, a GitHub repository URL or a YouTube channel URL' };
  for (const url of urls) {
    if (!isHttpUrl(url)) return { error: `Not an http(s) URL: ${url}` };
  }
  const include = input.include?.trim() || undefined;
  if (include) {
    try { new RegExp(include, 'i'); } catch { return { error: `Invalid keyword filter: ${include}` }; }
  }

  const youtube = urls.map(parseYoutubeUrl);
  const target = youtube[0];
  if (target && 'error' in target) return target;
  if (youtube.some(Boolean) && urls.length > 1) return { error: 'Add one YouTube channel or playlist per source' };

  const repo = urls.length === 1 ? urls[0].match(GITHUB_REPO_URL)?.[1] : undefined;
  const defaultName = target ? youtubeName(target) : repo ? `${repo} releases` : new URL(urls[0]).hostname.replace(/^www\./, '');
  const displayName = input.name?.trim() || defaultName;
  const taken = new Set([...BUILTIN_IDS, ...EXPERIMENTAL_SOURCE_INFOS.map((s) => s.id), ...(settings.userSources ?? []).map((s) => s.id)]);
  const id = uniqueId(slugify(displayName) || 'source', taken);

  if (repo) {
    if (include) return { error: 'The keyword filter only works for feeds' };
    return { spec: { kind: 'github-releases', id, displayName, repo } };
  }
  if (target) {
    const shorts = 'channel' in target && input.shorts ? { shorts: true } : {};
    return { spec: { kind: 'youtube', id, displayName, ...target, ...shorts, ...(include ? { include } : {}) } };
  }
  return { spec: { kind: 'feed', id, displayName, urls, ...(include ? { include } : {}) } };
}

/** The user's own source `id`, or undefined for built-ins and unknown ids. */
export function userSource(settings: Partial<SourceSettings>, id: SourceId): UserSourceSpec | undefined {
  return BUILTIN_IDS.has(id) ? undefined : settings.userSources?.find((s) => s.id === id);
}

/** The editable fields of a user source, as `newUserSource` takes them. */
export function sourceEditInput(spec: UserSourceSpec): Required<NewSourceInput> {
  switch (spec.kind) {
    case 'feed': return { url: spec.urls.join(' '), name: spec.displayName, include: spec.include ?? '', shorts: false };
    case 'github-releases': return { url: `https://github.com/${spec.repo}`, name: spec.displayName, include: '', shorts: false };
    case 'youtube': return { url: youtubeUrl(spec), name: spec.displayName, include: spec.include ?? '', shorts: !!spec.shorts };
  }
}

/** Rebuild a user source from edited fields. The id never changes, so its stored updates stay with it. */
export function editUserSource(spec: UserSourceSpec, input: NewSourceInput): { spec: UserSourceSpec } | { error: string } {
  const result = newUserSource(input);
  return 'error' in result ? result : { spec: { ...result.spec, id: spec.id } };
}

/** Settings patch that replaces the user source with `spec.id`, keeping its place in the list. */
export function updateSourcePatch(settings: SourceSettings, spec: UserSourceSpec): Partial<AppSettings> {
  return { userSources: settings.userSources.map((s) => (s.id === spec.id ? spec : s)) };
}

/** What the source details popup edits; URLs and filters only apply to user-defined feeds. */
export interface SourceDraft {
  enabled: boolean;
  /** Short label shown instead of the name; empty uses the name. */
  label: string;
  /** Empty keeps the default color. */
  color: string;
  name: string;
  /** Display name of the extension shared by its source instances. */
  extensionName?: string;
  /** Feed URLs separated by spaces or new lines, a GitHub repository URL, or a YouTube channel or playlist URL. */
  url: string;
  include: string;
  /** Include Shorts; only applies to a YouTube channel. */
  shorts: boolean;
}

/** The name a built-in or experimental source ships with, and the extension it runs. */
function sourceDefaults(id: SourceId): { name: string; extensionId?: string; extensionName?: string } {
  const spec = BUILTIN_SOURCES.find((s) => s.id === id);
  if (spec?.kind === 'custom') {
    const extensionId = 'extension' in spec ? spec.extension : spec.module;
    return { name: spec.displayName, extensionId, extensionName: ('extensionName' in spec ? spec.extensionName : undefined) ?? extensionId };
  }
  if (spec) return { name: spec.displayName };
  const info = experimentalSourceInfo(id);
  if (info?.extensionId) return { name: info.displayName, extensionId: info.extensionId, extensionName: info.extensionName ?? info.extensionId };
  return { name: info?.displayName ?? id };
}

/**
 * The current values of a source, to start editing it. An experimental source is turned on per profile on
 * one computer, not in these settings: the caller sets its `enabled`.
 */
export function sourceDraft(settings: Pick<AppSettings, 'disabledSources' | 'sourceLabels' | 'sourceColors'> & Partial<SourceSettings>, id: SourceId): SourceDraft {
  const own = userSource(settings, id);
  const { name, extensionId, extensionName } = sourceDefaults(id);
  return {
    enabled: !settings.disabledSources.includes(id),
    label: settings.sourceLabels[id] ?? '',
    color: settings.sourceColors?.[id] ?? '',
    ...(extensionId ? { extensionName: settings.extensionNames?.[extensionId] ?? extensionName ?? extensionId } : {}),
    ...(own ? sourceEditInput(own) : { name: settings.sourceNames?.[id] ?? name, url: '', include: '', shorts: false }),
  };
}

/** Whether `url` points at one GitHub repository (so the keyword filter does not apply). */
export function isGithubRepoUrl(url: string): boolean {
  const urls = url.split(/[\s,]+/).filter(Boolean);
  return urls.length === 1 && GITHUB_REPO_URL.test(urls[0]);
}

/** Whether `url` is one YouTube channel (so Shorts can be turned on or off). */
export function isYoutubeChannelUrl(url: string): boolean {
  const urls = url.split(/[\s,]+/).filter(Boolean);
  const target = urls.length === 1 ? parseYoutubeUrl(urls[0]) : undefined;
  return !!target && 'channel' in target;
}

/**
 * Settings patch that saves an edited draft of source `id`. An experimental source's `enabled` is not saved
 * here (it is turned on per profile on one computer).
 */
export function sourceDraftPatch(settings: AppSettings, id: SourceId, draft: SourceDraft): { patch: Partial<AppSettings> } | { error: string } {
  const label = draft.label.trim();
  if (label.length > MAX_SOURCE_LABEL_LENGTH) {
    return { error: `Label must be ${MAX_SOURCE_LABEL_LENGTH} characters or fewer` };
  }
  const patch: Partial<AppSettings> = {};
  const own = userSource(settings, id);
  const defaults = sourceDefaults(id);
  if (own) {
    const edited = editUserSource(own, { url: draft.url, name: draft.name, include: isGithubRepoUrl(draft.url) ? undefined : draft.include, shorts: draft.shorts });
    if ('error' in edited) return edited;
    Object.assign(patch, updateSourcePatch(settings, edited.spec));
  } else {
    const sourceNames = { ...settings.sourceNames };
    const name = draft.name.trim();
    if (name && name !== defaults.name) sourceNames[id] = name;
    else delete sourceNames[id];
    patch.sourceNames = sourceNames;
  }
  const { extensionId } = defaults;
  if (extensionId && draft.extensionName !== undefined) {
    const extensionNames = { ...settings.extensionNames };
    const name = draft.extensionName.trim();
    if (name && name !== defaults.extensionName) extensionNames[extensionId] = name;
    else delete extensionNames[extensionId];
    patch.extensionNames = extensionNames;
  }
  const sourceLabels = { ...settings.sourceLabels };
  if (label && label !== id) sourceLabels[id] = label;
  else delete sourceLabels[id];
  const sourceColors = { ...settings.sourceColors };
  if (draft.color) sourceColors[id] = draft.color;
  else delete sourceColors[id];
  if (isExperimentalSource(id)) return { patch: { ...patch, sourceLabels, sourceColors } };
  const disabled = new Set(settings.disabledSources);
  if (draft.enabled) disabled.delete(id);
  else disabled.add(id);
  return { patch: { ...patch, sourceLabels, sourceColors, disabledSources: [...disabled] } };
}

/** Settings patch that adds `spec`. */
export function addSourcePatch(settings: SourceSettings, spec: UserSourceSpec): Partial<AppSettings> {
  return { userSources: [...settings.userSources.filter((s) => s.id !== spec.id), spec] };
}

/**
 * Settings patch that removes a source: user sources are deleted, built-ins are hidden.
 * With `keepName`, a user source's name is kept as its label, so its remaining updates still show it.
 */
export function removeSourcePatch(
  settings: SourceSettings & Pick<AppSettings, 'disabledSources'> & Partial<Pick<AppSettings, 'sourceLabels'>>,
  id: SourceId,
  { keepName = false } = {},
): Partial<AppSettings> {
  const disabledSources = settings.disabledSources.filter((s) => s !== id);
  if (BUILTIN_IDS.has(id)) {
    return { removedSources: [...new Set([...settings.removedSources, id])], disabledSources };
  }
  const spec = settings.userSources.find((s) => s.id === id);
  const labels = settings.sourceLabels ?? {};
  const keepLabel = keepName && spec && !labels[id] ? { sourceLabels: { ...labels, [id]: spec.displayName } } : {};
  return { userSources: settings.userSources.filter((s) => s.id !== id), disabledSources, ...keepLabel };
}

/**
 * Removed sources that still have stored updates (`bySource` from the stats), shown greyed out until
 * their updates are deleted. Includes updates of sources that no longer exist at all.
 */
export function retiredSources(
  settings: Partial<SourceSettings> & Partial<Pick<AppSettings, 'sourceLabels' | 'sourceNames' | 'extensionNames'>>,
  bySource: Record<SourceId, number> = {},
): SourceInfo[] {
  const active = new Set(activeSourceSpecs(settings).map((s) => s.id));
  return Object.keys(bySource)
    .filter((id) => (bySource[id] ?? 0) > 0 && !active.has(id) && !isExperimentalSource(id))
    .sort()
    .map((id) => {
      const builtin = BUILTIN_SOURCES.find((s) => s.id === id);
      if (builtin) return { ...sourceInfo(builtin, settings.sourceNames, settings.extensionNames), removed: true };
      return { id, displayName: settings.sourceNames?.[id] ?? settings.sourceLabels?.[id] ?? id, capabilities: { preview: true }, kind: 'feed', builtin: false, removed: true };
    });
}

/** Settings patch that forgets the label and color of a source that is gone for good. */
export function forgetSourcePatch(settings: Pick<AppSettings, 'sourceLabels' | 'sourceColors' | 'sourceNames'>, id: SourceId): Partial<AppSettings> {
  const { [id]: _label, ...sourceLabels } = settings.sourceLabels;
  const { [id]: _color, ...sourceColors } = settings.sourceColors;
  const { [id]: _name, ...sourceNames } = settings.sourceNames;
  return { sourceLabels, sourceColors, sourceNames };
}

/** Settings patch that brings back every removed built-in. */
export function restoreSourcesPatch(): Partial<AppSettings> {
  return { removedSources: [] };
}

function isHttpUrl(text: string): boolean {
  try {
    return /^https?:$/.test(new URL(text).protocol);
  } catch {
    return false;
  }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
