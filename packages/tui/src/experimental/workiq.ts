import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CONFIG_DIR } from '../config.js';
import { cleanMessage, object, text } from '../extensions/validation.js';
import type { SharePointSourceConfig } from '@fomo/core';

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

function sharePointApprovalText(source: Pick<SharePointSourceConfig, 'id' | 'accountId' | 'scopeHash' | 'approvalRevision'>): string {
  return `${source.id}\n${source.accountId}\n${source.scopeHash}\n${source.approvalRevision}\n`;
}

async function sharePointApproval(directory: string, source: SharePointSourceConfig, write = false): Promise<void> {
  const fileName = `sharepoint-${createHash('sha256').update(source.id).digest('hex')}-approved`;
  const path = join(directory, fileName);
  if (write) {
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(sharePointApprovalText(source)); }
    finally { await file.close(); }
    return;
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077 || info.uid !== process.getuid?.()
      || info.size !== Buffer.byteLength(sharePointApprovalText(source))
      || await file.readFile('utf8') !== sharePointApprovalText(source)) {
      throw new Error('SharePoint WorkIQ approval does not match this source, account and scope');
    }
  } finally { await file.close(); }
}

function isSharePointPath(path: string, siteId: string, listId: string): boolean {
  const url = new URL(path, 'https://graph.microsoft.com');
  const keys = [...url.searchParams.keys()];
  if (url.origin !== 'https://graph.microsoft.com' || new Set(keys).size !== keys.length
    || !keys.every((key) => ['$select', '$expand', '$top', '$skiptoken'].includes(key))) return false;
  const skiptoken = url.searchParams.get('$skiptoken');
  // Exactly the approved list metadata and page-text projection; no other list or Graph path is allowed.
  if (url.searchParams.get('$select') !== 'id,webUrl,eTag,createdDateTime,lastModifiedDateTime'
    || url.searchParams.get('$expand') !== 'fields($select=Title,FileLeafRef,FSObjType,CanvasContent1)'
    || url.searchParams.get('$top') !== '25' || (skiptoken !== null && (!skiptoken || skiptoken.length > 6000))) return false;
  return url.pathname === `/sites/${siteId}/lists/${listId}/items`;
}

/** Bound read-only Graph operations. A tool's advertised readOnlyHint is not authorization. */
export function validateWorkIQCall(
  tool: string,
  args: Record<string, unknown>,
  account: string,
  threads: ReadonlySet<string>,
  now = Date.now(),
  sharePoint?: Pick<SharePointSourceConfig, 'siteId' | 'listId'>,
): void {
  if (sharePoint) {
    // A SharePoint source gets one scoped, read-only list-items query and nothing from the Teams scope.
    const path = Array.isArray(args.entityUrls) ? args.entityUrls[0] : undefined;
    if (tool === 'fetch' && Object.keys(args).join(',') === 'entityUrls' && Array.isArray(args.entityUrls)
      && args.entityUrls.length === 1 && text(path, 8192) && path.startsWith('/') && !path.startsWith('//') && !/[#\\]/.test(path)
      && isSharePointPath(path, sharePoint.siteId, sharePoint.listId)) return;
    throw new Error('WorkIQ request is outside the approved SharePoint page-text scope');
  }
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
      if ([...url.searchParams.keys()].some((key) =>
        !['$select', '$top', '$filter', '$orderby', '$skip', '$skiptoken', 'startDateTime', 'endDateTime'].includes(key))) return false;
      if (url.pathname === '/me') return url.search === '?$select=id';
      if (url.pathname === '/me/calendarView') return windowAllowed(url.searchParams.get('startDateTime'), url.searchParams.get('endDateTime'), now);
      const chat = /^\/me\/chats\/([^/]+)\/messages$/.exec(url.pathname);
      if (chat) return threads.has(decodeURIComponent(chat[1]));
      return /^\/shares\/u![a-zA-Z0-9_-]+\/driveItem$/.test(url.pathname) && url.search === '?$select=id,parentReference';
    })) return;
  throw new Error('WorkIQ request is outside the approved read-only meeting scope');
}

/** Site Pages is a system list: Graph omits it from the catalog unless `system` is selected. */
const SHAREPOINT_CATALOG_SELECT = 'id,displayName,webUrl,list,system';

