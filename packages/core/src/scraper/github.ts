import type { ScrapedItem } from '../types.js';
import { fetchJson } from './http.js';
import { MAX_CONTENT } from './text.js';

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
