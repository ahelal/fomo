import { createHmac, timingSafeEqual } from 'node:crypto';
import { createMiddleware } from 'hono/factory';

export const SESSION_COOKIE = 'fomo_session';

// ─── Cookie signing ────────────────────────────────────────────────────────

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function createSessionCookie(email: string, secret: string, maxAge: number): string {
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const data = Buffer.from(JSON.stringify({ email, exp })).toString('base64url');
  const sig = sign(data, secret);
  return `${data}.${sig}`;
}

export function verifySessionCookie(
  cookie: string,
  secret: string,
): { email: string; exp: number } | null {
  const dotIdx = cookie.lastIndexOf('.');
  if (dotIdx === -1) return null;

  const data = cookie.slice(0, dotIdx);
  const sig = cookie.slice(dotIdx + 1);

  const expected = sign(data, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
    if (!parsed.email || !parsed.exp) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── Middleware ─────────────────────────────────────────────────────────────

/**
 * Session-cookie authentication middleware.
 * Rejects API requests (Accept: application/json) with 401.
 * Redirects browser requests to /auth/login.
 */
export function sessionAuth(secret: string) {
  return createMiddleware(async (c, next) => {
    const raw = getCookie(c.req.raw, SESSION_COOKIE);
    if (!raw) return deny(c);

    const session = verifySessionCookie(raw, secret);
    if (!session) return deny(c);

    c.set('userEmail' as never, session.email);
    await next();
  });
}

function deny(c: import('hono').Context) {
  const accept = c.req.header('Accept') ?? '';
  if (accept.includes('application/json')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return c.redirect('/auth/login');
}

function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('Cookie');
  if (!header) return undefined;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}
