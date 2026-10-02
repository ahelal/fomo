import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { StatsResponse } from '@fomo/core';
import { fit, textWidth } from '../text.js';

/** A long-running background job (fetch, Copilot digest, restore) shown until it finishes. */
export interface Activity {
  label: string;
  startedAt: number;
}

interface Props {
  stats?: StatsResponse;
  loading?: boolean;
  message?: string;
  activity?: Activity;
  columns: number;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPIN_MS = 120;
/** Columns the activity label keeps when a message competes for space. */
const MIN_LABEL = 16;

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

export const StatusBar = React.memo(function StatusBar({ stats, loading, message, activity, columns }: Props) {
  // Animate while a background job runs, so it's obvious the app is still working.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!activity) return;
    const timer = setInterval(() => setTick((t) => t + 1), SPIN_MS);
    return () => clearInterval(timer);
  }, [activity]);

  const unread = stats?.byStatus.unread ?? 0;
  const saved  = stats?.saved          ?? 0;
  const read   = stats?.byStatus.read  ?? 0;
  const total  = stats?.total          ?? 0;

  const bg = '#0d4f8b';

  const brandStr = ' 📰 FOMO ';
  const sep = ' │ ';
  const helpStr = '[h] help ';
  const statsStr = stats
    ? `Total: ${total}  Unread: ${unread}  Read: ${read}  Saved: ${saved}`
    : 'loading…';
  const leftW = textWidth(brandStr + sep + statsStr);
  let room = columns - leftW - textWidth(sep + helpStr) - 1;

  // Spinner and elapsed time always show; the message comes next; the label gets the rest.
  const spinStr = activity ? ` ${SPINNER[tick % SPINNER.length]} ` : loading ? ' ⟳ ' : '';
  const elapsedStr = activity ? ` · ${formatElapsed(Date.now() - activity.startedAt)} ` : '';
  room -= textWidth(spinStr + elapsedStr);
  const labelWant = activity ? Math.min(textWidth(activity.label), MIN_LABEL) : 0;
  const shownMessage = message ? fit(message, room - labelWant - 2) : '';
  const messageStr = shownMessage ? ` ${shownMessage} ` : '';
  room -= textWidth(messageStr);
  const labelStr = activity ? fit(activity.label, room) : '';
  const messageColor = /^⚠|error:/i.test(message ?? '') ? '#f0883e' : '#3fb950';

  const rightW = textWidth(messageStr + spinStr + labelStr + elapsedStr + sep + helpStr);
  const pad = ' '.repeat(Math.max(1, columns - leftW - rightW));

  return (
    <Box flexDirection="column" width={columns}>
      <Text backgroundColor={bg} wrap="truncate">
        <Text color="#f0f6fc" bold backgroundColor={bg}>{brandStr}</Text>
        <Text color="#8b949e" backgroundColor={bg}>{sep}</Text>
        {stats ? (
          <>
            <Text color="#8b949e" backgroundColor={bg}>{'Total: '}</Text>
            <Text color="#f0f6fc" bold backgroundColor={bg}>{total}</Text>
            <Text color="#8b949e" backgroundColor={bg}>{'  Unread: '}</Text>
            <Text color="#f0f6fc" bold backgroundColor={bg}>{unread}</Text>
            <Text color="#8b949e" backgroundColor={bg}>{'  Read: '}</Text>
            <Text color="#8b949e" backgroundColor={bg}>{read}</Text>
            <Text color="#8b949e" backgroundColor={bg}>{'  Saved: '}</Text>
            <Text color="#e3b341" bold backgroundColor={bg}>{saved}</Text>
          </>
        ) : (
          <Text color="#8b949e" backgroundColor={bg}>{'loading…'}</Text>
        )}
        <Text backgroundColor={bg}>{pad}</Text>
        {messageStr && <Text color={messageColor} backgroundColor={bg}>{messageStr}</Text>}
        {spinStr && <Text color="#e3b341" bold backgroundColor={bg}>{spinStr}</Text>}
        {labelStr && <Text color="#e3b341" backgroundColor={bg}>{labelStr}</Text>}
        {elapsedStr && <Text color="#8b949e" backgroundColor={bg}>{elapsedStr}</Text>}
        <Text color="#8b949e" backgroundColor={bg}>{sep}</Text>
        <Text color="#58a6ff" bold backgroundColor={bg}>{'[h]'}</Text>
        <Text color="#8b949e" backgroundColor={bg}>{' help '}</Text>
      </Text>
      <Text color="#30363d">{'─'.repeat(columns)}</Text>
    </Box>
  );
});
