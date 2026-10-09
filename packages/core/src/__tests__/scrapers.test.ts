import { describe, it, expect, vi, beforeEach } from 'vitest';
import { githubSource } from '../scraper/sources/github.js';
import { azureSource } from '../scraper/sources/azure.js';
import { vscodeSource } from '../scraper/sources/vscode.js';
import { copilotCliSource, parseChangelog } from '../scraper/sources/copilot-cli.js';
import { theRegisterSource } from '../scraper/sources/theregister.js';
import { githubNextSource } from '../scraper/sources/github-next.js';
import { getAllSources, getSource, getSourceIds, registerSource } from '../scraper/registry.js';
import type { SourcePlugin } from '../types.js';

describe('source plugins metadata', () => {
  it('github source has correct metadata', () => {
    expect(githubSource.id).toBe('github');
    expect(githubSource.displayName).toBe('GitHub Changelog');
    expect(githubSource.capabilities.preview).toBe(true);
  });

  it('azure source has correct metadata', () => {
    expect(azureSource.id).toBe('azure');
    expect(azureSource.displayName).toBe('Azure Updates');
    expect(azureSource.capabilities.preview).toBe(true);
  });

  it('vscode source has correct metadata', () => {
    expect(vscodeSource.id).toBe('vscode');
    expect(vscodeSource.displayName).toBe('VS Code Updates');
    expect(vscodeSource.capabilities.preview).toBe(true);
  });
});

describe('github source fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses RSS feed correctly', async () => {
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss><channel>
        <item>
          <title>New feature X</title>
          <link>https://github.blog/changelog/2025-01-01-new-feature-x</link>
          <pubDate>Wed, 01 Jan 2025 00:00:00 GMT</pubDate>
          <description><![CDATA[<p>Some description</p>]]></description>
        </item>
        <item>
          <title>Bug fix Y</title>
          <link>https://github.blog/changelog/2025-01-02-bug-fix-y</link>
          <pubDate>Thu, 02 Jan 2025 00:00:00 GMT</pubDate>
          <description>Plain text description</description>
        </item>
      </channel></rss>`;

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(rssXml, { status: 200 }),
    );

    const items = await githubSource.fetch();
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('New feature X');
    expect(items[0].url).toBe('https://github.blog/changelog/2025-01-01-new-feature-x');
    expect(items[0].datePublished).toBeInstanceOf(Date);
    expect(items[1].title).toBe('Bug fix Y');
  });

  it('reports HTTP errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 500 }),
    );

    await expect(githubSource.fetch()).rejects.toThrow('[github] fetch failed: HTTP 500');
  });

  it('reports network errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    await expect(githubSource.fetch()).rejects.toThrow('[github] fetch failed: Network error');
  });
});

describe('azure source fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses RSS feed correctly', async () => {
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss><channel>
        <item>
          <title>Azure Kubernetes update</title>
          <link>https://azure.microsoft.com/updates/aks-123</link>
          <pubDate>Mon, 15 Apr 2025 00:00:00 GMT</pubDate>
          <description>AKS now supports feature Z</description>
        </item>
      </channel></rss>`;

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(rssXml, { status: 200 }),
    );

    const items = await azureSource.fetch();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Azure Kubernetes update');
    expect(items[0].url).toBe('https://azure.microsoft.com/updates/aks-123');
  });

  it('reports failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
    await expect(azureSource.fetch()).rejects.toThrow('[azure] fetch failed: timeout');
  });
});

