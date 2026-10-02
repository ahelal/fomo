/**
 * Switch to the alternate screen and make Ink's redraws flicker-free.
 * Returns a function that restores the terminal.
 *
 * Ink redraws by clearing the screen (full-screen output) or erasing the previous
 * frame's lines, then writing every line again, which flashes. We intercept
 * stdout.write, strip those prefixes, diff the frame against the previous one and
 * rewrite only the changed lines with absolute cursor addressing.
 */
export function enterFullScreen(): () => void {
  const raw = process.stdout.write.bind(process.stdout);
  raw('\x1b[?1049h\x1b[?25l\x1b[H');

  const CLEAR_TERMINAL = '\x1b[2J\x1b[3J\x1b[H';
  const ERASE_LINES_RE = /^(?:\x1b\[2K(?:\x1b\[1A)?)+\x1b\[G/;
  let prevLines: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (chunk: unknown, ...rest: unknown[]): boolean => {
    if (typeof chunk !== 'string') {
      return (raw as (...a: unknown[]) => boolean)(chunk, ...rest);
    }

    let content: string | null = null;
    if (chunk.startsWith(CLEAR_TERMINAL)) {
      content = chunk.slice(CLEAR_TERMINAL.length);
    } else if (chunk.startsWith('\x1b[2K')) {
      const m = ERASE_LINES_RE.exec(chunk);
      if (m) content = chunk.slice(m[0].length);
    }

    // Not a frame (cursor-hide, first render, etc.) — pass through.
    if (content === null) {
      return (raw as (...a: unknown[]) => boolean)(chunk, ...rest);
    }

    const newLines = content.split('\n');
    if (prevLines.length === 0) {
      prevLines = newLines;
      return raw('\x1b[H' + content);
    }

    let buf = '\x1b[?2026h'; // begin synchronized output
    let changes = 0;
    const len = Math.max(prevLines.length, newLines.length);
    for (let i = 0; i < len; i++) {
      if ((prevLines[i] ?? '') !== (newLines[i] ?? '')) {
        buf += `\x1b[${i + 1};1H\x1b[2K${newLines[i] ?? ''}`;
        changes++;
      }
    }
    buf += '\x1b[?2026l'; // end synchronized output
    prevLines = newLines;
    return changes > 0 ? raw(buf) : true;
  };

  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = raw;
    raw('\x1b[?25h\x1b[?1049l');
  };
}
