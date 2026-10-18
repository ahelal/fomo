import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export type AuditLevel = 'info' | 'error';

/** One line of the audit trail (stored as JSON lines). */
export interface AuditEntry {
  /** ISO timestamp. */
  ts: string;
  level: AuditLevel;
  /** What happened, e.g. `fetch`, `status`, `config`. */
  action: string;
  detail?: string;
}

/** Records user actions and errors; never throws (auditing must not break the UI). */
export interface AuditLog {
  log(action: string, detail?: string): void;
  error(action: string, err: unknown): void;
  /** Newest entries first. */
  recent(limit?: number): AuditEntry[];
  /** Called after each new entry; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export const DEFAULT_AUDIT_MAX_BYTES = 1024 * 1024;
const MAX_DETAIL = 2000;

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Hide account keys and SAS signatures that may appear in error messages. */
export function redact(text: string): string {
  return text
    .replace(/\b(AccountKey|SharedAccessSignature)=[^;\s]+/gi, '$1=***')
    .replace(/([?&#;]sig=)[^&;\s]+/gi, '$1***');
}

function entry(level: AuditLevel, action: string, detail?: string): AuditEntry {
  const clean = detail === undefined ? undefined : redact(detail).slice(0, MAX_DETAIL);
  return { ts: new Date().toISOString(), level, action, ...(clean ? { detail: clean } : {}) };
}

function parseLines(text: string): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as AuditEntry;
      if (e && typeof e.ts === 'string' && typeof e.action === 'string') out.push(e);
    } catch {
      // skip a damaged line
    }
  }
  return out;
}

function createListeners() {
  const listeners = new Set<() => void>();
  return {
    notify: () => listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } }),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

/**
 * Audit trail in `file` (JSON lines). When it grows past `maxBytes` it moves to `<file>.1`
 * (replacing the previous one), so at most two files are kept.
 */
export function createAuditLog(file: string, { maxBytes = DEFAULT_AUDIT_MAX_BYTES } = {}): AuditLog {
  const rotated = `${file}.1`;
  const { notify, subscribe } = createListeners();
  let size = 0;
  try {
    mkdirSync(dirname(file), { recursive: true });
    size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  } catch {
    // ignore
  }

  const write = (e: AuditEntry) => {
    const line = `${JSON.stringify(e)}\n`;
    try {
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) {
        renameSync(file, rotated);
        size = 0;
      }
      appendFileSync(file, line);
      size += Buffer.byteLength(line);
    } catch {
      // ignore
    }
    notify();
  };

  const read = (path: string) => {
    try {
      return parseLines(readFileSync(path, 'utf-8'));
    } catch {
      return [];
    }
  };

  return {
    log: (action, detail) => write(entry('info', action, detail)),
    error: (action, err) => write(entry('error', action, errorText(err))),
    recent: (limit = 500) => {
      let entries = read(file);
      if (entries.length < limit) entries = [...read(rotated), ...entries];
      return entries.slice(-limit).reverse();
    },
    subscribe,
  };
}

/** In-memory audit log (tests, and when no file is configured). */
export function createMemoryAuditLog(): AuditLog & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  const { notify, subscribe } = createListeners();
  const add = (e: AuditEntry) => { entries.push(e); notify(); };
  return {
    entries,
    log: (action, detail) => add(entry('info', action, detail)),
    error: (action, err) => add(entry('error', action, errorText(err))),
    recent: (limit = 500) => entries.slice(-limit).reverse(),
    subscribe,
  };
}
