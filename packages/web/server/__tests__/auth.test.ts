import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  sessionAuth,
  createSessionCookie,
  verifySessionCookie,
  SESSION_COOKIE,
} from '../middleware/auth.js';

const SECRET = 'test-session-secret-that-is-long-enough';

describe('session cookie signing', () => {
  it('creates and verifies a valid cookie', () => {
    const cookie = createSessionCookie('alice@example.com', SECRET, 3600);
    const result = verifySessionCookie(cookie, SECRET);
    expect(result).not.toBeNull();
    expect(result!.email).toBe('alice@example.com');
  });

  it('rejects a cookie signed with a different secret', () => {
    const cookie = createSessionCookie('alice@example.com', SECRET, 3600);
    const result = verifySessionCookie(cookie, 'wrong-secret');
    expect(result).toBeNull();
  });

  it('rejects an expired cookie', () => {
    const cookie = createSessionCookie('alice@example.com', SECRET, -1);
    const result = verifySessionCookie(cookie, SECRET);
    expect(result).toBeNull();
  });

  it('rejects malformed cookie values', () => {
    expect(verifySessionCookie('garbage', SECRET)).toBeNull();
    expect(verifySessionCookie('', SECRET)).toBeNull();
    expect(verifySessionCookie('a.b.c', SECRET)).toBeNull();
  });
});

describe('sessionAuth middleware', () => {
  function createApp() {
    const app = new Hono();
    app.use('/protected/*', sessionAuth(SECRET));
    app.get('/protected/data', (c) => c.json({ ok: true }));
    app.get('/public', (c) => c.json({ ok: true }));
    return app;
  }

  it('allows requests with valid session cookie', async () => {
    const app = createApp();
    const cookie = createSessionCookie('alice@example.com', SECRET, 3600);
    const res = await app.request('/protected/data', {
      headers: { Cookie: `${SESSION_COOKIE}=${cookie}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects requests without session cookie (JSON)', async () => {
    const app = createApp();
    const res = await app.request('/protected/data', {
      headers: { Accept: 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('redirects browser requests without session cookie', async () => {
    const app = createApp();
    const res = await app.request('/protected/data', {
      headers: { Accept: 'text/html' },
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/auth/login');
  });

  it('rejects requests with invalid cookie', async () => {
    const app = createApp();
    const res = await app.request('/protected/data', {
      headers: {
        Cookie: `${SESSION_COOKIE}=bad-value`,
        Accept: 'application/json',
      },
    });
    expect(res.status).toBe(401);
  });

  it('does not affect unprotected routes', async () => {
    const app = createApp();
    const res = await app.request('/public');
    expect(res.status).toBe(200);
  });
});
