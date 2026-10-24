import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import type { ExtensionContext, Json } from '@fomo/core/extension-api';
import type { ScrapedItem, Update } from '@fomo/core';

// This file is copied into a read-only snapshot beside the approved extension.
const write = process.stdout.write.bind(process.stdout);
const send = (value: unknown) => write(`${JSON.stringify(value)}\n`);
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let sequence = 0;
function call(method: string, params: unknown): Promise<unknown> {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); send({ type: 'call', id, method, params }); });
}
const extension = await import(pathToFileURL(process.argv[2]).href) as {
  fetch(ctx: ExtensionContext): Promise<ScrapedItem[]>;
  merge?(existing: Update, fetched: ScrapedItem): unknown;
};
const abort = new AbortController();
const context: ExtensionContext = {
  options: {},
  signal: abort.signal,
  http: {
    text: async (url) => await call('http', { url }) as string,
    json: async <T>(url: string) => JSON.parse(await call('http', { url }) as string) as T,
  },
  mcp: { call: (binding, tool, args) => call('mcp', { binding, tool, args }) },
  state: {
    get: async (key) => (await call('state.get', { key }) ?? undefined) as Json | undefined,
    set: async (key, value) => { await call('state.set', { key, value }); },
  },
  log: (message) => { send({ type: 'log', message }); },
};
console.log = (...args) => context.log(args.join(' '));
console.warn = console.error = console.log;
let queue = Promise.resolve();
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'reply') {
    const p = pending.get(message.id);
    if (!p) throw new Error('Unexpected broker reply');
    pending.delete(message.id);
    if (message.error) p.reject(new Error(message.error));
    else p.resolve(message.result);
    return;
  }
  queue = queue.then(async () => {
    try {
      let result: unknown;
      if (message.method === 'fetch') {
        context.options = Object.freeze(message.params.options);
        result = await extension.fetch(context);
      } else if (message.method === 'merge' && extension.merge) {
        result = await extension.merge(message.params.existing, { ...message.params.fetched, datePublished: new Date(message.params.fetched.datePublished) });
      } else throw new Error('Unknown extension operation');
      send({ type: 'response', id: message.id, result: result ?? null });
    } catch (error) {
      send({ type: 'response', id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
});
input.on('close', () => { abort.abort(); process.exit(0); });
