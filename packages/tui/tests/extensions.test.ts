import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Update } from '@fomo/core';
import { ExtensionHost, snapshotExtension } from '../src/extensions/host.js';
import { closeSandbox, spawnSandbox } from '../src/extensions/sandbox.js';
import { decodeItems, decodeMerge } from '../src/extensions/validation.js';
import { publicAddress } from '../src/extensions/http.js';

const mocks = vi.hoisted(() => ({ http: vi.fn(), workiq: vi.fn() }));
vi.mock('../src/extensions/http.js', async (original) => ({
  ...await original<typeof import('../src/extensions/http.js')>(), httpText: mocks.http,
}));
vi.mock('../src/experimental/workiq.js', () => ({ openWorkIQ: mocks.workiq }));
const hosts: ExtensionHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.dispose())); vi.clearAllMocks(); vi.unstubAllEnvs(); });
const host = (profile = 'test') => { const value = new ExtensionHost(profile); hosts.push(value); return value; };

describe('extension validation', () => {
  it('rejects malformed items, executable links and protected merge fields', () => {
    const item = { title: 'T', url: 'https://example.com', datePublished: '2026-01-01T00:00:00.000Z' };
    expect(decodeItems([item])[0].datePublished).toBeInstanceOf(Date);
    expect(() => decodeItems([{ ...item, source: 'another-profile' }])).toThrow();
    expect(() => decodeItems([{ ...item, url: 'javascript:alert(1)' }])).toThrow();
    expect(() => decodeItems([{ ...item, datePublished: 'not a date' }])).toThrow();
    expect(() => decodeMerge({ status: 'read' })).toThrow('protected');
    expect(() => decodeMerge({ saved: false })).toThrow();
    expect(decodeMerge({ content: 'Updated' })).toEqual({ content: 'Updated' });
  });
  it('excludes private, loopback, metadata, mapped and special-use addresses', () => {
    for (const ip of ['127.0.0.1', '169.254.169.254', '10.1.2.3', '172.20.1.1', '192.168.1.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1', '2001:db8::1']) expect(publicAddress(ip)).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true);
    expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('snapshots approved bytes and rejects changed, extra and symlinked bundle files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fomo-catalog-test-'));
    const folder = join(directory, 'fixture');
    const catalog = join(directory, 'catalog.json');
    let snapshot: Awaited<ReturnType<typeof snapshotExtension>> | undefined;
    try {
      await mkdir(folder);
      const files = {
        'extension.json': JSON.stringify({ apiVersion: 1, id: 'fixture', entry: 'index.mjs', permissions: { http: [], mcp: [], filesystem: { readOnly: [], readWrite: [] } } }),
        'index.mjs': 'export const fetch = async () => [];',
      };
      const hashes: Record<string, string> = {};
      for (const [name, content] of Object.entries(files)) {
        await writeFile(join(folder, name), content);
        hashes[name] = createHash('sha256').update(content).digest('hex');
      }
      await writeFile(catalog, JSON.stringify([{ id: 'fixture', hashes }]));
      snapshot = await snapshotExtension('fixture', catalog);
      await writeFile(join(folder, 'index.mjs'), 'changed code');
      expect(await readFile(join(snapshot.directory, 'index.mjs'), 'utf8')).toBe(files['index.mjs']);
      await expect(snapshotExtension('fixture', catalog)).rejects.toThrow('changed');
      await writeFile(join(folder, 'index.mjs'), files['index.mjs']);
      await writeFile(join(folder, 'extra.mjs'), 'extra');
      await expect(snapshotExtension('fixture', catalog)).rejects.toThrow('Unexpected files');
      await rm(join(folder, 'extra.mjs'));
      await rm(join(folder, 'index.mjs'));
      await symlink(catalog, join(folder, 'index.mjs'));
      await expect(snapshotExtension('fixture', catalog)).rejects.toThrow('Invalid extension file');
      await expect(snapshotExtension('not-installed', catalog)).rejects.toThrow('not bundled');
    } finally {
      if (snapshot) await rm(snapshot.directory, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe.runIf(process.platform === 'darwin')('real MXC workers', () => {
  it('runs both Anthropic instances through private RPC', async () => {
    mocks.http.mockImplementation(async (url: string) => {
      const section = url.endsWith('/engineering') ? 'engineering' : 'news';
      return `<a href="/${section}/new"><h2>${section} article</h2><time>Oct 18, 2026</time></a>`;
    });
    const sources = host().sources();
    const [news, engineering] = await Promise.all([
      sources.anthropic.fetch({ sourceId: 'anthropic-news', options: { section: 'news' } }),
      sources.anthropic.fetch({ sourceId: 'anthropic-engineering', options: { section: 'engineering' } }),
    ]);
    expect(news[0].title).toBe('news article');
    expect(engineering[0].title).toBe('engineering article');
    expect(mocks.workiq).not.toHaveBeenCalled();
  }, 20_000);

  it('runs Teams classification and asynchronous merges in the worker and closes the helper', async () => {
    const end = new Date(Date.now() - 3_600_000);
    const start = new Date(end.getTime() - 3_600_000);
    const thread = '19:fixture@thread.v2';
    const close = vi.fn(async () => {});
    mocks.workiq.mockImplementation(async () => ({
      account: 'me', close,
      call: async (tool: string, args: Record<string, unknown>) => {
        if (tool === 'call_function') return { statusCode: 200, data: { value: [] } };
        const paths = args.entityUrls as string[];
        return { results: paths.map((path) => ({
          statusCode: 200,
          data: path === '/me?$select=id' ? { id: 'me' } : { value: path.startsWith('/me/calendarView') ? [{
            id: 'event', subject: 'Fixture meeting', onlineMeeting: { joinUrl: `https://teams.microsoft.com/l/meetup-join/${thread}/0` },
            start: { dateTime: start.toISOString(), timeZone: 'UTC' }, end: { dateTime: end.toISOString(), timeZone: 'UTC' },
          }] : [{
            createdDateTime: end.toISOString(),
            eventDetail: { '@odata.type': '#microsoft.graph.callEndedEventMessageDetail', callParticipants: [] },
          }] },
        })) };
      },
    }));
    const runtime = host('personal-test');
    runtime.setTeamsEnabled(true);
    expect(runtime.teamsProvider()).toBe(runtime.teamsProvider());
    for (let i = 0; i < 2; i++) {
      const session = await runtime.teamsProvider().open!();
      try {
        const [item] = await session.fetch();
        expect(item.key).toBe(`teams:${thread}:${start.toISOString()}`);
        expect(item.content).toContain('Missed');
        const existing: Update = { ...item, id: 'teams-meetings__fixed', source: 'teams-meetings', datePublished: item.datePublished.toISOString(), dateAdded: end.toISOString(), status: 'read', saved: true, content: 'Missed' };
        const change = await session.merge!(existing, item);
        expect(change?.content).toContain('Missed');
        expect(change).not.toHaveProperty('saved');
        expect(change).not.toHaveProperty('status');
      } finally { await session.close!(); }
    }
    expect(close).toHaveBeenCalledTimes(2);
    runtime.setTeamsEnabled(false);
    await expect(runtime.teamsProvider().fetch()).rejects.toThrow('not enabled');
  }, 20_000);

  it('cancels an in-flight worker when its profile is disposed', async () => {
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    mocks.http.mockImplementation((_url: string, _origins: string[], signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      ready();
    }));
    const runtime = host('old-profile');
    const result = expect(runtime.sources().anthropic.fetch({ sourceId: 'anthropic-news', options: { section: 'news' } })).rejects.toThrow(/Profile|cancel|closed/);
    await started;
    await runtime.dispose();
    await result;
  }, 10_000);

  it('enforces filesystem modes, symlink containment, offline networking and no subprocesses', async () => {
    vi.stubEnv('FOMO_SANDBOX_TEST_SECRET', 'test-only-sentinel');
    const base = await realpath(await mkdtemp(join(tmpdir(), 'fomo-boundary-test-')));
    let child: Awaited<ReturnType<typeof spawnSandbox>> | undefined;
    try {
      const ro = join(base, 'read-only'); const rw = join(base, 'read-write');
      await mkdir(ro); await mkdir(rw);
      const canary = join(base, 'private-canary');
      await writeFile(canary, 'FAKE CANARY');
      await writeFile(join(ro, 'allowed'), 'ok');
      await symlink(canary, join(ro, 'escape'));
      const worker = join(ro, 'probe.mjs');
      await writeFile(worker, `
        import fs from 'node:fs'; import net from 'node:net'; import {spawnSync} from 'node:child_process';
        const result = {};
        for (const [name, action] of Object.entries({
          allowed: () => fs.readFileSync(${JSON.stringify(join(ro, 'allowed'))}, 'utf8'),
          private: () => fs.readFileSync(${JSON.stringify(canary)}, 'utf8'),
          alias: () => fs.readFileSync(${JSON.stringify(join(ro, 'escape'))}, 'utf8'),
          roWrite: () => fs.writeFileSync(${JSON.stringify(join(ro, 'denied'))}, 'x'),
          rwWrite: () => fs.writeFileSync(${JSON.stringify(join(rw, 'allowed'))}, 'ok'),
          spawn: () => { const p=spawnSync('/bin/sh',['-c','exit 0']); if(p.error)throw p.error; return 'SPAWNED'; }
        })) {try{result[name]=action()??'ok'}catch(e){result[name]=e.code}}
        result.outbound = await new Promise(resolve=>{const s=net.connect(9,'127.0.0.1');s.on('error',e=>resolve(e.code));s.on('connect',()=>{s.destroy();resolve('CONNECTED')})});
        result.inbound = await new Promise(resolve=>{const s=net.createServer();s.on('error',e=>resolve(e.code));s.listen(0,'127.0.0.1',()=>s.close(()=>resolve('LISTENING')))});
        result.secretEnv = process.env.FOMO_SANDBOX_TEST_SECRET ?? 'absent';
        console.log(JSON.stringify(result));
      `);
      child = await spawnSandbox({ executable: process.execPath, args: ['--openssl-config=/dev/null', worker], directory: ro, readonlyPaths: [ro], readwritePaths: [rw], timeoutMs: 5000 });
      child.standardInput?.end();
      let out = ''; let err = '';
      child.standardOutput?.on('data', (b) => { out += b; });
      child.standardError?.on('data', (b) => { err += b; });
      expect(await child.wait(), err).toMatchObject({ exitCode: 0, timedOut: false });
      expect(JSON.parse(out)).toEqual({ allowed: 'ok', private: 'EPERM', alias: 'EPERM', roWrite: 'EPERM', rwWrite: 'ok', spawn: 'EPERM', outbound: 'EPERM', inbound: 'EPERM', secretEnv: 'absent' });
      expect(await readFile(join(rw, 'allowed'), 'utf8')).toBe('ok');
    } finally { if (child) await closeSandbox(child); await rm(base, { recursive: true, force: true }); }
  }, 10_000);

  // MXC's timeout teardown sweeps every pid on the machine and reports a spurious backend_error
  // (ffiStatus 12) when a process exits mid-sweep, e.g. under parallel test load. The worker is
  // still killed, so tolerate only that error and keep asserting that nothing keeps running.
  const tolerateTeardownRace = (error: unknown) => {
    const { code, details } = (error ?? {}) as { code?: unknown; details?: { ffiStatus?: unknown } };
    if (!(error instanceof Error) || code !== 'backend_error' || details?.ffiStatus !== 12) throw error;
  };
  const running = (pid: number) => {
    try { return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim().startsWith('Z'); } catch { return false; }
  };

  it('terminates a timed-out CPU loop and confirms that the process is gone', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'fomo-timeout-test-')));
    let child: Awaited<ReturnType<typeof spawnSandbox>> | undefined;
    try {
      const script = join(directory, 'loop.mjs');
      await writeFile(script, 'for (;;) {}');
      child = await spawnSandbox({ executable: process.execPath, args: ['--openssl-config=/dev/null', script], directory, readonlyPaths: [directory], timeoutMs: 700 });
      child.standardInput?.end();
      child.standardOutput?.resume();
      child.standardError?.resume();
      let timedOut: boolean | undefined;
      try { timedOut = (await child.wait()).timedOut; } catch (error) { tolerateTeardownRace(error); }
      if (timedOut !== undefined) expect(timedOut).toBe(true);
      const pid = child.id;
      expect(pid).toBeGreaterThan(0);
      expect(running(pid)).toBe(false);
    } finally {
      if (child) await closeSandbox(child).catch(tolerateTeardownRace);
      await rm(directory, { recursive: true, force: true });
    }
  }, 5000);
});
