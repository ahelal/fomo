import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseChangelog } from '../scraper/sources/custom/copilot-cli.js';
import { parsePosts } from '../scraper/sources/custom/anthropic.js';
import { getAllSources, getSource, getSourceIds, createSource } from '../scraper/registry.js';
import {
  activeSourceSpecs,
  addSourcePatch,
  editUserSource,
  newUserSource,
  removeSourcePatch,
  retiredSources,
  forgetSourcePatch,
  restoreSourcesPatch,
  sourceDraft,
  sourceDraftPatch,
  sourceEditInput,
  sourceInfos,
  updateSourcePatch,
  userSource,
} from '../scraper/specs.js';
import { parseFeed } from '../scraper/feed.js';
import { DEFAULT_SETTINGS, type AppSettings, type SourcePlugin } from '../types.js';

const builtin = (id: string): SourcePlugin => getSource(id)!;
const githubSource = builtin('github');
const azureSource = builtin('azure');
const azureSreAgentSource = builtin('azure-sre-agent');
const vscodeSource = builtin('vscode');
const copilotCliSource = builtin('copilot-cli');
const theRegisterSource = builtin('theregister');
const githubNextSource = builtin('github-next');

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

describe('azure-sre-agent source fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the public Azure feed and keeps only SRE Agent updates', async () => {
    const rssXml = `<rss><channel>
      <item>
        <title>[In preview] Live Reports for Azure SRE Agent</title>
        <link>https://azure.microsoft.com/updates?id=569690</link>
        <pubDate>Wed, 26 Aug 2026 16:52:23 Z</pubDate>
        <description><![CDATA[<p>Reports &amp; operational views</p>]]></description>
      </item>
      <item>
        <title>New operational capabilities</title>
        <link>https://azure.microsoft.com/updates?id=569695</link>
        <description>Connect Azure sre agent to your network.</description>
      </item>
      <item>
        <title>Azure Kubernetes update</title>
        <link>https://azure.microsoft.com/updates?id=123</link>
        <description>Tools for SRE teams and unrelated agents.</description>
      </item>
    </channel></rss>`;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === 'https://www.microsoft.com/releasecommunications/api/v2/azure/rss') {
        return new Response(rssXml, { status: 200 });
      }
      if (String(input) === 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=AppsonAzureBlog&count=100') {
        return new Response('<rss><channel></channel></rss>', { status: 200 });
      }
      return new Response('', { status: 401 });
    });

    const items = await azureSreAgentSource.fetch();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: '[In preview] Live Reports for Azure SRE Agent',
      url: 'https://azure.microsoft.com/updates?id=569690',
      datePublished: new Date('2026-08-26T16:52:23Z'),
      content: 'Reports & operational views',
    });
    expect(items[1].title).toBe('New operational capabilities');
  });

  it('includes the reported Tech Community article and decodes RSS-escaped HTML', async () => {
    const blogXml = `<rss><channel>
      <item>
        <title>Enterprise Adoption Guide for Azure SRE Agent, Part 2: From One Team to Enterprise-Wide Adoption</title>
        <link>https://techcommunity.microsoft.com/t5/apps-on-azure-blog/enterprise-adoption-guide-for-azure-sre-agent-part-2-from-one/ba-p/4564311</link>
        <pubDate>Thu, 15 Oct 2026 03:51:09 GMT</pubDate>
        <description>&lt;P&gt;Share &amp;amp; govern your &lt;strong&gt;SRE Agent&lt;/strong&gt;.&lt;/P&gt;</description>
      </item>
      <item>
        <title>New operational guidance</title>
        <link>https://techcommunity.microsoft.com/blog/AppsonAzureBlog/guidance/123</link>
        <description>&lt;p&gt;Learn about SRE&amp;#32;agents.&lt;/p&gt;</description>
      </item>
      <item>
        <title>Unrelated Azure Container Apps post</title>
        <link>https://techcommunity.microsoft.com/blog/AppsonAzureBlog/other/456</link>
        <description>New container features.</description>
      </item>
    </channel></rss>`;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => new Response(
      String(input).includes('techcommunity.microsoft.com') ? blogXml : '<rss><channel></channel></rss>',
      { status: 200 },
    ));

    const items = await azureSreAgentSource.fetch();

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Enterprise Adoption Guide for Azure SRE Agent, Part 2: From One Team to Enterprise-Wide Adoption',
      url: expect.stringContaining('/4564311'),
      datePublished: new Date('2026-10-15T03:51:09Z'),
      content: 'Share & govern your SRE Agent .',
    });
    expect(items[1].content).toBe('Learn about SRE agents.');
    expect(items[0].content).not.toMatch(/&lt;|<P>|<strong>/);
  });

  it('merges both feeds without duplicate URLs', async () => {
    const xml = `<rss><channel><item>
      <title>Azure SRE Agent update</title>
      <link>https://azure.microsoft.com/updates?id=569690</link>
    </item></channel></rss>`;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(xml, { status: 200 }));

    await expect(azureSreAgentSource.fetch()).resolves.toHaveLength(1);
  });

  it('reports Tech Community failures instead of silently returning only Azure announcements', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => (
      String(input).includes('techcommunity.microsoft.com')
        ? new Response('', { status: 503 })
        : new Response('<rss><channel></channel></rss>', { status: 200 })
    ));

    await expect(azureSreAgentSource.fetch()).rejects.toThrow(
      '[azure-sre-agent] fetch failed: techcommunity.microsoft.com: HTTP 503',
    );
  });

  it('reports a non-RSS response instead of treating it as an empty feed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => new Response(
      String(input).includes('techcommunity.microsoft.com') ? '<html>Sign in</html>' : '<rss><channel></channel></rss>',
      { status: 200 },
    ));

    await expect(azureSreAgentSource.fetch()).rejects.toThrow('Expected an RSS or Atom feed');
  });

  it('returns no items when the feed has no SRE Agent updates', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('<rss><channel></channel></rss>', { status: 200 }),
    );

    await expect(azureSreAgentSource.fetch()).resolves.toEqual([]);
  });

  it('reports HTTP failures with the SRE Agent source ID', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 503 }),
    );

    await expect(azureSreAgentSource.fetch()).rejects.toThrow(/\[azure-sre-agent\].*HTTP 503/);
  });

  it('reports network failures with the SRE Agent source ID', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    await expect(azureSreAgentSource.fetch()).rejects.toThrow(/\[azure-sre-agent\].*offline/);
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

  it('leaves out removed built-ins and adds user sources', () => {
    const userSources: AppSettings['userSources'] = [{ kind: 'feed', id: 'my-feed', displayName: 'My feed', urls: ['https://example.com/rss'] }];
    const ids = getSourceIds({ removedSources: ['github'], userSources });
    expect(ids).not.toContain('github');
    expect(ids).toContain('my-feed');
    expect(getSource('my-feed', { userSources })?.displayName).toBe('My feed');
  });

  it('ignores user sources that reuse a built-in id', () => {
    const userSources: AppSettings['userSources'] = [{ kind: 'feed', id: 'github', displayName: 'Fake', urls: ['https://example.com/rss'] }];
    expect(activeSourceSpecs({ userSources }).filter((s) => s.id === 'github')).toHaveLength(1);
  });
});

