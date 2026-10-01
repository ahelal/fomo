import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelRequest, Summarizer } from '@fomo/core/digest';

export const DEFAULT_COPILOT_MODEL = 'gpt-5-mini';

export interface CopilotSummarizerOptions {
  model?: string;
  /** Explicit token; otherwise COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN or the logged-in Copilot CLI user. */
  gitHubToken?: string;
  /** Default per-request timeout in ms when the request gives none. */
  timeoutMs?: number;
}

type CopilotClientLike = {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  listModels(): Promise<Array<{ id: string; supportedReasoningEfforts?: string[] }>>;
  createSession(config: Record<string, unknown>): Promise<{
    sendAndWait(options: Record<string, unknown>, timeout?: number): Promise<{ data: { content: string } } | undefined>;
    disconnect(): Promise<void>;
  }>;
};

/**
 * Summarizer backed by the GitHub Copilot SDK.
 * Uses an isolated, tool-less session per request so the model only sees the prompt.
 */
export class CopilotSummarizer implements Summarizer {
  private client: CopilotClientLike | undefined;
  private efforts: Promise<Set<string>> | undefined;
  readonly model: string;

  constructor(private readonly options: CopilotSummarizerOptions = {}) {
    this.model = options.model || DEFAULT_COPILOT_MODEL;
  }

  private async getClient(): Promise<CopilotClientLike> {
    if (this.client) return this.client;
    const { CopilotClient } = await import('@github/copilot-sdk');
    const baseDirectory = join(homedir(), '.fomo', 'copilot');
    mkdirSync(baseDirectory, { recursive: true });
    const token =
      this.options.gitHubToken ??
      process.env['COPILOT_GITHUB_TOKEN'] ??
      process.env['GH_TOKEN'] ??
      process.env['GITHUB_TOKEN'];
    const client = new CopilotClient({
      mode: 'empty',
      baseDirectory,
      logLevel: 'error',
      ...(token ? { gitHubToken: token } : {}),
    }) as unknown as CopilotClientLike;
    await client.start();
    this.client = client;
    return client;
  }

  /** Reasoning efforts the model accepts (empty when unknown or unsupported). */
  private supportedEfforts(client: CopilotClientLike): Promise<Set<string>> {
    this.efforts ??= client
      .listModels()
      .then((models) => new Set(models.find((m) => m.id === this.model)?.supportedReasoningEfforts ?? []))
      .catch(() => new Set<string>());
    return this.efforts;
  }

  async generateJson({ system, prompt, schema, effort, timeoutMs }: ModelRequest): Promise<unknown> {
    const client = await this.getClient();
    const reasoningEffort = effort && (await this.supportedEfforts(client)).has(effort) ? effort : undefined;
    const session = await client.createSession({
      model: this.model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      availableTools: [],
      onPermissionRequest: () => ({ kind: 'reject' }),
      systemMessage: { mode: 'append', content: system },
    });
    try {
      const message = await session.sendAndWait(
        { prompt, responseSchema: schema },
        timeoutMs ?? this.options.timeoutMs ?? 180_000,
      );
      const content = message?.data.content?.trim();
      if (!content) throw new Error('Copilot returned an empty response');
      return JSON.parse(content);
    } finally {
      await session.disconnect().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client) await client.stop().catch(() => undefined);
  }
}

/** Hands out one summarizer per model; replaced ones stay open until `close()` in case a run still uses them. */
export class SummarizerCache {
  private current: CopilotSummarizer | undefined;
  private readonly retired: CopilotSummarizer[] = [];

  get(model?: string): CopilotSummarizer {
    const wanted = model || DEFAULT_COPILOT_MODEL;
    if (this.current?.model !== wanted) {
      if (this.current) this.retired.push(this.current);
      this.current = new CopilotSummarizer({ model: wanted });
    }
    return this.current;
  }

  async close(): Promise<void> {
    const all = [...this.retired.splice(0), ...(this.current ? [this.current] : [])];
    this.current = undefined;
    await Promise.all(all.map((s) => s.close()));
  }
}
