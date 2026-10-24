import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAllSources, getSource, getSourceIds, createSource } from '../scraper/registry.js';
import {
  LEGACY_USER_SOURCES,
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
  sourceInfo,
  updateSourcePatch,
  userSource,
} from '../scraper/specs.js';
import { parseFeed } from '../scraper/feed.js';
import { experimentalSourceInfos } from '../experimental.js';
import { DEFAULT_SETTINGS, type AppSettings, type SourcePlugin, type SourceSpec } from '../types.js';

const testSource = (spec: SourceSpec): SourcePlugin => createSource(spec);
const githubSource = testSource({ kind: 'feed', id: 'github', displayName: 'GitHub Changelog', urls: ['https://github.blog/changelog/feed/'] });
const azureSource = testSource({ kind: 'feed', id: 'azure', displayName: 'Azure Updates', urls: ['https://www.microsoft.com/releasecommunications/api/v2/azure/rss'] });
const azureSreAgentSource = testSource({
  kind: 'feed',
  id: 'azure-sre-agent',
  displayName: 'Azure SRE Agent Updates',
  urls: ['https://www.microsoft.com/releasecommunications/api/v2/azure/rss', 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=AppsonAzureBlog&count=100'],
  include: '\\bsre\\s+agents?\\b',
});
const vscodeSource = testSource({ kind: 'feed', id: 'vscode', displayName: 'VS Code Updates', urls: ['https://code.visualstudio.com/feed.xml'], category: 'release' });
const theRegisterSource = testSource({ kind: 'feed', id: 'theregister', displayName: 'The Register', urls: ['https://www.theregister.com/headlines.atom'] });
const githubNextSource = testSource({ kind: 'feed', id: 'github-next', displayName: 'GitHub Next', urls: ['https://githubnext.com/rss.xml'] });

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
  it('starts with only FOMO releases as a built-in source', () => {
    const sources = getAllSources();
    expect(sources.map((s) => s.id)).toEqual(['fomo-releases']);
    expect(sources[0].displayName).toBe('FOMO Releases');
  });

  it('keeps previous defaults only for migrated accounts', () => {
    const installedLegacySources = ['anthropic-news'];
    const userSources = LEGACY_USER_SOURCES.filter((s) => s.id === 'github');
    const sources = getAllSources({ installedLegacySources, userSources });
    expect(sources.map((s) => s.id)).toEqual(['fomo-releases', 'anthropic-news', 'github']);
    expect(sourceInfos({ installedLegacySources, userSources }).map((s) => s.builtin)).toEqual([true, true, false]);
  });

  it('getSource returns a source by id', () => {
    expect(getSource('fomo-releases')?.id).toBe('fomo-releases');
    expect(getSource('github')).toBeUndefined();
    expect(getSource('nonexistent')).toBeUndefined();
  });

  it('getSourceIds returns all ids', () => {
    const ids = getSourceIds();
    expect(ids).toEqual(['fomo-releases']);
  });

  it('leaves out removed built-ins and adds user sources', () => {
    const userSources: AppSettings['userSources'] = [{ kind: 'feed', id: 'my-feed', displayName: 'My feed', urls: ['https://example.com/rss'] }];
    const ids = getSourceIds({ removedSources: ['fomo-releases'], userSources });
    expect(ids).not.toContain('fomo-releases');
    expect(ids).toContain('my-feed');
    expect(getSource('my-feed', { userSources })?.displayName).toBe('My feed');
  });

  it('ignores user sources that reuse a built-in id', () => {
    const userSources: AppSettings['userSources'] = [{ kind: 'feed', id: 'fomo-releases', displayName: 'Fake', urls: ['https://example.com/rss'] }];
    expect(activeSourceSpecs({ userSources }).filter((s) => s.id === 'fomo-releases')).toHaveLength(1);
  });
});

