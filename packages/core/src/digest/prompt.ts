import type { Topic, Update } from '../types.js';

const TITLE_RULE = `TITLE: the area name, max 6 words, no trailing period (e.g. "Copilot code review", "Azure retirements"). For a standalone launch, name the launch.`;

const IMPORTANCE_RULES = `IMPORTANCE — would the reader regret skipping the topic? Rate by its most important item.
- "high": at most 3 topics per reply, often none. Only a new product, a major version or revamp of a widely used developer tool (e.g. Copilot CLI, VS Code, GitHub Actions), or a flagship model from a major AI lab.
- "medium": notable new features, previews becoming generally available, breaking changes or required actions for common setups within about 3 months.
- "low": everything else, e.g. patch and bug-fix releases, minor tweaks, region or SKU expansions, admin and billing settings, far-off or narrow deprecations, research, partnerships, events, case studies, essays and marketing.
Deprecations and protocol or algorithm changes are never high: a Copilot CLI revamp is high, an SSH algorithm deprecation is low.
If READER INTERESTS are given, move importance by at most one level for topics that clearly match them; interests never change the grouping.`;

const SHARED_GROUPING_RULES = `- Never make vendor-wide or catch-all topics such as "Azure product updates", "GitHub updates", "Misc", "Other news" or "Guidance and opinion". A title joining unrelated areas with "and" means the topic should be split.
- Deprecations, retirements and end-of-support notices (see LIKELY RETIREMENTS) go into one retirements topic per vendor (e.g. "Azure retirements", "GitHub deprecations"); never mix them with launches.
- Items listed together under RELEASE SERIES belong in the same topic. Items with the same title are the same story: same topic.`;

const HINTS_RULE = `- If READER GROUPING HINTS are given, follow them: they take priority over the other grouping rules, but every item still goes into exactly one topic.`;

/**
 * Pass 1 — plan: sees every pending item at once (titles + short excerpts) and
 * assigns them to product-area topics with an importance rating.
 */
export const DIGEST_PLAN_SYSTEM_PROMPT = `You organise a personal tech-news digest for a busy software engineer.
Group the NEW ITEMS (release notes, changelogs, blog posts, news) into product-area topics that the reader can read or skip as a unit, and rate each topic.

GROUPING
- A topic is one product, or one clear feature area of a large platform, e.g. "Copilot CLI releases", "Copilot code review", "Copilot coding agent", "Copilot models", "Copilot billing and metrics", "GitHub Actions", "GitHub code security", "GitHub enterprise admin", "GitHub issues and projects", "VS Code releases", "Azure SRE Agent", "Azure databases", "Azure networking", "Azure retirements", "Anthropic news".
- Size: 3–15 items per topic is ideal; aim for about one topic per 10 items (20–30 topics for 250 items). Split an area with more than 15 items into narrower areas. Put an area with only 1–2 items into the closest area of the same product, unless it is a major launch.
${SHARED_GROUPING_RULES}
- A blog post goes into the product area it is about. General essays (opinion, culture, career, generic how-tos) go into one "<source> essays" topic per source (e.g. "GitHub blog essays").
- A new product, a major launch or a revamp of a widely used developer tool gets its own topic so it is not buried.
- If an item fits an OPEN topic, set "topic" to that id (e.g. "t2") and keep its title; otherwise set "topic" to null.
- Every new item id (e.g. "i3") must appear in exactly one topic. Never invent ids.
${HINTS_RULE}

${TITLE_RULE}

${IMPORTANCE_RULES}
Reply only with JSON matching the schema.`;

/** Follow-up for a planned topic that came out too large: split it into narrower areas. */
export const DIGEST_SPLIT_SYSTEM_PROMPT = `You organise a personal tech-news digest for a busy software engineer.
The TOPIC below grew too large to skim. Split its NEW ITEMS into 2–4 narrower product-area topics of about 3–12 items each, and rate each topic.

GROUPING
- Each topic is one product or one clear feature area, e.g. split "Azure updates" into "Azure SRE Agent", "Azure networking", "Azure compute" and "Azure retirements"; split "Copilot apps and editors" into "Copilot app", "Copilot CLI" and "Copilot in editors".
${SHARED_GROUPING_RULES}
- If items belong to one of the OTHER TOPICS, put them in a topic with exactly that title instead of making a similar one.
- Set "topic" to null. Every item id (e.g. "i3") must appear in exactly one topic. Never invent ids.
${HINTS_RULE}

${TITLE_RULE}

${IMPORTANCE_RULES}
Reply only with JSON matching the schema.`;

