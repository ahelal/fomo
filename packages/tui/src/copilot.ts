import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelRequest, Summarizer } from '@fomo/core/digest';
import { ghAuthToken } from './ghAccounts.js';

export const DEFAULT_COPILOT_MODEL = 'gpt-5-mini';

/** Token variables the Copilot SDK reads, in order, when no account is chosen. */
export const COPILOT_TOKEN_ENV = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] as const;

/** The token variable Copilot uses when no account is chosen, if one is set. */
export function copilotTokenEnv(): string | undefined {
  return COPILOT_TOKEN_ENV.find((name) => process.env[name]);
}

const AUTH_ERROR = /authorization error|credentials may be expired or invalid/i;

export interface CopilotSummarizerOptions {
  model?: string;
  /** Explicit token; otherwise `account`'s gh token, a COPILOT_TOKEN_ENV variable, or the logged-in user / gh's active account. */
  gitHubToken?: string;
  /** GitHub login whose gh CLI token to use (Config → Copilot account). */
  account?: string;
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
  getAuthStatus?(): Promise<{ login?: string; authType?: string }>;
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
  /** Where the running client's credentials came from, for auth error messages. */
  private tokenSource: string | undefined;
  readonly model: string;
  readonly account: string | undefined;

  constructor(private readonly options: CopilotSummarizerOptions = {}) {
    this.model = options.model || DEFAULT_COPILOT_MODEL;
    this.account = options.account || undefined;
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
    const envName = copilotTokenEnv();
    let token: string | undefined;
    let source: string | undefined;
    if (this.options.gitHubToken) {
      token = this.options.gitHubToken;
    } else if (this.account) {
      token = await ghAuthToken(this.account);
      source = `GitHub account ${this.account}`;
    } else if (envName) {
      token = process.env[envName];
      source = `the token in ${envName}`;
    }
    const client = new CopilotClient({
      mode: 'empty',
      baseDirectory,
      logLevel: 'error',
      ...(token ? { gitHubToken: token } : {}),
    }) as unknown as CopilotClientLike;
    await client.start();
    this.client = client;
    this.tokenSource = source;
    return client;
  }

  /** Adds which credentials were rejected, and where to change them, to an authorization error. */
  private async explainAuthError(client: CopilotClientLike, err: unknown): Promise<unknown> {
    if (!(err instanceof Error) || !AUTH_ERROR.test(err.message)) return err;
    let who = this.tokenSource;
    if (!who && !this.options.gitHubToken) {
      const status = await client.getAuthStatus?.().catch(() => undefined);
      const login = status?.login ? `GitHub account ${status.login}` : 'your GitHub account';
      who = status?.authType === 'gh-cli' ? `${login} (gh’s active account)` : login;
    }
    if (!who) return err;
    return new Error(`${err.message} — Copilot rejected ${who}; choose another account in Config → Copilot account`, { cause: err });
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
      if (!isClosed(client)) throw await this.explainAuthError(client, err);
      this.discard(client);
      client = await this.getClient();
      try {
        session = await this.openSession(client, system, effort);
      } catch (retryErr) {
        throw await this.explainAuthError(client, retryErr);
      }
    }
    try {
      const message = await session.sendAndWait(
        { prompt, responseSchema: schema },
        timeoutMs ?? this.options.timeoutMs ?? 180_000,
      );
      const content = message?.data.content?.trim();
      if (!content) throw new Error('Copilot returned an empty response');
      return JSON.parse(content);
    } catch (err) {
      throw await this.explainAuthError(client, err);
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

/** Hands out one summarizer per model and account; replaced ones stay open until `close()` in case a run still uses them. */
export class SummarizerCache {
  private current: CopilotSummarizer | undefined;
  private readonly retired: CopilotSummarizer[] = [];

  get(model?: string, account?: string): CopilotSummarizer {
    const wanted = model || DEFAULT_COPILOT_MODEL;
    const who = account || undefined;
    if (this.current?.model !== wanted || this.current.account !== who) {
      if (this.current) this.retired.push(this.current);
      this.current = new CopilotSummarizer({ model: wanted, account: who });
    }
    return this.current;
  }

  async close(): Promise<void> {
    const all = [...this.retired.splice(0), ...(this.current ? [this.current] : [])];
    this.current = undefined;
    await Promise.all(all.map((s) => s.close()));
  }
}
