import type { SourcePlugin, ScrapedItem } from '../../types.js';

const API_URL = 'https://api.github.com/repos/github/copilot-cli/releases?per_page=30';
const CHANGELOG_URL = 'https://raw.githubusercontent.com/github/copilot-cli/main/changelog.md';
const MAX_CONTENT = 3000;

export const copilotCliSource: SourcePlugin = {
  id: 'copilot-cli',
  displayName: 'Copilot CLI Releases',
  capabilities: { preview: true },

  async fetch(): Promise<ScrapedItem[]> {
    try {
      const [res, changelog] = await Promise.all([
        globalThis.fetch(API_URL, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'fomo-release-tracker/1.0',
          },
          signal: AbortSignal.timeout(15_000),
        }),
        fetchChangelog(),
      ]);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const releases = (await res.json()) as GithubRelease[];
      return releases
        .filter((r) => r.html_url && (r.name || r.tag_name))
        .map((r) => ({
          title: (r.name || r.tag_name).trim(),
          url: r.html_url,
          datePublished: new Date(r.published_at || r.created_at || Date.now()),
          content: stripMarkdown(releaseNotes(r, changelog).slice(0, MAX_CONTENT)),
        }));
    } catch (err) {
      throw new Error(`[copilot-cli] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

/** Best effort: release bodies still work when the changelog is unavailable. */
async function fetchChangelog(): Promise<Map<string, string>> {
  try {
    const res = await globalThis.fetch(CHANGELOG_URL, {
      headers: { 'User-Agent': 'fomo-release-tracker/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? parseChangelog(await res.text()) : new Map();
  } catch {
    return new Map();
  }
}

/** Map of version (e.g. `1.0.94`) → section body from `## 1.0.94 - 2026-10-08` headings. */
export function parseChangelog(md: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = md.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const heading = newline === -1 ? part : part.slice(0, newline);
    const version = heading.match(/^v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/)?.[1];
    const body = newline === -1 ? '' : part.slice(newline + 1).trim();
    if (version && body && !sections.has(version)) sections.set(version, body);
  }
  return sections;
}

/**
 * Prefer the changelog entry for the exact version, then (for prereleases with a placeholder
 * body like "Fixes and changes") the entry for the base version, then the release body.
 */
function releaseNotes(r: GithubRelease, changelog: Map<string, string>): string {
  const body = (r.body ?? '').trim();
  const version = r.tag_name.replace(/^v/, '');
  const exact = changelog.get(version);
  if (exact) return exact;
  if (isPlaceholder(body)) {
    const base = changelog.get(version.replace(/-.*$/, ''));
    if (base) return base;
  }
  return body;
}

function isPlaceholder(body: string): boolean {
  return body === '' || /^fixes and changes\.?$/i.test(body);
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface GithubRelease {
  name: string;
  tag_name: string;
  html_url: string;
  published_at: string;
  created_at: string;
  body: string | null;
}