/** JSON Schema for the plan response (strict-mode compatible). */
export const DIGEST_PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['topics'],
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'title', 'items', 'importance'],
        properties: {
          topic: { type: ['string', 'null'], description: 'Open topic id (t1, t2, …) or null for a new topic' },
          title: { type: 'string' },
          items: { type: 'array', items: { type: 'string' }, description: 'New item ids (i1, i2, …)' },
          importance: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

/** Pass 2 — write: one call per topic with fuller excerpts. */
export const DIGEST_WRITE_SYSTEM_PROMPT = `You write one topic of a personal tech-news digest for a busy software engineer.
You receive the topic TITLE, its CURRENT summary and highlights (if any) and its NEW ITEMS.
Write:
- title: keep the given title unless it no longer fits; max 10 words, no trailing period.
- summary: one sentence (max 30 words) saying what changed in this area and why it matters.
- highlights: 1–6 terse bullets, most important first, one per notable change, with the concrete facts (versions, features, dates, breaking changes, availability, pricing). Fold minor items into a single bullet. Keep current highlights that still matter.
- items: one entry for every NEW ITEM: its id (e.g. "i3") and a one-sentence summary (max 25 words) of what the item says and who it affects, with the key fact (version, feature, availability, deadline). Do not repeat the item title or its publish date.
No marketing language, do not repeat the topic title and never mention item ids inside any text.
Reply only with JSON matching the schema.`;

export const DIGEST_WRITE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'highlights', 'items'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'summary'],
        properties: {
          id: { type: 'string', description: 'Item id (i1, i2, …)' },
          summary: { type: 'string' },
        },
      },
    },
  },
};

export interface ModelRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  /** Reasoning-effort hint; ignored by models that do not support it. */
  effort?: 'low' | 'medium' | 'high';
  /** Per-request timeout hint in ms. */
  timeoutMs?: number;
}

export interface WritePrompt extends ModelRequest {
  /** alias (i1…) → update, for the per-item summaries */
  items: Map<string, Update>;
}

export interface PlanPrompt extends ModelRequest {
  /** alias (i1…) → update */
  items: Map<string, Update>;
  /** alias (t1…) → topic */
  topics: Map<string, Topic>;
}

const EXCERPT_CHARS = 500;
const PLAN_EXCERPT_CHARS = 140;
const MAX_INTERESTS_CHARS = 500;
const MAX_HINTS_CHARS = 1000;
const OPEN_TOPIC_SAMPLES = 3;
const MAX_WRITE_ITEMS = 30;

/** Reader settings shared by the plan and split prompts. */
export interface ReaderOptions {
  /** Nudges importance by at most one level. */
  interests?: string;
  /** Free-text grouping instructions that take priority over the default grouping rules. */
  groupingHints?: string;
}

function oneLine(text: string | undefined, max: number): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** READER INTERESTS / READER GROUPING HINTS lines (each followed by a blank line) when set. */
function readerLines({ interests, groupingHints }: ReaderOptions): string[] {
  const lines: string[] = [];
  const i = oneLine(interests, MAX_INTERESTS_CHARS);
  if (i) lines.push(`READER INTERESTS: ${i}`, '');
  const h = oneLine(groupingHints, MAX_HINTS_CHARS);
  if (h) lines.push(`READER GROUPING HINTS: ${h}`, '');
  return lines;
}

