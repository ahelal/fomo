import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { format } from 'node:util';

const MAX_LOG_BYTES = 1024 * 1024;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** Appends text to `file`; never throws (logging must not break the UI). */
function createLogger(file: string): (text: string) => void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_LOG_BYTES) writeFileSync(file, '');
  } catch {
    // ignore
  }
  return (text) => {
    const clean = text.replace(ANSI_RE, '').trimEnd();
    if (!clean.trim()) return;
    try {
      appendFileSync(file, `[${new Date().toISOString()}] ${clean}\n`);
    } catch {
      // ignore
    }
  };
}

/**
 * Switch to the alternate screen and make Ink's redraws flicker-free.
 * Returns a function that restores the terminal.
 *
 * Ink redraws by clearing the screen (full-screen output) or erasing the previous
 * frame's lines, then writing every line again, which flashes. We intercept
 * stdout.write, strip those prefixes, diff the frame against the previous one and
 * rewrite only the changed lines with absolute cursor addressing.
 *
 * Because only changed lines are redrawn, anything else printed to the terminal would
 * leave stale lines behind (or scroll the screen). So while the UI is open:
 * - console output and stderr (scraper errors, Copilot runtime logs) go to `logFile`;
 *   render Ink with `patchConsole: false` so it doesn't reroute console to the terminal;
 * - line wrapping is off, so a line wider than the terminal is clipped instead of
 *   spilling into the next row;
 * - an unexpected write or a resize forces a full repaint.
 */
export function enterFullScreen(logFile: string): () => void {
  const log = createLogger(logFile);
  const raw = process.stdout.write.bind(process.stdout);
  const rawErr = process.stderr.write.bind(process.stderr);
  // alternate screen, hide cursor, no auto-wrap, home
  raw('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[H');

  const CLEAR_TERMINAL = '\x1b[2J\x1b[3J\x1b[H';
  const ERASE_LINES_RE = /^(?:\x1b\[2K(?:\x1b\[1A)?)+\x1b\[G/;
  // Writes that don't move the cursor or print text (cursor show/hide, OSC 52 clipboard)
  // eslint-disable-next-line no-control-regex
  const HARMLESS_RE = /^(?:\x1b\[\?[0-9;]*[hl]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))*$/;
  /** Lines currently on screen; undefined means the next frame repaints everything. */
  let prevLines: string[] | undefined;

  const drawFrame = (content: string): boolean => {
    const lines = content.split('\n').slice(0, process.stdout.rows || 24);
    const full = !prevLines;
    const prev = prevLines ?? [];
    let buf = '\x1b[?2026h'; // begin synchronized output
    if (full) buf += '\x1b[2J';
    let changes = 0;
    const len = Math.max(prev.length, lines.length);
    for (let i = 0; i < len; i++) {
      if (full || prev[i] !== lines[i]) {
        buf += `\x1b[${i + 1};1H\x1b[2K${lines[i] ?? ''}`;
        changes++;
      }
    }
    buf += '\x1b[?2026l'; // end synchronized output
    prevLines = lines;
    return changes > 0 ? raw(buf) : true;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: unknown, ...rest: unknown[]): boolean => {
    if (typeof chunk !== 'string') {
      prevLines = undefined;
      return (raw as (...a: unknown[]) => boolean)(chunk, ...rest);
    }
    if (chunk.startsWith(CLEAR_TERMINAL)) return drawFrame(chunk.slice(CLEAR_TERMINAL.length));
    const m = chunk.startsWith('\x1b[2K') ? ERASE_LINES_RE.exec(chunk) : null;
    if (m) return drawFrame(chunk.slice(m[0].length));

    // Not a frame (cursor hide, clipboard, Ink's first log-update render, …): pass it
    // through, and repaint everything next time if it may have printed something.
    if (!HARMLESS_RE.test(chunk)) prevLines = undefined;
    return (raw as (...a: unknown[]) => boolean)(chunk, ...rest);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: unknown, ...rest: unknown[]): boolean => {
    log(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString());
    const done = rest.find((r) => typeof r === 'function') as (() => void) | undefined;
    if (done) process.nextTick(done);
    return true;
  };

  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
  const originalConsole = consoleMethods.map((name) => console[name]);
  for (const name of consoleMethods) {
    console[name] = (...args: unknown[]) => log(format(...args));
  }

  // The terminal may reflow or clear the screen on resize.
  const onResize = () => { prevLines = undefined; };
  process.stdout.on('resize', onResize);

  return () => {
    process.stdout.off('resize', onResize);
    consoleMethods.forEach((name, i) => { console[name] = originalConsole[i]!; });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = rawErr;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = raw;
    raw('\x1b[?7h\x1b[?25h\x1b[?1049l');
  };
}
