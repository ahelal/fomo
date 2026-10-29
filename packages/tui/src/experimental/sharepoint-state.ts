import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { DatabaseSync as Database } from 'node:sqlite';
import { join } from 'node:path';
import type { ScrapedItem, SharePointOrigin, SharePointSourceConfig } from '@fomo/core';
import { CONFIG_DIR } from '../config.js';

// Loaded at runtime: bundlers/test transformers (Vite 5) don't list `node:sqlite` as a builtin.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = Database;

/** Matches the extension's scan budget (100 pages × 25). */
const MAX_RECORDS = 2500;
const MAX_SNAPSHOT_BYTES = 48 * 1024 * 1024;
const MAX_PAGE_TEXT_CHARS = 24_000;
const MAX_EVENT_CONTENT_CHARS = 32_000;
/** Fetch hands at most this many outbox events to one ingestion pass. */
const DELIVERY_BATCH = 100;
const INITIAL_LOOKBACK_MS = 20 * 24 * 60 * 60_000;
export const LEASE_MS = 15 * 60_000;

function withinSite(value: URL, site: URL): boolean {
  const path = value.pathname.toLowerCase();
  const root = site.pathname.toLowerCase();
  return value.protocol === 'https:' && value.origin === site.origin && !value.username && !value.password
    && (path === root || path.startsWith(`${root}/`));
}

interface SharePointRow {
  id: string;
  etag: string;
  title: string;
  url: string;
  createdAt: string;
  modifiedAt: string;
  text: string;
}

function checkedRows(value: unknown, source: SharePointSourceConfig): SharePointRow[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) throw new Error('scope-too-large: SharePoint snapshot exceeds the record budget');
  const ids = new Set<string>();
  const site = new URL(source.siteUrl);
  let textBytes = 0;
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid SharePoint item metadata');
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id || item.id.length > 512
      || typeof item.etag !== 'string' || !item.etag || item.etag.length > 512
      || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500
      || typeof item.url !== 'string' || item.url.length > 8192
      || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))
      || typeof item.modifiedAt !== 'string' || !Number.isFinite(Date.parse(item.modifiedAt))
      || typeof item.text !== 'string' || item.text.length > MAX_PAGE_TEXT_CHARS) {
      throw new Error('Invalid SharePoint item metadata');
    }
    textBytes += Buffer.byteLength(item.text);
    if (textBytes > MAX_SNAPSHOT_BYTES) throw new Error('scope-too-large: SharePoint page-text snapshots exceed the local storage budget');
    if (!withinSite(new URL(item.url), site)) throw new Error('SharePoint item URL is outside the approved site');
    if (ids.has(item.id)) throw new Error('SharePoint snapshot contains duplicate item IDs');
    ids.add(item.id);
    return {
      id: item.id,
      etag: item.etag,
      title: item.title.trim(),
      url: item.url,
      createdAt: new Date(item.createdAt).toISOString(),
      modifiedAt: new Date(item.modifiedAt).toISOString(),
      text: item.text,
    };
  });
}

function lineChanges(previous: string, current: string): { added: string[]; removed: string[] } {
  const previousCounts = new Map<string, number>();
  for (const line of previous.split('\n')) previousCounts.set(line, (previousCounts.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of current.split('\n')) {
    const count = previousCounts.get(line) ?? 0;
    if (count) previousCounts.set(line, count - 1);
    else added.push(line);
  }

  const currentCounts = new Map<string, number>();
  for (const line of current.split('\n')) currentCounts.set(line, (currentCounts.get(line) ?? 0) + 1);
  const removed: string[] = [];
  for (const line of previous.split('\n')) {
    const count = currentCounts.get(line) ?? 0;
    if (count) currentCounts.set(line, count - 1);
    else removed.push(line);
  }
  return { added, removed };
}

function eventContent(eventKind: 'first-seen' | 'updated', previous: string | null, current: string): string {
  const body = current || '(No readable page text.)';
  let content: string;
  if (eventKind === 'first-seen') {
    content = `First observed page text (no previous snapshot):\n\n${body}`;
  } else if (previous === null) {
    content = `Previous page-text snapshot unavailable; current page text follows:\n\n${body}`;
  } else {
    const { added, removed } = lineChanges(previous, current);
    if (!added.length && !removed.length) content = 'No page-text additions or removals detected (metadata revision or text reordering only).';
    else content = [
      'Changes since the previous fetch:',
      ...added.map((line) => `+ ${line}`),
      ...removed.map((line) => `- ${line}`),
    ].join('\n');
  }
  if (content.length <= MAX_EVENT_CONTENT_CHARS) return content;
  const suffix = '\n… Diff truncated; open the page for the full text.';
  let end = MAX_EVENT_CONTENT_CHARS - suffix.length;
  if (content.charCodeAt(end - 1) >= 0xd800 && content.charCodeAt(end - 1) <= 0xdbff) end--;
  return `${content.slice(0, end)}${suffix}`;
}

async function privateStateDirectory(profile: string, configDir = CONFIG_DIR): Promise<string> {
  const base = configDir;
  await mkdir(base, { recursive: true, mode: 0o700 });
  let directory = await realpath(base);
  const profileHash = createHash('sha256').update(profile).digest('hex');
  for (const segment of ['extension-state', profileHash, 'sharepoint']) {
    directory = join(directory, segment);
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid?.()) {
      throw new Error('SharePoint journal storage must be a private, user-owned directory without symlinks');
    }
  }
  return directory;
}