describe('vscode source fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Visual Studio Code</title>
  <entry>
    <title>Visual Studio Code 1.116</title>
    <link href="https://code.visualstudio.com/updates/v1_116"/>
    <updated>2026-04-15T17:00:00.000Z</updated>
    <id>https://code.visualstudio.com/updates/v1_116</id>
    <category term="release" />
    <content type="html">
      &lt;p&gt;Learn what's new in Visual Studio Code 1.116&lt;/p&gt;
    </content>
  </entry>
  <entry>
    <title>How VS Code Builds with AI</title>
    <link href="https://code.visualstudio.com/blogs/2026/03/13/how-VS-Code-Builds-with-AI"/>
    <updated>2026-03-13T00:00:00.000Z</updated>
    <id>https://code.visualstudio.com/blogs/2026/03/13/how-VS-Code-Builds-with-AI</id>
    <category term="blog" />
    <content type="html">&lt;p&gt;Blog post&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>Visual Studio Code 1.115</title>
    <link href="https://code.visualstudio.com/updates/v1_115"/>
    <updated>2026-04-08T17:00:00.000Z</updated>
    <id>https://code.visualstudio.com/updates/v1_115</id>
    <category term="release" />
    <content type="html">
      &lt;p&gt;Learn what's new in Visual Studio Code 1.115&lt;/p&gt;
    </content>
  </entry>
</feed>`;

  it('parses Atom feed and filters to releases only', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(ATOM_FEED, { status: 200 }),
    );

    const items = await vscodeSource.fetch();
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Visual Studio Code 1.116');
    expect(items[0].url).toBe('https://code.visualstudio.com/updates/v1_116');
    expect(items[0].content).toContain("what's new in Visual Studio Code 1.116");
    expect(items[1].title).toBe('Visual Studio Code 1.115');
  });

  it('excludes blog posts from results', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(ATOM_FEED, { status: 200 }),
    );

    const items = await vscodeSource.fetch();
    const titles = items.map((i) => i.title);
    expect(titles).not.toContain('How VS Code Builds with AI');
  });

  it('reports failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(vscodeSource.fetch()).rejects.toThrow('[vscode] fetch failed: offline');
  });
});

describe('copilot-cli source', () => {
  it('has correct metadata', () => {
    expect(copilotCliSource.id).toBe('copilot-cli');
    expect(copilotCliSource.displayName).toBe('Copilot CLI Releases');
    expect(copilotCliSource.capabilities.preview).toBe(true);
  });
});

describe('copilot-cli source fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses GitHub releases API correctly', async () => {
    const releases = [
      {
        name: 'v1.0.27',
        tag_name: 'v1.0.27',
        html_url: 'https://github.com/github/copilot-cli/releases/tag/v1.0.27',
        published_at: '2026-04-15T00:00:00Z',
        created_at: '2026-04-15T00:00:00Z',
        body: '## What\'s Changed\n\n* **New feature**: Added thinking effort\n* Fixed [bug](https://github.com/issue/1)',
      },
    ];

    mockCopilotCli(releases, null);

    const items = await copilotCliSource.fetch();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('v1.0.27');
    expect(items[0].url).toBe('https://github.com/github/copilot-cli/releases/tag/v1.0.27');
    expect(items[0].content).toContain('New feature');
    // Markdown should be stripped
    expect(items[0].content).not.toContain('**');
    expect(items[0].content).not.toContain('##');
  });

  it('uses the changelog section for the release version', async () => {
    const changelog = [
      '# Changelog',
      '',
      '## 1.0.94 - 2026-10-08',
      '',
      '- Add Claude Haiku 5.5 to model selection',
      '- `copilot mcp add` recovers cleanly',
      '',
      '## 1.0.93 - 2026-10-07',
      '',
      '- Add enterprise permissions.limitTo',
    ].join('\n');
    const releases = [
      release('v1.0.95-0', 'Fixes and changes'),
      release('v1.0.94', '2026-10-08'),
      release('v1.0.94-2', 'Fixes and changes'),
      release('v1.0.94-1', '**Fixed**\n- Sessions sidebar row switches reliably'),
    ];
    mockCopilotCli(releases, changelog);

    const items = await copilotCliSource.fetch();
    const byTitle = Object.fromEntries(items.map((i) => [i.title, i.content]));
    expect(byTitle['1.0.94']).toBe('- Add Claude Haiku 5.5 to model selection\n- copilot mcp add recovers cleanly');
    expect(byTitle['1.0.94-2']).toContain('Add Claude Haiku 5.5');
    expect(byTitle['1.0.94-1']).toBe('Fixed\n- Sessions sidebar row switches reliably');
    expect(byTitle['1.0.95-0']).toBe('Fixes and changes');
  });

  it('falls back to release bodies when the changelog is unavailable', async () => {
    mockCopilotCli([release('v1.0.94', '2026-10-08\n\n- Something new')], new Error('offline'));
    const items = await copilotCliSource.fetch();
    expect(items[0].content).toContain('Something new');
  });

  it('parses changelog headings', () => {
    const sections = parseChangelog('## 1.0.2 - 2026-01-02\n\n- two\n\n## v1.0.1\n- one\n');
    expect(sections.get('1.0.2')).toBe('- two');
    expect(sections.get('1.0.1')).toBe('- one');
  });

  it('reports failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(copilotCliSource.fetch()).rejects.toThrow('[copilot-cli] fetch failed: offline');
  });
});

function release(tag: string, body: string) {
  return {
    name: tag.replace(/^v/, ''),
    tag_name: tag,
    html_url: `https://github.com/github/copilot-cli/releases/tag/${tag}`,
    published_at: '2026-10-08T00:00:00Z',
    created_at: '2026-10-08T00:00:00Z',
    body,
  };
}

function mockCopilotCli(releases: unknown[], changelog: string | null | Error) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('changelog.md')) {
      if (changelog instanceof Error) throw changelog;
      return changelog === null ? new Response('', { status: 404 }) : new Response(changelog, { status: 200 });
    }
    return new Response(JSON.stringify(releases), { status: 200 });
  });
}

describe('theregister source', () => {
  it('has correct metadata', () => {
    expect(theRegisterSource.id).toBe('theregister');
    expect(theRegisterSource.displayName).toBe('The Register');
    expect(theRegisterSource.capabilities.preview).toBe(true);
  });
});

