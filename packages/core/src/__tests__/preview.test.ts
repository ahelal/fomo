import { describe, expect, it } from 'vitest';
import { previewText } from '../preview.js';

describe('previewText', () => {
  it('keeps release-note headings, paragraphs and bullets on separate lines', () => {
    const notes = 'Highlights\r\n\r\n- First fix\r\n- Second fix\r\n\r\nAdded\r\n\r\n- New feature';
    expect(previewText(notes)).toBe(notes.replace(/\r\n/g, '\n'));
  });

  it('turns HTML blocks and lists into readable plain text', () => {
    expect(previewText('<h2>Highlights</h2><p>A &amp; B<br>Next line</p><ul><li>First</li><li>Second</li></ul>'))
      .toBe('Highlights\n\nA & B\nNext line\n\n- First\n\n- Second');
  });

  it('handles escaped HTML without showing executable markup', () => {
    expect(previewText('&lt;p&gt;First&lt;br&gt;Second&lt;/p&gt;')).toBe('First\nSecond');
    expect(previewText('<p>Safe</p><script>bad()</script><style>body{}</style>')).toBe('Safe');
  });

  it('keeps long content and non-ASCII text, decoding entities safely', () => {
    const content = `Notes\n\n- ${'Text '.repeat(400)}\n- &#x1F680; &lt;value&gt;`;
    const text = previewText(content);
    expect(text.length).toBeGreaterThan(1000);
    expect(text).toContain('\n- 🚀 <value>');
    expect(previewText('')).toBe('');
  });
});