export function excerpt(content: string, max = EXCERPT_CHARS): string {
  const text = content
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * What the model reads about an item: its saved Copilot summary (gist) when there is one — written from the
 * full page, so it says more in fewer words — otherwise the start of the feed preview.
 */
export function itemText(u: Update, max: number): string {
  const gist = u.gist ? [u.gist.summary, ...u.gist.points].join(' ') : '';
  return excerpt(gist.trim() || (u.content ?? ''), max);
}

/** Items whose titles differ only in numbers (versions, dates) are likely one release stream. */
function seriesKey(u: Update): string {
  return `${u.source}|${u.title.toLowerCase().replace(/\d+(?:[.-]\d+)*/g, '#').replace(/\s+/g, ' ').trim()}`;
}

function itemLine(alias: string, u: Update): string {
  return `[${alias}] (${u.source} · ${u.datePublished.slice(0, 10)}) ${u.title}`;
}

const RETIREMENT =
  /\b(?:retir(?:e|ed|es|ing|ements?)|deprecat(?:e|ed|es|ing|ions?)|end[- ]of[- ](?:support|life|sale)|sunset(?:s|ting)?)\b/i;

/** NEW ITEMS plus grouping hints; fills `aliases` (i1… → update). */
function itemSection(items: Update[], aliases: Map<string, Update>): string[] {
  const lines = ['NEW ITEMS:'];
  const series = new Map<string, string[]>();
  const retirements = new Map<string, string[]>();
  items.forEach((u, i) => {
    const alias = `i${i + 1}`;
    aliases.set(alias, u);
    const text = itemText(u, PLAN_EXCERPT_CHARS);
    lines.push(`${itemLine(alias, u)}${text ? ` — ${text}` : ''}`);
    const key = seriesKey(u);
    series.set(key, [...(series.get(key) ?? []), alias]);
    if (RETIREMENT.test(u.title)) retirements.set(u.source, [...(retirements.get(u.source) ?? []), alias]);
  });

  const releaseSeries = [...series.values()].filter((group) => group.length > 1);
  if (releaseSeries.length > 0) {
    lines.push('', 'RELEASE SERIES (same source, titles differ only in numbers):');
    for (const group of releaseSeries) lines.push(`- ${group.join(', ')}`);
  }
  if (retirements.size > 0) {
    lines.push('', 'LIKELY RETIREMENTS (title mentions a retirement or deprecation), by source:');
    for (const [source, group] of retirements) lines.push(`- ${source}: ${group.join(', ')}`);
  }
  return lines;
}

export interface OpenTopic {
  topic: Topic;
  /** Unread or saved item titles already in the topic (newest first), used as scope samples. */
  itemTitles?: string[];
}

/** Pass 1 prompt. Short aliases (i1, t1) keep the model from echoing long ids. */
export function buildPlanPrompt(items: Update[], open: OpenTopic[], options: ReaderOptions = {}): PlanPrompt {
  const itemAliases = new Map<string, Update>();
  const topicAliases = new Map<string, Topic>();
  const lines = readerLines(options);

  lines.push('OPEN TOPICS:');
  if (open.length === 0) lines.push('(none)');
  open.forEach(({ topic: t, itemTitles = [] }, i) => {
    const alias = `t${i + 1}`;
    topicAliases.set(alias, t);
    const n = itemTitles.length;
    const meta = [t.importance, n ? `${n} item${n === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
    lines.push(`[${alias}]${meta ? ` (${meta})` : ''} ${t.title}`);
    for (const title of itemTitles.slice(0, OPEN_TOPIC_SAMPLES)) lines.push(`  - ${title}`);
  });

  lines.push('', ...itemSection(items, itemAliases));

  return {
    system: DIGEST_PLAN_SYSTEM_PROMPT,
    prompt: lines.join('\n'),
    schema: DIGEST_PLAN_SCHEMA,
    effort: 'medium',
    items: itemAliases,
    topics: topicAliases,
  };
}

/**
 * Prompt to split one oversized new topic into narrower areas; answered with the plan schema.
 * `otherTopics` are titles the parts may reuse so they can be merged instead of duplicated.
 */
export function buildSplitPrompt(
  title: string,
  items: Update[],
  options: ReaderOptions & { otherTopics?: string[] } = {},
): PlanPrompt {
  const itemAliases = new Map<string, Update>();
  const lines = readerLines(options);
  const others = options.otherTopics ?? [];
  if (others.length > 0) lines.push('OTHER TOPICS:', ...others.map((t) => `- ${t}`), '');
  lines.push(`TOPIC: ${title} (${items.length} items)`, '', ...itemSection(items, itemAliases));
  return {
    system: DIGEST_SPLIT_SYSTEM_PROMPT,
    prompt: lines.join('\n'),
    schema: DIGEST_PLAN_SCHEMA,
    effort: 'low',
    items: itemAliases,
    topics: new Map(),
  };
}

/** Excerpt budget shrinks as topics grow so large areas stay fast to write. */
function writeExcerptChars(count: number): number {
  if (count <= 5) return EXCERPT_CHARS;
  if (count <= 12) return 280;
  return 200;
}

/** Pass 2 prompt for one topic. Only the newest items are sent for very large topics. */
export function buildWritePrompt(title: string, items: Update[], existing?: Topic): WritePrompt {
  const newest = [...items].sort((a, b) => b.datePublished.localeCompare(a.datePublished)).slice(0, MAX_WRITE_ITEMS);
  const chars = writeExcerptChars(newest.length);
  const lines = [`TITLE: ${title}`];
  if (existing && (existing.summary || existing.highlights.length > 0)) {
    lines.push('', 'CURRENT:');
    if (existing.summary) lines.push(`summary: ${existing.summary}`);
    for (const h of existing.highlights) lines.push(`- ${h}`);
  }
  lines.push('', `NEW ITEMS (${items.length}${items.length > newest.length ? `, newest ${newest.length} shown` : ''}):`);
  const aliases = new Map<string, Update>();
  newest.forEach((u, i) => {
    const alias = `i${i + 1}`;
    aliases.set(alias, u);
    lines.push(itemLine(alias, u));
    const text = itemText(u, chars);
    if (text) lines.push(`  ${text}`);
  });
  return {
    system: DIGEST_WRITE_SYSTEM_PROMPT,
    prompt: lines.join('\n'),
    schema: DIGEST_WRITE_SCHEMA,
    effort: 'low',
    items: aliases,
  };
}
