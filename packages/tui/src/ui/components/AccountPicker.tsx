import React from 'react';
import { Box, Text } from 'ink';
import type { GhAccount } from '../../ghAccounts.js';

export interface AccountOption {
  /** Undefined for Automatic. */
  login?: string;
  /** gh's active account. */
  active?: boolean;
  /** Saved in the config, but gh no longer has it. */
  missing?: boolean;
}

/** Picker rows: Automatic first, then each gh account, plus the saved account if gh no longer has it. */
export function accountOptions(accounts: GhAccount[], current?: string): AccountOption[] {
  const options: AccountOption[] = [{}, ...accounts.map(({ login, active }) => ({ login, active }))];
  if (current && !accounts.some((a) => a.login === current)) options.push({ login: current, missing: true });
  return options;
}

interface Props {
  /** Undefined while gh lists the accounts. */
  accounts: GhAccount[] | undefined;
  /** Saved account; undefined is Automatic. */
  current?: string;
  /** What Automatic uses right now. */
  automatic: string;
  /** Why gh couldn't list the accounts. */
  error?: string;
  focusIndex: number;
  height: number;
  columns: number;
}

export function AccountPicker({ accounts, current, automatic, error, focusIndex, height, columns }: Props) {
  const options = accounts ? accountOptions(accounts, current) : [];
  const listH = Math.max(1, height - 7);
  const start = Math.max(0, Math.min(focusIndex - Math.floor(listH / 2), options.length - listH));
  const visible = options.slice(start, start + listH);
  const nameW = Math.min(32, Math.max(9, ...options.map((o) => (o.login ?? 'Automatic').length)));

  return (
    <Box flexDirection="column" height={height} width={columns} paddingX={2} paddingTop={1}>
      <Text color="#f0f6fc" bold>{'👤 Copilot account'}</Text>
      {error ? (
        <Text color="#e3b341" wrap="truncate">{`⚠ Couldn’t list gh accounts: ${error}`}</Text>
      ) : (
        <Text color="#8b949e" wrap="truncate">
          {accounts ? 'Digests and summaries use this GitHub account’s Copilot access · accounts from gh auth login' : 'Asking gh for your accounts…'}
        </Text>
      )}
      <Box height={1} />
      <Box flexDirection="column" height={listH} overflowY="hidden">
        {visible.map((o, i) => {
          const focused = start + i === focusIndex;
          const chosen = o.login === current;
          const bg = focused ? '#1c2d4f' : undefined;
          const name = o.login ?? 'Automatic';
          const note = o.login === undefined ? automatic
            : o.missing ? 'not signed in to gh — run gh auth login'
              : o.active ? 'gh’s active account' : '';
          return (
            <Text key={o.login ?? ''} wrap="truncate">
              <Text color="#1c7cd6" backgroundColor={bg}>{focused ? '▸ ' : '  '}</Text>
              <Text color={chosen ? '#3fb950' : '#8b949e'} backgroundColor={bg}>{chosen ? '● ' : '○ '}</Text>
              <Text color="#f0f6fc" bold={chosen} backgroundColor={bg}>{name.padEnd(nameW)}</Text>
              <Text color={o.missing ? '#e3b341' : '#8b949e'} backgroundColor={bg}>{note ? `  ${note}` : ''}</Text>
            </Text>
          );
        })}
      </Box>
      <Box height={1} />
      <Text color="#8b949e" wrap="truncate">
        <Text color="#58a6ff" bold>↑/↓</Text>{' choose   '}
        <Text color="#58a6ff" bold>↵</Text>{' select   '}
        <Text color="#58a6ff" bold>Esc</Text>{' close'}
      </Text>
    </Box>
  );
}
