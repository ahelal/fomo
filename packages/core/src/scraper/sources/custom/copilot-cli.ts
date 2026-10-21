import type { ScrapedItem } from '../../../types.js';
import { fetchText } from '../../http.js';
import { fetchGithubReleases, releaseItems, type GithubRelease } from '../../github.js';

const REPO = 'github/copilot-cli';
const CHANGELOG_URL = `https://raw.githubusercontent.com/${REPO}/main/changelog.md`;

/** Copilot CLI releases, with notes from the changelog (release bodies are often placeholders). */
export async function fetchCopilotCli(): Promise<ScrapedItem[]> {
  const [releases, changelog] = await Promise.all([fetchGithubReleases(REPO), fetchChangelog()]);
  return releaseItems(releases, (r) => releaseNotes(r, changelog));
}

/** Best effort: release bodies still work when the changelog is unavailable. */
async function fetchChangelog(): Promise<Map<string, string>> {
  try {
    return parseChangelog(await fetchText(CHANGELOG_URL));
  } catch {
    return new Map();
  }
}

/** Map of version (e.g. `1.0.94`) → section body from `## 1.0.94 - 2026-10-08` headings. */
export function parseChangelog(md: string): Map<string, string> {
  const sections = new Map<string, string>();
  for (const part of md.split(/^##\s+/m).slice(1)) {
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
  if (body === '' || /^fixes and changes\.?$/i.test(body)) {
    const base = changelog.get(version.replace(/-.*$/, ''));
    if (base) return base;
  }
  return body;
}
