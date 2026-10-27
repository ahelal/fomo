import type { TableClient, TableEntity } from '@azure/data-tables';
import { createTableClient } from './connection.js';
import { isTableError } from './tables.js';
import { deleteFolderEntries, moveFolderColors, setFolderColor } from '../folders.js';
import { normalizeHexColor } from '../colors.js';
import type { DeleteFolderMode, FolderColorMap, StoreConnection } from '../types.js';

/** The colors live in one row beside the items, outside their partition (`todo`, `ref`). */
const COLORS_PK = 'folder';
const COLORS_RK = 'colors';
/** Writes retried when another device changed the colors in between. */
const ATTEMPTS = 4;

type ColorsEntity = TableEntity<{ data: string }>;

function parseColors(data: string | undefined): FolderColorMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data ?? '{}');
  } catch {
    return {};
  }
  const colors: FolderColorMap = {};
  if (parsed && typeof parsed === 'object') {
    for (const [path, color] of Object.entries(parsed)) {
      const hex = typeof color === 'string' ? normalizeHexColor(color) : undefined;
      if (path && hex) colors[path] = hex;
    }
  }
  return colors;
}

/** Folder colors of one folder tree (the `todos` or `references` table). */
export class FolderColorStore {
  private readonly client: TableClient;

  constructor(conn: StoreConnection, table: string) {
    this.client = createTableClient(conn, table);
  }

  async get(): Promise<FolderColorMap> {
    return (await this.read()).colors;
  }

  /** Color `folder` (`''` clears it); returns every folder color. */
  set(folder: string, color: string): Promise<FolderColorMap> {
    return this.change((colors) => setFolderColor(colors, folder, color));
  }

  /** Carry the colors of folder `from` (and its subfolders) over to `to`. */
  move(from: string, to: string): Promise<FolderColorMap> {
    return this.change((colors) => moveFolderColors(colors, from, to));
  }

  /** Drop the colors of deleted folder `path` (see `DeleteFolderMode`). */
  delete(path: string, mode: DeleteFolderMode): Promise<FolderColorMap> {
    return this.change((colors) => deleteFolderEntries(colors, path, mode, moveFolderColors));
  }

  private async read(): Promise<{ colors: FolderColorMap; etag?: string }> {
    try {
      const entity = await this.client.getEntity<ColorsEntity>(COLORS_PK, COLORS_RK);
      return { colors: parseColors(entity.data), etag: entity.etag };
    } catch (err: unknown) {
      if (isTableError(err, 404)) return { colors: {} };
      throw err;
    }
  }

  private async change(update: (colors: FolderColorMap) => FolderColorMap): Promise<FolderColorMap> {
    for (let attempt = 1; ; attempt++) {
      const { colors, etag } = await this.read();
      const next = update(colors);
      if (JSON.stringify(next) === JSON.stringify(colors)) return colors;
      const entity: ColorsEntity = { partitionKey: COLORS_PK, rowKey: COLORS_RK, data: JSON.stringify(next) };
      try {
        if (etag) await this.client.updateEntity(entity, 'Replace', { etag });
        else await this.client.createEntity(entity);
        return next;
      } catch (err: unknown) {
        // 412: changed since it was read; 409: created meanwhile.
        if (attempt < ATTEMPTS && (isTableError(err, 412) || isTableError(err, 409))) continue;
        throw err;
      }
    }
  }
}
