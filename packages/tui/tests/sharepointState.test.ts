import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SharePointSourceConfig } from '@fomo/core';
import { LEASE_MS, SharePointJournal } from '../src/experimental/sharepoint-state.js';

const source: SharePointSourceConfig = {
  id: 'sharepoint-12345678-1234-4234-8234-123456789abc',
  displayName: 'Product',
  siteUrl: 'https://tenant.sharepoint.com/teams/product',
  siteId: 'tenant.sharepoint.com,site,web',
  listId: '12345678-1234-4234-8234-123456789abc',
  listName: 'Site Pages',
  accountId: 'account',
  scopeHash: 'a'.repeat(64),
  ownerInstallationId: 'installation',
  mode: 'list-snapshot-v1',
  approvalRevision: 1,
  enabled: true,
};

const item = (id: string, etag: string, title = id, text = `Page ${id}\nStable text`) => ({
  id, etag, title,
  url: `https://tenant.sharepoint.com/teams/product/SitePages/${id}.aspx`,
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-02T00:00:00.000Z',
  text,
});

const now = new Date('2026-02-01T12:00:00.000Z');

describe('SharePoint revision journal', () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('imports only pages modified in the last 20 days as first-seen events on the first scan', async () => {
    directory = await mkdtemp(join(tmpdir(), 'fomo-sharepoint-state-'));
    const journal = await SharePointJournal.open('default', source, directory);
    const staged = journal.stageSnapshot([
      item('old', 'e1'),
      { ...item('recent', 'e1'), modifiedAt: '2026-01-15T12:00:00.000Z' },
      { ...item('boundary', 'e1'), modifiedAt: '2026-01-12T12:00:00.000Z' },
      { ...item('too-old', 'e1'), modifiedAt: '2026-01-12T11:59:59.999Z' },
      { ...item('today', 'e1'), modifiedAt: now.toISOString() },
      { ...item('future', 'e1'), modifiedAt: '2026-02-01T12:00:00.001Z' },
      { ...item('offset', 'e1'), modifiedAt: '2026-01-12T13:00:00.000+01:00' },
    ], now);

    expect(staged.map((update) => update.title)).toEqual(['recent', 'boundary', 'today', 'offset']);
    for (const update of staged) {
      expect(update.sharePointOrigin).toMatchObject({
        eventKind: 'first-seen',
        observedAt: now.toISOString(),
        createdAt: '2026-01-01T00:00:00.000Z',
        modifiedAt: update.datePublished.toISOString(),
      });
      expect(update.content).toContain('no previous snapshot');
    }
    expect(staged[0]!.datePublished.toISOString()).toBe('2026-01-15T12:00:00.000Z');
    expect(staged[3]!.datePublished.toISOString()).toBe('2026-01-12T12:00:00.000Z');
    journal.close();
  });

  it('persists initial imports and does not repeat acknowledged revisions on later scans', async () => {
    directory = await mkdtemp(join(tmpdir(), 'fomo-sharepoint-state-'));
    let journal = await SharePointJournal.open('default', source, directory);
    const snapshot = ['1', '2'].map((id) => ({ ...item(id, 'e1'), modifiedAt: '2026-01-31T12:00:00.000Z' }));
    const staged = journal.stageSnapshot(snapshot, now);
    expect(staged).toHaveLength(2);
    journal.close();

    journal = await SharePointJournal.open('default', source, directory);
    expect(journal.pending()).toEqual(staged);
    journal.acknowledge(staged[0]!.key!);
    expect(journal.stageSnapshot(snapshot, new Date('2026-02-02T12:00:00.000Z'))).toEqual([staged[1]]);
    journal.close();

    journal = await SharePointJournal.open('default', source, directory);
    expect(journal.pending()).toEqual([staged[1]]);
    journal.acknowledge(staged[1]!.key!);
    expect(journal.stageSnapshot(snapshot, new Date('2026-02-03T12:00:00.000Z'))).toEqual([]);
    expect(journal.stageSnapshot(snapshot, new Date('2026-03-01T12:00:00.000Z'))).toEqual([]);
    journal.close();
  });

  it('keeps every recent page in the journal while delivering at most 100 per fetch', async () => {
    directory = await mkdtemp(join(tmpdir(), 'fomo-sharepoint-state-'));
    let journal = await SharePointJournal.open('default', source, directory);
    const snapshot = Array.from({ length: 205 }, (_, i) => ({
      ...item(String(i), 'e1'), modifiedAt: '2026-01-20T12:00:00.000Z',
    }));
    expect(journal.stageSnapshot(snapshot, now)).toHaveLength(100);
    const keys: string[] = [];
    for (const size of [100, 100, 5]) {
      journal.close();
      journal = await SharePointJournal.open('default', source, directory);
      const batch = journal.pending();
      expect(batch).toHaveLength(size);
      for (const update of batch) {
        expect(update.sharePointOrigin?.eventKind).toBe('first-seen');
        keys.push(update.key!);
        journal.acknowledge(update.key!);
      }
    }
    expect(new Set(keys).size).toBe(205);
    expect(journal.stageSnapshot(snapshot, now)).toEqual([]);
    journal.close();
  });

  it('rejects an invalid first snapshot without recording a baseline or queuing partial imports', async () => {
    directory = await mkdtemp(join(tmpdir(), 'fomo-sharepoint-state-'));
    const journal = await SharePointJournal.open('default', source, directory);
    const recent = { ...item('recent', 'e1'), modifiedAt: '2026-01-31T12:00:00.000Z' };
    expect(() => journal.stageSnapshot([recent, { ...item('old', 'e1'), url: 'https://example.org/item' }], now))
      .toThrow('outside the approved site');
    expect(journal.pending()).toEqual([]);
    const staged = journal.stageSnapshot([recent, item('old', 'e1')], now);
    expect(staged).toHaveLength(1);
    expect(staged[0]!.title).toBe('recent');
    expect(staged[0]!.sharePointOrigin?.eventKind).toBe('first-seen');
    journal.close();
  });

  it('completes an empty baseline so later first-seen pages are not limited to 20 days', async () => {
    directory = await mkdtemp(join(tmpdir(), 'fomo-sharepoint-state-'));
    const journal = await SharePointJournal.open('default', source, directory);
    expect(journal.stageSnapshot([], now)).toEqual([]);
    const staged = journal.stageSnapshot([item('1', 'e1')], now);
    expect(staged).toHaveLength(1);
    expect(staged[0]!.sharePointOrigin?.eventKind).toBe('first-seen');
    journal.close();
  });

  it('baselines older pages quietly, stages stable ETag events, and replays until acknowledged', async () => {
    directory = await mkdtemp(join(tmpdir(), 'fomo-sharepoint-state-'));
    let journal = await SharePointJournal.open('default', source, directory);
    expect(journal.stageSnapshot([item('1', 'e1')], now)).toEqual([]);
    expect(journal.stageSnapshot([item('1', 'e1')], now)).toEqual([]);

    const staged = journal.stageSnapshot([item('1', 'e2', 'Updated', 'Page 1\nNew sentence'), item('2', 'e1')], now);
    expect(staged).toHaveLength(2);
    expect(staged.map((update) => update.sharePointOrigin?.eventKind)).toEqual(['updated', 'first-seen']);
    expect(staged[0]!.sharePointOrigin?.eventFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(staged[0]!.content).toContain('+ New sentence');
    expect(staged[0]!.content).toContain('- Stable text');
    expect(journal.stageSnapshot([item('1', 'e2', 'Updated', 'Page 1\nNew sentence'), item('2', 'e1')], now)).toEqual(staged);

    const firstKey = staged[0]!.key!;
    journal.acknowledge(firstKey);
    expect(journal.pending()).toHaveLength(1);
    journal.close();

    journal = await SharePointJournal.open('default', source, directory);
    expect(journal.stageSnapshot([item('1', 'e2', 'Updated'), item('2', 'e1')], now)).toHaveLength(1);
    expect(journal.pending()[0]!.key).toBe(staged[1]!.key);
    journal.acknowledge(staged[1]!.key!);
    expect(journal.pending()).toEqual([]);
    journal.close();
  });

  it('reports the initial text snapshot and distinguishes metadata-only revisions', async () => {
    directory = await mkdtemp(join(tmpdir(), 'fomo-sharepoint-state-'));
    const journal = await SharePointJournal.open('default', source, directory);
    const first = journal.stageSnapshot([{
      ...item('1', 'e1', 'Page', 'Intro\nExisting paragraph'),
      modifiedAt: '2026-01-31T12:00:00.000Z',
    }], now);
    expect(first[0]!.content).toContain('no previous snapshot');
    expect(first[0]!.content).toContain('Existing paragraph');
    journal.acknowledge(first[0]!.key!);

    const metadataOnly = journal.stageSnapshot([{
      ...item('1', 'e2', 'Renamed', 'Intro\nExisting paragraph'),
      modifiedAt: '2026-01-31T12:00:00.000Z',
    }], now);
    expect(metadataOnly[0]!.content).toContain('No page-text additions or removals detected');
    journal.close();
  });

  it('bounds large diffs to the storage limit without corrupting the pending event', async () => {
    directory = await mkdtemp(join(tmpdir(), 'fomo-sharepoint-state-'));
    const journal = await SharePointJournal.open('default', source, directory);
    journal.stageSnapshot([item('1', 'e1', 'Page', 'x'.repeat(256 * 1024))], now);
    const [updated] = journal.stageSnapshot([item('1', 'e2', 'Page', 'y'.repeat(256 * 1024))], now);
    expect(updated!.content!.length).toBeLessThanOrEqual(32_000);
    expect(updated!.content).toContain('Diff truncated');
    expect(journal.pending()).toEqual([updated]);
    journal.close();
  });

  it('rejects partial or untrusted snapshots without advancing the recorded revision', async () => {
    directory = await mkdtemp(join(tmpdir(), 'fomo-sharepoint-state-'));
    const journal = await SharePointJournal.open('default', source, directory);
    journal.stageSnapshot([item('1', 'e1')], now);
    expect(() => journal.stageSnapshot([{ ...item('1', 'e2'), url: 'https://example.org/item' }], now)).toThrow('outside the approved site');
    expect(journal.stageSnapshot([item('1', 'e1')], now)).toEqual([]);
    expect(() => journal.stageSnapshot([item('1', 'e2'), item('1', 'e3')], now)).toThrow('duplicate item IDs');
    journal.close();
  });

  it('serializes competing scans and binds journal state to the exact source scope', async () => {
    directory = await mkdtemp(join(tmpdir(), 'fomo-sharepoint-state-'));
    const first = await SharePointJournal.open('default', source, directory);
    const second = await SharePointJournal.open('default', source, directory);
    first.acquireLease();
    expect(() => second.acquireLease()).toThrow('already running');
    first.releaseLease();
    second.acquireLease();
    second.releaseLease();
    second.close();
    first.close();
    await expect(SharePointJournal.open('default', { ...source, listId: '22345678-1234-4234-8234-123456789abc' }, directory))
      .rejects.toThrow('binding changed');
  });

  it('holds one renewable scan lease per source and delivers events in observation order', async () => {
    directory = await mkdtemp(join(tmpdir(), 'fomo-sharepoint-state-'));
    const first = await SharePointJournal.open('default', source, directory);
    const second = await SharePointJournal.open('default', source, directory);
    first.acquireLease(1_000);
    expect(() => second.acquireLease(2_000)).toThrow('already running');
    first.renewLease(LEASE_MS);
    expect(() => second.acquireLease(LEASE_MS + 2_000)).toThrow('already running');
    second.acquireLease(3 * LEASE_MS);
    expect(() => first.renewLease(3 * LEASE_MS)).toThrow('lease was lost');
    second.releaseLease();

    first.stageSnapshot([item('b', 'e1'), item('a', 'e1')], now);
    const staged = first.stageSnapshot([item('b', 'e2'), item('a', 'e2'), item('c', 'e1')], now);
    expect(first.pending().map((update) => update.key)).toEqual(staged.map((update) => update.key));
    first.close();
    second.close();
  });
});
