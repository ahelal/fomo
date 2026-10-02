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

type CopilotSessionLike = {
  sendAndWait(options: Record<string, unknown>, timeout?: number): Promise<{ data: { content: string } } | undefined>;
  disconnect(): Promise<void>;
};

type CopilotClientLike = {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  listModels(): Promise<Array<{ id: string; supportedReasoningEfforts?: string[] }>>;
  createSession(config: Record<string, unknown>): Promise<CopilotSessionLike>;
};

/**
 * True when the client's runtime connection has closed (the Copilot CLI process exited or
 * crashed, e.g. after the machine slept). The SDK doesn't reconnect by itself and has no
 * public state getter, so this reads its internal `state` field; unknown means "alive".
 */
function isClosed(client: CopilotClientLike): boolean {
  const state = (client as { state?: unknown }).state;
  return state === 'disconnected' || state === 'error';
}

/**
 * Summarizer backed by the GitHub Copilot SDK.
 * Uses an isolated, tool-less session per request so the model only sees the prompt.
 */
export class CopilotSummarizer implements Summarizer {
  private clientPromise: Promise<CopilotClientLike> | undefined;
  private client: CopilotClientLike | undefined;
  private efforts: Promise<Set<string>> | undefined;
  readonly model: string;

  constructor(private readonly options: CopilotSummarizerOptions = {}) {
    this.model = options.model || DEFAULT_COPILOT_MODEL;
  }

  /** One shared client (concurrent callers wait for the same start); a failed start is retried next time. */
  private getClient(): Promise<CopilotClientLike> {
    if (!this.clientPromise) {
      const starting = this.startClient();
      this.clientPromise = starting;
      starting.catch(() => {
        if (this.clientPromise === starting) this.clientPromise = undefined;
      });
    }
    return this.clientPromise;
  }

  private async startClient(): Promise<CopilotClientLike> {
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

  /** Drops a dead client so the next request starts a new runtime. */
  private discard(client: CopilotClientLike): void {
    if (this.client === client) {
      this.client = undefined;
      this.clientPromise = undefined;
      this.efforts = undefined;
    }
    void client.stop().catch(() => undefined);
  }

  /** Reasoning efforts the model accepts (empty when unknown or unsupported). */
  private supportedEfforts(client: CopilotClientLike): Promise<Set<string>> {
    this.efforts ??= client
      .listModels()
      .then((models) => new Set(models.find((m) => m.id === this.model)?.supportedReasoningEfforts ?? []))
      .catch(() => new Set<string>());
    return this.efforts;
  }

  private async openSession(
    client: CopilotClientLike,
    system: string,
    effort: ModelRequest['effort'],
  ): Promise<CopilotSessionLike> {
    const reasoningEffort = effort && (await this.supportedEfforts(client)).has(effort) ? effort : undefined;
    return client.createSession({
      model: this.model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      availableTools: [],
      onPermissionRequest: () => ({ kind: 'reject' }),
      systemMessage: { mode: 'append', content: system },
    });
  }

  async generateJson({ system, prompt, schema, effort, timeoutMs }: ModelRequest): Promise<unknown> {
    let client = await this.getClient();
    let session: CopilotSessionLike;
    try {
      session = await this.openSession(client, system, effort);
    } catch (err) {
      if (!isClosed(client)) throw err;
      this.discard(client);
      client = await this.getClient();
      session = await this.openSession(client, system, effort);
    }
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
    const starting = this.clientPromise;
    this.clientPromise = undefined;
    this.client = undefined;
    const client = await starting?.catch(() => undefined);
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
