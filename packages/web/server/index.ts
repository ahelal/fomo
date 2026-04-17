import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { config } from './config.js';
import { UpdateStore } from '@fomo/core/store';
import { getAllSources } from '@fomo/core/scrapers';
import { sessionAuth } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { updatesRouter } from './routes/updates.js';
import { fetchRouter } from './routes/fetch.js';

// ── Storage ──────────────────────────────────────────────────────────────────
const store = new UpdateStore(config.storageConnectionString);

await store.init();

// ── App ───────────────────────────────────────────────────────────────────────
export const app = new Hono();

app.use('*', logger());
app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'] }));

// Public routes
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route('/auth', authRouter({
  googleClientId: config.googleClientId,
  googleClientSecret: config.googleClientSecret,
  sessionSecret: config.sessionSecret,
  sessionMaxAge: config.sessionMaxAge,
  allowedUsers: config.allowedUsers,
}));

// Protected routes (session cookie auth)
const auth = sessionAuth(config.sessionSecret);
app.use('/updates/*', auth);
app.use('/fetch/*', auth);
app.use('/stats', auth);
app.use('/sources', auth);
app.use('/settings', auth);

app.route('/updates', updatesRouter(store));
app.route('/fetch', fetchRouter(store));

app.get('/stats', async (c) => c.json(await store.getStats()));
app.get('/sources', (c) =>
  c.json(getAllSources().map((s) => ({
    id: s.id,
    displayName: s.displayName,
    capabilities: s.capabilities,
  }))),
);

// ── Settings ──────────────────────────────────────────────────────────────────
app.get('/settings', async (c) => c.json(await store.getSettings()));
app.patch('/settings', async (c) => {
  const patch = await c.req.json();
  const updated = await store.updateSettings(patch);
  return c.json(updated);
});

// ── Web UI (static) ───────────────────────────────────────────────────────────
app.use('/*', serveStatic({ root: './public' }));
app.get('/*', serveStatic({ path: './public/index.html' }));

// ── Server ────────────────────────────────────────────────────────────────────
console.log(`🚀 FOMO listening on port ${config.port}`);
console.log(`   Allowed users: ${config.allowedUsers.size > 0 ? `${config.allowedUsers.size} email(s)` : 'ALL (no allowlist)'}`);

serve({ fetch: app.fetch, port: config.port });
