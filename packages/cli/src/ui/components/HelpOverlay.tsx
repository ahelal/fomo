import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  context: 'list' | 'detail' | 'settings';
  height: number;
  columns: number;
}

interface Section {
  title: string;
  keys: [string, string][];
}

const LIST_KEYS: [string, string][] = [
  ['↵',    'Open detail view'],
  ['r',    'Mark as read'],
  ['u',    'Mark as unread'],
  ['s',    'Save / unsave'],
  ['x',    'Mark read & next unread'],
  ['n',    'Jump to next unread'],
  ['o',    'Open in browser'],
  ['q',    'Quit'],
];

const DETAIL_KEYS: [string, string][] = [
  ['Esc/⌫', 'Close detail view'],
  ['r',     'Mark as read'],
  ['u',     'Mark as unread'],
  ['s',     'Save / unsave'],
  ['x',     'Mark read & next unread'],
  ['n',     'Jump to next unread'],
  ['o',     'Open URL in browser'],
  ['p',     'Fetch full content'],
];

const GLOBAL_KEYS: [string, string][] = [
  ['↑/k',  'Move up'],
  ['↓/j',  'Move down'],
  ['1–4',  'Filter: all / unread / read / saved'],
  ['f',    'Fetch new updates'],
  ['c',    'Open config'],
  ['.',    'Toggle preview position'],
  ['h',    'Show this help'],
];

const SETTINGS_KEYS: [string, string][] = [
  ['↑/k',  'Move up'],
  ['↓/j',  'Move down'],
  ['↵',    'Toggle / cycle option'],
  ['e',    'Edit source label'],
  ['d',    'Cycle source color'],
  ['Esc/⌫','Close config'],
  ['h',    'Show this help'],
];

function buildSections(context: Props['context']): Section[] {
  if (context === 'settings') {
    return [{ title: 'Config', keys: SETTINGS_KEYS }];
  }
  return [
    {
      title: context === 'detail' ? 'Detail View' : 'List View',
      keys: context === 'detail' ? DETAIL_KEYS : LIST_KEYS,
    },
    { title: 'Global', keys: GLOBAL_KEYS },
  ];
}

const CONTEXT_LABEL: Record<string, string> = {
  list: 'Main View',
  detail: 'Detail View',
  settings: 'Config',
};

const KEY_W = 8;

export function HelpOverlay({ context, height, columns }: Props) {
  const sections = buildSections(context);

  return (
    <Box flexDirection="column" height={height} width={columns}>
      {/* Header */}
      <Box justifyContent="center" paddingTop={1}>
        <Text color="#f0f6fc" bold>{'⌨  Keyboard Shortcuts'}</Text>
      </Box>
      <Box justifyContent="center">
        <Text color="#8b949e">{CONTEXT_LABEL[context]}</Text>
      </Box>
      <Box height={1} />

      {/* Sections */}
      {sections.map((section) => (
        <React.Fragment key={section.title}>
          <Box paddingX={4}>
            <Text color="#58a6ff" bold>{section.title}</Text>
          </Box>
          {section.keys.map(([key, label]) => (
            <Box key={key} paddingX={6}>
              <Text color="#58a6ff" bold>{key.padEnd(KEY_W)}</Text>
              <Text color="#c9d1d9">{label}</Text>
            </Box>
          ))}
          <Box height={1} />
        </React.Fragment>
      ))}

      {/* Footer */}
      <Box justifyContent="center">
        <Text color="#8b949e">
          {'Press '}
          <Text color="#58a6ff" bold>Esc</Text>
          {' or '}
          <Text color="#58a6ff" bold>⌫</Text>
          {' to close'}
        </Text>
      </Box>
    </Box>
  );
}
