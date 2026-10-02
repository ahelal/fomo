import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { CONFIG_FILE, connectionStringProblem, maskConnectionString, tildify } from '../../config.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

interface Props {
  /** Why the saved connection string can't be used, if it can't. */
  error?: string;
  /** Check and save the connection string; resolves to an error message on failure. */
  onSubmit(connectionString: string, skipCheck: boolean): Promise<string | undefined>;
}

/** First-run screen: asks for the Azure Storage connection string. */
export function SetupScreen({ error, onSubmit }: Props) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const [buffer, setBuffer] = useState('');
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<{ value: string; message: string } | undefined>(
    error ? { value: '', message: error } : undefined,
  );

  useInput((input, key) => {
    if (checking) return;
    if (key.escape) { exit(); return; }
    if (key.return) {
      const value = buffer.trim();
      if (!value) return;
      const problem = connectionStringProblem(value);
      if (problem) { setFailure({ value: '', message: problem }); return; }
      // A second ↵ on a value that failed the check saves it anyway (e.g. storage temporarily unreachable).
      const skipCheck = failure?.value === value;
      setChecking(true);
      void onSubmit(value, skipCheck).then((message) => {
        setChecking(false);
        setFailure(message ? { value, message } : undefined);
      });
      return;
    }
    if (key.backspace || key.delete) { setBuffer((b) => b.slice(0, -1)); return; }
    if (input && !key.ctrl && !key.meta) setBuffer((b) => b + input.replace(/[\r\n]/g, ''));
  });

  const width = Math.min(columns - 4, 100);
  const shown = maskConnectionString(buffer);
  const failedThis = failure && failure.value === buffer.trim() && failure.value !== '';

  return (
    <Box flexDirection="column" height={rows} width={columns} paddingX={2} paddingY={1}>
      <Text color="#f0f6fc" bold>{'📰 FOMO — first-time setup'}</Text>
      <Box height={1} />
      <Text color="#c9d1d9">Paste the connection string of your FOMO storage account:</Text>
      <Text color="#8b949e">{'  az storage account show-connection-string -g fomo -n <account> -o tsv'}</Text>
      <Text color="#8b949e">{'  (use UseDevelopmentStorage=true for Azurite)'}</Text>
      <Box height={1} />
      <Box borderStyle="round" borderColor={checking ? '#e3b341' : '#1c7cd6'} width={width} paddingX={1}>
        <Text color="#f0f6fc" wrap="wrap">{`${shown}▏`}</Text>
      </Box>
      <Box height={1} />
      {checking ? (
        <Text color="#e3b341">Connecting…</Text>
      ) : failure ? (
        <Box flexDirection="column" width={width}>
          <Text color="#f85149" wrap="wrap">{`✗ ${failure.message}`}</Text>
          {failedThis && <Text color="#8b949e">Press ↵ again to save it anyway.</Text>}
        </Box>
      ) : null}
      <Box flexGrow={1} />
      <Text color="#8b949e">
        {'↵ connect   Esc quit   · saved to '}
        <Text color="#58a6ff">{tildify(CONFIG_FILE)}</Text>
        {'; change it later under c → This computer'}
      </Text>
    </Box>
  );
}
