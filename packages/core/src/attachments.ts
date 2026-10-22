export interface AttachmentTarget {
  kind: 'url' | 'path';
  value: string;
}

/** Only web URLs and file references may be opened; other URL schemes are not commands. */
export function attachmentTarget(input: string): AttachmentTarget {
  const value = input.trim();
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('An attachment must be a URL or file path on one line');
  }
  if (/^(?:https?|file):\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Not a valid attachment URL: ${value}`);
    }
    if (url.protocol === 'file:') {
      if (url.search || url.hash) throw new Error('Use a file path or a file URL without a query or fragment');
      return { kind: 'path', value: url.href };
    }
    return { kind: 'url', value: url.href };
  }
  // A Windows drive letter is a path, not a URL scheme.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) {
    throw new Error('Attachments support http://, https:// and file paths only');
  }
  return { kind: 'path', value };
}

/** Normalize and deduplicate references without reading or uploading any files. */
export function normalizeAttachments(values: readonly string[]): string[] {
  const attachments = [...new Set(values.map((value) => attachmentTarget(value).value))];
  // Azure Table string properties hold at most 64 KiB of UTF-16.
  if (JSON.stringify(attachments).length > 32_768) {
    throw new Error('The attachment list is too long for storage; shorten it or remove some entries');
  }
  return attachments;
}

/** One attachment per line; blank lines are ignored. */
export function parseAttachments(text: string): string[] {
  return normalizeAttachments(text.split(/\r\n?|\n/).map((line) => line.trim()).filter(Boolean));
}
