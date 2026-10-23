import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Microsoft WorkIQ (`@microsoft/workiq`, a pinned dependency) gives read access to the signed-in
 * user's Microsoft 365 data. FOMO starts its MCP server (`workiq mcp`) over stdio for a fetch and
 * stops it afterwards; WorkIQ keeps its own sign-in, FOMO never sees a token.
 */

/** One Graph request that `fetch` ran: the response body, or why it failed. */
export interface GraphResult {
  statusCode: number;
  data?: unknown;
  error?: string;
}

/** A OneDrive / SharePoint file that a search found. */
export interface FileHit {
  driveId: string;
  driveItemId: string;
  /** Its name without the extension (a video's or a document's title), when the search gives one. */
  title?: string;
}

export interface WorkIQ {
  /** GET several Graph paths (`/me/...`) in one call. */
  fetch(paths: string[], signal?: AbortSignal): Promise<GraphResult[]>;
  /** GET a Graph function (`/me/onlineMeetings/getAllRecordings(...)`). */
  callFunction(path: string, signal?: AbortSignal): Promise<GraphResult>;
  /** Search the OneDrive and SharePoint files I can open (Microsoft Search); throws when the search fails. */
  searchFiles(query: string, signal?: AbortSignal): Promise<FileHit[]>;
  close(): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 60_000;
const CALL_TIMEOUT_MS = 90_000;

/** Path of the native WorkIQ binary for this platform (spawned directly, so a kill reaches it). */
export function workiqBinary(): string {
  const require = createRequire(import.meta.url);
  const install = require('@microsoft/workiq/lib/install') as { getBinaryPath(): string };
  return install.getBinaryPath();
}

/**
 * Environment for WorkIQ. `COPILOT_AGENT_SESSION_ID` is dropped: Microsoft sign-in libraries pass it
 * on as a session id and reject the request when it does not have the expected length.
 */
function workiqEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'COPILOT_AGENT_SESSION_ID') env[k] = v;
  }
  return env;
}

/** Running WorkIQ servers, stopped on exit even if a fetch is still using one. */
const open = new Set<StdioClientTransport>();

/** Stop every WorkIQ server this process started. */
export async function closeAllWorkIQ(): Promise<void> {
  await Promise.all([...open].map((t) => t.close().catch(() => undefined)));
  open.clear();
}

process.once('exit', () => {
  for (const t of open) {
    const pid = t.pid;
    if (pid) {
      try { process.kill(pid); } catch { /* already gone */ }
    }
  }
});

/** Start `workiq mcp` and connect to it. */
export async function connectWorkIQ(signal?: AbortSignal): Promise<WorkIQ> {
  const transport = new StdioClientTransport({ command: workiqBinary(), args: ['mcp'], env: workiqEnv(), stderr: 'pipe' });
  // Keep the last lines WorkIQ wrote, to explain a failure.
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
  const client = new Client({ name: 'fomo', version: '1' });
  open.add(transport);
  const close = async () => {
    open.delete(transport);
    await client.close().catch(() => undefined);
  };
  try {
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS, ...(signal ? { signal } : {}) });
  } catch (err) {
    await close();
    const detail = lastLine(stderr);
    throw new Error(`Could not start WorkIQ: ${message(err)}${detail ? ` (${detail})` : ''}`);
  }

  const call = async (name: string, args: Record<string, unknown>, sig?: AbortSignal): Promise<Record<string, unknown>> => {
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS, ...(sig ? { signal: sig } : {}) });
    const structured = res.structuredContent as Record<string, unknown> | undefined;
    if (structured) return structured;
    const text = (res.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === 'text')?.text ?? '';
    if (res.isError) throw new Error(`WorkIQ ${name} failed: ${text.slice(0, 200) || 'no details'}`);
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { text };
    }
  };

  return {
    async fetch(paths, sig) {
      const out = await call('fetch', { entityUrls: paths }, sig);
      const results = Array.isArray(out.results) ? (out.results as Record<string, unknown>[]) : [];
      return paths.map((_, i) => graphResult(results[i]));
    },
    async callFunction(path, sig) {
      return graphResult(await call('call_function', { functionUrl: path }, sig));
    },
    async searchFiles(query, sig) {
      return fileHits(await call('retrieve', { query, capabilities: [{ name: 'OneDriveAndSharePoint' }] }, sig));
    },
    close,
  };
}

const RETRIEVAL = 'application/vnd.ms-workiq.retrieval';

