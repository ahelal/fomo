import { describe, it, expect, vi } from 'vitest';
import type { Topic, Update } from '../types.js';
import { buildDigest, flattenDigest, removeFromDigest, removeAndAdvance } from '../digest/view.js';
import {
  DIGEST_PLAN_SYSTEM_PROMPT,
  DIGEST_SPLIT_SYSTEM_PROMPT,
  buildPlanPrompt,
  buildSplitPrompt,
  buildWritePrompt,
  excerpt,
  type ModelRequest,
} from '../digest/prompt.js';
import { parseItemSummaries, parseTopicText, reconcilePlan, singletonGroup, stripPublishDate } from '../digest/reconcile.js';
import { runDigest, type DigestTopicStore, type DigestUpdateStore } from '../digest/run.js';

function upd(id: string, over: Partial<Update> = {}): Update {
  return {
    id,
    source: id.split('__')[0]!,
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    datePublished: '2026-01-01T00:00:00Z',
    dateAdded: '2026-01-01T00:00:00Z',
    status: 'unread',
    saved: false,
    content: '',
    ...over,
  };
}

function topic(id: string, over: Partial<Topic> = {}): Topic {
  return { id, title: `Topic ${id}`, summary: '', highlights: [], createdAt: 'c', updatedAt: 'u', ...over };
}

describe('buildDigest', () => {
  it('groups by topic, keeps ungrouped items as synthetic entries, sorts newest first', () => {
    const digest = buildDigest(
      [
        upd('a__1', { topicId: 't1', datePublished: '2026-01-01' }),
        upd('b__2', { topicId: 't1', datePublished: '2026-01-05' }),
        upd('c__3', { datePublished: '2026-01-03' }),
        upd('d__4', { topicId: 'missing', datePublished: '2026-01-02' }),
        upd('e__5', { topicId: 't1', status: 'read', datePublished: '2026-01-09' }),
      ],
      new Map([['t1', topic('t1')]]),
    );

    expect(digest.pending).toBe(2);
    expect(digest.entries.map((e) => e.topic.id)).toEqual(['t1', 'item:c__3', 'item:d__4']);
    expect(digest.entries[0]!.items.map((u) => u.id)).toEqual(['b__2', 'a__1']);
    expect(digest.entries[0]!.sources).toEqual(['b', 'a']);
    expect(digest.entries[1]!.synthetic).toBe(true);
    expect(digest.entries[1]!.topic.title).toBe('Title c__3');
  });

  it('puts important topics first, unrated ones with medium, then newest within a level', () => {
    const digest = buildDigest(
      [
        upd('a__1', { topicId: 'low', datePublished: '2026-01-09' }),
        upd('b__2', { topicId: 'high', datePublished: '2026-01-01' }),
        upd('c__3', { topicId: 'med', datePublished: '2026-01-03' }),
        upd('d__4', { datePublished: '2026-01-05' }),
      ],
      new Map([
        ['low', topic('low', { importance: 'low' })],
        ['high', topic('high', { importance: 'high' })],
        ['med', topic('med', { importance: 'medium' })],
      ]),
    );
    expect(digest.entries.map((e) => e.topic.id)).toEqual(['high', 'item:d__4', 'med', 'low']);
  });
});