describe('source specs', () => {
  const settings = (patch: Partial<AppSettings> = {}): AppSettings => ({ ...DEFAULT_SETTINGS, ...patch });

  it('describes sources for the UI', () => {
    const infos = sourceInfos();
    expect(infos.find((s) => s.id === 'github')).toMatchObject({ kind: 'feed', builtin: true, capabilities: { preview: true } });
    expect(infos.find((s) => s.id === 'anthropic-news')).toMatchObject({ kind: 'custom', capabilities: { preview: false } });
  });

  it('builds a feed source from a URL', () => {
    const result = newUserSource({ url: 'https://www.example.com/feed.xml', include: 'copilot' });
    expect(result).toEqual({
      spec: { kind: 'feed', id: 'example-com', displayName: 'example.com', urls: ['https://www.example.com/feed.xml'], include: 'copilot' },
    });
  });

  it('merges several feed URLs into one source', () => {
    const result = newUserSource({ url: 'https://a.example/rss, https://b.example/rss', name: 'Both' });
    expect(result).toMatchObject({ spec: { kind: 'feed', id: 'both', urls: ['https://a.example/rss', 'https://b.example/rss'] } });
  });

  it('builds a GitHub releases source from a repository URL', () => {
    expect(newUserSource({ url: 'https://github.com/microsoft/vscode/releases' })).toEqual({
      spec: { kind: 'github-releases', id: 'microsoft-vscode-releases', displayName: 'microsoft/vscode releases', repo: 'microsoft/vscode' },
    });
  });

  it('picks an id no other source uses', () => {
    const taken = newUserSource({ url: 'https://example.com/rss', name: 'GitHub' });
    expect(taken).toMatchObject({ spec: { id: 'github-2' } });
    const first = newUserSource({ url: 'https://example.com/rss', name: 'Mine' });
    const userSources = 'spec' in first ? [first.spec] : [];
    expect(newUserSource({ url: 'https://example.com/rss', name: 'Mine' }, { userSources })).toMatchObject({ spec: { id: 'mine-2' } });
  });

  it('rejects bad input', () => {
    expect(newUserSource({ url: '' })).toHaveProperty('error');
    expect(newUserSource({ url: 'ftp://example.com/rss' })).toHaveProperty('error');
    expect(newUserSource({ url: 'https://example.com/rss', include: '(' })).toHaveProperty('error');
    expect(newUserSource({ url: 'https://github.com/a/b', include: 'x' })).toHaveProperty('error');
  });

  it('edits a user source in place, keeping its id', () => {
    const a = { kind: 'feed' as const, id: 'a', displayName: 'A', urls: ['https://a.example/rss'], include: 'x' };
    const b = { kind: 'feed' as const, id: 'b', displayName: 'B', urls: ['https://b.example/rss'] };
    const current = settings({ userSources: [a, b] });
    expect(userSource(current, 'a')).toBe(a);
    expect(userSource(current, 'github')).toBeUndefined();
    expect(sourceEditInput(a)).toEqual({ url: 'https://a.example/rss', name: 'A', include: 'x', shorts: false });

    const edited = editUserSource(a, { url: 'https://github.com/octo/app', name: 'Octo' });
    expect(edited).toEqual({ spec: { kind: 'github-releases', id: 'a', displayName: 'Octo', repo: 'octo/app' } });
    expect(sourceEditInput('spec' in edited ? edited.spec : a).url).toBe('https://github.com/octo/app');
    expect(updateSourcePatch(current, 'spec' in edited ? edited.spec : a).userSources?.map((s) => s.id)).toEqual(['a', 'b']);
    expect(editUserSource(a, { url: 'nope' })).toHaveProperty('error');
  });

  it('saves a draft of the details popup', () => {
    const mine = { kind: 'feed' as const, id: 'mine', displayName: 'Mine', urls: ['https://a.example/rss'] };
    const current = settings({ userSources: [mine], sourceColors: { github: '#3fb950' } });
    expect(sourceDraft(current, 'github')).toEqual({ enabled: true, label: '', color: '#3fb950', name: '', url: '', include: '', shorts: false });
    expect(sourceDraft(current, 'mine')).toMatchObject({ name: 'Mine', url: 'https://a.example/rss' });

    const builtin = sourceDraftPatch(current, 'github', { ...sourceDraft(current, 'github'), enabled: false, label: '🐙', color: '' });
    expect(builtin).toEqual({ patch: { sourceLabels: { github: '🐙' }, sourceColors: {}, disabledSources: ['github'] } });

    const own = sourceDraftPatch(current, 'mine', { ...sourceDraft(current, 'mine'), url: 'https://a.example/rss\nhttps://b.example/rss', include: 'ai' });
    expect(own).toMatchObject({ patch: { userSources: [{ id: 'mine', urls: ['https://a.example/rss', 'https://b.example/rss'], include: 'ai' }] } });

    const repo = sourceDraftPatch(current, 'mine', { ...sourceDraft(current, 'mine'), url: 'https://github.com/o/r', include: 'ignored' });
    expect(repo).toMatchObject({ patch: { userSources: [{ kind: 'github-releases', id: 'mine', repo: 'o/r' }] } });
    expect(sourceDraftPatch(current, 'mine', { ...sourceDraft(current, 'mine'), url: '' })).toHaveProperty('error');
  });

  it('describes feed filters', () => {
    const infos = sourceInfos();
    expect(infos.find((s) => s.id === 'vscode')?.filter).toBe('category “release”');
    expect(infos.find((s) => s.id === 'azure-sre-agent')?.filter).toContain('keywords');
    expect(infos.find((s) => s.id === 'github')?.filter).toBeUndefined();
  });

  it('adds, removes and restores sources', () => {
    const spec = { kind: 'feed' as const, id: 'mine', displayName: 'Mine', urls: ['https://example.com/rss'] };
    const added = settings(addSourcePatch(settings(), spec));
    expect(added.userSources).toEqual([spec]);

    const removedUser = settings({ ...added, ...removeSourcePatch({ ...added, disabledSources: ['mine'] }, 'mine') });
    expect(removedUser.userSources).toEqual([]);
    expect(removedUser.disabledSources).toEqual([]);

    const removedBuiltin = settings(removeSourcePatch(settings(), 'github'));
    expect(removedBuiltin.removedSources).toEqual(['github']);
    expect(sourceInfos(removedBuiltin).map((s) => s.id)).not.toContain('github');
    expect(sourceInfos({ ...removedBuiltin, ...restoreSourcesPatch() }).map((s) => s.id)).toContain('github');
  });

  it('keeps removed sources with stored updates as retired, until their updates are gone', () => {
    const spec = { kind: 'feed' as const, id: 'mine', displayName: 'Mine', urls: ['https://example.com/feed'] };
    const base = settings({ userSources: [spec] });
    const kept = settings({ ...base, ...removeSourcePatch(base, 'mine', { keepName: true }) });
    expect(kept.sourceLabels).toEqual({ mine: 'Mine' });
    const removed = settings({ ...kept, ...removeSourcePatch(kept, 'github') });
    const active = sourceInfos(removed)[0]!.id;
    const retired = retiredSources(removed, { mine: 3, github: 2, orphan: 1, [active]: 4, gone: 0 });
    expect(retired.map((s) => [s.id, s.displayName, s.builtin, s.removed])).toEqual([
      ['github', sourceInfos().find((s) => s.id === 'github')!.displayName, true, true],
      ['mine', 'Mine', false, true],
      ['orphan', 'orphan', false, true],
    ]);
    expect(forgetSourcePatch({ ...kept, sourceColors: { mine: '#fff' } }, 'mine')).toEqual({ sourceLabels: {}, sourceColors: {} });
    expect(removeSourcePatch(base, 'mine').sourceLabels).toBeUndefined();
  });
});

