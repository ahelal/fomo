import { describe, it, expect } from 'vitest';
import {
  buildConnectLink,
  parseConnectLink,
  normalizeConnectionString,
  parseConnectionString,
  sasExpiry,
  isSasConnection,
} from '../store/connection.js';

describe('parseConnectionString', () => {
  it('derives the table endpoint from account name + suffix', () => {
    const parsed = parseConnectionString(
      'DefaultEndpointsProtocol=https;AccountName=fomoabc;AccountKey=a2V5PT0=;EndpointSuffix=core.windows.net',
    );
    expect(parsed).toEqual({
      accountName: 'fomoabc',
      accountKey: 'a2V5PT0=',
      tableEndpoint: 'https://fomoabc.table.core.windows.net',
    });
  });

  it('prefers an explicit TableEndpoint (Azurite)', () => {
    const parsed = parseConnectionString(
      'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=k==;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1/;',
    );
    expect(parsed.tableEndpoint).toBe('http://127.0.0.1:10002/devstoreaccount1');
  });

  it('expands UseDevelopmentStorage=true to the Azurite account', () => {
    const parsed = parseConnectionString('UseDevelopmentStorage=true');
    expect(parsed.accountName).toBe('devstoreaccount1');
    expect(parsed.tableEndpoint).toBe('http://127.0.0.1:10002/devstoreaccount1');
    expect(normalizeConnectionString('AccountName=a;AccountKey=b')).toBe('AccountName=a;AccountKey=b');
  });

  it('throws without a key', () => {
    expect(() => parseConnectionString('AccountName=x')).toThrow(/AccountKey/);
  });
});

describe('connect link', () => {
  const conn = {
    tableEndpoint: 'https://fomoabc.table.core.windows.net',
    sas: 'sv=2020-12-06&ss=t&srt=o&sp=rwdau&se=2027-01-01T00%3A00%3A00Z&spr=https&sig=abc%2Bdef%3D',
  };

  it('round-trips through the URL fragment', () => {
    const link = buildConnectLink('https://fomoabc.z1.web.core.windows.net', conn);
    expect(link.startsWith('https://fomoabc.z1.web.core.windows.net/#endpoint=')).toBe(true);
    expect(parseConnectLink(link)).toEqual(conn);
  });

  it('accepts just the hash and strips a leading ? from the sas', () => {
    const link = buildConnectLink('https://site/', { ...conn, sas: `?${conn.sas}` });
    expect(parseConnectLink(link.slice(link.indexOf('#')))).toEqual(conn);
  });

  it('rejects unrelated fragments', () => {
    expect(parseConnectLink('https://site/#section-2')).toBeUndefined();
    expect(parseConnectLink('#endpoint=javascript:alert(1)&sas=x')).toBeUndefined();
  });

  it('reads the sas expiry', () => {
    expect(sasExpiry(conn.sas)?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(sasExpiry('sv=1')).toBeUndefined();
  });

  it('distinguishes SAS from connection strings', () => {
    expect(isSasConnection(conn)).toBe(true);
    expect(isSasConnection('AccountName=x;AccountKey=y')).toBe(false);
  });
});

describe('createWebSas', () => {
  it('signs an object-only table SAS for the account endpoint', async () => {
    const { createWebSas } = await import('../store/sas.js');
    const now = new Date('2026-01-01T00:00:00Z');
    const result = createWebSas(
      'DefaultEndpointsProtocol=https;AccountName=fomoabc;AccountKey=a2V5a2V5a2V5a2V5;EndpointSuffix=core.windows.net',
      { days: 30, now },
    );
    const params = new URLSearchParams(result.sas);
    expect(result.tableEndpoint).toBe('https://fomoabc.table.core.windows.net');
    expect(params.get('ss')).toBe('t');
    expect(params.get('srt')).toBe('o');
    expect([...params.get('sp')!].sort().join('')).toBe('adru');
    expect(params.get('spr')).toBe('https');
    expect(params.get('sig')).toBeTruthy();
    expect(result.expiresOn.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(sasExpiry(result.sas)?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('allows http and container-level queries for the local emulator (Azurite)', async () => {
    const { createWebSas } = await import('../store/sas.js');
    const result = createWebSas('UseDevelopmentStorage=true');
    const params = new URLSearchParams(result.sas);
    expect(result.tableEndpoint).toBe('http://127.0.0.1:10002/devstoreaccount1');
    expect(params.get('srt')).toBe('co');
    expect(params.get('spr')).toBe('https,http');
  });
});
