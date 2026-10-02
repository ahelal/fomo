import { TableClient, AzureSASCredential } from '@azure/data-tables';
import type { StoreConnection, SasConnection } from '../types.js';

export function isSasConnection(conn: StoreConnection): conn is SasConnection {
  return typeof conn !== 'string';
}

// Azurite's well-known development account (public, documented by Microsoft).
const DEV_STORAGE_CONNECTION_STRING =
  'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;' +
  'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
  'TableEndpoint=http://127.0.0.1:10002/devstoreaccount1';

/** Expand the `UseDevelopmentStorage=true` shorthand into the full Azurite connection string. */
export function normalizeConnectionString(cs: string): string {
  return /^\s*UseDevelopmentStorage\s*=\s*true\s*;?\s*$/i.test(cs) ? DEV_STORAGE_CONNECTION_STRING : cs;
}

export function createTableClient(conn: StoreConnection, tableName: string): TableClient {
  if (isSasConnection(conn)) {
    const sas = conn.sas.replace(/^\?/, '');
    const endpoint = conn.tableEndpoint.replace(/\/$/, '');
    return new TableClient(endpoint, tableName, new AzureSASCredential(sas), {
      allowInsecureConnection: endpoint.startsWith('http://'),
    });
  }
  const cs = normalizeConnectionString(conn);
  const allowInsecureConnection = /DefaultEndpointsProtocol=http;|TableEndpoint=http:\/\//i.test(cs);
  return TableClient.fromConnectionString(cs, tableName, { allowInsecureConnection });
}

export interface ParsedConnectionString {
  accountName: string;
  accountKey: string;
  tableEndpoint: string;
}

/** Extract account name/key and the Table endpoint from a storage connection string. */
export function parseConnectionString(cs: string): ParsedConnectionString {
  const parts = new Map<string, string>();
  for (const segment of normalizeConnectionString(cs).split(';')) {
    const eq = segment.indexOf('=');
    if (eq > 0) parts.set(segment.slice(0, eq).trim(), segment.slice(eq + 1).trim());
  }
  const accountName = parts.get('AccountName');
  const accountKey = parts.get('AccountKey');
  if (!accountName || !accountKey) {
    throw new Error('Connection string must contain AccountName and AccountKey');
  }
  const protocol = parts.get('DefaultEndpointsProtocol') ?? 'https';
  const suffix = parts.get('EndpointSuffix') ?? 'core.windows.net';
  const tableEndpoint = (parts.get('TableEndpoint') ?? `${protocol}://${accountName}.table.${suffix}`).replace(/\/$/, '');
  return { accountName, accountKey, tableEndpoint };
}

// ─── Magic link ──────────────────────────────────────────────────────────────
// The SAS travels in the URL fragment, which browsers never send to the server.

/** Build `https://site/#endpoint=…&sas=…`. */
export function buildConnectLink(webUrl: string, conn: SasConnection): string {
  const params = new URLSearchParams({ endpoint: conn.tableEndpoint, sas: conn.sas.replace(/^\?/, '') });
  return `${webUrl.replace(/#.*$/, '').replace(/\/?$/, '/')}#${params.toString()}`;
}

/** Parse a connect link (or just its `#fragment`). Returns undefined when it is not one. */
export function parseConnectLink(linkOrHash: string): SasConnection | undefined {
  const hashIdx = linkOrHash.indexOf('#');
  const fragment = hashIdx >= 0 ? linkOrHash.slice(hashIdx + 1) : linkOrHash;
  const params = new URLSearchParams(fragment);
  const tableEndpoint = params.get('endpoint');
  const sas = params.get('sas');
  if (!tableEndpoint || !sas) return undefined;
  if (!/^https?:\/\//.test(tableEndpoint)) return undefined;
  return { tableEndpoint: tableEndpoint.replace(/\/$/, ''), sas };
}

/** Expiry (`se=`) of a SAS token, if present. */
export function sasExpiry(sas: string): Date | undefined {
  const se = new URLSearchParams(sas.replace(/^\?/, '')).get('se');
  if (!se) return undefined;
  const d = new Date(se);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