describe('flattenDigest / removeFromDigest', () => {
  const digest = buildDigest(
    [upd('a__1', { topicId: 't1' }), upd('b__2', { topicId: 't1' }), upd('c__3')],
    new Map([['t1', topic('t1')]]),
  );

  it('lists items under expanded topics only', () => {
    expect(flattenDigest(digest.entries, new Set()).map((r) => r.kind)).toEqual(['topic', 'topic']);
    const rows = flattenDigest(digest.entries, new Set(['t1', 'item:c__3']));
    expect(rows.map((r) => r.key)).toEqual(['t1', 't1/a__1', 't1/b__2', 'item:c__3']);
  });

  it('removeAndAdvance selects the next surviving row', () => {
    const open = new Set(['t1']);
    // rows: t1, t1/a__1, t1/b__2, item:c__3
    expect(removeAndAdvance(digest.entries, open, 't1', new Set(['a__1', 'b__2'])).nextKey).toBe('item:c__3');
    expect(removeAndAdvance(digest.entries, open, 't1/a__1', new Set(['a__1'])).nextKey).toBe('t1/b__2');
    expect(removeAndAdvance(digest.entries, open, 'item:c__3', new Set(['c__3'])).nextKey).toBe('t1/b__2');
    const last = removeAndAdvance(digest.entries, open, 't1/b__2', new Set(['a__1', 'b__2', 'c__3']));
    expect(last.entries).toEqual([]);
    expect(last.nextKey).toBeUndefined();
  });

  it('drops read items and empty topics', () => {
    const left = removeFromDigest(digest.entries, new Set(['a__1', 'c__3']));
    expect(left).toHaveLength(1);
    expect(left[0]!.items.map((u) => u.id)).toEqual(['b__2']);
  });
});