describe('user sources fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches a feed source with a keyword filter', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`<rss><channel>
      <item><title>Copilot news</title><link>https://example.com/1</link></item>
      <item><title>Other</title><link>https://example.com/2</link></item>
    </channel></rss>`, { status: 200 }));
    const source = createSource({ kind: 'feed', id: 'mine', displayName: 'Mine', urls: ['https://example.com/rss'], include: 'copilot' });
    const items = await source.fetch();
    expect(items.map((i) => i.url)).toEqual(['https://example.com/1']);
  });

  it('fetches GitHub releases', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([release('v2.0.0', '**Big** release')]), { status: 200 }));
    const items = await createSource({ kind: 'github-releases', id: 'rel', displayName: 'Rel', repo: 'octo/app' }).fetch();
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.github.com/repos/octo/app/releases?per_page=30');
    expect(items[0]).toMatchObject({ title: '2.0.0', content: 'Big release' });
  });

  it('reports an unknown custom module', async () => {
    const source = createSource({ kind: 'custom', id: 'x', displayName: 'X', module: 'nope' });
    await expect(source.fetch()).rejects.toThrow('[x] fetch failed: unknown custom module “nope”');
  });
});

describe('feed parser', () => {
  it('keeps only items of a category', () => {
    const xml = `<rss><channel>
      <item><title>A</title><link>https://e.x/a</link><category><![CDATA[Release]]></category></item>
      <item><title>B</title><link>https://e.x/b</link><category>Blog</category></item>
    </channel></rss>`;
    expect(parseFeed(xml, { category: 'release' }).map((i) => i.title)).toEqual(['A']);
  });

  it('reads RSS 1.0 (RDF) feeds', () => {
    const xml = `<rdf:RDF><item rdf:about="x"><title>T</title><link>https://e.x/t</link><dc:date>2026-01-02T00:00:00Z</dc:date></item></rdf:RDF>`;
    expect(parseFeed(xml)).toMatchObject([{ title: 'T', url: 'https://e.x/t', datePublished: new Date('2026-01-02T00:00:00Z') }]);
  });
});

describe('anthropic custom module', () => {
  it('reads post links of a section with their titles and dates', () => {
    const html = `
      <a href="/news/post-one"><span class="Card__title">Post one &amp; more</span><time>Oct 18, 2026</time></a>
      <a href="/news/post-one">duplicate</a>
      <a href="/research/other"><span class="x__title">Other</span></a>`;
    expect(parsePosts(html, 'news')).toEqual([
      { title: 'Post one & more', url: 'https://www.anthropic.com/news/post-one', datePublished: new Date('Oct 18, 2026') },
    ]);
  });
});
