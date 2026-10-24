import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { httpsUrl } from './validation.js';

const blocked = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blocked.addSubnet(ip, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [ip, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16]] as const) blocked.addSubnet(ip, prefix, 'ipv6');

export function publicAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? !blocked.check(address, 'ipv4')
    : version === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

/** DNS is checked once per hop and that exact address is pinned to the TLS request. */
export async function httpText(input: string, origins: readonly string[], signal: AbortSignal, redirects = 0): Promise<string> {
  signal.throwIfAborted();
  if (!httpsUrl(input)) throw new Error('Only HTTPS URLs without credentials are permitted');
  const url = new URL(input);
  if (!origins.includes(url.origin)) throw new Error(`HTTP origin not granted: ${url.origin}`);
  const addresses = await lookup(url.hostname, { all: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address))) {
    throw new Error('HTTP destination resolved to a non-public address');
  }
  const pinned = addresses[0];
  const hopSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  return new Promise<string>((resolve, reject) => {
    const req = request(url, {
      method: 'GET', signal: hopSignal, agent: false, family: pinned.family,
      headers: { 'User-Agent': 'FOMO/1', Accept: '*/*', 'Accept-Encoding': 'identity' },
      lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.destroy();
        if (redirects >= 3 || !res.headers.location) { reject(new Error('HTTP redirect limit or missing destination')); return; }
        try { resolve(httpText(new URL(res.headers.location, url).href, origins, signal, redirects + 1)); } catch (error) { reject(error); }
        return;
      }
      if (status < 200 || status >= 300) { res.destroy(); reject(new Error(`HTTP ${status} from ${url.origin}`)); return; }
      let bytes = 0;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) {
          const error = new Error('Extension HTTP response exceeds 4 MiB');
          res.destroy(error); reject(error); return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('Extension HTTP response was interrupted')));
    });
    req.on('error', reject);
    req.end();
  });
}
