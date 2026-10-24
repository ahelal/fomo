import type { ExtensionContext } from '@fomo/core/extension-api';

export interface GraphResult { statusCode: number; data?: unknown; error?: string }
export interface FileHit { driveId: string; driveItemId: string; title?: string }
export interface WorkIQ {
  fetch(paths: string[], signal?: AbortSignal): Promise<GraphResult[]>;
  callFunction(path: string, signal?: AbortSignal): Promise<GraphResult>;
  searchFiles(query: string, signal?: AbortSignal): Promise<FileHit[]>;
  close(): Promise<void>;
}

export function workiqClient(ctx: ExtensionContext): WorkIQ {
  const call = async (tool: string, args: Record<string, string | string[] | { name: string }[]>) => {
    const result = await ctx.mcp.call('workiq', tool, args);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid WorkIQ response');
    return result as Record<string, unknown>;
  };
  return {
    async fetch(paths) {
      const out = await call('fetch', { entityUrls: paths });
      const results = Array.isArray(out.results) ? out.results : [];
      return paths.map((_, i) => graphResult(results[i]));
    },
    async callFunction(path) { return graphResult(await call('call_function', { functionUrl: path })); },
    async searchFiles(query) { return fileHits(await call('retrieve', { query, capabilities: [{ name: 'OneDriveAndSharePoint' }] })); },
    async close() {},
  };
}

export function fileHits(raw: Record<string, unknown>): FileHit[] {
  const out = (raw['application/vnd.ms-workiq.retrieval'] ?? raw) as { results?: unknown; stoppedReason?: unknown; error?: unknown; errorCode?: unknown };
  if (out.stoppedReason === 'error' || out.error || !Array.isArray(out.results)) {
    const why = [out.errorCode, out.error].filter((v): v is string => typeof v === 'string' && v !== '').join(': ');
    throw new Error(`WorkIQ search failed${why ? `: ${why}` : ''}`);
  }
  return (out.results as Record<string, unknown>[]).flatMap((r) => {
    const ids = typeof r.entityUrl === 'string' ? /\/drives\/([^/]+)\/items\/([^/?]+)/.exec(r.entityUrl) : null;
    const driveId = typeof r.driveId === 'string' && r.driveId ? r.driveId : ids?.[1];
    const driveItemId = typeof r.itemId === 'string' && r.itemId ? r.itemId : ids?.[2];
    const meta = r.resourceMetadata as { video?: { title?: unknown }; document?: { title?: unknown } } | undefined;
    const title = [meta?.video?.title, meta?.document?.title].find((t): t is string => typeof t === 'string' && t !== '');
    return driveId && driveItemId ? [{ driveId, driveItemId, ...(title ? { title } : {}) }] : [];
  });
}

function errorText(err: unknown): string | undefined {
  if (typeof err === 'string') return err || undefined;
  if (!err || typeof err !== 'object') return undefined;
  const { code, message, error } = err as { code?: unknown; message?: unknown; error?: unknown };
  return [code, message].filter((v): v is string => typeof v === 'string' && v !== '').join(': ') || errorText(error);
}

export function graphResult(raw: Record<string, unknown> | undefined): GraphResult {
  if (!raw) return { statusCode: 0, error: 'no result' };
  const statusCode = typeof raw.statusCode === 'number' ? raw.statusCode : raw.data !== undefined ? 200 : 0;
  const error = errorText(raw.error);
  return { statusCode, ...(raw.data !== undefined ? { data: raw.data } : {}), ...(error ? { error } : {}) };
}

export function graphPath(link: string): string {
  return link.replace(/^https:\/\/graph\.microsoft\.com\/(?:v1\.0|beta)(?=\/)/, '');
}