describe('source specs', () => {
  const settings = (patch: Partial<AppSettings> = {}): AppSettings => ({ ...DEFAULT_SETTINGS, ...patch });

  it('describes sources for the UI', () => {
    const infos = sourceInfos();
    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatchObject({ id: 'fomo-releases', kind: 'github-releases', builtin: true, capabilities: { preview: true } });
    const custom = sourceInfo({
      kind: 'custom',
      id: 'anthropic-news',
      displayName: 'Anthropic News',
      extension: 'anthropic',
      extensionName: 'Anthropic',
      options: { section: 'news' },
      preview: false,
    });
    expect(custom).toMatchObject({
      kind: 'custom',
      capabilities: { preview: false },
      extensionId: 'anthropic',
      extensionName: 'Anthropic',
    });
    expect(sourceInfo(
      { kind: 'custom', id: 'anthropic-news', displayName: 'Anthropic News', extension: 'anthropic', options: { section: 'news' } },
      {},
      { anthropic: 'Claude news' },
    )).toMatchObject({ extensionId: 'anthropic', extensionName: 'Claude news' });
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

  it('accepts an optional relative changelog path only for GitHub releases', () => {
    expect(newUserSource({ url: 'https://github.com/github/copilot-cli', changelogPath: 'changelog.md' })).toMatchObject({
      spec: { kind: 'github-releases', repo: 'github/copilot-cli', changelogPath: 'changelog.md' },
    });
    expect(newUserSource({ url: 'https://github.com/github/copilot-cli', changelogPath: '../private.md' })).toHaveProperty('error');
  });

  it('picks an id no other source uses', () => {
    const taken = newUserSource({ url: 'https://example.com/rss', name: 'FOMO Releases' });
    expect(taken).toMatchObject({ spec: { id: 'fomo-releases-2' } });
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
    expect(sourceEditInput(a)).toEqual({ url: 'https://a.example/rss', name: 'A', include: 'x', shorts: false, changelogPath: '' });

    const edited = editUserSource(a, { url: 'https://github.com/octo/app', name: 'Octo' });
    expect(edited).toEqual({ spec: { kind: 'github-releases', id: 'a', displayName: 'Octo', repo: 'octo/app' } });
    expect(sourceEditInput('spec' in edited ? edited.spec : a).url).toBe('https://github.com/octo/app');
    expect(updateSourcePatch(current, 'spec' in edited ? edited.spec : a).userSources?.map((s) => s.id)).toEqual(['a', 'b']);
    expect(editUserSource(a, { url: 'nope' })).toHaveProperty('error');
  });

  it('saves a draft of the details popup', () => {
    const mine = { kind: 'feed' as const, id: 'mine', displayName: 'Mine', urls: ['https://a.example/rss'] };
    const current = settings({ userSources: [mine], sourceColors: { 'fomo-releases': '#3fb950' } });
    expect(sourceDraft(current, 'fomo-releases')).toEqual({ enabled: true, label: '', color: '#3fb950', name: 'FOMO Releases', url: '', include: '', shorts: false, changelogPath: '' });
    expect(sourceDraft(current, 'mine')).toMatchObject({ name: 'Mine', url: 'https://a.example/rss' });

    const builtin = sourceDraftPatch(current, 'fomo-releases', { ...sourceDraft(current, 'fomo-releases'), enabled: false, label: 'FOMO', color: '' });
    expect(builtin).toEqual({ patch: { sourceNames: {}, sourceLabels: { 'fomo-releases': 'FOMO' }, sourceColors: {}, disabledSources: ['fomo-releases'] } });

    const renamed = sourceDraftPatch(current, 'fomo-releases', { ...sourceDraft(current, 'fomo-releases'), name: 'FOMO' });
    expect(renamed).toEqual({ patch: { sourceNames: { 'fomo-releases': 'FOMO' }, sourceLabels: {}, sourceColors: { 'fomo-releases': '#3fb950' }, disabledSources: [] } });
    expect(sourceInfos({ ...current, sourceNames: { 'fomo-releases': 'FOMO' } }).find((s) => s.id === 'fomo-releases')?.displayName).toBe('FOMO');
    expect(sourceDraftPatch(current, 'fomo-releases', { ...sourceDraft(current, 'fomo-releases'), label: '12345678901' })).toHaveProperty('error');

    const own = sourceDraftPatch(current, 'mine', { ...sourceDraft(current, 'mine'), url: 'https://a.example/rss\nhttps://b.example/rss', include: 'ai' });
    expect(own).toMatchObject({ patch: { userSources: [{ id: 'mine', urls: ['https://a.example/rss', 'https://b.example/rss'], include: 'ai' }] } });

    const repo = sourceDraftPatch(current, 'mine', { ...sourceDraft(current, 'mine'), url: 'https://github.com/o/r', include: 'ignored' });
    expect(repo).toMatchObject({ patch: { userSources: [{ kind: 'github-releases', id: 'mine', repo: 'o/r' }] } });
    expect(sourceDraftPatch(current, 'mine', { ...sourceDraft(current, 'mine'), url: '' })).toHaveProperty('error');
  });

  it('edits an experimental source like a built-in, leaving it on or off per computer', () => {
    const current = settings({ disabledSources: ['github'] });
    const draft = sourceDraft(current, 'teams-meetings');
    expect(draft).toMatchObject({ name: 'Teams meetings', extensionName: 'Teams meetings', label: '', color: '' });
    const result = sourceDraftPatch(current, 'teams-meetings', {
      ...draft,
      enabled: false,
      label: 'Mtg',
      color: '#3fb950',
      name: 'Calls',
      extensionName: 'WorkIQ',
    });
    expect(result).toEqual({
      patch: {
        sourceNames: { 'teams-meetings': 'Calls' },
        extensionNames: { 'teams-meetings': 'WorkIQ' },
        sourceLabels: { 'teams-meetings': 'Mtg' },
        sourceColors: { 'teams-meetings': '#3fb950' },
      },
    });
    expect(sourceDraftPatch(current, 'teams-meetings', draft)).toEqual({
      patch: { sourceNames: {}, extensionNames: {}, sourceLabels: {}, sourceColors: {} },
    });
    expect(experimentalSourceInfos({ sourceNames: { 'teams-meetings': 'Calls' }, extensionNames: { 'teams-meetings': 'WorkIQ' } }))
      .toEqual([expect.objectContaining({ id: 'teams-meetings', displayName: 'Calls', extensionName: 'WorkIQ', experimental: true })]);
    expect(experimentalSourceInfos()[0]).toMatchObject({ displayName: 'Teams meetings', extensionName: 'Teams meetings' });
  });

  it('describes feed filters', () => {
    expect(sourceInfo({
      kind: 'feed',
      id: 'vscode',
      displayName: 'VS Code Updates',
      urls: ['https://code.visualstudio.com/feed.xml'],
      category: 'release',
    }).filter).toBe('category “release”');
    expect(sourceInfo({
      kind: 'feed',
      id: 'azure-sre-agent',
      displayName: 'Azure SRE Agent Updates',
      urls: ['https://example.com/rss'],
      include: '\\bsre\\s+agents?\\b',
    }).filter).toContain('keywords');
  });

  it('adds, removes and restores sources', () => {
    const spec = { kind: 'feed' as const, id: 'mine', displayName: 'Mine', urls: ['https://example.com/rss'] };
    const added = settings(addSourcePatch(settings(), spec));
    expect(added.userSources).toEqual([spec]);

    const removedUser = settings({ ...added, ...removeSourcePatch({ ...added, disabledSources: ['mine'] }, 'mine') });
    expect(removedUser.userSources).toEqual([]);
    expect(removedUser.disabledSources).toEqual([]);

    const removedBuiltin = settings(removeSourcePatch(settings(), 'fomo-releases'));
    expect(removedBuiltin.removedSources).toEqual(['fomo-releases']);
    expect(sourceInfos(removedBuiltin).map((s) => s.id)).not.toContain('fomo-releases');
    expect(sourceInfos({ ...removedBuiltin, ...restoreSourcesPatch() }).map((s) => s.id)).toContain('fomo-releases');
  });

  it('keeps removed sources with stored updates as retired, until their updates are gone', () => {
    const spec = { kind: 'feed' as const, id: 'mine', displayName: 'Mine', urls: ['https://example.com/feed'] };
    const activeSpec = { kind: 'feed' as const, id: 'active', displayName: 'Active', urls: ['https://example.com/active'] };
    const base = settings({ userSources: [spec, activeSpec] });
    const kept = settings({ ...base, ...removeSourcePatch(base, 'mine', { keepName: true }) });
    expect(kept.sourceLabels).toEqual({ mine: 'Mine' });
    const removed = settings({ ...kept, ...removeSourcePatch(kept, 'fomo-releases') });
    const retired = retiredSources(removed, { mine: 3, 'fomo-releases': 2, orphan: 1, active: 4, gone: 0, 'teams-meetings': 5 });
    expect(retired.map((s) => [s.id, s.displayName, s.builtin, s.removed])).toEqual([
      ['fomo-releases', sourceInfos().find((s) => s.id === 'fomo-releases')!.displayName, true, true],
      ['mine', 'Mine', false, true],
      ['orphan', 'orphan', false, true],
    ]);
    expect(forgetSourcePatch({ ...kept, sourceColors: { mine: '#fff' } }, 'mine')).toEqual({ sourceLabels: {}, sourceColors: {}, sourceNames: {} });
    expect(removeSourcePatch(base, 'mine').sourceLabels).toBeUndefined();
  });

  it('keeps the ids of experimental sources out of the source list and away from new sources', () => {
    expect(sourceInfos().some((s) => s.id === 'teams-meetings')).toBe(false);
    const added = newUserSource({ url: 'https://example.com/feed.xml', name: 'Teams meetings' });
    expect('spec' in added && added.spec.id).toBe('teams-meetings-2');
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

  it('uses a matching optional changelog section and falls back to release notes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([release('v1.0.94', 'Fixes and changes'), release('v1.0.93', 'Release body')]), { status: 200 }))
      .mockResolvedValueOnce(new Response('## [1.0.94] - 2026-10-08\n- New CLI command', { status: 200 }));
    const items = await createSource({
      kind: 'github-releases', id: 'copilot-cli', displayName: 'Copilot CLI', repo: 'github/copilot-cli', changelogPath: 'changelog.md',
    }).fetch();
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://raw.githubusercontent.com/github/copilot-cli/HEAD/changelog.md');
    expect(items.map((item) => item.content)).toEqual(['- New CLI command', 'Release body']);
  });

  it('reports a failure when a configured changelog cannot be fetched', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([release('v1.0.94', '- Release notes')]), { status: 200 }))
      .mockRejectedValueOnce(new Error('offline'));
    const source = createSource({
      kind: 'github-releases', id: 'copilot-cli', displayName: 'Copilot CLI', repo: 'github/copilot-cli', changelogPath: 'changelog.md',
    });
    await expect(source.fetch()).rejects.toThrow('[copilot-cli] fetch failed: offline');
  });

  it('reports an unknown custom module', async () => {
    const source = createSource({ kind: 'custom', id: 'x', displayName: 'X', module: 'nope' });
    await expect(source.fetch()).rejects.toThrow('[x] fetch failed: extension “nope” is not available');
  });

  it('fetches extension sources through the injected host adapter', async () => {
    const fetch = vi.fn().mockResolvedValue([{ title: 'Hello', url: 'https://example.com', datePublished: new Date('2026-01-01') }]);
    const source = createSource(
      { kind: 'custom', id: 'hello-source', displayName: 'Hello', extension: 'hello-extension', options: { mode: 'latest' } },
      { extensions: { 'hello-extension': { fetch } } },
    );

    await expect(source.fetch()).resolves.toMatchObject([{ title: 'Hello' }]);
    expect(fetch).toHaveBeenCalledWith({ sourceId: 'hello-source', options: { mode: 'latest' } });
  });

  it('reports an unavailable extension rather than treating it as an empty fetch', async () => {
    const source = createSource({ kind: 'custom', id: 'hello-source', displayName: 'Hello', extension: 'missing' });
    await expect(source.fetch()).rejects.toThrow('[hello-source] fetch failed: extension “missing” is not available');
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

  it('estimates reading time from full feed content before truncating the preview', () => {
    const words = Array.from({ length: 700 }, (_, i) => `word${i}`).join(' ');
    const [item] = parseFeed(`<rss><channel><item>
      <title>Article</title><link>https://e.x/article</link>
      <content:encoded><![CDATA[${words}]]></content:encoded>
    </item></channel></rss>`);
    expect(item?.readingTimeMinutes).toBe(4);
    expect(item?.content?.length).toBeLessThan(words.length);
  });
});
