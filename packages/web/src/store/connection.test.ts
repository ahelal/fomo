import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildConnectLink } from '@fomo/core';
import {
  clearConnection,
  consumeConnectLink,
  daysUntilExpiry,
  loadConnection,
  saveConnection,
} from './connection.js';

const conn = {
  tableEndpoint: 'https://acct.table.core.windows.net',
  sas: 'sv=2024-11-04&ss=t&srt=o&sp=raud&se=2030-01-31T00:00:00Z&sig=abc%2B%3D',
};

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

describe('web connection store', () => {
  let replaceState: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    replaceState = vi.fn();
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('window', {
      location: { hash: '', pathname: '/app/', search: '?x=1' },
      history: { replaceState },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('round-trips a connection through localStorage', () => {
    expect(loadConnection()).toBeUndefined();
    saveConnection(conn);
    expect(loadConnection()).toEqual(conn);
    clearConnection();
    expect(loadConnection()).toBeUndefined();
  });

  it('ignores corrupt stored values', () => {
    localStorage.setItem('fomo.connection', '{not json');
    expect(loadConnection()).toBeUndefined();
    localStorage.setItem('fomo.connection', JSON.stringify({ tableEndpoint: 1 }));
    expect(loadConnection()).toBeUndefined();
  });

  it('consumes a magic link, stores it and strips the fragment', () => {
    const link = buildConnectLink('https://example.com/app/', conn);
    (window.location as { hash: string }).hash = new URL(link).hash;

    expect(consumeConnectLink()).toEqual(conn);
    expect(loadConnection()).toEqual(conn);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app/?x=1');
  });

  it('does nothing without a magic link', () => {
    (window.location as { hash: string }).hash = '#other';
    expect(consumeConnectLink()).toBeUndefined();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('computes days until SAS expiry', () => {
    const now = Date.parse('2030-01-01T00:00:00Z');
    expect(daysUntilExpiry(conn, now)).toBe(30);
    expect(daysUntilExpiry(conn, Date.parse('2030-02-02T00:00:00Z'))).toBeLessThan(0);
    expect(daysUntilExpiry({ ...conn, sas: 'sig=abc' }, now)).toBeUndefined();
  });
});
