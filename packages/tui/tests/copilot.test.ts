import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelRequest } from '@fomo/core/digest';

const AUTH_ERROR = 'Authorization error. Your credentials may be expired or invalid. (Request ID: 556C:70D6B)';

const sdk = vi.hoisted(() => ({
  /** Options passed to each CopilotClient. */
  clients: [] as Record<string, unknown>[],
  reply: async (): Promise<unknown> => ({ data: { content: '{"ok":true}' } }),
  authStatus: { isAuthenticated: true, authType: 'gh-cli', login: 'work-emu' } as Record<string, unknown>,
}));

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: class {
    constructor(options: Record<string, unknown>) { sdk.clients.push(options); }
    async start() {}
    async stop() { return []; }
    async listModels() { return []; }
    async getAuthStatus() { return sdk.authStatus; }
    async createSession() {
      return { sendAndWait: () => sdk.reply(), disconnect: async () => {} };
    }
  },
}));

const gh = vi.hoisted(() => ({ ghAuthToken: vi.fn(async (login: string) => `gh-token-${login}`) }));
vi.mock('../src/ghAccounts.js', () => gh);

const { CopilotSummarizer, SummarizerCache } = await import('../src/copilot.js');

const request: ModelRequest = { system: 'system', prompt: 'prompt', schema: { type: 'object' } };
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'fomo-copilot-'));
  vi.stubEnv('HOME', home);
  for (const name of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) vi.stubEnv(name, '');
  sdk.clients.length = 0;
  sdk.reply = async () => ({ data: { content: '{"ok":true}' } });
  gh.ghAuthToken.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe('Copilot credentials', () => {
  it('uses the chosen account’s gh token ahead of token variables', async () => {
    vi.stubEnv('GH_TOKEN', 'env-token');
    const summarizer = new CopilotSummarizer({ account: 'personal' });
    await expect(summarizer.generateJson(request)).resolves.toEqual({ ok: true });
    expect(gh.ghAuthToken).toHaveBeenCalledWith('personal');
    expect(sdk.clients[0]).toMatchObject({ gitHubToken: 'gh-token-personal' });
    await summarizer.close();
  });

  it('falls back to a token variable, then to the signed-in user', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'github-token');
    vi.stubEnv('GH_TOKEN', 'gh-env-token');
    const fromEnv = new CopilotSummarizer();
    await fromEnv.generateJson(request);
    expect(sdk.clients[0]).toMatchObject({ gitHubToken: 'gh-env-token' });

    vi.stubEnv('GH_TOKEN', '');
    vi.stubEnv('GITHUB_TOKEN', '');
    const signedIn = new CopilotSummarizer();
    await signedIn.generateJson(request);
    expect(sdk.clients[1]).not.toHaveProperty('gitHubToken');
    expect(gh.ghAuthToken).not.toHaveBeenCalled();
    await Promise.all([fromEnv.close(), signedIn.close()]);
  });

  it('fails with gh’s reason when it has no token for the account', async () => {
    gh.ghAuthToken.mockRejectedValueOnce(new Error('Copilot account gone: gh has no token for it'));
    const summarizer = new CopilotSummarizer({ account: 'gone' });
    await expect(summarizer.generateJson(request)).rejects.toThrow('Copilot account gone: gh has no token for it');
    expect(sdk.clients).toHaveLength(0);
  });
});

describe('authorization errors', () => {
  beforeEach(() => {
    sdk.reply = async () => { throw new Error(AUTH_ERROR); };
  });

  it('name the chosen account', async () => {
    const summarizer = new CopilotSummarizer({ account: 'personal' });
    const err = await summarizer.generateJson(request).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      `${AUTH_ERROR} — Copilot rejected GitHub account personal; choose another account in Config → Copilot account`,
    );
    await summarizer.close();
  });

  it('name gh’s active account when none is chosen', async () => {
    const summarizer = new CopilotSummarizer();
    await expect(summarizer.generateJson(request)).rejects.toThrow(
      'Copilot rejected GitHub account work-emu (gh’s active account); choose another account in Config → Copilot account',
    );
    await summarizer.close();
  });

  it('name the token variable that was used', async () => {
    vi.stubEnv('COPILOT_GITHUB_TOKEN', 'copilot-token');
    const summarizer = new CopilotSummarizer();
    await expect(summarizer.generateJson(request)).rejects.toThrow('Copilot rejected the token in COPILOT_GITHUB_TOKEN;');
    await summarizer.close();
  });

  it('leave other errors alone', async () => {
    sdk.reply = async () => { throw new Error('quota exceeded'); };
    const summarizer = new CopilotSummarizer({ account: 'personal' });
    await expect(summarizer.generateJson(request)).rejects.toThrow(/^quota exceeded$/);
    await summarizer.close();
  });
});

describe('SummarizerCache', () => {
  it('keeps one summarizer per model and account', async () => {
    const cache = new SummarizerCache();
    const first = cache.get('gpt-5-mini', 'personal');
    expect(cache.get('gpt-5-mini', 'personal')).toBe(first);
    const other = cache.get('gpt-5-mini', 'work-emu');
    expect(other).not.toBe(first);
    expect(other.account).toBe('work-emu');
    const automatic = cache.get(undefined, '');
    expect(automatic).not.toBe(other);
    expect(automatic).toMatchObject({ model: 'gpt-5-mini', account: undefined });
    expect(cache.get('', undefined)).toBe(automatic);
    await cache.close();
  });
});
