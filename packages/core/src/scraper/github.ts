import type { ScrapedItem } from '../types.js';
import { fetchJson, fetchText } from './http.js';
import { MAX_CONTENT } from './text.js';
import type { GithubReleasesSourceSpec } from '../types.js';

export interface GithubRelease {
  name: string | null;
  tag_name: string;
  html_url: string;
  published_at: string | null;
  created_at: string | null;
  body: string | null;
}

/** `owner/name` of a GitHub repository. */
export const GITHUB_REPO = /^[\w.-]+\/[\w.-]+$/;

/** The latest releases of `repo` (`owner/name`). */
export function fetchGithubReleases(repo: string, perPage = 30): Promise<GithubRelease[]> {
  return fetchJson<GithubRelease[]>(`https://api.github.com/repos/${repo}/releases?per_page=${perPage}`, {
    Accept: 'application/vnd.github+json',
  });
}

/** Validate an optional repository-relative changelog path before using it in a raw GitHub URL. */
export function normalizeChangelogPath(path: string | undefined): string | undefined {
  const normalized = path?.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith('/') || normalized.includes('\\') || /[?#]/.test(normalized)
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Changelog path must be a relative file path inside the repository');
  }
  return normalized;
}

/** Parse Markdown sections headed by a release version, optionally wrapped in brackets. */
export function parseChangelog(md: string): Map<string, string> {
  const sections = new Map<string, string>();
  for (const part of md.split(/^##\s+/m).slice(1)) {
    const newline = part.indexOf('\n');
    const heading = newline === -1 ? part : part.slice(0, newline);
    const version = heading.match(/^\[?v?(\d+\.\d+\.\d+(?:-[\w.]+)?)\]?/)?.[1];
    const body = newline === -1 ? '' : part.slice(newline + 1).trim();
    if (version && body && !sections.has(version)) sections.set(version, body);
  }
  return sections;
}

function changelogNotes(release: GithubRelease, sections: Map<string, string>): string | undefined {
  const version = release.tag_name.replace(/^v/, '');
  const exact = sections.get(version);
  if (exact) return exact;
  if (!release.body?.trim() || /^fixes and changes\.?$/i.test(release.body.trim())) {
    return sections.get(version.replace(/-.*$/, ''));
  }
  return undefined;
}

/** Fetch releases and, when configured, use matching sections from the repository changelog. */
export async function fetchGithubReleaseItems(spec: GithubReleasesSourceSpec): Promise<ScrapedItem[]> {
  const releases = await fetchGithubReleases(spec.repo);
  let sections = new Map<string, string>();
  const path = normalizeChangelogPath(spec.changelogPath);
  if (path) {
    sections = parseChangelog(await fetchText(
      `https://raw.githubusercontent.com/${spec.repo}/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`,
    ));
  }
  return releaseItems(releases, (release) => changelogNotes(release, sections) ?? release.body ?? '');
}

/** Releases as items; `notes` overrides a release's body (e.g. with a changelog section). */
export function releaseItems(releases: GithubRelease[], notes: (r: GithubRelease) => string = (r) => r.body ?? ''): ScrapedItem[] {
  return releases
    .filter((r) => r.html_url && (r.name || r.tag_name))
    .map((r) => ({
      title: (r.name || r.tag_name).trim(),
      url: r.html_url,
      datePublished: new Date(r.published_at || r.created_at || Date.now()),
      content: stripMarkdown(notes(r).slice(0, MAX_CONTENT)),
    }));
}

export function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
