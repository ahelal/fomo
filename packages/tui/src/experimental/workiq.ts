import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CONFIG_DIR } from '../config.js';
import { cleanMessage, object, text } from '../extensions/validation.js';

export interface WorkIQRun { ok: boolean; output: string }

/**
 * `workiq auth login` exits 0 even when it fails. Signed in means the Microsoft 365 `fetch` tool is
 * available from the host WorkIQ account.
 */
export function workiqSignedIn(tools: readonly string[]): boolean {
  return tools.includes('fetch');
}

const NOT_SIGNED_IN = 'WorkIQ is not signed in with the host account: its Microsoft 365 tools are unavailable. Use Config > Teams meetings > l to sign in.';
const APPROVAL = '2\n';
const MAX_COMMAND_OUTPUT = 1000;
const activeClosers = new Set<() => Promise<void>>();
const activeCommands = new Set<ChildProcess>();

export function workiqBinary(): string {
  const require = createRequire(import.meta.url);
  const install = require('@microsoft/workiq/lib/install') as { getBinaryPath(): string };
  return install.getBinaryPath();
}

function hostHome(): string {
  return process.env.HOME || homedir();
}

function hostEnvironment(): Record<string, string> {
  return {
    ...getDefaultEnvironment(),
    HOME: hostHome(),
    DOTNET_EnableDiagnostics: '0',
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  };
}

async function workiqProfileDirectory(profile: string): Promise<string> {
  if (process.platform !== 'darwin') throw new Error('Teams WorkIQ is currently supported only on macOS');
  const id = createHash('sha256').update(profile).digest('hex');
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  let directory = await realpath(CONFIG_DIR);
  for (const segment of ['extension-state', id, 'workiq']) {
    directory = join(directory, segment);
    try { await mkdir(directory, { mode: 0o700 }); } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid?.()) {
      throw new Error('WorkIQ profile storage must be a private, user-owned directory without symlinks');
    }
  }
  return directory;
}

