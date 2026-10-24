import { StringDecoder } from 'node:string_decoder';
import type { MxcProcess } from '@microsoft/mxc-sdk/v1';
import { closeSandbox } from './sandbox.js';
import { cleanMessage, MAX_FRAME_BYTES, object, text } from './validation.js';

export class WorkerConnection {
  private next = 0;
  private lastCall = 0;
  private calls = 0;
  private logs = 0;
  private ended?: Error;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  constructor(
    private readonly child: MxcProcess,
    signal: AbortSignal,
    broker: (method: string, params: Record<string, unknown>) => Promise<unknown>,
    private readonly log: (message: string) => void,
  ) {
    const input = child.standardInput;
    const output = child.standardOutput;
    const errors = child.standardError;
    if (!input || !output || !errors) throw new Error('MXC did not provide private worker pipes');
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let bytes = 0;
    let stderr = '';
    errors.on('data', (chunk: Buffer) => { stderr = cleanMessage(stderr + chunk.toString()); });
    const fail = (error: unknown) => this.fail(error instanceof Error ? error : new Error(cleanMessage(error)));
    const onAbort = () => fail(signal.reason ?? new Error('Extension invocation cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    output.on('data', (chunk: Buffer) => {
      try {
        bytes += chunk.length;
        buffer += decoder.write(chunk);
        if (bytes > 32 * 1024 * 1024 || Buffer.byteLength(buffer) > MAX_FRAME_BYTES) throw new Error('Extension output limit exceeded');
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const frame: unknown = JSON.parse(line);
          if (!object(frame) || !text(frame.type)) throw new Error('Invalid extension frame');
          if (frame.type === 'log') {
            if (!text(frame.message, 4000) || ++this.logs > 100) throw new Error('Extension log limit exceeded');
            log(cleanMessage(frame.message));
          } else if (frame.type === 'response') {
            if (typeof frame.id !== 'number') throw new Error('Invalid response identity');
            const waiter = this.pending.get(frame.id);
            if (!waiter) throw new Error('Unexpected extension response');
            this.pending.delete(frame.id);
            if (frame.error !== undefined) waiter.reject(new Error(cleanMessage(frame.error)));
            else waiter.resolve(frame.result);
          } else if (frame.type === 'call') {
            if (!Number.isSafeInteger(frame.id) || typeof frame.id !== 'number' || frame.id !== this.lastCall + 1
              || frame.id > 4000 || ++this.calls > 16 || !text(frame.method) || !object(frame.params)) {
              throw new Error('Invalid or excessive extension capability call');
            }
            this.lastCall = frame.id;
            const id = frame.id;
            void broker(frame.method, frame.params).then(
              (result) => this.send({ type: 'reply', id, result: result ?? null }),
              (error) => this.send({ type: 'reply', id, error: cleanMessage(error instanceof Error ? error.message : error) }),
            ).catch(fail).finally(() => { this.calls--; });
          } else throw new Error('Unknown extension frame');
        }
      } catch (error) { fail(error); }
    });
    output.on('error', fail);
    input.on('error', fail);
    void child.wait().then((outcome) => {
      const reason = outcome.timedOut ? 'timed out' : `exited (${outcome.exitCode})`;
      fail(new Error(`Extension worker ${reason}${stderr ? `: ${stderr}` : ''}`));
    }, fail).finally(() => signal.removeEventListener('abort', onAbort));
    if (signal.aborted) onAbort();
  }

  assertActive(): void { if (this.ended) throw this.ended; }

  request(method: 'fetch' | 'merge', params: unknown): Promise<unknown> {
    this.assertActive();
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.send({ type: 'request', id, method, params }); } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  private send(frame: unknown): void {
    this.assertActive();
    const message = `${JSON.stringify(frame)}\n`;
    if (Buffer.byteLength(message) > MAX_FRAME_BYTES) throw new Error('Extension protocol frame exceeds 8 MiB');
    this.child.standardInput!.write(message);
  }

  private fail(error: Error): void {
    if (this.ended) return;
    this.ended = error;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    void closeSandbox(this.child).catch((reason) => this.log(`Sandbox shutdown failed: ${cleanMessage(reason)}`));
  }
}
