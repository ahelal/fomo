import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ExperimentalProvider, KeyedChange, SharePointSourceConfig, SourceExtension, Update } from '@fomo/core';
import type { Json } from '@fomo/core/extension-api';
import { createSharePointSource, openWorkIQ, removeSharePointApproval } from '../experimental/workiq.js';
import { SharePointJournal } from '../experimental/sharepoint-state.js';
import { httpText } from './http.js';
import { WorkerConnection } from './protocol.js';
import { closeSandbox, spawnSandbox } from './sandbox.js';
import { cleanMessage, decodeItems, decodeMerge, object, text } from './validation.js';

const require = createRequire(import.meta.url);
type WorkIQConnection = Awaited<ReturnType<typeof openWorkIQ>>;
const publicIds = ['anthropic'];

export async function snapshotExtension(id: string, catalogPath = require.resolve('@fomo/extensions/catalog')): Promise<{ directory: string; origins: string[]; mcp: string[]; digest: string }> {
  const catalog: unknown = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (!Array.isArray(catalog)) throw new Error('Invalid bundled extension catalog');
  const entry: unknown = catalog.find((e) => object(e) && e.id === id);
  if (!object(entry) || !object(entry.hashes)) throw new Error(`Extension is not bundled: ${id}`);
  const folder = join(dirname(catalogPath), id);
  if ((await lstat(folder)).isSymbolicLink()) throw new Error('Bundled extension directory must not be a symlink');
  const names = (await readdir(folder)).sort();
  if (names.join(',') !== 'extension.json,index.mjs') throw new Error(`Unexpected files in extension ${id}`);
  const files = new Map<string, Buffer>();
  for (const name of names) {
    const path = join(folder, name);
    const info = await lstat(path);
    if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error(`Invalid extension file: ${name}`);
    const bytes = await readFile(path);
    if (bytes.length > 4 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== entry.hashes[name]) {
      throw new Error(`Bundled extension ${id} changed; rebuild or reinstall FOMO before fetching`);
    }
    files.set(name, bytes);
  }
  const manifest: unknown = JSON.parse(files.get('extension.json')!.toString());
  if (!object(manifest) || manifest.apiVersion !== 1 || manifest.id !== id || manifest.entry !== 'index.mjs'
    || !object(manifest.permissions) || !Array.isArray(manifest.permissions.http)
    || !manifest.permissions.http.every((v) => typeof v === 'string' && new URL(v).origin === v && v.startsWith('https://'))
    || !Array.isArray(manifest.permissions.mcp) || !manifest.permissions.mcp.every((v) => v === 'workiq')
    || !object(manifest.permissions.filesystem)
    || JSON.stringify(manifest.permissions.filesystem) !== '{"readOnly":[],"readWrite":[]}') {
    throw new Error(`Invalid or unsupported bundled permissions for ${id}`);
  }
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'fomo-extension-')));
  try {
    for (const [name, bytes] of files) await writeFile(join(directory, name), bytes, { mode: 0o400, flag: 'wx' });
    await writeFile(join(directory, 'worker.mjs'), await readFile(new URL('../../dist/extensions/worker.js', import.meta.url)), { mode: 0o400, flag: 'wx' });
    return {
      directory, origins: manifest.permissions.http, mcp: manifest.permissions.mcp,
      digest: createHash('sha256').update(JSON.stringify(entry.hashes)).digest('hex'),
    };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

export class ExtensionHost {
  private readonly state = new Map<string, Map<string, Json>>();
  private readonly active = new Map<AbortController, string>();
  private readonly closers = new Set<() => Promise<void>>();
  private readonly sourceClosers = new Map<string, Set<() => Promise<void>>>();
  private readonly lifetime = new AbortController();
  private enabled = false;
  private disposed = false;
  private teams?: ExperimentalProvider;
  private readonly sharePointSources = new Map<string, SharePointSourceConfig>();
  private readonly sharePointProviders = new Map<string, { config: string; provider: ExperimentalProvider }>();

  constructor(readonly profile: string, private readonly log: (message: string) => void = () => {}) {}

  get signal(): AbortSignal { return this.lifetime.signal; }

  /** Stops the running Teams meetings invocations (its fetch), failing them with `reason`. */
  revokeTeamsInvocations(reason: string): void {
    for (const [abort, sourceId] of this.active) if (sourceId === 'teams-meetings') abort.abort(new Error(reason));
  }

  revokeSharePointInvocation(sourceId: string, reason: string): void {
    for (const [abort, activeSource] of this.active) if (activeSource === sourceId) abort.abort(new Error(reason));
  }

  setSharePointSources(sources: readonly SharePointSourceConfig[], enabledIds: readonly string[]): void {
    const enabled = new Set(enabledIds);
    const next = new Map(sources.filter((source) => source.enabled && enabled.has(source.id)).map((source) => [source.id, source]));
    for (const id of new Set([...this.sharePointSources.keys(), ...next.keys()])) {
      if (JSON.stringify(this.sharePointSources.get(id)) !== JSON.stringify(next.get(id))) {
        this.revokeSharePointInvocation(id, 'Stopped: SharePoint source configuration or authorization changed');
      }
    }
    this.sharePointSources.clear();
    for (const [id, source] of next) this.sharePointSources.set(id, source);
  }

  async addSharePointSource(siteUrl: string, name: string, signal: AbortSignal) {
    return createSharePointSource(this.profile, siteUrl, name, signal);
  }

  async purgeSharePointSource(sourceId: string): Promise<void> {
    this.revokeSharePointInvocation(sourceId, 'Stopped: SharePoint source was purged');
    this.sharePointSources.delete(sourceId);
    await Promise.all([...(this.sourceClosers.get(sourceId) ?? [])].map((close) => close()));
    await SharePointJournal.purge(this.profile, sourceId);
    await removeSharePointApproval(this.profile, sourceId);
    this.sharePointProviders.delete(sourceId);
  }

  sharePointProvider(source: SharePointSourceConfig): ExperimentalProvider {
    const config = JSON.stringify(source);
    const cached = this.sharePointProviders.get(source.id);
    if (cached?.config === config) return cached.provider;
    const open = async (): Promise<ExperimentalProvider> => {
      if (this.sharePointSources.get(source.id) !== source && JSON.stringify(this.sharePointSources.get(source.id)) !== JSON.stringify(source)) {
        throw new Error('SharePoint source is not enabled in this profile');
      }
      // Lease first: a second TUI on this profile must not scan or deliver the same source concurrently.
      const journal = await SharePointJournal.open(this.profile, source);
      try { journal.acquireLease(); } catch (error) { journal.close(); throw error; }
      let session: Awaited<ReturnType<ExtensionHost['open']>>;
      try { session = await this.open('sharepoint', source.id, source); }
      catch (error) { journal.releaseLease(); journal.close(); throw error; }
      // Renewed for the whole invocation, including the storage writes that follow the scan.
      const renew = setInterval(() => {
        try { journal.renewLease(); }
        catch (error) { this.revokeSharePointInvocation(source.id, `Stopped: ${error instanceof Error ? error.message : String(error)}`); }
      }, 60_000);
      renew.unref();
      return {
        id: source.id,
        fetch: async () => {
          session.connection.assertActive();
          // Undelivered events go out first; scanning again would only grow the backlog.
          const pending = journal.pending();
          if (pending.length) return pending;
          const snapshot = await session.connection.request('fetch', {
            options: { siteId: source.siteId, listId: source.listId, siteUrl: source.siteUrl },
          });
          session.connection.assertActive();
          return journal.stageSnapshot(snapshot);
        },
        merge: () => undefined,
        assertActive: () => session.connection.assertActive(),
        acknowledge: async (key) => journal.acknowledge(key),
        close: async () => {
          clearInterval(renew);
          try { journal.releaseLease(); journal.close(); }
          finally { await session.close(); }
        },
      };
    };
    const provider: ExperimentalProvider = {
      id: source.id,
      open,
      fetch: async () => {
        const provider = await open();
        try { return await provider.fetch(); } finally { await provider.close?.(); }
      },
    };
    this.sharePointProviders.set(source.id, { config, provider });
    return provider;
  }

  sources(): Readonly<Record<string, SourceExtension>> {
    return Object.fromEntries(publicIds.map((id) => [id, {
      fetch: async (input: Parameters<SourceExtension['fetch']>[0]) => {
        const session = await this.open(id, input.sourceId);
        try { return decodeItems(await session.connection.request('fetch', { options: input.options })); }
        finally { await session.close(); }
      },
    }]));
  }

  setTeamsEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.revokeTeamsInvocations('Stopped: the source was turned off');
  }

  teamsProvider(): ExperimentalProvider {
    if (this.teams) return this.teams;
    const open = async (): Promise<ExperimentalProvider> => {
      if (!this.enabled) throw new Error('Teams meetings is not enabled in this profile');
      const session = await this.open('teams-meetings', 'teams-meetings');
      return {
        id: 'teams-meetings',
        fetch: async () => decodeItems(await session.connection.request('fetch', { options: {} })),
        merge: async (existing, fetched): Promise<KeyedChange | undefined> => {
          const { title, url, content, datePublished, durationSeconds } = existing;
          return decodeMerge(await session.connection.request('merge', {
            existing: { title, url, content, datePublished, durationSeconds }, fetched,
          }));
        },
        assertActive: () => session.connection.assertActive(),
        close: session.close,
      };
    };
    this.teams = {
      id: 'teams-meetings', open,
      fetch: async () => {
        const session = await open();
        try { return await session.fetch(); } finally { await session.close?.(); }
      },
    };
    return this.teams;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.lifetime.abort(new Error('Profile changed or FOMO closed'));
    for (const abort of this.active.keys()) abort.abort(new Error('Profile changed or FOMO closed'));
    await Promise.all([...this.closers].map((close) => close()));
    this.state.clear();
  }

  private async open(id: string, sourceId: string, sharePoint?: SharePointSourceConfig) {
    if (this.disposed) throw new Error('Extension profile has been closed');
    const snapshotInfo = await snapshotExtension(id);
    const abort = new AbortController();
    this.active.set(abort, sourceId);
    let workiq: Promise<WorkIQConnection> | undefined;
    const key = `${sourceId}:${snapshotInfo.digest}`;
    const state = this.state.get(key) ?? new Map<string, Json>();
    this.state.set(key, state);
    let launching: Promise<Awaited<ReturnType<typeof spawnSandbox>>> | undefined;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => closing ??= (async () => {
      abort.abort(new Error('Extension invocation finished'));
      try {
        const resources = await Promise.allSettled([launching, workiq]);
        const worker = resources[0].status === 'fulfilled' ? resources[0].value : undefined;
        const helper = resources[1].status === 'fulfilled' ? resources[1].value : undefined;
        const stopped = await Promise.allSettled([worker && closeSandbox(worker), helper?.close()]);
        const failures = stopped.filter((result) => result.status === 'rejected');
        if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Extension cleanup failed');
      } finally {
        this.active.delete(abort);
        this.closers.delete(close);
        const bySource = this.sourceClosers.get(sourceId);
        bySource?.delete(close);
        if (bySource?.size === 0) this.sourceClosers.delete(sourceId);
        await rm(snapshotInfo.directory, { recursive: true, force: true });
      }
    })();
    this.closers.add(close);
    const sourceClosers = this.sourceClosers.get(sourceId) ?? new Set<() => Promise<void>>();
    sourceClosers.add(close);
    this.sourceClosers.set(sourceId, sourceClosers);
    try {
      if (this.disposed || (id === 'teams-meetings' && !this.enabled)
        || (sharePoint && JSON.stringify(this.sharePointSources.get(sourceId)) !== JSON.stringify(sharePoint))) {
        throw new Error('Extension authorization changed before launch');
      }
      launching = spawnSandbox({
        executable: process.execPath,
        args: ['--openssl-config=/dev/null', '--max-old-space-size=128', join(snapshotInfo.directory, 'worker.mjs'), join(snapshotInfo.directory, 'index.mjs')],
        directory: snapshotInfo.directory, readonlyPaths: [snapshotInfo.directory],
        timeoutMs: id === 'teams-meetings' || sharePoint ? 300_000 : 60_000,
      });
      const child = await launching;
      if (this.disposed || (id === 'teams-meetings' && !this.enabled)
        || (sharePoint && JSON.stringify(this.sharePointSources.get(sourceId)) !== JSON.stringify(sharePoint))) {
        throw new Error('Extension authorization changed before launch');
      }
      const connection = new WorkerConnection(child, abort.signal, async (method, params) => {
        abort.signal.throwIfAborted();
        if (method === 'http' && text(params.url, 8192)) {
          return httpText(params.url, snapshotInfo.origins, abort.signal);
        }
        if (method === 'mcp' && params.binding === 'workiq' && snapshotInfo.mcp.includes('workiq') && text(params.tool) && object(params.args)) {
          if (sharePoint) {
            if (JSON.stringify(this.sharePointSources.get(sourceId)) !== JSON.stringify(sharePoint)) throw new Error('SharePoint source disabled');
          } else if (!this.enabled) throw new Error('Teams source disabled');
          workiq ??= openWorkIQ(this.profile, abort.signal, sharePoint);
          return (await workiq).call(params.tool, params.args);
        }
        if ((method === 'state.get' || method === 'state.set') && text(params.key, 100) && params.key) {
          if (method === 'state.get') return state.get(params.key);
          if (!('value' in params) || Buffer.byteLength(JSON.stringify(params.value)) > 256 * 1024 || state.size >= 16 && !state.has(params.key)) {
            throw new Error('Extension state limit exceeded');
          }
          state.set(params.key, params.value as Json);
          return null;
        }
        abort.abort(new Error('Extension requested an ungranted capability'));
        throw abort.signal.reason;
      }, (message) => this.log(`${id}: ${cleanMessage(message)}`));
      return { connection, close };
    } catch (error) { await close(); throw error; }
  }
}