function safeOutput(value: unknown): string {
  return cleanMessage(value)
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<redacted token>')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}/gi, 'Bearer <redacted>')
    .replace(/((?:access|refresh|id)[_-]?token|password|secret|authorization|code)(["':= ]+)[^\s"',]{8,}/gi, '$1$2<redacted>');
}

async function approval(directory: string, write = false): Promise<void> {
  const file = await open(join(directory, 'fomo-sign-in-approved'),
    (write ? constants.O_WRONLY | constants.O_CREAT : constants.O_RDONLY) | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077 || info.uid !== process.getuid?.()) throw new Error('Invalid WorkIQ sign-in approval file');
    if (write) { await file.truncate(0); await file.writeFile(APPROVAL); }
    else if (info.size !== Buffer.byteLength(APPROVAL) || await file.readFile('utf8') !== APPROVAL) {
      throw new Error('UNSANDBOXED WorkIQ approval is missing or outdated; use Config > Teams meetings > l to approve the host account');
    }
  } finally { await file.close(); }
}

/** Bound read-only Graph operations. A tool's advertised readOnlyHint is not authorization. */
export function validateWorkIQCall(tool: string, args: Record<string, unknown>, account: string, threads: ReadonlySet<string>, now = Date.now()): void {
  if (tool === 'retrieve' && Object.keys(args).sort().join(',') === 'capabilities,query' && text(args.query, 1000)
    && JSON.stringify(args.capabilities) === '[{"name":"OneDriveAndSharePoint"}]') return;
  if (tool === 'call_function' && Object.keys(args).join(',') === 'functionUrl' && text(args.functionUrl, 8192)) {
    const match = /^\/me\/onlineMeetings\/getAll(?:Recordings|Transcripts)\(meetingOrganizerUserId='([^']+)',startDateTime=([^,]+),endDateTime=([^)]+)\)(?:\?.*)?$/.exec(args.functionUrl);
    const query = new URL(args.functionUrl, 'https://graph.microsoft.com').searchParams;
    if (match && match[1] === account && windowAllowed(match[2], match[3], now)
      && [...query.keys()].every((key) => ['$top', '$skip', '$skiptoken'].includes(key))) return;
  }
  if (tool === 'fetch' && Object.keys(args).join(',') === 'entityUrls' && Array.isArray(args.entityUrls)
    && args.entityUrls.length > 0 && args.entityUrls.length <= 5 && args.entityUrls.every((path) => {
      if (!text(path, 8192) || !path.startsWith('/') || path.startsWith('//') || /[#\\]/.test(path)) return false;
      const url = new URL(path, 'https://graph.microsoft.com');
      if (url.origin !== 'https://graph.microsoft.com') return false;
      if ([...url.searchParams.keys()].some((key) => !['$select', '$top', '$filter', '$orderby', '$skip', '$skiptoken', 'startDateTime', 'endDateTime'].includes(key))) return false;
      if (url.pathname === '/me') return url.search === '?$select=id';
      if (url.pathname === '/me/calendarView') return windowAllowed(url.searchParams.get('startDateTime'), url.searchParams.get('endDateTime'), now);
      const chat = /^\/me\/chats\/([^/]+)\/messages$/.exec(url.pathname);
      if (chat) return threads.has(decodeURIComponent(chat[1]));
      return /^\/shares\/u![a-zA-Z0-9_-]+\/driveItem$/.test(url.pathname) && url.search === '?$select=id,parentReference';
    })) return;
  throw new Error('WorkIQ request is outside the approved read-only meeting scope');
}

function windowAllowed(start: string | null, end: string | null, now: number): boolean {
  const a = Date.parse(start ?? '');
  const b = Date.parse(end ?? '');
  return Number.isFinite(a) && Number.isFinite(b) && b >= a
    && a >= now - 7 * 86_400_000 - 300_000 && b <= now + 300_000;
}

async function callWorkIQ(client: Client, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 90_000, signal });
  if (response.isError) throw new Error(`WorkIQ ${tool} failed; check the host account's sign-in`);
  if (object(response.structuredContent)) return response.structuredContent;
  const content = Array.isArray(response.content) ? response.content.find((part) => object(part) && part.type === 'text' && text(part.text, 4 * 1024 * 1024)) : undefined;
  const parsed: unknown = content && object(content) && typeof content.text === 'string' ? JSON.parse(content.text) : undefined;
  if (!object(parsed)) throw new Error('Invalid WorkIQ response');
  return parsed;
}

async function connectWorkIQ(signal: AbortSignal): Promise<{ client: Client; account: string; close: () => Promise<void> }> {
  signal.throwIfAborted();
  const client = new Client({ name: 'fomo', version: '1' });
  const transport = new StdioClientTransport({
    command: workiqBinary(),
    args: ['mcp'],
    cwd: hostHome(),
    env: hostEnvironment(),
    stderr: 'pipe',
    maxBufferSize: 4 * 1024 * 1024,
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', abort);
    activeClosers.delete(close);
    await client.close();
  };
  const abort = () => { void close().catch(() => {}); };
  activeClosers.add(close);
  signal.addEventListener('abort', abort, { once: true });
  try {
    await client.connect(transport, { timeout: 60_000, signal });
    const { tools } = await client.listTools(undefined, { timeout: 30_000, signal });
    if (!workiqSignedIn(tools.map((tool) => tool.name))) throw new Error(NOT_SIGNED_IN);
    const identity = await callWorkIQ(client, 'fetch', { entityUrls: ['/me?$select=id'] }, signal);
    const results = identity.results;
    const first = Array.isArray(results) ? results[0] : undefined;
    const account = object(first) && first.statusCode === 200 && object(first.data) && text(first.data.id) ? first.data.id : undefined;
    if (!account) throw new Error('WorkIQ could not verify the host account; sign in again');
    return { client, account, close };
  } catch (error) { await close(); throw error; }
}

export async function openWorkIQ(profile: string, signal: AbortSignal) {
  const now = Date.now();
  const directory = await workiqProfileDirectory(profile);
  try { await approval(directory); } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error('Teams needs explicit host-account sign-in (Config > Teams meetings > l). WorkIQ will run outside FOMO’s sandbox.');
    }
    throw error;
  }
  const connection = await connectWorkIQ(signal);
  const { client, account, close } = connection;
  try {
    const threads = new Set<string>();
    return {
      account,
      async call(tool: string, args: Record<string, unknown>) {
        validateWorkIQCall(tool, args, account, threads, now);
        const response = await callWorkIQ(client, tool, args, signal);
        if (tool === 'fetch' && Array.isArray(args.entityUrls) && Array.isArray(response.results)) {
          args.entityUrls.forEach((path, index) => {
            if (typeof path !== 'string' || !path.startsWith('/me/calendarView?')) return;
            const result = (response.results as unknown[])[index];
            if (!object(result) || !object(result.data) || !Array.isArray(result.data.value)) return;
            for (const item of result.data.value) {
              if (!object(item) || !object(item.onlineMeeting) || !text(item.onlineMeeting.joinUrl, 8192)) continue;
              try {
                const thread = /19:[^/?#\s]+@thread\.(?:v2|skype|tacv2)/.exec(decodeURIComponent(item.onlineMeeting.joinUrl))?.[0];
                if (thread) threads.add(thread);
              } catch { /* malformed provider URL grants no chat access */ }
            }
          });
        }
        return response;
      },
      close,
    };
  } catch (error) { await close(); throw error; }
}

export async function runWorkIQ(args: string[], options: { profile?: string; timeoutMs?: number; onLine?: (line: string) => void; signal?: AbortSignal } = {}): Promise<WorkIQRun> {
  let child: ChildProcess | undefined;
  let output = '';
  let timedOut = false;
  let forceKill: NodeJS.Timeout | undefined;
  const abort = () => {
    child?.kill('SIGTERM');
    forceKill ??= setTimeout(() => child?.kill('SIGKILL'), 2000);
    forceKill.unref();
  };
  try {
    options.signal?.throwIfAborted();
    if (!['accept-eula', 'auth login'].includes(args.join(' '))) throw new Error('Unapproved WorkIQ command');
    await workiqProfileDirectory(options.profile ?? 'default');
    child = spawn(workiqBinary(), args, {
      cwd: hostHome(),
      env: hostEnvironment(),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    activeCommands.add(child);
    if (options.signal?.aborted) { abort(); options.signal.throwIfAborted(); }
    options.signal?.addEventListener('abort', abort, { once: true });
    const onData = (chunk: Buffer) => {
      output = safeOutput(output + chunk.toString()).slice(0, MAX_COMMAND_OUTPUT);
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) options.onLine?.(safeOutput(line));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const timer = setTimeout(() => { timedOut = true; abort(); }, options.timeoutMs ?? 300_000);
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child!.once('error', reject);
      child!.once('close', (code, signal) => resolve({ code, signal }));
      child!.stdin?.end();
    }).finally(() => clearTimeout(timer));
    return {
      ok: result.code === 0 && !timedOut && !options.signal?.aborted,
      output: output || (result.code === 0 ? 'WorkIQ command completed' : 'WorkIQ host command failed'),
    };
  } catch (error) { return { ok: false, output: safeOutput(error instanceof Error ? error.message : error) }; }
  finally {
    options.signal?.removeEventListener('abort', abort);
    if (forceKill) clearTimeout(forceKill);
    if (child) {
      activeCommands.delete(child);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
  }
}

export async function signInWorkIQ(onLine?: (line: string) => void, profile = 'default', signal?: AbortSignal): Promise<WorkIQRun> {
  const eula = await runWorkIQ(['accept-eula'], { profile, timeoutMs: 60_000, onLine, signal });
  if (!eula.ok) return eula;
  const login = await runWorkIQ(['auth', 'login'], { profile, onLine, signal });
  signal?.throwIfAborted();
  if (!login.ok) return login;
  const directory = await workiqProfileDirectory(profile);
  try {
    await (await connectWorkIQ(signal ?? new AbortController().signal)).close();
  } catch (error) {
    signal?.throwIfAborted();
    return { ok: false, output: safeOutput(error instanceof Error ? error.message : error) };
  }
  await approval(directory, true);
  return login;
}

export async function closeAllWorkIQ(): Promise<void> {
  const clients = Promise.all([...activeClosers].map((close) => close()));
  const children = [...activeCommands].map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  }));
  await Promise.all([clients, ...children]);
}
