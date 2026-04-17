import { Hono } from 'hono';
import { createSessionCookie, verifySessionCookie, SESSION_COOKIE } from '../middleware/auth.js';

interface AuthConfig {
  googleClientId: string;
  googleClientSecret: string;
  sessionSecret: string;
  sessionMaxAge: number;
  allowedUsers: Set<string>;
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

function getRedirectUri(req: Request): string {
  const url = new URL(req.url);
  // Use X-Forwarded headers if behind a reverse proxy (Azure Container Apps)
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  return `${proto}://${host}/auth/callback`;
}

export function authRouter(cfg: AuthConfig) {
  const router = new Hono();

  // GET /auth/login — redirect to Google consent screen
  router.get('/login', (c) => {
    const redirectUri = getRedirectUri(c.req.raw);
    const params = new URLSearchParams({
      client_id: cfg.googleClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
    });
    return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  // GET /auth/callback — exchange code for tokens, verify email, set cookie
  router.get('/callback', async (c) => {
    const code = c.req.query('code');
    const error = c.req.query('error');

    if (error || !code) {
      return c.html(errorPage('Login cancelled or failed.'), 403);
    }

    const redirectUri = getRedirectUri(c.req.raw);

    // Exchange authorization code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.googleClientId,
        client_secret: cfg.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      console.error('[auth] token exchange failed:', await tokenRes.text());
      return c.html(errorPage('Failed to exchange authorization code.'), 500);
    }

    const tokens = (await tokenRes.json()) as { access_token: string };

    // Get user info
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      console.error('[auth] userinfo failed:', await userRes.text());
      return c.html(errorPage('Failed to retrieve user info.'), 500);
    }

    const user = (await userRes.json()) as { email?: string; name?: string };
    const email = user.email?.toLowerCase();

    if (!email) {
      return c.html(errorPage('Google account has no email address.'), 403);
    }

    // Check allowlist
    if (cfg.allowedUsers.size > 0 && !cfg.allowedUsers.has(email)) {
      console.warn(`[auth] denied: ${email} not in allowed users`);
      return c.html(errorPage(`Access denied for ${email}. Contact the administrator.`), 403);
    }

    // Create session cookie
    const cookie = createSessionCookie(email, cfg.sessionSecret, cfg.sessionMaxAge);
    const secure = c.req.url.startsWith('https') ||
      c.req.header('x-forwarded-proto') === 'https';

    c.header(
      'Set-Cookie',
      `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cfg.sessionMaxAge}${secure ? '; Secure' : ''}`,
    );

    return c.redirect('/');
  });

  // GET /auth/logout — clear session cookie
  router.get('/logout', (c) => {
    c.header(
      'Set-Cookie',
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    return c.redirect('/auth/login');
  });

  // GET /auth/me — return current session user (for the SPA)
  router.get('/me', (c) => {
    const raw = c.req.raw.headers.get('Cookie');
    const match = raw?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`));
    const cookieVal = match?.[1];

    if (!cookieVal) return c.json({ error: 'Not authenticated' }, 401);

    const session = verifySessionCookie(cookieVal, cfg.sessionSecret);
    if (!session) return c.json({ error: 'Invalid session' }, 401);

    return c.json({ email: session.email });
  });

  return router;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>FOMO — Access Denied</title>
<style>
  body { background: #0d1117; color: #c9d1d9; font-family: monospace; display: flex;
         align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .box { text-align: center; padding: 2rem; border: 1px solid #30363d; border-radius: 8px;
         background: #161b22; max-width: 400px; }
  h1 { color: #f85149; font-size: 1.2rem; margin-bottom: 1rem; }
  p { color: #8b949e; margin: 0.5rem 0; }
  a { color: #58a6ff; }
</style></head>
<body><div class="box">
  <h1>⛔ Access Denied</h1>
  <p>${message}</p>
  <p><a href="/auth/login">Try again</a></p>
</div></body></html>`;
}
