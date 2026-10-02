import type { PostGist, Update } from '../types.js';
import { excerpt, type ModelRequest } from './prompt.js';
import type { Summarizer } from './run.js';

/** Posts with less text than this aren't summarised: a gist wouldn't be shorter. */
export const GIST_MIN_CHARS = 1000;
/** Most post text sent to the model. */
export const GIST_MAX_INPUT_CHARS = 20_000;
const MAX_SUMMARY = 300;
const MAX_POINTS = 5;
const MAX_POINT = 200;

export const POST_GIST_SYSTEM_PROMPT = `You summarise one post (release note, changelog entry, blog post or announcement) for a busy software engineer who wants the gist without reading it.
Focus on the feature or change itself, not on the article around it (navigation, author, sign-up prompts, related links).
Write:
- summary: one sentence (max 30 words) saying what the feature or change is and why it matters.
- points: 3–5 terse bullets (max 20 words each), most useful first, with the concrete facts the post gives: what it does, who it is for, how to get or enable it (plan, version, setting, preview or generally available, regions), and limits, pricing, deadlines or breaking changes.
Only use facts from the post and leave out what it does not say. No marketing language, do not repeat the title or the publish date.
Reply only with JSON matching the schema.`;

export const POST_GIST_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'points'],
  properties: {
    summary: { type: 'string' },
    points: { type: 'array', items: { type: 'string' } },
  },
};

function titleWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2);
}

/**
 * True when the text mentions most words of the title. Pages rendered by JavaScript, sign-in
 * walls and error pages don't, so their text isn't mistaken for the post.
 */
export function mentionsTitle(text: string, title: string): boolean {
  const wanted = new Set(titleWords(title));
  if (wanted.size === 0) return true;
  const present = new Set(titleWords(text));
  let hits = 0;
  for (const w of wanted) if (present.has(w)) hits++;
  return hits / wanted.size >= 0.6;
}

/**
 * The text to summarise: the fetched page when it is about the post and says more than the stored
 * preview, otherwise the preview (e.g. the page couldn't be fetched or is rendered by JavaScript).
 */
export function gistSource(
  update: Pick<Update, 'title' | 'content'>,
  pageText: string | undefined,
): { text: string; from: 'page' | 'preview' } {
  const previewText = excerpt(update.content, Number.MAX_SAFE_INTEGER);
  const page = excerpt(pageText ?? '', Number.MAX_SAFE_INTEGER);
  return page.length > previewText.length && mentionsTitle(page, update.title)
    ? { text: page, from: 'page' }
    : { text: previewText, from: 'preview' };
}

export function buildGistPrompt(update: Update, text: string): ModelRequest {
  return {
    system: POST_GIST_SYSTEM_PROMPT,
    prompt: [
      `TITLE: ${update.title}`,
      `SOURCE: ${update.source} · ${update.datePublished.slice(0, 10)}`,
      '',
      'POST:',
      excerpt(text, GIST_MAX_INPUT_CHARS),
    ].join('\n'),
    schema: POST_GIST_SCHEMA,
    effort: 'low',
  };
}

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const s = value.replace(/\s+/g, ' ').trim().replace(/^[-•*]\s+/, '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Validate the model's JSON; throws when there is no summary. */
export function parseGist(raw: unknown): PostGist {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as { summary?: unknown; points?: unknown };
  const summary = clean(obj.summary, MAX_SUMMARY);
  if (!summary) throw new Error('Copilot returned no summary');
  const points = (Array.isArray(obj.points) ? obj.points : [])
    .map((p) => clean(p, MAX_POINT))
    .filter(Boolean)
    .slice(0, MAX_POINTS);
  return { summary, points };
}

/** Ask the model for the gist of `text` (the post's full text). */
export async function writeGist(
  update: Update,
  text: string,
  summarizer: Summarizer,
  timeoutMs = 120_000,
): Promise<PostGist> {
  return parseGist(await summarizer.generateJson({ ...buildGistPrompt(update, text), timeoutMs }));
}
