import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachmentTarget } from '@fomo/core';
import { untildify } from './config.js';

/** Open an explicitly selected reference with the OS default application, never through a shell. */
export async function openTodoAttachment(value: string): Promise<void> {
  const target = attachmentTarget(value);
  let path = target.value;
  if (target.kind === 'path') {
    if (process.platform !== 'win32' && /^(?:[a-z]:[\\/]|\\\\)/i.test(path)) {
      throw new Error('This is a Windows path; open it on the Windows computer where it exists');
    }
    path = /^file:\/\//i.test(path) ? fileURLToPath(path) : resolve(untildify(path));
    const entry = await stat(path);
    if (!entry.isFile() && !entry.isDirectory()) throw new Error(`Not a file or directory: ${path}`);
  }
  const { default: open } = await import('open');
  const launcher = await open(path);
  // Observe the launcher, without `wait: true` (which waits for the application to close).
  await new Promise<void>((resolve, reject) => {
    const finished = (code: number | null, signal: string | null) => {
      if (code === 0) resolve();
      else reject(new Error(`Could not open attachment: ${signal ? `terminated by ${signal}` : `opener exited with code ${code}`}`));
    };
    launcher.once('error', reject);
    launcher.once('close', finished);
    if (launcher.exitCode !== null || launcher.signalCode !== null) finished(launcher.exitCode, launcher.signalCode);
  });
}
