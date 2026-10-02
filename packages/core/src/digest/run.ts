import type { ListOptions, ListResponse, Topic, TopicImportance, Update } from '../types.js';
import { mapLimit } from '../util.js';
import { buildPlanPrompt, buildSplitPrompt, buildWritePrompt, type ModelRequest } from './prompt.js';
import {
  higherImportance,
  parseItemSummaries,
  parseTopicText,
  reconcilePlan,
  singletonGroup,
  type TopicGroup,
  type TopicText,
} from './reconcile.js';
import { importanceRank } from './view.js';

/** LLM backend used to group items. Implemented in the TUI with the GitHub Copilot SDK. */
export interface Summarizer {
  /** Send the prompt and return the parsed JSON response (must follow `schema`). */
  generateJson(req: ModelRequest): Promise<unknown>;
}

export interface DigestUpdateStore {
  listUpdates(options: ListOptions): Promise<ListResponse>;
  /** `summary` is the update's one-line summary; omitted when the model gave none. */
  setTopicId(id: string, topicId: string, summary?: string): Promise<void>;
}

export interface DigestTopicStore {
  getTopics(ids: string[]): Promise<Map<string, Topic>>;
  upsertTopic(topic: Topic): Promise<void>;
  deleteTopic(id: string): Promise<void>;
}

export interface DigestOptions {
  /** Max unread items to digest per run (newest first). Default 300. */
  maxItems?: number;
  /** Items per planning call. Default 300 (one call, so the model sees everything at once). */
  planBatchSize?: number;
  /** Max open topics sent as context per planning call. Default 100. */
  maxContextTopics?: number;
  /** New topics with more items than this get a follow-up call to split them. Default 15. */
  maxTopicItems?: number;
  /** Parallel topic-writing calls. Default 6. */
  concurrency?: number;
  /** Timeout per planning call in ms. Default 480000. */
  planTimeoutMs?: number;
  /** Timeout per topic-writing attempt in ms (one retry on failure). Default 120000. */
  writeTimeoutMs?: number;
  /** Ungroup all unread items and regroup from scratch. */
  reset?: boolean;
  /** Free-text reader interests; nudges importance by at most one level. */
  interests?: string;
  onProgress?(message: string): void;
  /** Injectable for tests. */
  now?(): Date;
  newId?(): string;
}

export interface DigestResult {
  /** Items grouped in this run. */
  processed: number;
  /** Unread items still ungrouped (over `maxItems` or failed planning calls). */
  remaining: number;
  created: number;
  updated: number;
  errors: string[];
}