/**
 * The files in a `retrieve` answer. A failed search answers like an empty one, with
 * `stoppedReason: 'error'`; that throws, so it is not taken for "nothing found".
 */
export function fileHits(raw: Record<string, unknown>): FileHit[] {
  const out = (raw[RETRIEVAL] ?? raw) as { results?: unknown; stoppedReason?: unknown; error?: unknown; errorCode?: unknown };
  if (out.stoppedReason === 'error' || out.error || !Array.isArray(out.results)) {
    const why = [out.errorCode, out.error].filter((v): v is string => typeof v === 'string' && v !== '').join(': ');
    throw new Error(`WorkIQ search failed${why ? `: ${why}` : ''}`);
  }
  return (out.results as Record<string, unknown>[]).flatMap((r) => {
    const ids = typeof r.entityUrl === 'string' ? /\/drives\/([^/]+)\/items\/([^/?]+)/.exec(r.entityUrl) : null;
    const driveId = typeof r.driveId === 'string' && r.driveId ? r.driveId : ids?.[1];
    const driveItemId = typeof r.itemId === 'string' && r.itemId ? r.itemId : ids?.[2];
    const meta = r.resourceMetadata as { video?: { title?: unknown }; document?: { title?: unknown } } | undefined;
    const title = [meta?.video?.title, meta?.document?.title].find((t): t is string => typeof t === 'string' && t !== '');
    return driveId && driveItemId ? [{ driveId, driveItemId, ...(title ? { title } : {}) }] : [];
  });
}

/** The text of a WorkIQ error: a string, or Graph's `{ error: { code, message } }` body passed through. */
function errorText(err: unknown): string | undefined {
  if (typeof err === 'string') return err || undefined;
  if (!err || typeof err !== 'object') return undefined;
  const { code, message, error } = err as { code?: unknown; message?: unknown; error?: unknown };
  const own = [code, message].filter((v): v is string => typeof v === 'string' && v !== '').join(': ');
  return own || errorText(error);
}

export function graphResult(raw: Record<string, unknown> | undefined): GraphResult {
  if (!raw) return { statusCode: 0, error: 'no result' };
  const statusCode = typeof raw.statusCode === 'number' ? raw.statusCode : raw.data !== undefined ? 200 : 0;
  const error = errorText(raw.error);
  return { statusCode, ...(raw.data !== undefined ? { data: raw.data } : {}), ...(error ? { error } : {}) };
}

/** Graph's `@odata.nextLink` as a path WorkIQ accepts (it takes `/me/...`, not the full URL). */
export function graphPath(link: string): string {
  return link.replace(/^https:\/\/[^/]+\/(?:v1\.0|beta)(?=\/)/, '');
}

export interface WorkIQRun {
  ok: boolean;
  output: string;
}

/**
 * Run a WorkIQ command without a terminal (stdin closed); `onLine` gets each line it prints.
 * Used for `accept-eula` and `auth login` (which signs in through the system or a browser window).
 */
export function runWorkIQ(args: string[], options: { timeoutMs?: number; onLine?: (line: string) => void } = {}): Promise<WorkIQRun> {
  return new Promise((resolve) => {
    let output = '';
    let bin: string;
    try {
      bin = workiqBinary();
    } catch (err) {
      resolve({ ok: false, output: `WorkIQ is not installed: ${message(err)}` });
      return;
    }
    const child = spawn(bin, args, { env: workiqEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      output += '\nTimed out';
      child.kill();
    }, options.timeoutMs ?? 300_000);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split(/\r?\n/)) if (line.trim()) options.onLine?.(line.trim());
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `${output}\n${err.message}`.trim() });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: output.trim() });
    });
  });
}

/**
 * Accept the WorkIQ EULA, then sign in. Both must succeed before the source is turned on.
 * `onLine` reports progress (sign-in may open a browser window or the system account picker).
 */
export async function signInWorkIQ(onLine?: (line: string) => void): Promise<WorkIQRun> {
  const eula = await runWorkIQ(['accept-eula'], { timeoutMs: 60_000, ...(onLine ? { onLine } : {}) });
  if (!eula.ok) return { ok: false, output: `Could not accept the WorkIQ EULA: ${lastLine(eula.output) || 'no details'}` };
  const login = await runWorkIQ(['auth', 'login'], onLine ? { onLine } : {});
  if (!login.ok) return { ok: false, output: `WorkIQ sign-in failed: ${lastLine(login.output) || 'no details'}` };
  return login;
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).filter(Boolean).pop()?.trim().slice(0, 200) ?? '';
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
