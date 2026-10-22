import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuditLog, createMemoryAuditLog, redact } from '../src/audit.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fomo-audit-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('audit log', () => {
  it('appends actions and errors as JSON lines and reads them newest first', () => {
    const file = join(dir, 'nested', 'audit.log');
    const audit = createAuditLog(file);
    audit.log('fetch', 'added 3');
    audit.error('digest', new Error('planning: quota exceeded'));

    const lines = readFileSync(file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toMatchObject([
      { level: 'info', action: 'fetch', detail: 'added 3' },
      { level: 'error', action: 'digest', detail: 'planning: quota exceeded' },
    ]);
    expect(audit.recent().map((e) => e.action)).toEqual(['digest', 'fetch']);
    expect(createAuditLog(file).recent(1)).toMatchObject([{ action: 'digest' }]);
  });

  it('never records account keys or SAS signatures', () => {
    const audit = createAuditLog(join(dir, 'audit.log'));
    audit.error('setup', 'bad DefaultEndpointsProtocol=https;AccountName=a;AccountKey=c2VjcmV0==;EndpointSuffix=x');
    audit.log('link', 'https://x.blob.core.windows.net/?sv=2024&sig=abc%2Fdef&se=1');
    const text = readFileSync(join(dir, 'audit.log'), 'utf-8');
    expect(text).not.toContain('c2VjcmV0');
    expect(text).not.toContain('abc%2Fdef');
    expect(redact('SharedAccessSignature=sv=1&sig=x;')).toBe('SharedAccessSignature=***;');
  });

  it('moves a full file to .1 and still reads across both', () => {
    const file = join(dir, 'audit.log');
    const audit = createAuditLog(file, { maxBytes: 300 });
    for (let i = 0; i < 10; i++) audit.log('status', `read update ${i}`);
    expect(statSync(file).size).toBeLessThanOrEqual(300);
    expect(statSync(`${file}.1`).size).toBeGreaterThan(0);
    const recent = audit.recent(6);
    // Each line is ~90 bytes: 3 per file, the current one holds the 10th.
    expect(recent.map((e) => e.detail)).toEqual(['read update 9', 'read update 8', 'read update 7', 'read update 6']);
  });

  it('skips damaged lines and notifies subscribers', () => {
    const file = join(dir, 'audit.log');
    writeFileSync(file, '{"ts":"2026-01-01T00:00:00Z","level":"info","action":"app"}\n');
    appendFileSync(file, 'not json\n');
    const audit = createAuditLog(file);
    let calls = 0;
    const off = audit.subscribe(() => { calls++; });
    audit.log('fetch');
    off();
    audit.log('fetch');
    expect(calls).toBe(1);
    expect(audit.recent().map((e) => e.action)).toEqual(['fetch', 'fetch', 'app']);
  });

  it('does not throw when the file cannot be written', () => {
    const file = join(dir, 'audit.log');
    writeFileSync(join(dir, 'blocker'), '');
    const audit = createAuditLog(join(dir, 'blocker', 'audit.log'));
    expect(() => audit.error('crash', 'boom')).not.toThrow();
    expect(audit.recent()).toEqual([]);
    expect(() => createAuditLog(file).recent()).not.toThrow();
  });

  it('stamps the entries that follow with the profile, until it is cleared', () => {
    const file = join(dir, 'audit.log');
    const audit = createAuditLog(file);
    audit.log('app', 'no profile yet');
    audit.setProfile('work');
    audit.log('fetch', 'added 3');
    audit.error('digest', 'quota exceeded');
    audit.setProfile('private');
    audit.log('fetch', 'added 1');
    audit.setProfile(undefined);
    audit.log('status', 'back to one profile');

    expect(audit.recent().map((e) => e.profile)).toEqual([undefined, 'private', 'work', 'work', undefined]);
    const lines = readFileSync(file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).not.toHaveProperty('profile');
    expect(lines[1]).toMatchObject({ action: 'fetch', profile: 'work' });
    expect(lines[2]).toMatchObject({ level: 'error', profile: 'work' });
    expect(lines[4]).not.toHaveProperty('profile');
  });

  it('stamps the in-memory log the same way', () => {
    const audit = createMemoryAuditLog();
    audit.setProfile('work');
    audit.log('fetch');
    audit.error('digest', 'boom');
    audit.setProfile(undefined);
    audit.log('fetch');
    expect(audit.entries.map((e) => e.profile)).toEqual(['work', 'work', undefined]);
  });
});

describe('startup', () => {
  it('records a malformed config.json in the audit trail', () => {
    mkdirSync(join(dir, '.fomo'));
    writeFileSync(join(dir, '.fomo', 'config.json'), '{ not json');
    const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
    const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
    // FOMO_CONFIG_DIR is unset for the child so that HOME decides where ~/.fomo is.
    const run = spawnSync(tsx, [entry], { env: { ...process.env, HOME: dir, USERPROFILE: dir, FOMO_CONFIG_DIR: '' }, encoding: 'utf-8' });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Failed to parse');
    const lines = readFileSync(join(dir, '.fomo', 'audit.log'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toContainEqual(expect.objectContaining({ level: 'error', action: 'crash', detail: expect.stringContaining('Failed to parse') }));
  }, 30_000);
});
