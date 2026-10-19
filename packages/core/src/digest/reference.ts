import type { ReferenceSuggestion } from '../types.js';
import { normalizeFolder } from '../references.js';
import { excerpt, type ModelRequest } from './prompt.js';
import type { Summarizer } from './run.js';

/** Most page text sent to the model. */
export const REFERENCE_MAX_INPUT_CHARS = 12_000;
/** Most existing folders listed in the prompt. */
const MAX_FOLDERS = 200;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 400;

export const REFERENCE_SYSTEM_PROMPT = `You file a link into a software engineer's personal reference library, a folder tree of bookmarks.
Write:
- title: a short, specific title for the link (keep the page's own title when it is good).
- folder: the folder path, segments joined with "/" (e.g. "ai/agents"), at most 3 levels deep. Reuse an existing folder when one fits; only create a new one (short, lowercase, broad topic first) when none does.
- description: one or two sentences (max 40 words) saying what the link is and when it would be useful to come back to it.
Only use facts from the input. No marketing language.
Reply only with JSON matching the schema.`;

export const REFERENCE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'folder', 'description'],
  properties: {
    title: { type: 'string' },
    folder: { type: 'string' },
    description: { type: 'string' },
  },
};

export interface ReferenceSuggestionInput {
  url: string;
  title?: string;
  /** What is known about the link: summary, gist, page text… */
  text: string;
  /** Folders already in use, so the model can reuse one. */
  folders: string[];
}

export function buildReferencePrompt(input: ReferenceSuggestionInput): ModelRequest {
  const folders = input.folders.slice(0, MAX_FOLDERS);
  return {
    system: REFERENCE_SYSTEM_PROMPT,
    prompt: [
      'EXISTING FOLDERS:',
      folders.length ? folders.map((f) => `- ${f}`).join('\n') : '(none yet)',
      '',
      `URL: ${input.url}`,
      `TITLE: ${input.title?.trim() || '(unknown)'}`,
      '',
      'CONTENT:',
      excerpt(input.text, REFERENCE_MAX_INPUT_CHARS) || '(not available)',
    ].join('\n'),
    schema: REFERENCE_SCHEMA,
    effort: 'low',
  };
}

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const s = value.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Validate the model's JSON; throws when it has neither a folder nor a description. */
export function parseReferenceSuggestion(raw: unknown): ReferenceSuggestion {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const suggestion: ReferenceSuggestion = {
    title: clean(obj.title, MAX_TITLE),
    folder: normalizeFolder(clean(obj.folder, MAX_TITLE)),
    description: clean(obj.description, MAX_DESCRIPTION),
  };
  if (!suggestion.folder && !suggestion.description) throw new Error('Copilot returned no suggestion');
  return suggestion;
}

export async function suggestReferenceWith(
  input: ReferenceSuggestionInput,
  summarizer: Summarizer,
  timeoutMs = 90_000,
): Promise<ReferenceSuggestion> {
  return parseReferenceSuggestion(await summarizer.generateJson({ ...buildReferencePrompt(input), timeoutMs }));
}
