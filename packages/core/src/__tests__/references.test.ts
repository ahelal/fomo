import { describe, it, expect } from 'vitest';
import { buildReferenceRows, matchesReference, normalizeReferenceUrl, referenceFolders } from '../references.js';
import { parentRowIndex, rowFolder } from '../folders.js';
import { ReferenceStore } from '../store/references.js';
import { buildReferencePrompt, parseReferenceSuggestion } from '../digest/reference.js';
import type { Reference } from '../types.js';

function ref(id: string, title: string, folder: string, extra: Partial<Reference> = {}): Reference {
  return { id, title, url: `https://example.com/${id}`, folder, description: '', createdAt: 't', updatedAt: 't', ...extra };
}

describe('referenceFolders', () => {
  it('lists every folder in use with its ancestors', () => {
    expect(referenceFolders([{ folder: 'b/x' }, { folder: '' }, { folder: 'a' }, { folder: 'b/x' }])).toEqual(['a', 'b', 'b/x']);
  });
});

describe('normalizeReferenceUrl', () => {
  it('accepts http(s) links only', () => {
    expect(normalizeReferenceUrl('  https://example.com/a ')).toBe('https://example.com/a');
    expect(() => normalizeReferenceUrl('example.com')).toThrow(/full URL/);
    expect(() => normalizeReferenceUrl('javascript:alert(1)')).toThrow(/http/);
  });
});

describe('buildReferenceRows', () => {
  const refs = [
    ref('1', 'Zed', ''),
    ref('2', 'agents guide', 'ai/agents'),
    ref('3', 'Prompting', 'ai'),
    ref('4', 'Bicep', 'azure', { description: 'infra as code' }),
  ];

  it('lists folders before links and only opens expanded folders', () => {
    const rows = buildReferenceRows(refs, new Set(['ai']));
    expect(rows.map((r) => (r.kind === 'folder' ? `${r.depth}:${r.name}/${r.count}${r.open ? '+' : ''}` : `${r.depth}:${r.item.title}`))).toEqual([
      '0:ai/2+',
      '1:agents/1',
      '1:Prompting',
      '0:azure/1',
      '0:Zed',
    ]);
    expect(rowFolder(rows[2])).toBe('ai');
    expect(rowFolder(rows[1])).toBe('ai/agents');
    expect(parentRowIndex(rows, 2)).toBe(0);
    expect(parentRowIndex(rows, 0)).toBe(-1);
  });

  it('shows only matches, with their folders opened, when searching', () => {
    const rows = buildReferenceRows(refs, new Set(), 'infra');
    expect(rows.map((r) => r.key)).toEqual(['folder:azure', 'ref:4']);
    expect(matchesReference(refs[1]!, 'AI guide')).toBe(true);
    expect(matchesReference(refs[1]!, 'guide bicep')).toBe(false);
  });
});

describe('reference suggestion', () => {
  it('lists existing folders in the prompt', () => {
    const req = buildReferencePrompt({ url: 'https://x.dev', text: 'Body', folders: ['ai', 'azure'] });
    expect(req.prompt).toContain('EXISTING FOLDERS:\n- ai\n- azure');
    expect(req.prompt).toContain('TITLE: (unknown)');
    expect(req.effort).toBe('low');
  });

  it('cleans the reply and rejects an empty one', () => {
    expect(parseReferenceSuggestion({ title: ' T ', folder: 'ai//agents/', description: ' What\nit is. ' })).toEqual({
      title: 'T',
      folder: 'ai/agents',
      description: 'What it is.',
    });
    expect(() => parseReferenceSuggestion({ title: 'only' })).toThrow(/no suggestion/);
  });
});

describe('ReferenceStore', () => {
  const conn = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=dGVzdA==;TableEndpoint=http://localhost:10002/devstoreaccount1;';

  function storeWith(rows: Record<string, unknown>[]) {
    const store = new ReferenceStore(conn as any);
    const calls = { created: [] as any[], updated: [] as any[] };
    (store as any).client = {
      listEntities: ({ queryOptions }: { queryOptions: { filter: string } }) =>
        (async function* () {
          const m = queryOptions.filter.match(/url eq '([^']*)'/);
          for (const r of rows) if (!m || r.url === m[1]) yield r;
        })(),
      createEntity: async (e: any) => { calls.created.push(e); },
      updateEntity: async (e: any, mode: string) => { calls.updated.push({ ...e, mode }); },
    };
    return { store, calls };
  }

  const row = (rowKey: string, folder: string, url = `https://example.com/${rowKey}`) => ({
    partitionKey: 'ref', rowKey, title: rowKey, url, folder, description: '', updateId: '', createdAt: 't', updatedAt: 't',
  });

  it('creates a reference with a clean folder and the URL as fallback title', async () => {
    const { store, calls } = storeWith([]);
    const created = await store.createReference({ title: '  ', url: 'https://example.com/new', folder: ' ai / agents ', updateId: 'github__1' });
    expect(created).toMatchObject({ title: 'https://example.com/new', folder: 'ai/agents', updateId: 'github__1' });
    expect(calls.created[0]).toMatchObject({ partitionKey: 'ref', folder: 'ai/agents' });
  });

  it('refuses a URL that is already filed', async () => {
    const { store } = storeWith([row('a', 'ai', 'https://example.com/dup')]);
    await expect(store.createReference({ title: 'x', url: 'https://example.com/dup' })).rejects.toThrow('Already in Bookmarks (ai): a');
  });

  it('keeps a clean color, or none', async () => {
    const { store, calls } = storeWith([]);
    const created = await store.createReference({ title: 'T', url: 'https://example.com/c', color: '#ABC' });
    expect(created.color).toBe('#aabbcc');
    expect(calls.created[0].color).toBe('#aabbcc');
    const plain = await store.createReference({ title: 'P', url: 'https://example.com/p' });
    expect(plain).not.toHaveProperty('color');
    await expect(store.createReference({ title: 'B', url: 'https://example.com/b', color: 'blue' })).rejects.toThrow(/Not a color/);
  });

  it('moves a folder with its subfolders', async () => {
    const { store, calls } = storeWith([row('a', 'ai'), row('b', 'ai/agents'), row('c', 'aids'), row('d', '')]);
    expect(await store.moveFolder('ai', 'ml')).toBe(2);
    expect(calls.updated.map((u) => `${u.rowKey}:${u.folder}:${u.mode}`)).toEqual(['a:ml:Merge', 'b:ml/agents:Merge']);
    await expect(store.moveFolder('ai', 'ai/sub')).rejects.toThrow(/into itself/);
  });
});
