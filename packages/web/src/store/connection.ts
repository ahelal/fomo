import { parseConnectLink, sasExpiry, type SasConnection } from '@fomo/core';

const STORAGE_KEY = 'fomo.connection';

export function loadConnection(): SasConnection | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<SasConnection>;
    if (typeof parsed.tableEndpoint === 'string' && typeof parsed.sas === 'string') {
      return { tableEndpoint: parsed.tableEndpoint, sas: parsed.sas };
    }
  } catch {
    // corrupt entry — treat as disconnected
  }
  return undefined;
}

export function saveConnection(conn: SasConnection): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
}

export function clearConnection(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * If the page was opened via a `fomo link` magic link, remember the connection and
 * strip the fragment so the SAS doesn't linger in the address bar or history.
 */
export function consumeConnectLink(): SasConnection | undefined {
  const conn = parseConnectLink(window.location.hash);
  if (!conn) return undefined;
  saveConnection(conn);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return conn;
}

/** Days until the SAS expires (negative when expired), if it has an expiry. */
export function daysUntilExpiry(conn: SasConnection, now = Date.now()): number | undefined {
  const expiry = sasExpiry(conn.sas);
  return expiry ? Math.floor((expiry.getTime() - now) / 86_400_000) : undefined;
}
