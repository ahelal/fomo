import { describe, it, expect } from 'vitest';
import { makeId, parseId } from '../store/tables.js';

describe('makeId / parseId', () => {
  it('creates a deterministic id from source + url', () => {
    const id1 = makeId('github', 'https://example.com/a');
    const id2 = makeId('github', 'https://example.com/a');
    expect(id1).toBe(id2);
  });

  it('different urls produce different ids', () => {
    const id1 = makeId('github', 'https://example.com/a');
    const id2 = makeId('github', 'https://example.com/b');
    expect(id1).not.toBe(id2);
  });

  it('id starts with source prefix', () => {
    const id = makeId('azure', 'https://example.com/x');
    expect(id.startsWith('azure__')).toBe(true);
  });

  it('parseId round-trips source correctly', () => {
    const id = makeId('vscode', 'https://example.com/release');
    const parsed = parseId(id);
    expect(parsed.source).toBe('vscode');
    expect(parsed.rowKey).toHaveLength(32);
  });

  it('parseId throws on invalid id', () => {
    expect(() => parseId('nope')).toThrow('Invalid update id');
  });
});