describe('buildPlanPrompt', () => {
  it('uses short aliases, short html-free excerpts and asks for medium effort', () => {
    const p = buildPlanPrompt(
      [upd('github__1', { content: `<p>Hello&nbsp;<b>world</b></p><script>x()</script>${'z'.repeat(400)}` })],
      [{ topic: topic('t-long-id', { title: 'Open', importance: 'high' }), itemTitles: ['S1', 'S2', 'S3', 'S4'] }],
    );
    expect(p.prompt).toContain('[t1] (high, 4 items) Open\n  - S1\n  - S2\n  - S3\n');
    expect(p.prompt).not.toContain('S4');
    expect(p.prompt).toContain('[i1] (github · 2026-01-01) Title github__1 — Hello world z');
    expect(p.prompt).not.toContain('<p>');
    expect(p.prompt).not.toContain('x()');
    expect(p.prompt).not.toContain('z'.repeat(200));
    expect(p.items.get('i1')!.id).toBe('github__1');
    expect(p.topics.get('t1')!.id).toBe('t-long-id');
    expect(p.effort).toBe('medium');
  });

  it('marks an empty context and shows optional reader interests', () => {
    const p = buildPlanPrompt([upd('a__1')], [], { interests: '  Copilot CLI,\n agents ' });
    expect(p.prompt.startsWith('READER INTERESTS: Copilot CLI, agents\n')).toBe(true);
    expect(p.prompt).toContain('OPEN TOPICS:\n(none)');
    expect(buildPlanPrompt([upd('a__1')], [{ topic: topic('x', { title: 'One' }), itemTitles: ['S'] }]).prompt).toContain(
      '[t1] (1 item) One',
    );
    expect(buildPlanPrompt([upd('a__1')], []).prompt).not.toContain('READER INTERESTS');
  });

  it('flags same-source items whose titles differ only in numbers as a release series', () => {
    const p = buildPlanPrompt(
      [
        upd('vscode__1', { title: 'Visual Studio Code 1.140 (Insiders)' }),
        upd('cli__1', { title: 'Copilot CLI 1.0.90' }),
        upd('vscode__2', { title: 'Visual Studio Code 1.141 (Insiders)' }),
        upd('cli__2', { title: 'Copilot CLI 1.0.90.1' }),
        upd('other__1', { title: 'Visual Studio Code 1.142 (Insiders)' }),
        upd('cli__3', { title: 'Copilot CLI adds agents' }),
      ],
      [],
    );
    expect(p.prompt).toContain('RELEASE SERIES (same source, titles differ only in numbers):\n- i1, i3\n- i2, i4');
    expect(p.prompt).not.toContain('i5, ');
    expect(buildPlanPrompt([upd('a__1'), upd('b__1')], []).prompt).not.toContain('RELEASE SERIES');
  });

  it('lists items that look like retirements by source', () => {
    const p = buildPlanPrompt(
      [
        upd('azure__1', { title: 'Retirement: NVv3-series Azure Virtual Machines' }),
        upd('github__1', { title: 'Custom thread subscriptions are being deprecated' }),
        upd('azure__2', { title: 'Upcoming retirements for classic SKUs' }),
        upd('github__2', { title: 'Retiring the legacy runner images' }),
        upd('github__3', { title: 'New runner images' }),
      ],
      [],
    );
    expect(p.prompt).toContain('LIKELY RETIREMENTS (title mentions a retirement or deprecation), by source:\n- azure: i1, i3\n- github: i2, i4');
    expect(buildPlanPrompt([upd('a__1')], []).prompt).not.toContain('LIKELY RETIREMENTS');
  });

  it('builds a split prompt for one oversized topic', () => {
    const p = buildSplitPrompt('Azure updates', [upd('azure__1', { title: 'AKS GA' }), upd('azure__2', { title: 'SQL preview' })], {
      interests: 'AKS',
      otherTopics: ['Azure retirements', 'Azure SRE Agent'],
    });
    expect(p.system).toBe(DIGEST_SPLIT_SYSTEM_PROMPT);
    expect(p.effort).toBe('low');
    expect(p.prompt).toBe(
      [
        'READER INTERESTS: AKS',
        '',
        'OTHER TOPICS:',
        '- Azure retirements',
        '- Azure SRE Agent',
        '',
        'TOPIC: Azure updates (2 items)',
        '',
        'NEW ITEMS:',
        '[i1] (azure · 2026-01-01) AKS GA',
        '[i2] (azure · 2026-01-01) SQL preview',
      ].join('\n'),
    );
    expect(p.items.get('i2')!.id).toBe('azure__2');
    expect(p.topics.size).toBe(0);
    expect(buildSplitPrompt('X', [upd('a__1')]).prompt).not.toContain('OTHER TOPICS');
  });

  it('truncates long excerpts', () => {
    expect(excerpt('a'.repeat(1000), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});

describe('buildWritePrompt', () => {
  it('sends the current text and newest items first with low effort', () => {
    const w = buildWritePrompt(
      'Copilot CLI',
      [
        upd('a__1', { datePublished: '2026-01-01', content: 'old <b>news</b>' }),
        upd('a__2', { datePublished: '2026-01-02', content: 'new news' }),
      ],
      topic('x', { summary: 'Sum', highlights: ['H1'] }),
    );
    expect(w.prompt).toBe(
      [
        'TITLE: Copilot CLI',
        '',
        'CURRENT:',
        'summary: Sum',
        '- H1',
        '',
        'NEW ITEMS (2):',
        '[i1] (a · 2026-01-02) Title a__2',
        '  new news',
        '[i2] (a · 2026-01-01) Title a__1',
        '  old news',
      ].join('\n'),
    );
    expect(w.effort).toBe('low');
    expect([...w.items].map(([alias, u]) => [alias, u.id])).toEqual([['i1', 'a__2'], ['i2', 'a__1']]);
  });

  it('caps large topics to the newest items and shortens their excerpts', () => {
    const items = Array.from({ length: 35 }, (_, i) =>
      upd(`a__${i}`, { datePublished: `2026-${String(i + 1).padStart(2, '0')}-01`, content: 'y'.repeat(400) }),
    );
    const w = buildWritePrompt('Big', items);
    expect(w.prompt).not.toContain('CURRENT:');
    expect(w.prompt).toContain('NEW ITEMS (35, newest 30 shown):');
    expect(w.prompt).toContain('Title a__34');
    expect(w.prompt).not.toContain('Title a__4\n');
    expect(w.prompt).not.toContain('y'.repeat(200));
    expect(w.items.size).toBe(30);
  });
});

describe('reconcilePlan', () => {
  const prompt = buildPlanPrompt(
    [upd('a__1'), upd('b__2'), upd('c__3'), upd('d__4')],
    [{ topic: topic('open-1', { title: 'Existing', importance: 'medium' }) }],
  );

  it('maps aliases, dedupes items, merges repeated topics and leaves skipped items out', () => {
    const groups = reconcilePlan(
      {
        topics: [
          { topic: 't1', title: 'Existing grown', importance: 'low', items: ['i1', 'i9'] },
          { topic: null, title: '  Fresh  ', importance: 'low', items: ['i2', 'i1'] },
          { topic: 't1', title: 'dup', importance: 'high', items: ['i3'] },
          { topic: null, title: 'fresh', importance: 'urgent', items: [] },
        ],
      },
      prompt,
    );
    expect(groups).toEqual([
      { existingId: 'open-1', title: 'Existing grown', importance: 'high', itemIds: ['a__1', 'c__3'] },
      { title: 'Fresh', importance: 'low', itemIds: ['b__2'] },
    ]);
  });

  it('merges new topics with the same title and never lowers an open topic', () => {
    const groups = reconcilePlan(
      {
        topics: [
          { topic: null, title: 'Area', importance: 'medium', items: ['i1'] },
          { topic: null, title: 'AREA', importance: 'urgent', items: ['i2'] },
          { topic: 't1', title: '', importance: 'low', items: ['i3'] },
        ],
      },
      prompt,
    );
    expect(groups).toEqual([
      { title: 'Area', importance: 'medium', itemIds: ['a__1', 'b__2'] },
      { existingId: 'open-1', title: 'Existing', importance: 'medium', itemIds: ['c__3'] },
    ]);
  });

  it('returns nothing for garbage output and strips cited aliases from titles', () => {
    expect(reconcilePlan('nonsense', prompt)).toEqual([]);
    expect(reconcilePlan({ topics: [{ topic: null, title: 'T (t1)', items: ['i1'] }] }, prompt)[0]!.title).toBe('T');
    expect(reconcilePlan({ topics: [{ topic: null, title: '', items: ['i4'] }] }, prompt)[0]!.title).toBe('Title d__4');
  });

  it('builds a single-item group for an unplaced item', () => {
    expect(singletonGroup(upd('a__1', { title: 'GA now (i1)' }))).toEqual({ title: 'GA now', itemIds: ['a__1'] });
  });
});

describe('parseTopicText', () => {
  const fallback = { title: 'Planned', summary: 'Old', highlights: ['fallback'] };

  it('cleans fields and caps highlights', () => {
    const text = parseTopicText(
      { title: 'T (t1)', summary: 'S (i1).', highlights: ['- GA now (i1, i2)', '', 'Core i7 CPUs', '3', '4', '5', '6', '7'] },
      fallback,
    );
    expect(text).toEqual({ title: 'T', summary: 'S.', highlights: ['GA now', 'Core i7 CPUs', '3', '4', '5', '6'] });
  });

  it('falls back per field', () => {
    expect(parseTopicText({ title: '', summary: 'New', highlights: [] }, fallback)).toEqual({ ...fallback, summary: 'New' });
    expect(parseTopicText('nonsense', fallback)).toEqual(fallback);
  });
});

describe('parseItemSummaries', () => {
  const aliases = new Map([
    ['i1', upd('a__1')],
    ['i2', upd('b__2')],
  ]);

  it('maps aliases to update ids, cleans text and drops unknown, blank and repeated entries', () => {
    const summaries = parseItemSummaries(
      {
        items: [
          { id: ' i1 ', summary: '- Adds agent mode (i1).' },
          { id: 'i1', summary: 'Duplicate' },
          { id: 'i2', summary: '  ' },
          { id: 'i9', summary: 'Invented' },
          { summary: 'No id' },
          'garbage',
        ],
      },
      aliases,
    );
    expect([...summaries]).toEqual([['a__1', 'Adds agent mode.']]);
  });

  it('returns nothing for a reply without items', () => {
    expect(parseItemSummaries({ title: 'T' }, aliases).size).toBe(0);
    expect(parseItemSummaries(null, aliases).size).toBe(0);
  });

  it('drops a tacked-on publish date', () => {
    const dated = new Map([['i1', upd('a__1', { datePublished: '2026-09-24T10:00:00Z' })]]);
    const summaries = parseItemSummaries({ items: [{ id: 'i1', summary: 'Public preview (2026-09-24) adds MFA.' }] }, dated);
    expect(summaries.get('a__1')).toBe('Public preview adds MFA.');
  });
});

describe('stripPublishDate', () => {
  const cases: [string, string][] = [
    ['Private saved views are generally available (2026-09-25), enabling filters.', 'Private saved views are generally available, enabling filters.'],
    ['Improves promotion workflows (affects publishers; 2026-09-25).', 'Improves promotion workflows (affects publishers).'],
    ['Surfaces custom properties on repos—announced 2026-09-25.', 'Surfaces custom properties on repos.'],
    ['Helped find 24 Android bugs (report dated 2026-09-25).', 'Helped find 24 Android bugs.'],
    ['Explains canvases (released Sept 25, 2026) — useful for designers.', 'Explains canvases — useful for designers.'],
    ['Discovered 24 vulnerabilities (September 25, 2026).', 'Discovered 24 vulnerabilities.'],
  ];
  it.each(cases)('cleans %s', (input, expected) => {
    expect(stripPublishDate(input, '2026-09-25T08:00:00Z')).toBe(expected);
  });

  it('keeps dates that are part of the sentence or differ from the publish date', () => {
    const kept = [
      'NVv3-series VMs were retired Sep 25, 2026 and are no longer available.',
      'Enforcement ships 2026-09-25 with full enforcement from 2026-10-01.',
      'Retirement takes effect (2027-03-31).',
    ];
    for (const s of kept) expect(stripPublishDate(s, '2026-09-25')).toBe(s);
  });
});

describe('runDigest', () => {
  function makeStores(updates: Update[], topics: Topic[] = []) {
    const topicMap = new Map(topics.map((t) => [t.id, t]));
    const updateStore: DigestUpdateStore = {
      listUpdates: vi.fn(async () => ({ updates: updates.map((u) => ({ ...u })), total: updates.length, hasMore: false })),
      setTopicId: vi.fn(async () => undefined),
    };
    const topicStore: DigestTopicStore = {
      getTopics: vi.fn(async (ids: string[]) => new Map([...topicMap].filter(([id]) => ids.includes(id)))),
      upsertTopic: vi.fn(async (t: Topic) => { topicMap.set(t.id, t); }),
      deleteTopic: vi.fn(async (id: string) => { topicMap.delete(id); }),
    };
    return { updateStore, topicStore, topicMap };
  }

  /** Routes plan requests to `plan` (in order) and answers write requests with `S <title>`. */
  function fakeSummarizer(
    plans: unknown[],
    write?: (req: ModelRequest) => Promise<unknown>,
    split?: (req: ModelRequest) => Promise<unknown>,
  ) {
    const planRequests: ModelRequest[] = [];
    const splitRequests: ModelRequest[] = [];
    const writeRequests: ModelRequest[] = [];
    const generateJson = vi.fn(async (req: ModelRequest) => {
      if (req.system === DIGEST_PLAN_SYSTEM_PROMPT) {
        planRequests.push(req);
        return plans[planRequests.length - 1] ?? { topics: [] };
      }
      if (req.system === DIGEST_SPLIT_SYSTEM_PROMPT) {
        splitRequests.push(req);
        return split ? split(req) : { topics: [] };
      }
      writeRequests.push(req);
      if (write) return write(req);
      const title = req.prompt.split('\n')[0]!.replace('TITLE: ', '');
      return { title: '', summary: `S ${title}`, highlights: ['H'] };
    });
    return { summarizer: { generateJson }, planRequests, splitRequests, writeRequests };
  }

  it('plans all pending items with open topics as context, then writes each touched topic', async () => {
    const { updateStore, topicStore } = makeStores(
      [
        upd('a__1', { topicId: 'open-1', datePublished: '2026-01-01' }),
        upd('b__2', { datePublished: '2026-01-02' }),
        upd('c__3', { datePublished: '2026-01-03' }),
        upd('d__4', { datePublished: '2026-01-04' }),
      ],
      [topic('open-1', { summary: 'Before', highlights: ['old'] })],
    );
    const { summarizer, planRequests, writeRequests } = fakeSummarizer([
      {
        topics: [
          { topic: 't1', title: 'Grown', importance: 'high', items: ['i1', 'i2'] },
          { topic: null, title: 'New', importance: 'low', items: ['i3'] },
        ],
      },
    ]);
    let n = 0;
    const result = await runDigest({ updates: updateStore, topics: topicStore }, summarizer, {
      interests: 'agents',
      newId: () => `new-${++n}`,
      now: () => new Date('2026-02-01T00:00:00Z'),
    });

    expect(result).toEqual({ processed: 3, remaining: 0, created: 1, updated: 1, errors: [] });
    expect(planRequests).toHaveLength(1);
    const plan = planRequests[0]!;
    expect(plan).toMatchObject({ effort: 'medium', timeoutMs: 480_000 });
    expect(plan.prompt).toContain('READER INTERESTS: agents');
    expect(plan.prompt).toContain('[t1] (1 item) Topic open-1\n  - Title a__1');
    // oldest pending first
    expect(plan.prompt.indexOf('Title b__2')).toBeLessThan(plan.prompt.indexOf('Title d__4'));

    expect(writeRequests).toHaveLength(2);
    expect(writeRequests.every((r) => r.effort === 'low' && r.timeoutMs === 120_000)).toBe(true);
    const grownWrite = writeRequests.find((r) => r.prompt.startsWith('TITLE: Grown'))!;
    expect(grownWrite.prompt).toContain('summary: Before');
    expect(grownWrite.prompt).toContain('NEW ITEMS (2)');

    expect(topicStore.upsertTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'open-1',
        title: 'Grown',
        summary: 'S Grown',
        highlights: ['H'],
        importance: 'high',
        createdAt: 'c',
        updatedAt: '2026-02-01T00:00:00.000Z',
      }),
    );
    expect(topicStore.upsertTopic).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new-1', title: 'New', importance: 'low', createdAt: '2026-02-01T00:00:00.000Z' }),
    );
    expect(updateStore.setTopicId).toHaveBeenCalledWith('b__2', 'open-1');
    expect(updateStore.setTopicId).toHaveBeenCalledWith('c__3', 'open-1');
    expect(updateStore.setTopicId).toHaveBeenCalledWith('d__4', 'new-1');
  });

  it('stores the per-item summaries written for each topic', async () => {
    const { updateStore, topicStore } = makeStores([
      upd('a__1', { datePublished: '2026-01-01' }),
      upd('b__2', { datePublished: '2026-01-02' }),
    ]);
    const { summarizer, writeRequests } = fakeSummarizer(
      [{ topics: [{ topic: null, title: 'Area', importance: 'medium', items: ['i1', 'i2'] }] }],
      async () => ({ title: 'Area', summary: 'S', highlights: ['H'], items: [{ id: 'i1', summary: 'Newest item.' }] }),
    );
    await runDigest({ updates: updateStore, topics: topicStore }, summarizer, { newId: () => 'area' });
    // write prompts list the newest item first, so i1 is b__2
    expect(writeRequests[0]!.prompt).toContain('[i1] (b · 2026-01-02) Title b__2');
    expect(updateStore.setTopicId).toHaveBeenCalledWith('b__2', 'area', 'Newest item.');
    expect(updateStore.setTopicId).toHaveBeenCalledWith('a__1', 'area');
  });

  it('lets later planning chunks join topics formed by earlier ones', async () => {
    const { updateStore, topicStore } = makeStores([
      upd('a__1', { datePublished: '2026-01-01' }),
      upd('b__2', { datePublished: '2026-01-02' }),
    ]);
    const { summarizer, planRequests, writeRequests } = fakeSummarizer([
      { topics: [{ topic: null, title: 'Area', importance: 'low', items: ['i1'] }] },
      { topics: [{ topic: 't1', title: 'Area', importance: 'medium', items: ['i1'] }] },
    ]);
    const result = await runDigest({ updates: updateStore, topics: topicStore }, summarizer, {
      planBatchSize: 1,
      newId: () => 'area',
    });
    expect(planRequests[1]!.prompt).toContain('[t1] (low, 1 item) Area\n  - Title a__1');
    expect(writeRequests).toHaveLength(1);
    expect(writeRequests[0]!.prompt).toContain('NEW ITEMS (2)');
    expect(result).toMatchObject({ processed: 2, created: 1, updated: 0 });
    expect(topicStore.upsertTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'area', importance: 'medium' }));
  });

  it('re-plans skipped items against the new topics, then falls back to single-item topics', async () => {
    const { updateStore, topicStore, topicMap } = makeStores([
      upd('a__1', { datePublished: '2026-01-01' }),
      upd('b__2', { datePublished: '2026-01-02' }),
      upd('c__3', { datePublished: '2026-01-03' }),
    ]);
    const { summarizer, planRequests } = fakeSummarizer([
      { topics: [{ topic: null, title: 'Area', importance: 'low', items: ['i1'] }] },
      { topics: [{ topic: 't1', title: 'Area', importance: 'low', items: ['i1'] }] },
    ]);
    const log: string[] = [];
    let n = 0;
    const result = await runDigest({ updates: updateStore, topics: topicStore }, summarizer, {
      newId: () => `t-${++n}`,
      onProgress: (m) => log.push(m),
    });
    expect(planRequests).toHaveLength(2);
    expect(log).toContain('Placing skipped 2 item(s), 1 open topic(s)…');
    expect(planRequests[1]!.prompt).toContain('[t1] (low, 1 item) Area');
    expect(planRequests[1]!.prompt).toContain('[i1] (b · 2026-01-02) Title b__2');
    expect(result).toMatchObject({ processed: 3, created: 2, errors: [] });
    expect([...topicMap.values()].map((t) => t.title).sort()).toEqual(['Area', 'Title c__3']);
    expect(updateStore.setTopicId).toHaveBeenCalledWith('b__2', 't-1');
    expect(updateStore.setTopicId).toHaveBeenCalledWith('c__3', 't-2');
  });

  it('splits oversized new topics, caps their importance and merges parts into same-titled topics', async () => {
    const { updateStore, topicStore, topicMap } = makeStores(
      ['a', 'b', 'c', 'd', 'e'].map((x, i) => upd(`azure__${x}`, { datePublished: `2026-01-0${i + 1}` })),
    );
    const { summarizer, splitRequests, writeRequests } = fakeSummarizer(
      [
        {
          topics: [
            { topic: null, title: 'Azure updates', importance: 'medium', items: ['i1', 'i2', 'i3', 'i4'] },
            { topic: null, title: 'Azure retirements', importance: 'low', items: ['i5'] },
          ],
        },
      ],
      undefined,
      async () => ({
        topics: [
          { topic: null, title: 'Azure SRE Agent', importance: 'high', items: ['i1', 'i2'] },
          { topic: null, title: 'azure retirements', importance: 'low', items: ['i3'] },
        ],
      }),
    );
    let n = 0;
    const result = await runDigest({ updates: updateStore, topics: topicStore }, summarizer, {
      maxTopicItems: 3,
      newId: () => `t-${++n}`,
    });
    expect(splitRequests).toHaveLength(1);
    expect(splitRequests[0]!.prompt).toContain('OTHER TOPICS:\n- Azure retirements\n\nTOPIC: Azure updates (4 items)');
    expect(writeRequests).toHaveLength(3);
    expect(result).toMatchObject({ processed: 5, created: 3, errors: [] });
    const saved = [...topicMap.values()].map((t) => [t.title, t.importance]).sort();
    expect(saved).toEqual([
      ['Azure SRE Agent', 'medium'],
      ['Azure retirements', 'low'],
      ['Azure updates', 'medium'],
    ]);
    const retirements = [...topicMap.values()].find((t) => t.title === 'Azure retirements')!;
    expect(updateStore.setTopicId).toHaveBeenCalledWith('azure__c', retirements.id);
    expect(updateStore.setTopicId).toHaveBeenCalledWith('azure__e', retirements.id);
    const rest = [...topicMap.values()].find((t) => t.title === 'Azure updates')!;
    expect(updateStore.setTopicId).toHaveBeenCalledWith('azure__d', rest.id);
  });

  it('keeps an oversized topic whole when splitting fails or yields one part', async () => {
    for (const split of [
      async () => {
        throw new Error('timeout');
      },
      async () => ({ topics: [{ topic: null, title: 'Same', items: ['i1', 'i2', 'i3'] }] }),
    ]) {
      const { updateStore, topicStore, topicMap } = makeStores([upd('a__1'), upd('a__2'), upd('a__3')]);
      const { summarizer, splitRequests } = fakeSummarizer(
        [{ topics: [{ topic: null, title: 'Area', importance: 'low', items: ['i1', 'i2', 'i3'] }] }],
        undefined,
        split,
      );
      const result = await runDigest({ updates: updateStore, topics: topicStore }, summarizer, { maxTopicItems: 2 });
      expect(splitRequests).toHaveLength(1);
      expect(result).toMatchObject({ processed: 3, created: 1, errors: [] });
      expect([...topicMap.values()].map((t) => t.title)).toEqual(['Area']);
    }
  });

  it('retries a failed write once, then falls back to the item titles', async () => {
    const plans = [{ topics: [{ topic: null, title: 'Area', importance: 'low', items: ['i1'] }] }];
    const flaky = fakeSummarizer(plans, vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({
      title: 'Area',
      summary: 'ok',
      highlights: ['H'],
    }));
    const first = makeStores([upd('a__1')]);
    const log: string[] = [];
    const ok = await runDigest({ updates: first.updateStore, topics: first.topicStore }, flaky.summarizer, {
      onProgress: (m) => log.push(m),
    });
    expect(flaky.writeRequests).toHaveLength(2);
    expect(log).toContain('↻ retrying "Area": timeout');
    expect(ok.errors).toEqual([]);
    expect([...first.topicMap.values()][0]).toMatchObject({ summary: 'ok' });

    const broken = fakeSummarizer(plans, vi.fn().mockRejectedValue(new Error('boom')));
    const second = makeStores([upd('a__1')]);
    const failed = await runDigest({ updates: second.updateStore, topics: second.topicStore }, broken.summarizer);
    expect(broken.writeRequests).toHaveLength(2);
    expect(failed.errors).toEqual(['topic "Area": boom']);
    expect([...second.topicMap.values()][0]).toMatchObject({ title: 'Area', summary: '', highlights: ['Title a__1'] });
    expect(second.updateStore.setTopicId).toHaveBeenCalledWith('a__1', expect.any(String));
  });

  it('records a failed planning call and leaves its items pending', async () => {
    const { updateStore, topicStore } = makeStores([upd('a__1'), upd('b__2')]);
    const summarizer = { generateJson: vi.fn().mockRejectedValue(new Error('quota')) };
    const result = await runDigest({ updates: updateStore, topics: topicStore }, summarizer);
    expect(summarizer.generateJson).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 0, remaining: 2, created: 0, updated: 0, errors: ['planning: quota'] });
    expect(updateStore.setTopicId).not.toHaveBeenCalled();
  });

  it('respects maxItems and reports the rest as remaining', async () => {
    const { updateStore, topicStore } = makeStores([upd('a__1'), upd('b__2'), upd('c__3')]);
    const { summarizer } = fakeSummarizer([]);
    const result = await runDigest({ updates: updateStore, topics: topicStore }, summarizer, { maxItems: 2 });
    expect(result.processed).toBe(2);
    expect(result.remaining).toBe(1);
  });

  it('reset ungroups unread items and deletes their topics before regrouping', async () => {
    const { updateStore, topicStore } = makeStores([upd('a__1', { topicId: 'old' })], [topic('old')]);
    const { summarizer, planRequests } = fakeSummarizer([]);
    const result = await runDigest({ updates: updateStore, topics: topicStore }, summarizer, { reset: true, newId: () => 'fresh' });
    expect(topicStore.deleteTopic).toHaveBeenCalledWith('old');
    expect(updateStore.setTopicId).toHaveBeenCalledWith('a__1', '');
    expect(updateStore.setTopicId).toHaveBeenCalledWith('a__1', 'fresh');
    expect(planRequests[0]!.prompt).toContain('OPEN TOPICS:\n(none)');
    expect(result.created).toBe(1);
  });
});
