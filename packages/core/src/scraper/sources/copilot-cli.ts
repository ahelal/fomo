import type { SourcePlugin, ScrapedItem } from '../../types.js';

const API_URL = 'https://api.github.com/repos/github/copilot-cli/releases?per_page=30';

export const copilotCliSource: SourcePlugin = {
  id: 'copilot-cli',
  displayName: 'Copilot CLI Releases',
  capabilities: { preview: true },

  async fetch(): Promise<ScrapedItem[]> {
    try {
      const res = await globalThis.fetch(API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'fomo-release-tracker/1.0',
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const releases = (await res.json()) as GithubRelease[];
      return releases
        .filter((r) => r.html_url && (r.name || r.tag_name))
        .map((r) => ({
          title: (r.name || r.tag_name).trim(),
          url: r.html_url,
          datePublished: new Date(r.published_at || r.created_at || Date.now()),
          content: stripMarkdown((r.body ?? '').slice(0, 3000)),
        }));
    } catch (err) {
      throw new Error(`[copilot-cli] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

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
