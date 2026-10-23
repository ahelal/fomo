import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DigestInspection } from '@fomo/core/digest';
import { createGroupingHistory } from '../src/groupingHistory.js';

const folders: string[] = [];
const temporary = () => {
  const folder = mkdtempSync(join(tmpdir(), 'fomo-grouping-'));
  folders.push(folder);
  return folder;
};
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
const snapshot = (startedAt = '2026-10-23T12:00:00Z'): DigestInspection => ({
  startedAt, guidance: 'Keep release streams together', items: [{ id: 'a', title: 'CLI release' }],
  calls: [{ label: 'Planning', system: 'rules', prompt: 'items', state: 'running' }],
});

describe('grouping run history', () => {
  it('persists exact snapshots across store instances and lists latest first', () => {
    const folder = temporary();
    const history = createGroupingHistory('default', folder);
    expect(history.list()).toEqual([]);
    const first = snapshot();
    const oldId = history.save(first);
    const newer = snapshot('2026-10-23T13:00:00Z');
    const newId = history.save(newer);
    newer.calls[0]!.state = 'complete';
    newer.calls[0]!.response = { topics: [] };
    expect(history.save(newer)).toBe(newId);
    const reopened = createGroupingHistory('default', folder);
    expect(reopened.list()).toEqual([newId, oldId]);
    expect(reopened.read(newId)).toEqual(newer);
    expect(reopened.read(oldId)).toEqual(first);
    const profileFolder = join(folder, 'grouping-runs', Buffer.from('default').toString('base64url'));
    expect(readdirSync(profileFolder)).toHaveLength(2);
    expect(statSync(join(profileFolder, newId)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(profileFolder, newId), 'utf8'))).toEqual(newer);
  });

  it('isolates profiles, including unusual names, and rejects path traversal', () => {
    const folder = temporary();
    const first = createGroupingHistory('../profile', folder);
    first.save(snapshot());
    expect(createGroupingHistory('other', folder).list()).toEqual([]);
    expect(() => first.read('../config.json')).toThrow('Invalid grouping run id');
    expect(first.list()).toHaveLength(1);
  });

  it('surfaces corrupted snapshots and malformed saved data', () => {
    const folder = temporary();
    const history = createGroupingHistory('default', folder);
    const id = history.save(snapshot());
    const file = join(folder, 'grouping-runs', Buffer.from('default').toString('base64url'), id);
    writeFileSync(file, '{broken');
    expect(() => history.read(id)).toThrow();
    writeFileSync(file, JSON.stringify({ startedAt: 'now', calls: [] }));
    expect(() => history.read(id)).toThrow('Invalid grouping history snapshot');
    expect(() => history.save({ ...snapshot(), startedAt: 'invalid' })).toThrow('Invalid grouping inspection');
  });
});
