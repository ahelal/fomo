/**
 * One-shot scraper job — called by the Container Apps scheduled Job.
 * Uses FomoDirectService directly instead of going through HTTP.
 */
import { FomoDirectService } from '@fomo/core/service';

const connectionString = process.env['AZURE_STORAGE_CONNECTION_STRING'];

if (!connectionString) {
  console.error('AZURE_STORAGE_CONNECTION_STRING must be set');
  process.exit(1);
}

console.log('[scraper-job] Starting fetch…');

try {
  const svc = new FomoDirectService(connectionString);
  const result = await svc.fetch();

  console.log(`[scraper-job] Done. added=${result.added}`);
  for (const [source, r] of Object.entries(result.results)) {
    const err = r.error ? `  ⚠ ${r.error}` : '';
    console.log(`  ${source}: fetched=${r.fetched} added=${r.added}${err}`);
  }
} catch (err) {
  console.error('[scraper-job] Unexpected error:', err);
  process.exit(1);
}
