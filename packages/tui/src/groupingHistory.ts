import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DigestInspection } from '@fomo/core/digest';
import { CONFIG_DIR } from './config.js';

export interface GroupingHistory {
  list(): string[];
  read(id: string): DigestInspection;
  save(inspection: DigestInspection): string;
}

function validInspection(value: unknown): value is DigestInspection {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return typeof data.startedAt === 'string' && Number.isFinite(Date.parse(data.startedAt))
    && typeof data.guidance === 'string'
    && Array.isArray(data.items) && data.items.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      return 'id' in item && typeof item.id === 'string' && 'title' in item && typeof item.title === 'string';
    })
    && Array.isArray(data.calls) && data.calls.every((call: unknown) => {
      if (!call || typeof call !== 'object') return false;
      const entry = call as Record<string, unknown>;
      return typeof entry.label === 'string' && typeof entry.system === 'string' && typeof entry.prompt === 'string'
        && ['running', 'complete', 'failed'].includes(String(entry.state))
        && (entry.error === undefined || typeof entry.error === 'string')
        && (entry.groups === undefined || (Array.isArray(entry.groups) && entry.groups.every((group: unknown) => {
          if (!group || typeof group !== 'object') return false;
          const g = group as Record<string, unknown>;
          return typeof g.title === 'string' && Array.isArray(g.itemIds) && g.itemIds.every((id: unknown) => typeof id === 'string')
            && (g.rationale === undefined || typeof g.rationale === 'string');
        })));
    });
}

/** One atomic, private snapshot per run. Profile names never become filesystem paths. */
export function createGroupingHistory(profile: string, directory = CONFIG_DIR): GroupingHistory {
  const folder = join(directory, 'grouping-runs', Buffer.from(profile).toString('base64url'));
  const pathFor = (id: string) => {
    if (!/^\d{13}-[a-f0-9]{16}\.json$/.test(id)) throw new Error('Invalid grouping run id');
    return join(folder, id);
  };
  return {
    list() {
      try {
        return readdirSync(folder).filter((name) => /^\d{13}-[a-f0-9]{16}\.json$/.test(name)).sort().reverse();
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return [];
        throw err;
      }
    },
    read(id) {
      const data: unknown = JSON.parse(readFileSync(pathFor(id), 'utf8'));
      if (!validInspection(data)) throw new Error(`Invalid grouping history snapshot: ${id}`);
      return data;
    },
    save(inspection) {
      if (!validInspection(inspection)) throw new Error('Invalid grouping inspection snapshot');
      const hash = createHash('sha256').update(inspection.startedAt).digest('hex').slice(0, 16);
      const id = `${Date.parse(inspection.startedAt).toString().padStart(13, '0')}-${hash}.json`;
      const target = pathFor(id);
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const temporary = join(folder, `${id}.${randomUUID()}.tmp`);
      writeFileSync(temporary, JSON.stringify(inspection), { mode: 0o600, flag: 'wx' });
      try {
        renameSync(temporary, target);
      } catch (err) {
        unlinkSync(temporary);
        throw err;
      }
      return id;
    },
  };
}