describe('theregister source fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>The Register</title>
  <entry>
    <title type="html">Microsoft closes book on rogue Windows Server 2025 upgrades</title>
    <link rel="alternate" type="text/html" href="https://www.theregister.com/2026/04/17/microsoft_windows_server_2025/"/>
    <published>2026-04-17T12:29:09.00Z</published>
    <summary type="html">&lt;h4&gt;Starts new one on boot loops&lt;/h4&gt; &lt;p&gt;More than a year after...&lt;/p&gt;</summary>
  </entry>
  <entry>
    <title type="html">NASA gets the ball rolling on Mars rover</title>
    <link rel="alternate" type="text/html" href="https://www.theregister.com/2026/04/17/nasa_rosalind_franklin/"/>
    <published>2026-04-17T11:39:13.00Z</published>
    <summary type="html">&lt;p&gt;Rosalind Franklin moving again&lt;/p&gt;</summary>
  </entry>
</feed>`;

  it('parses Atom feed correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(ATOM_FEED, { status: 200 }),
    );

    const items = await theRegisterSource.fetch();
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Microsoft closes book on rogue Windows Server 2025 upgrades');
    expect(items[0].url).toBe('https://www.theregister.com/2026/04/17/microsoft_windows_server_2025/');
    expect(items[0].content).toContain('Starts new one on boot loops');
    // HTML should be stripped
    expect(items[0].content).not.toContain('<h4>');
    expect(items[1].title).toBe('NASA gets the ball rolling on Mars rover');
  });

  it('parses RSS feed items and indexes their full article content', async () => {
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
  <item>
    <link>https://www.theregister.com/2026/10/02/example/</link>
    <pubDate>Fri, 02 Oct 2026 21:52:40 +0200</pubDate>
    <title>Google hearts Apple&apos;s Swift</title>
    <description><![CDATA[Short summary]]></description>
    <content:encoded><![CDATA[Full article text with backend details.]]></content:encoded>
  </item>
</channel></rss>`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(rss, { status: 200 }));

    const items = await theRegisterSource.fetch();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Google hearts Apple's Swift");
    expect(items[0].datePublished.toISOString()).toBe('2026-10-02T19:52:40.000Z');
    expect(items[0].content).toBe('Full article text with backend details.');
  });

  it('reports failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(theRegisterSource.fetch()).rejects.toThrow('[theregister] fetch failed: offline');
  });
});

describe('github-next source', () => {
  it('has correct metadata', () => {
    expect(githubNextSource.id).toBe('github-next');
    expect(githubNextSource.displayName).toBe('GitHub Next');
    expect(githubNextSource.capabilities.preview).toBe(true);
  });
});

describe('github-next source fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
      <title>GitHub Next</title>
      <link>https://githubnext.com/</link>
      <item>
        <title>/goooooooal!</title>
        <link>https://githubnext.com/posts/goal/</link>
        <guid isPermaLink="true">https://githubnext.com/posts/goal/</guid>
        <description>Turn an issue into an agentic mission</description>
        <pubDate>Thu, 11 Jun 2026 00:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Crane: verified code migration</title>
        <link>https://githubnext.com/posts/crane/</link>
        <guid isPermaLink="true">https://githubnext.com/posts/crane/</guid>
        <description>Crane is a migration assistant for GitHub repositories.</description>
        <pubDate>Mon, 08 Jun 2026 00:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;

  it('parses RSS feed correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(RSS_FEED, { status: 200 }),
    );

    const items = await githubNextSource.fetch();
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('/goooooooal!');
    expect(items[0].url).toBe('https://githubnext.com/posts/goal/');
    expect(items[0].content).toBe('Turn an issue into an agentic mission');
    expect(items[0].datePublished).toBeInstanceOf(Date);
    expect(items[1].title).toBe('Crane: verified code migration');
  });

  it('reports failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(githubNextSource.fetch()).rejects.toThrow('[github-next] fetch failed: offline');
  });
});

describe('scraper registry', () => {
  it('getAllSources returns all built-in sources', () => {
    const sources = getAllSources();
    const ids = sources.map((s) => s.id);
    expect(ids).toContain('github');
    expect(ids).toContain('azure');
    expect(ids).toContain('vscode');
    expect(ids).toContain('copilot-cli');
    expect(ids).toContain('theregister');
    expect(ids).toContain('github-next');
  });

  it('getSource returns a source by id', () => {
    expect(getSource('github')?.id).toBe('github');
    expect(getSource('nonexistent')).toBeUndefined();
  });

  it('getSourceIds returns all ids', () => {
    const ids = getSourceIds();
    expect(ids).toContain('github');
    expect(ids).toContain('azure');
    expect(ids).toContain('vscode');
    expect(ids).toContain('copilot-cli');
    expect(ids).toContain('theregister');
    expect(ids).toContain('github-next');
  });

  it('registerSource adds a custom source', () => {
    const custom: SourcePlugin = {
      id: 'test-custom',
      displayName: 'Test Custom',
      capabilities: { preview: false },
      async fetch() { return []; },
    };

    registerSource(custom);
    expect(getSource('test-custom')?.id).toBe('test-custom');
  });
});
