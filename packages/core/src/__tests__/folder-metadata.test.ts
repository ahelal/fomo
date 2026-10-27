import { describe, expect, it } from 'vitest';
import { FolderMetadataStore } from '../store/folder-metadata.js';

const conn = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=dGVzdA==;TableEndpoint=http://localhost:10002/devstoreaccount1;';

function storeWithData(initial?: string) {
  const store = new FolderMetadataStore(conn, 'todos');
  let entity: Record<string, unknown> | undefined = initial === undefined
    ? undefined
    : { partitionKey: 'folder', rowKey: 'metadata', data: initial, etag: 'e1' };
  (store as unknown as { client: unknown }).client = {
    getEntity: async () => {
      if (!entity) throw { statusCode: 404 };
      return entity;
    },
    createEntity: async (next: Record<string, unknown>) => { entity = { ...next, etag: 'e1' }; },
    updateEntity: async (next: Record<string, unknown>) => { entity = { ...next, etag: 'e2' }; },
  };
  return { store, read: () => entity };
}

describe('FolderMetadataStore', () => {
  it('normalizes and persists metadata without needing a folder item', async () => {
    const { store, read } = storeWithData();
    expect(await store.set(' work/fomo ', { localPath: ' ~/src/fomo ', githubRepo: 'https://github.com/owner/fomo' }))
      .toEqual({ 'work/fomo': { localPath: '~/src/fomo', githubRepo: 'owner/fomo' } });
    expect(read()).toMatchObject({ partitionKey: 'folder', rowKey: 'metadata' });
    expect(await store.get()).toEqual({ 'work/fomo': { localPath: '~/src/fomo', githubRepo: 'owner/fomo' } });
  });

  it('clears metadata and rejects top-level associations', async () => {
    const { store } = storeWithData();
    await store.set('work', { localPath: '~/work' });
    expect(await store.set('work', {})).toEqual({});
    expect(() => store.set('', { localPath: '~/work' })).toThrow(/top level/);
  });

  it('moves nested metadata and rejects malformed stored data', async () => {
    const { store } = storeWithData();
    await store.set('work', { localPath: '~/work' });
    await store.set('work/eng', { githubRepo: 'owner/eng' });
    expect(await store.move('work', 'projects')).toEqual({
      projects: { localPath: '~/work' },
      'projects/eng': { githubRepo: 'owner/eng' },
    });

    const corrupted = storeWithData('not-json');
    await expect(corrupted.store.get()).rejects.toThrow(/Invalid folder metadata/);
  });

  it('checks for conflicts before a folder is moved', async () => {
    const { store } = storeWithData();
    await store.set('work', { localPath: '~/work' });
    await store.set('projects', { localPath: '~/projects' });
    await expect(store.assertCanMove('work', 'projects')).rejects.toThrow(/Conflicting metadata/);
  });
});
