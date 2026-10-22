import { describe, expect, it } from 'vitest';
import { attachmentTarget, normalizeAttachments, parseAttachments } from '../attachments.js';

describe('attachment references', () => {
  it('normalizes web URLs without treating local paths as URLs', () => {
    expect(attachmentTarget(' HTTPS://example.com/a file?q=1 ')).toEqual({
      kind: 'url', value: 'https://example.com/a%20file?q=1',
    });
    for (const path of ['/tmp/a file.pdf', '~/Documents/notes.md', './report.pdf', '../notes.txt', 'report.pdf', 'C:\\Work\\report.pdf', '\\\\server\\share\\a.pdf']) {
      expect(attachmentTarget(path)).toEqual({ kind: 'path', value: path });
    }
    expect(attachmentTarget('file:///tmp/a%20file.pdf')).toEqual({ kind: 'path', value: 'file:///tmp/a%20file.pdf' });
  });

  it('parses one reference per line, keeping spaces within paths and removing duplicates', () => {
    expect(parseAttachments(' https://example.com \r\n\r\n/tmp/a file.pdf\nhttps://example.com/\rnotes.md')).toEqual([
      'https://example.com/', '/tmp/a file.pdf', 'notes.md',
    ]);
    expect(parseAttachments(' \n ')).toEqual([]);
  });

  it.each(['javascript:alert(1)', 'data:text/html,test', 'ftp://example.com/a', 'https:example.com', 'mailto:a@example.com', 'https://', 'file:///tmp/a#fragment', '\u001b[31mnotes', 'a\nb', ''])(
    'rejects unsupported or invalid targets: %s', (target) => {
      expect(() => attachmentTarget(target)).toThrow();
    },
  );

  it('enforces the actual Azure Table string-property limit without truncating references', () => {
    const largest = 'a'.repeat(32_764); // JSON adds [" and "].
    expect(normalizeAttachments([largest])).toEqual([largest]);
    expect(() => normalizeAttachments([`${largest}a`])).toThrow(/too long/);
  });
});
