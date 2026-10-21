const USER_AGENT = 'Mozilla/5.0 fomo-release-tracker/1.0';
const TIMEOUT_MS = 15_000;

/** GET `url` and return the body; throws `HTTP <status>` on a non-2xx response. */
export async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await globalThis.fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return JSON.parse(await fetchText(url, { Accept: 'application/json', ...headers })) as T;
}
