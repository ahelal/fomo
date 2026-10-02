import { spawnSync } from 'node:child_process';

const COMMANDS: [string, string[]][] =
  process.platform === 'darwin'
    ? [['pbcopy', []]]
    : process.platform === 'win32'
      ? [['clip', []]]
      : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];

/** Copy text to the system clipboard, falling back to the OSC 52 terminal escape (works over SSH). */
export function copyToClipboard(text: string): void {
  for (const [cmd, args] of COMMANDS) {
    const result = spawnSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    if (!result.error && result.status === 0) return;
  }
  process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`);
}