function validateSharePointSetupCall(tool: string, args: Record<string, unknown>, sitePath: string, siteId?: string): void {
  if (tool !== 'fetch' || Object.keys(args).join(',') !== 'entityUrls'
    || !Array.isArray(args.entityUrls) || args.entityUrls.length !== 1 || !text(args.entityUrls[0], 8192)) {
    throw new Error('SharePoint setup permits only the selected site and Site Pages list metadata');
  }
  const path = args.entityUrls[0];
  if (!path.startsWith('/') || path.startsWith('//') || /[#\\]/.test(path)) throw new Error('Invalid SharePoint setup path');
  const url = new URL(path, 'https://graph.microsoft.com');
  const siteMatch = /^\/sites\/([^/]+):\/(.+)$/.exec(url.pathname);
  const listMatch = /^\/sites\/([^/]+)\/lists$/.exec(url.pathname);
  const queryAllowed = [...url.searchParams.keys()].every((key) => ['$select', '$top', '$skiptoken'].includes(key));
  if (url.origin !== 'https://graph.microsoft.com' || !queryAllowed
    || !(siteMatch?.[2] === sitePath && url.searchParams.get('$select') === 'id,webUrl,displayName'
      || (listMatch && listMatch[1] === siteId && url.searchParams.get('$select') === SHAREPOINT_CATALOG_SELECT))) {
    throw new Error('SharePoint setup request is outside the selected site metadata scope');
  }
}

/** WorkIQ continues the list catalog with a relative path (`/sites/<id>/lists?…`); absolute Graph URLs are accepted too. */
export function sharePointCatalogPath(link: string, siteId: string): string {
  let url: URL | undefined;
  try { url = new URL(link, 'https://graph.microsoft.com'); } catch { /* rejected below */ }
  const path = url?.pathname.replace(/^\/v1\.0(?=\/)/, '');
  if (!url || url.origin !== 'https://graph.microsoft.com' || url.username || url.password
    || path !== `/sites/${siteId}/lists`
    || url.searchParams.get('$select') !== SHAREPOINT_CATALOG_SELECT
    || [...url.searchParams.keys()].some((key) => !['$select', '$top', '$skiptoken'].includes(key))) {
    throw new Error('SharePoint returned a continuation outside the selected site');
  }
  return `${path}${url.search}`;
}

function safeSharePointSiteUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a valid SharePoint site URL'); }
  let sitePath: string;
  try { sitePath = decodeURIComponent(url.pathname); }
  catch { throw new Error('Enter a valid SharePoint site URL'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9.-]+\.sharepoint\.com$/i.test(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/(?:sites|teams)\/[A-Za-z0-9._ -]+(?:\/)?$/.test(sitePath)) {
    throw new Error('Use an HTTPS SharePoint site URL such as https://tenant.sharepoint.com/sites/Team');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

function graphResultData(response: Record<string, unknown>): Record<string, unknown> {
  const results = response.results;
  const first = Array.isArray(results) ? results[0] : undefined;
  if (!object(first) || first.statusCode !== 200 || !object(first.data)) {
    throw new Error('WorkIQ could not read the selected SharePoint metadata');
  }
  return first.data;
}

export async function createSharePointSource(
  profile: string,
  siteUrl: string,
  displayName: string,
  signal: AbortSignal,
): Promise<{ config: SharePointSourceConfig; descriptor: { id: string; provider: 'sharepoint'; displayName: string; siteHost: string; listName: string; ownerInstallationId: string; lifecycle: 'active'; schemaVersion: 1 } }> {
  const entered = safeSharePointSiteUrl(siteUrl);
  const directory = await workiqProfileDirectory(profile);
  const connection = await connectWorkIQ(signal);
  try {
    const sitePath = entered.pathname.slice(1);
    const lookupPath = `/sites/${entered.hostname}:/${sitePath}?$select=id,webUrl,displayName`;
    validateSharePointSetupCall('fetch', { entityUrls: [lookupPath] }, sitePath);
    const siteData = graphResultData(await callWorkIQ(connection.client, 'fetch', { entityUrls: [lookupPath] }, signal));
    // Composite `host,siteGuid,webGuid`; its commas must stay raw in later paths.
    const siteId = text(siteData.id, 512) && /^[\w.-]+,[\da-f-]+,[\da-f-]+$/i.test(siteData.id) ? siteData.id : undefined;
    if (!siteId) throw new Error('WorkIQ returned no stable SharePoint site ID');
    if (!text(siteData.webUrl, 2048)) throw new Error('WorkIQ returned no SharePoint site URL');
    // Keep SharePoint's canonical URL (its casing) so item URLs can be checked against it.
    const site = safeSharePointSiteUrl(siteData.webUrl);
    if (site.origin.toLowerCase() !== entered.origin.toLowerCase() || site.pathname.toLowerCase() !== entered.pathname.toLowerCase()) {
      throw new Error('WorkIQ resolved a different SharePoint site than the one entered');
    }
    const label = displayName.trim().slice(0, 100) || decodeURIComponent(site.pathname.split('/').filter(Boolean).at(-1) ?? '') || site.hostname;
    // Find Site Pages by its URL (`<site>/SitePages`), not its display name, which is localized.
    const pagesRoot = `${site.pathname}/sitepages`.toLowerCase();
    let listsPath = `/sites/${siteId}/lists?$select=${SHAREPOINT_CATALOG_SELECT}&$top=25`;
    const matches: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (let page = 0; listsPath; page++) {
      if (page >= 50 || seen.has(listsPath)) throw new Error('The SharePoint list catalog is too large or repeats; setup stopped');
      seen.add(listsPath);
      validateSharePointSetupCall('fetch', { entityUrls: [listsPath] }, '', siteId);
      const listData = graphResultData(await callWorkIQ(connection.client, 'fetch', { entityUrls: [listsPath] }, signal));
      if (!Array.isArray(listData.value)) throw new Error('WorkIQ returned an invalid SharePoint list catalog');
      for (const value of listData.value) {
        if (!object(value) || !text(value.webUrl, 8192)) continue;
        let url: URL;
        try { url = new URL(value.webUrl); } catch { continue; }
        if (url.origin === site.origin && decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase() === decodeURIComponent(pagesRoot)) matches.push(value);
      }
      const next = listData['@odata.nextLink'];
      listsPath = typeof next === 'string' ? sharePointCatalogPath(next, siteId) : '';
    }
    const list = matches.length === 1 ? matches[0] : undefined;
    if (!list || !text(list.id, 36) || !/^[0-9a-f-]{36}$/i.test(list.id)) {
      throw new Error('The selected site has no uniquely discoverable Site Pages list');
    }
    const listName = text(list.displayName, 200) && list.displayName.trim() ? list.displayName.trim() : 'Site Pages';
    const sourceId = `sharepoint-${randomUUID()}`;
    const ownerInstallationId = randomUUID();
    const scopeHash = createHash('sha256').update(JSON.stringify([connection.account, site.origin, site.pathname, siteId, list.id])).digest('hex');
    const config: SharePointSourceConfig = {
      id: sourceId,
      displayName: label,
      siteUrl: site.toString(),
      siteId,
      listId: list.id,
      listName,
      accountId: connection.account,
      scopeHash,
      ownerInstallationId,
      mode: 'list-snapshot-v1',
      approvalRevision: 2,
      enabled: true,
    };
    await sharePointApproval(directory, config, true);
    return {
      config,
      descriptor: {
        id: sourceId, provider: 'sharepoint', displayName: label, siteHost: site.hostname,
        listName, ownerInstallationId, lifecycle: 'active', schemaVersion: 1,
      },
    };
  } finally { await connection.close(); }
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

export async function openWorkIQ(profile: string, signal: AbortSignal, sharePoint?: SharePointSourceConfig) {
  const now = Date.now();
  const directory = await workiqProfileDirectory(profile);
  try {
    if (sharePoint) {
      if (sharePoint.approvalRevision !== 2) {
        throw new Error('Page-text access needs explicit approval; remove and add this SharePoint source again');
      }
      const site = safeSharePointSiteUrl(sharePoint.siteUrl);
      const expected = createHash('sha256').update(JSON.stringify([
        sharePoint.accountId, site.origin, site.pathname, sharePoint.siteId, sharePoint.listId,
      ])).digest('hex');
      if (expected !== sharePoint.scopeHash) throw new Error('SharePoint account or target changed since explicit approval');
      await sharePointApproval(directory, sharePoint);
    }
    else await approval(directory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(sharePoint
        ? 'SharePoint needs explicit metadata approval again; remove and add this source to renew its scoped approval'
        : 'Teams needs explicit host-account sign-in (Config > Teams meetings > l). WorkIQ will run outside FOMO’s sandbox.');
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
        if (sharePoint && account !== sharePoint.accountId) throw new Error('WorkIQ account changed since SharePoint consent');
        validateWorkIQCall(tool, args, account, threads, now, sharePoint);
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

export async function removeSharePointApproval(profile: string, sourceId: string): Promise<void> {
  const directory = await workiqProfileDirectory(profile);
  const path = join(directory, `sharepoint-${createHash('sha256').update(sourceId).digest('hex')}-approved`);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.mode & 0o077 || info.uid !== process.getuid?.()) {
      throw new Error('Invalid SharePoint approval file');
    }
    await unlink(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
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
