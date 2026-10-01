import { AzureNamedKeyCredential, generateAccountSas } from '@azure/data-tables';
import { parseConnectionString } from './connection.js';
import type { SasConnection } from '../types.js';

export interface WebSasOptions {
  /** Validity in days (default 365). */
  days?: number;
  now?: Date;
}

/**
 * Create an account SAS for the web app: Table service, object-level only (entity CRUD —
 * cannot create/delete tables), read/add/update/delete. Revoke by rotating the account key.
 * Node-only (HMAC signing).
 */
export function createWebSas(connectionString: string, options: WebSasOptions = {}): SasConnection & { expiresOn: Date } {
  const { accountName, accountKey, tableEndpoint } = parseConnectionString(connectionString);
  const now = options.now ?? new Date();
  const expiresOn = new Date(now.getTime() + (options.days ?? 365) * 86_400_000);
  const startsOn = new Date(now.getTime() - 15 * 60_000);
  const isLocalEmulator = !tableEndpoint.startsWith('https://');
  const sas = generateAccountSas(new AzureNamedKeyCredential(accountName, accountKey), {
    startsOn,
    expiresOn,
    services: { table: true },
    // Azure authorises Query Entities with resource type "o". Azurite wrongly demands "c"
    // for queries, so the local emulator also gets "c" (still without create/list permissions).
    resourceTypes: isLocalEmulator ? 'co' : 'o',
    permissions: { query: true, add: true, update: true, delete: true },
    protocol: isLocalEmulator ? 'https,http' : 'https',
  });
  return { tableEndpoint, sas: sas.replace(/^\?/, ''), expiresOn };
}