/** A topic touched by this run: its planned state plus the items joining it. */
interface TopicWork {
  topic: Topic;
  /** Stored topic before this run (unset for new topics). */
  prior?: Topic;
  items: Update[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A part of a topic is never rated above the whole. */
function capImportance(value: TopicImportance | undefined, cap: TopicImportance | undefined): TopicImportance | undefined {
  if (!value || !cap) return value ?? cap;
  return importanceRank(value) > importanceRank(cap) ? cap : value;
}

/**
 * Group unread, ungrouped updates into product-area topics in two passes:
 * 1. plan — the model sees all pending items (titles + short excerpts) and the open topics at once,
 *    and assigns items to topics with an importance rating; items it skips get one more planning call,
 *    and new topics over `maxTopicItems` get a call to split them into narrower areas;
 * 2. write — one call per touched topic writes its summary, highlights and a one-line summary per item.
 * Safe to re-run: only items without a known topic are sent to the model.
 */
export async function runDigest(
  stores: { updates: DigestUpdateStore; topics: DigestTopicStore },
  summarizer: Summarizer,
  options: DigestOptions = {},
): Promise<DigestResult> {
  const maxItems = options.maxItems ?? 300;
  const planBatchSize = Math.max(1, options.planBatchSize ?? 300);
  const maxContextTopics = options.maxContextTopics ?? 100;
  const maxTopicItems = Math.max(2, options.maxTopicItems ?? 15);
  const concurrency = Math.max(1, options.concurrency ?? 6);
  const planTimeoutMs = options.planTimeoutMs ?? 480_000;
  const writeTimeoutMs = options.writeTimeoutMs ?? 120_000;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const log = options.onProgress ?? (() => undefined);

  const { updates: unread } = await stores.updates.listUpdates({
    status: 'unread',
    limit: Number.MAX_SAFE_INTEGER,
    includeContent: true,
  });

  if (options.reset) {
    const grouped = unread.filter((u) => u.topicId);
    const topicIds = [...new Set(grouped.map((u) => u.topicId!))];
    log(`Resetting ${grouped.length} item(s) across ${topicIds.length} topic(s)…`);
    await mapLimit(grouped, 8, (u) => stores.updates.setTopicId(u.id, ''));
    await mapLimit(topicIds, 8, (id) => stores.topics.deleteTopic(id));
    for (const u of grouped) delete u.topicId;
  }

  const open = await stores.topics.getTopics(unread.map((u) => u.topicId ?? '').filter(Boolean));
  const topicTitles = new Map<string, string[]>();
  const newestFirst = [...unread].sort((a, b) => b.datePublished.localeCompare(a.datePublished));
  for (const u of newestFirst) {
    if (u.topicId && open.has(u.topicId)) topicTitles.set(u.topicId, [...(topicTitles.get(u.topicId) ?? []), u.title]);
  }
  const allPending = newestFirst.filter((u) => !u.topicId || !open.has(u.topicId));
  // Oldest first so topics evolve chronologically
  const pending = allPending.slice(0, maxItems).reverse();

  const result: DigestResult = { processed: 0, remaining: 0, created: 0, updated: 0, errors: [] };
  const work = new Map<string, TopicWork>();

  const applyGroup = (group: TopicGroup, byId: Map<string, Update>) => {
    const items = group.itemIds.map((id) => byId.get(id)!);
    const known = group.existingId ? work.get(group.existingId) : undefined;
    const stored = group.existingId && !known ? open.get(group.existingId) : undefined;
    let entry = known;
    if (!entry) {
      const topic: Topic = stored
        ? { ...stored }
        : { id: newId(), title: group.title, summary: '', highlights: [], createdAt: '', updatedAt: '' };
      entry = { topic, ...(stored ? { prior: stored } : {}), items: [] };
      work.set(topic.id, entry);
      open.set(topic.id, topic);
    }
    entry.topic.title = group.title;
    if (group.importance) entry.topic.importance = group.importance;
    entry.items.push(...items);
    topicTitles.set(entry.topic.id, [...items.map((u) => u.title).reverse(), ...(topicTitles.get(entry.topic.id) ?? [])]);
  };

  /** Plans one batch; returns the items the model left out (none if the call failed — those stay pending). */
  const plan = async (batch: Update[], label: string): Promise<Update[]> => {
    const context = [...open.values()]
      .sort((a, b) => (topicTitles.get(b.id)?.length ?? 0) - (topicTitles.get(a.id)?.length ?? 0))
      .slice(0, maxContextTopics)
      .map((topic) => ({ topic, itemTitles: topicTitles.get(topic.id) ?? [] }));
    log(`${label} ${batch.length} item(s), ${context.length} open topic(s)…`);
    try {
      const prompt = buildPlanPrompt(batch, context, { interests: options.interests });
      const groups = reconcilePlan(
        await summarizer.generateJson({ ...prompt, timeoutMs: planTimeoutMs }),
        prompt,
      );
      const byId = new Map(batch.map((u) => [u.id, u]));
      for (const group of groups) applyGroup(group, byId);
      const placed = new Set(groups.flatMap((g) => g.itemIds));
      return batch.filter((u) => !placed.has(u.id));
    } catch (err) {
      result.errors.push(`${label.toLowerCase()}: ${errorMessage(err)}`);
      log(`⚠ ${label.toLowerCase()} failed: ${errorMessage(err)}`);
      return [];
    }
  };

  const chunks = Math.ceil(pending.length / planBatchSize);
  let skipped: Update[] = [];
  for (let i = 0; i < pending.length; i += planBatchSize) {
    const chunkNo = i / planBatchSize + 1;
    const label = chunks > 1 ? `Planning (${chunkNo}/${chunks})` : 'Planning';
    skipped.push(...(await plan(pending.slice(i, i + planBatchSize), label)));
  }
  // The skipped items now see every topic formed above, so most find a home.
  if (skipped.length > 0) skipped = await plan(skipped, 'Placing skipped');
  const byId = new Map(skipped.map((u) => [u.id, u]));
  for (const u of skipped) applyGroup(singletonGroup(u), byId);

  // Oversized new topics get one more call to split them into narrower areas.
  const oversized = [...work.values()].filter((e) => !e.prior && e.items.length > maxTopicItems);
  const oversizedIds = new Set(oversized.map((e) => e.topic.id));
  const findTopic = (title: string) =>
    [...open.values()].find((t) => !oversizedIds.has(t.id) && t.title.toLowerCase() === title.toLowerCase());
  const otherTopics = [...open.values()]
    .filter((t) => !oversizedIds.has(t.id))
    .sort((a, b) => (topicTitles.get(b.id)?.length ?? 0) - (topicTitles.get(a.id)?.length ?? 0))
    .slice(0, maxContextTopics)
    .map((t) => t.title);
  await mapLimit(oversized, concurrency, async (entry) => {
    const { topic, items } = entry;
    log(`Splitting "${topic.title}" (${items.length})…`);
    try {
      const prompt = buildSplitPrompt(topic.title, items, { interests: options.interests, otherTopics });
      const groups = reconcilePlan(await summarizer.generateJson({ ...prompt, timeoutMs: planTimeoutMs }), prompt);
      if (groups.length < 2) return;
      const placed = new Set(groups.flatMap((g) => g.itemIds));
      const rest = items.filter((u) => !placed.has(u.id)).map((u) => u.id);
      if (rest.length > 0) groups.push({ title: topic.title, itemIds: rest });
      work.delete(topic.id);
      open.delete(topic.id);
      topicTitles.delete(topic.id);
      const itemsById = new Map(items.map((u) => [u.id, u]));
      for (const group of groups) {
        const importance = capImportance(group.importance ?? topic.importance, topic.importance);
        const same = findTopic(group.title);
        const merged = same ? higherImportance(same.importance, importance) : importance;
        applyGroup(
          {
            ...(same ? { existingId: same.id } : {}),
            title: same?.title ?? group.title,
            ...(merged ? { importance: merged } : {}),
            itemIds: group.itemIds,
          },
          itemsById,
        );
      }
    } catch (err) {
      log(`⚠ splitting "${topic.title}" failed: ${errorMessage(err)}`);
    }
  });

  const entries = [...work.values()];
  let written = 0;
  await mapLimit(entries, concurrency, async ({ topic, prior, items }) => {
    const fallback: TopicText = {
      title: topic.title,
      summary: prior?.summary ?? '',
      highlights: [...(prior?.highlights ?? []), ...items.map((u) => u.title)],
    };
    let text = fallback;
    let summaries = new Map<string, string>();
    const prompt = buildWritePrompt(topic.title, items, prior);
    const request = { ...prompt, timeoutMs: writeTimeoutMs };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await summarizer.generateJson(request);
        text = parseTopicText(raw, fallback);
        summaries = parseItemSummaries(raw, prompt.items);
        break;
      } catch (err) {
        if (attempt === 2) result.errors.push(`topic "${topic.title}": ${errorMessage(err)}`);
        else log(`↻ retrying "${topic.title}": ${errorMessage(err)}`);
      }
    }
    const ts = now().toISOString();
    const saved: Topic = { ...topic, ...text, createdAt: prior?.createdAt ?? ts, updatedAt: ts };
    // Topic first: if item assignment fails midway the items simply stay pending.
    await stores.topics.upsertTopic(saved);
    await mapLimit(items, 8, (u) => {
      const summary = summaries.get(u.id);
      return summary ? stores.updates.setTopicId(u.id, saved.id, summary) : stores.updates.setTopicId(u.id, saved.id);
    });
    if (prior) result.updated++;
    else result.created++;
    result.processed += items.length;
    written++;
    log(`Wrote ${written}/${entries.length}: ${saved.title} (${items.length})`);
  });

  result.remaining = allPending.length - result.processed;
  return result;
}
