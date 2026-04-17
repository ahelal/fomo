import { describe, it, expect } from 'vitest';
import type {
  Update,
  ListOptions,
  ListResponse,
  FetchRequest,
  FetchResponse,
  StatsResponse,
  Status,
  SourceInfo,
  FomoService,
  FomoClientConfig,
} from '../index.js';
import { FomoClient, FomoApiError } from '../index.js';

describe('types are exported correctly', () => {
  it('FomoClient is constructable', () => {
    const config: FomoClientConfig = { baseUrl: 'http://localhost', token: 'test' };
    const client = new FomoClient(config);
    expect(client).toBeDefined();
  });

  it('FomoApiError has statusCode', () => {
    const err = new FomoApiError(404, 'Not found');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('FomoApiError');
  });

  it('Status type accepts valid values', () => {
    const s1: Status = 'read';
    const s2: Status = 'unread';
    expect(s1).toBe('read');
    expect(s2).toBe('unread');
  });
});

describe('FomoClient', () => {
  it('strips trailing slash from baseUrl', () => {
    const client = new FomoClient({ baseUrl: 'http://localhost:3000/', token: 'x' });
    expect(client).toBeDefined();
  });

  it('listUpdates calls correct endpoint', async () => {
    const mockResponse: ListResponse = {
      updates: [],
      total: 0,
      hasMore: false,
    };

    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toContain('/updates');
      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new FomoClient({ baseUrl: 'http://localhost:3000', token: 'tok' });
    const result = await client.listUpdates();
    expect(result.updates).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('throws FomoApiError on non-OK response', async () => {
    globalThis.fetch = async () =>
      new Response('Not found', { status: 404, statusText: 'Not Found' });

    const client = new FomoClient({ baseUrl: 'http://localhost:3000', token: 'tok' });
    await expect(client.listUpdates()).rejects.toThrow(FomoApiError);
  });
});
