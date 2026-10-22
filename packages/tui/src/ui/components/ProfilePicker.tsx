import React from 'react';
import { Box, Text } from 'ink';
import { maskConnectionString } from '../../config.js';
import type { ProfilePickerView } from '../hooks/useProfilePicker.js';
import { textWidth } from '../text.js';

interface Props extends ProfilePickerView {
  height: number;
  columns: number;
}

const tail = (s: string, w: number) => (w <= 0 ? '' : s.length > w ? `…${s.slice(s.length - w + 1)}` : s);
const blank = <Text> </Text>;

/** The profile list (w) with its add / rename / remove prompts. */
export function ProfilePicker({ profiles, active, focusIndex, mode, note, height, columns }: Props) {
  // Title, subtitle, a prompt and a detail line under the list, and the key footer, with spacing.
  const listH = Math.max(1, height - 9);
  const start = Math.max(0, Math.min(focusIndex - Math.floor(listH / 2), profiles.length - listH));
  const visible = profiles.slice(start, start + listH);
  const nameW = Math.min(32, Math.max(7, ...profiles.map((p) => p.name.length)));
  const innerW = Math.max(20, columns - 4);

  const hint = (text: string) => <Text color="#8b949e" wrap="truncate">{text}</Text>;
  const field = (label: string, text: string) => {
    const w = Math.max(10, innerW - textWidth(label) - 1);
    return (
      <Text wrap="truncate">
        <Text color="#c9d1d9">{`${label} `}</Text>
        <Text color="#e3b341" backgroundColor="#2d1b00">{` ${tail(text, w - 3)}▏`.padEnd(w)}</Text>
      </Text>
    );
  };

  let prompt = blank;
  let detail = blank;
  let keys: [string, string][] = [];
  switch (mode.kind) {
    case 'list':
      if (note) prompt = <Text color="#e3b341" wrap="truncate">{note}</Text>;
      keys = [['↑/↓', 'choose'], ['↵', 'switch'], ['a', 'add'], ['e', 'rename'], ['x', 'remove'], ['Esc', 'close']];
      break;
    case 'name':
      prompt = field('New profile name:', mode.value);
      detail = mode.error ? <Text color="#f85149" wrap="truncate">{`✗ ${mode.error}`}</Text> : hint('a short name, such as work or private');
      keys = [['↵', 'next'], ['Esc', 'cancel']];
      break;
    case 'connection': {
      prompt = field(`Connection string for “${mode.name}”:`, maskConnectionString(mode.value));
      const again = mode.failed !== undefined && mode.failed === mode.value.replace(/\s+/g, '');
      detail = mode.checking
        ? <Text color="#e3b341" wrap="truncate">Connecting…</Text>
        : mode.error
          ? (
            <Text wrap="truncate">
              <Text color="#f85149">{`✗ ${mode.error}`}</Text>
              {again && <Text color="#8b949e">{'   ↵ again saves it anyway'}</Text>}
            </Text>
          )
          : hint('az storage account show-connection-string -g <group> -n <account> -o tsv   (UseDevelopmentStorage=true for Azurite)');
      keys = mode.checking ? [] : [['↵', 'connect'], ['Esc', 'cancel']];
      break;
    }
    case 'rename':
      prompt = field(`Rename “${mode.from}” to:`, mode.value);
      detail = mode.error ? <Text color="#f85149" wrap="truncate">{`✗ ${mode.error}`}</Text> : hint('its settings and backups stay with it');
      keys = [['↵', 'save'], ['Esc', 'cancel']];
      break;
    case 'remove':
      prompt = <Text color="#f0883e" bold wrap="truncate">{`Remove profile “${mode.name}”?`}</Text>;
      detail = hint('only forgets it here: the storage account and your backup files are not touched');
      keys = [['↵', 'remove'], ['Esc', 'keep it']];
      break;
  }

  return (
    <Box flexDirection="column" height={height} width={columns} paddingX={2} paddingTop={1}>
      <Text color="#f0f6fc" bold>{'🔀 Profiles'}</Text>
      <Text color="#8b949e" wrap="truncate">Each profile is one storage account, with its own settings and backups</Text>
      <Box height={1} />
      <Box flexDirection="column" height={listH} overflowY="hidden">
        {visible.map((p, i) => {
          const focused = start + i === focusIndex;
          const chosen = p.name === active;
          const bg = focused ? '#1c2d4f' : undefined;
          return (
            <Text key={p.name} wrap="truncate">
              <Text color="#1c7cd6" backgroundColor={bg}>{focused ? '▸ ' : '  '}</Text>
              <Text color={chosen ? '#3fb950' : '#8b949e'} backgroundColor={bg}>{chosen ? '● ' : '○ '}</Text>
              <Text color="#f0f6fc" bold={chosen} backgroundColor={bg}>{p.name.padEnd(nameW)}</Text>
              <Text color={p.account ? '#8b949e' : '#e3b341'} backgroundColor={bg}>{`  ${p.account ?? 'no connection string'}`}</Text>
            </Text>
          );
        })}
      </Box>
      <Box height={1} />
      {prompt}
      {detail}
      <Text color="#8b949e" wrap="truncate">
        {keys.map(([k, label], i) => (
          <React.Fragment key={k}>
            <Text color="#58a6ff" bold>{k}</Text>{` ${label}${i < keys.length - 1 ? '   ' : ''}`}
          </React.Fragment>
        ))}
      </Text>
    </Box>
  );
}
