import React from 'react';
import { Box, Text } from 'ink';

export interface LinkView {
  url: string;
  expiresOn: Date;
  qr: string;
}

interface Props {
  link: LinkView;
  height: number;
  columns: number;
}

export function LinkOverlay({ link, height, columns }: Props) {
  const qrLines = link.qr.replace(/\n+$/, '').split('\n');
  const qrWidth = Math.max(...qrLines.map((l) => l.length));
  // title + blank + url + blank + expiry + blank + footer + padding
  const fits = qrLines.length + 9 <= height && qrWidth + 4 <= columns;

  return (
    <Box flexDirection="column" height={height} width={columns} paddingX={2} paddingTop={1}>
      <Text color="#f0f6fc" bold>{'📱 Link a device'}</Text>
      <Text color="#8b949e">Scan the QR code on your phone, or open the link on any device, to connect the web app.</Text>
      <Box height={1} />
      {fits ? (
        <Box flexDirection="column">
          {qrLines.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </Box>
      ) : (
        <Text color="#e3b341">Make the terminal bigger to see the QR code, or press y to copy the link.</Text>
      )}
      <Box height={1} />
      <Text color="#58a6ff" wrap="truncate-middle">{link.url}</Text>
      <Text color="#8b949e">
        {`Valid until ${link.expiresOn.toISOString().slice(0, 10)}. Anyone with this link can read and change your FOMO data.`}
      </Text>
      <Box flexGrow={1} />
      <Text color="#8b949e">
        <Text color="#58a6ff" bold>o</Text>{' open in browser   '}
        <Text color="#58a6ff" bold>y</Text>{' copy link   '}
        <Text color="#58a6ff" bold>Esc</Text>{' close'}
      </Text>
    </Box>
  );
}