export class SharePointJournal {
  private readonly db: DatabaseSync;
  private closed = false;
  private readonly lease = randomUUID();

  private constructor(private readonly source: SharePointSourceConfig, db: DatabaseSync) {
    this.db = db;
  }

  static async open(profile: string, source: SharePointSourceConfig, configDir = CONFIG_DIR): Promise<SharePointJournal> {
    const directory = await privateStateDirectory(profile, configDir);
    const path = join(directory, `${source.id}.sqlite`);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.mode & 0o077 || info.uid !== process.getuid?.()) {
        throw new Error('Invalid SharePoint journal file');
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await file.close();
    }
    await chmod(path, 0o600);
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL');
      db.exec(`
        CREATE TABLE IF NOT EXISTS journal_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS journal_items (
          item_id TEXT PRIMARY KEY, etag TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
          created_at TEXT NOT NULL, modified_at TEXT NOT NULL, content_snapshot TEXT
        );
        CREATE TABLE IF NOT EXISTS journal_outbox (
          event_key TEXT PRIMARY KEY, observed_at TEXT NOT NULL, item_id TEXT NOT NULL, etag TEXT NOT NULL,
          event_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS journal_lease (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
      `);
      const outboxColumns = db.prepare('PRAGMA table_info(journal_outbox)').all() as { name: string }[];
      if (!outboxColumns.some((column) => column.name === 'etag')) {
        db.exec("ALTER TABLE journal_outbox ADD COLUMN etag TEXT NOT NULL DEFAULT ''");
      }
      const itemColumns = db.prepare('PRAGMA table_info(journal_items)').all() as { name: string }[];
      if (!itemColumns.some((column) => column.name === 'content_snapshot')) {
        db.exec('ALTER TABLE journal_items ADD COLUMN content_snapshot TEXT');
      }
      const binding = JSON.stringify([source.id, source.accountId, source.scopeHash, source.siteUrl, source.siteId, source.listId]);
      const current = db.prepare("SELECT value FROM journal_meta WHERE key = 'binding'").get() as { value?: string } | undefined;
      if (current && current.value !== binding) throw new Error('SharePoint journal binding changed; refusing to reuse another source scope');
      db.prepare("INSERT OR IGNORE INTO journal_meta(key,value) VALUES ('binding',?)").run(binding);
      return new SharePointJournal(source, db);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  static async purge(profile: string, sourceId: string, configDir = CONFIG_DIR): Promise<void> {
    if (!/^sharepoint-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId)) {
      throw new Error('Invalid SharePoint source ID');
    }
    const directory = await privateStateDirectory(profile, configDir);
    // SQLite creates its side files with the process umask; the private directory protects them.
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      const path = join(directory, `${sourceId}.sqlite${suffix}`);
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (!suffix && info.mode & 0o077) || info.uid !== process.getuid?.()) {
          throw new Error('Invalid SharePoint journal file during purge');
        }
        const file = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW);
        await file.close();
        await unlink(path);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
        throw error;
      }
    }
  }

  acquireLease(now = Date.now()): void {
    this.assertOpen();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT owner, expires_at FROM journal_lease WHERE singleton = 1').get() as { owner: string; expires_at: number } | undefined;
      if (row && row.expires_at > now && row.owner !== this.lease) throw new Error('Another SharePoint scan is already running for this source');
      this.db.prepare('INSERT INTO journal_lease(singleton,owner,expires_at) VALUES (1,?,?) ON CONFLICT(singleton) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at')
        .run(this.lease, now + LEASE_MS);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Extends this journal's lease; throws if another scan took it over meanwhile. */
  renewLease(now = Date.now()): void {
    this.assertOpen();
    const result = this.db.prepare('UPDATE journal_lease SET expires_at = ? WHERE singleton = 1 AND owner = ?').run(now + LEASE_MS, this.lease);
    if (Number(result.changes) !== 1) throw new Error('SharePoint scan lease was lost');
  }

  releaseLease(): void {
    this.assertOpen();
    this.db.prepare('DELETE FROM journal_lease WHERE singleton = 1 AND owner = ?').run(this.lease);
  }

  stageSnapshot(snapshot: unknown, now = new Date()): ScrapedItem[] {
    this.assertOpen();
    const rows = checkedRows(snapshot, this.source);
    const observedAt = now.toISOString();
    const observedTime = now.getTime();
    const initialCutoff = observedTime - INITIAL_LOOKBACK_MS;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const baseline = this.db.prepare("SELECT value FROM journal_meta WHERE key = 'baseline_complete'").get() as { value?: string } | undefined;
      const hasBaseline = baseline?.value === 'true';
      const itemQuery = this.db.prepare('SELECT etag,content_snapshot FROM journal_items WHERE item_id = ?');
      const writeItem = this.db.prepare(`
        INSERT INTO journal_items(item_id,etag,title,url,created_at,modified_at,content_snapshot) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(item_id) DO UPDATE SET etag=excluded.etag,title=excluded.title,url=excluded.url,
          created_at=excluded.created_at,modified_at=excluded.modified_at,content_snapshot=excluded.content_snapshot
      `);
      const queueEvent = this.db.prepare('INSERT OR IGNORE INTO journal_outbox(event_key,observed_at,item_id,etag,event_json) VALUES(?,?,?,?,?)');
      for (const item of rows) {
        const previous = hasBaseline ? itemQuery.get(item.id) as { etag: string; content_snapshot: string | null } | undefined : undefined;
        const modifiedTime = Date.parse(item.modifiedAt);
        const shouldQueue = hasBaseline
          ? !previous || previous.etag !== item.etag
          : modifiedTime >= initialCutoff && modifiedTime <= observedTime;
        if (shouldQueue) {
          const eventKind = previous ? 'updated' : 'first-seen';
          const eventFingerprint = createHash('sha256').update(`${this.source.id}\0${item.id}\0${item.etag}`).digest('hex');
          const key = `sharepoint-revision-${eventFingerprint}`;
          const origin: SharePointOrigin = {
            provider: 'sharepoint',
            revisionBasis: 'list-etag-v1',
            eventKind,
            observedAt,
            createdAt: item.createdAt,
            modifiedAt: item.modifiedAt,
            scopeLabel: `${this.source.displayName} · ${this.source.listName}`,
            eventFingerprint,
          };
          const event: ScrapedItem = {
            title: item.title,
            url: item.url,
            datePublished: new Date(item.modifiedAt),
            content: eventContent(eventKind, previous?.content_snapshot ?? null, item.text),
            key,
            sharePointOrigin: origin,
          };
          queueEvent.run(key, observedAt, item.id, item.etag, JSON.stringify({
            ...event,
            datePublished: event.datePublished.toISOString(),
          }));
        }
        writeItem.run(item.id, item.etag, item.title, item.url, item.createdAt, item.modifiedAt, item.text);
      }
      if (!hasBaseline) {
        this.db.prepare("INSERT INTO journal_meta(key,value) VALUES ('baseline_complete','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.pending();
  }

  pending(): ScrapedItem[] {
    this.assertOpen();
    const rows = this.db.prepare('SELECT event_key,item_id,etag,event_json FROM journal_outbox ORDER BY rowid LIMIT ?')
      .all(DELIVERY_BATCH) as { event_key: string; item_id: string; etag: string; event_json: string }[];
    return rows.map(({ event_key, item_id, etag, event_json }) => {
      const fingerprint = createHash('sha256').update(`${this.source.id}\0${item_id}\0${etag}`).digest('hex');
      const parsed = JSON.parse(event_json) as Omit<ScrapedItem, 'datePublished'> & { datePublished: string };
      const origin = parsed.sharePointOrigin;
      const valid = event_key === `sharepoint-revision-${fingerprint}`
        && parsed.key === event_key
        && typeof parsed.title === 'string' && !!parsed.title.trim() && parsed.title.length <= 500
        && withinSite(new URL(parsed.url), new URL(this.source.siteUrl))
        && typeof parsed.content === 'string' && parsed.content.length <= MAX_EVENT_CONTENT_CHARS
        && (origin?.eventKind === 'first-seen'
          ? parsed.content.startsWith('First observed page text (no previous snapshot):\n\n')
          : parsed.content.startsWith('Changes since the previous fetch:')
            || parsed.content.startsWith('No page-text additions or removals detected')
            || parsed.content.startsWith('Previous page-text snapshot unavailable; current page text follows:\n\n'))
        && origin?.provider === 'sharepoint' && origin.revisionBasis === 'list-etag-v1'
        && (origin.eventKind === 'first-seen' || origin.eventKind === 'updated')
        && origin.eventFingerprint === fingerprint
        && typeof origin.scopeLabel === 'string' && origin.scopeLabel.length <= 300
        && origin.scopeLabel.endsWith(` · ${this.source.listName}`)
        && Number.isFinite(Date.parse(origin.createdAt)) && Number.isFinite(Date.parse(origin.modifiedAt))
        && Number.isFinite(Date.parse(origin.observedAt)) && Date.parse(parsed.datePublished) === Date.parse(origin.modifiedAt);
      if (!valid) throw new Error('Invalid event in the SharePoint delivery journal');
      return { ...parsed, datePublished: new Date(parsed.datePublished) };
    });
  }

  acknowledge(key: string): void {
    this.assertOpen();
    if (!/^sharepoint-revision-[a-f0-9]{64}$/.test(key)) throw new Error('Invalid SharePoint event acknowledgment key');
    this.db.prepare('DELETE FROM journal_outbox WHERE event_key = ?').run(key);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('SharePoint journal is closed');
  }
}
