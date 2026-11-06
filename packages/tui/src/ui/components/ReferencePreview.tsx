import React, { type Ref } from 'react';
import { Box, Text } from 'ink';
import { formatDate, isManualReferenceUrl, MANUAL_SOURCE_ID, previewText, type Reference, type Update } from '@fomo/core';
import { PreviewViewport, type PreviewLine, type PreviewScroll } from './PreviewViewport.js';

export function ReferencePreview({ reference, update, loading, error, height, columns, focused, scrollRef }: {
  reference: Reference;
  update?: Update;
  loading: boolean;
  error?: string;
  height: number;
  columns: number;
  focused: boolean;
  scrollRef: Ref<PreviewScroll>;
}) {
  const content = update?.source === MANUAL_SOURCE_ID ? update.content : previewText(update?.content ?? '');
  const lines: PreviewLine[] = [
    { text: reference.title, bold: true, color: '#f0f6fc' },
    { text: `${reference.folder || 'top level'} · filed ${formatDate(reference.createdAt)}`, color: '#8b949e' },
  ];
  if (!isManualReferenceUrl(reference.url)) lines.push({ text: reference.url, color: '#58a6ff' });
  if (reference.description) lines.push({ text: reference.description }, { text: '' });
  if (error) lines.push({ text: error, color: '#f85149' });
  if (loading) lines.push({ text: 'Loading…', color: '#8b949e' });
  if (update?.gist) {
    lines.push({ text: update.gist.summary, bold: true });
    lines.push(...update.gist.points.map((point) => ({ text: `• ${point}` })), { text: '' });
  }
  if (content) lines.push({ text: content });
  if (!loading && !error && !content && !reference.description && !update?.gist) {
    lines.push({ text: 'No saved content. Press o to open the link.', color: '#8b949e' });
  }
  return (
    <Box flexDirection="column" height={height}>
      <Text color={focused ? '#58a6ff' : '#8b949e'} wrap="truncate">{' Preview  [Tab] focus  [.] right/bottom  [Esc] close  [e] edit'}</Text>
      <PreviewViewport lines={lines} height={Math.max(0, height - 1)} columns={columns} focused={focused} scrollRef={scrollRef} />
    </Box>
  );
}
