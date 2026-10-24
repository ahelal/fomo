import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { RequestOptions } from 'node:https';
import { httpText } from '../src/extensions/http.js';

type Response = PassThrough & { statusCode: number; headers: Record<string, string> };
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn<(url: URL, options: RequestOptions, callback: (response: Response) => void) => EventEmitter & { end(): void }>(),
}));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
const origins = ['https://news.example'];
const signal = () => new AbortController().signal;
let responses: { status: number; location?: string; chunks: string[] }[];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  responses = [{ status: 200, chunks: ['hello'] }];
  mocks.request.mockImplementation((_url, _options, callback) => Object.assign(new EventEmitter(), {
    end() {
      queueMicrotask(() => {
        const next = responses.shift()!;
        const response = Object.assign(new PassThrough(), { statusCode: next.status, headers: next.location ? { location: next.location } : {} });
        callback(response);
        for (const chunk of next.chunks) response.write(chunk);
        response.end();
      });
    },
  }));
});

describe('extension HTTP broker', () => {
  it('rejects unapproved origins, schemes, credentials and cancelled work before DNS', async () => {
    for (const url of ['http://news.example/', 'https://private.example/', 'https://user:password@news.example/']) {
      await expect(httpText(url, origins, signal())).rejects.toThrow();
    }
    await expect(httpText(origins[0], origins, AbortSignal.abort(new Error('revoked')))).rejects.toThrow('revoked');
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('rejects a mixed public/private DNS answer without opening a connection', async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    await expect(httpText(origins[0], origins, signal())).rejects.toThrow('non-public');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('pins the verified address and family for TLS rather than resolving again', async () => {
    expect(await httpText(origins[0], origins, signal())).toBe('hello');
    const options = mocks.request.mock.calls[0][1];
    expect(options).toMatchObject({ family: 4, agent: false, method: 'GET' });
    const resolved = vi.fn();
    options.lookup!('news.example', { family: 4 }, resolved);
    expect(resolved).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(mocks.lookup).toHaveBeenCalledOnce();
  });

  it('rechecks both origin and DNS on every redirect', async () => {
    responses = [{ status: 302, location: 'https://not-granted.example/', chunks: [] }];
    await expect(httpText(origins[0], origins, signal())).rejects.toThrow('not granted');
    expect(mocks.request).toHaveBeenCalledOnce();
    responses = [{ status: 302, location: '/next', chunks: [] }];
    mocks.lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
    await expect(httpText(origins[0], origins, signal())).rejects.toThrow('non-public');
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('bounds response bytes and surfaces HTTP errors', async () => {
    responses = [{ status: 200, chunks: ['x'.repeat(4 * 1024 * 1024), 'x'] }];
    await expect(httpText(origins[0], origins, signal())).rejects.toThrow('exceeds 4 MiB');
    responses = [{ status: 503, chunks: [] }];
    await expect(httpText(origins[0], origins, signal())).rejects.toThrow('HTTP 503');
  });
});
