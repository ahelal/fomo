import { decodeEntities } from './scraper/text.js';

/** Plain preview text, keeping paragraphs, line breaks and list items intact. */
export function previewText(content: string): string {
  const escapedMarkup = /&lt;\/?(?:p|div|ul|ol|li|h[1-6]|br|blockquote|pre|a|strong|em|span|code|script|style)\b/i;
  const markup = !/<[a-z!/]/i.test(content) && escapedMarkup.test(content) ? decodeEntities(content) : content;
  return decodeEntities(markup
    .replace(/\r\n?/g, '\n')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/?(?:p|div|ul|ol|li|h[1-6]|blockquote|pre|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
