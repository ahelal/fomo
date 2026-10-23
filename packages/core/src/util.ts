/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Runs at most `limit` tasks at once; the others wait in call order. */
export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (task) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/**
 * An error's message with its cause, which Node's `fetch` keeps the real reason in:
 * `fetch failed (ECONNRESET)` instead of `fetch failed`.
 */
export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  let detail: unknown;
  if (cause instanceof Error || (typeof cause === 'object' && cause !== null)) {
    const c = cause as { code?: unknown; message?: unknown };
    detail = c.code || c.message;
  }
  return typeof detail === 'string' && detail && !err.message.includes(detail) ? `${err.message} (${detail})` : err.message;
}
