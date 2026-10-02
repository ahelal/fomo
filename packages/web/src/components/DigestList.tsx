import React, { useEffect, useRef } from 'react';
import { soloUpdate, type DigestRow, type Update } from '@fomo/core';
import { usePullToRefresh } from '../hooks/usePullToRefresh.js';

interface Props {
  rows: DigestRow[];
  expanded: ReadonlySet<string>;
  selectedKey: string | undefined;
  pending: number;
  onSelect(row: DigestRow): void;
  onToggle(topicId: string): void;
  onMarkRead(row: DigestRow): void;
  sourceLabels?: Record<string, string>;
  sourceColors?: Record<string, string>;
  onRefresh?(): void;
  /** Applied search, for the empty state. */
  search?: string;
  /** `saved` lists saved updates (read or unread) and marks the unread ones instead of the saved ones. */
  mode?: 'digest' | 'saved';
}

export function DigestList({
  rows,
  expanded,
  selectedKey,
  pending,
  onSelect,
  onToggle,
  onMarkRead,
  sourceLabels = {},
  sourceColors = {},
  onRefresh,
  search,
  mode = 'digest',
}: Props) {
  const saved = mode === 'saved';
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const pull = usePullToRefresh(listRef, onRefresh);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  const label = (s: string) => sourceLabels[s] ?? s;
  /** Saved view: a dot on unread updates; digest: a star on saved ones. */
  const badge = (u: Update) => (
    saved
      ? u.status === 'unread' && <span className="digest-row__unread" title="Unread">● </span>
      : u.saved && '⭐ '
  );
  const readButton = (row: DigestRow, title: string) => (
    // The Saved view keeps read updates, so only offer ✓ while something in the row is unread.
    saved && !(row.kind === 'item' ? [row.update] : row.entry.items).some((u) => u.status === 'unread')
      ? <span />
      : <button className="digest-row__read" title={title} onClick={(e) => { e.stopPropagation(); onMarkRead(row); }}>✓</button>
  );
  const colorStyle = (s: string) => (sourceColors[s] ? { color: sourceColors[s] } : undefined);

  if (rows.length === 0) {
    return (
      <div className="updates-table empty" ref={listRef} {...pull.handlers}>
        {pull.indicator}
        {search ? (
          <p>No {saved ? 'saved' : 'unread'} updates match “{search}”. Press <kbd>Esc</kbd> or ✕ to clear the search.</p>
        ) : saved ? (
          <p>No saved updates — press <kbd>s</kbd> (or ☆) on an update to save it.</p>
        ) : (
          <>
            <p>All caught up 🎉</p>
            <p>Run <kbd>fomo</kbd> on your computer and press <kbd>f</kbd> to pull new updates and group them by topic.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="updates-table digest" ref={listRef} {...pull.handlers}>
      {pull.indicator}
      <div className="digest-header">
        <span />
        <span>Topic</span>
        <span>#</span>
        <span>Sources</span>
        <span>Latest</span>
        <span />
      </div>
      {pending > 0 && (
        <div className="digest-pending">
          {pending} {saved ? 'saved ' : ''}update{pending === 1 ? '' : 's'} not grouped yet — press <kbd>f</kbd> in <kbd>fomo</kbd> to group them
        </div>
      )}
      {rows.map((row) => {
        const selected = row.key === selectedKey;
        const read = saved && (row.kind === 'item' ? [row.update] : row.entry.items).every((u) => u.status !== 'unread');
        const cls = ['digest-row', `digest-row--${row.kind}`, selected ? 'digest-row--selected' : '', read ? 'digest-row--read' : '']
          .filter(Boolean)
          .join(' ');

        if (row.kind === 'item') {
          const u = row.update;
          return (
            <div key={row.key} ref={selected ? selectedRef : undefined} className={cls}>
              <div className="digest-row__inner" onClick={() => onSelect(row)}>
                <span className="digest-row__marker">└</span>
                <span className="digest-row__title">
                  {badge(u)}{u.title}
                  {u.summary && <span className="digest-row__summary">{u.summary}</span>}
                </span>
                <span />
                <span className="digest-row__sources" style={colorStyle(u.source)}>{label(u.source)}</span>
                <span className="digest-row__date">{u.datePublished.slice(0, 10)}</span>
                {readButton(row, 'Mark read')}
              </div>
            </div>
          );
        }

        const { entry } = row;
        const solo = soloUpdate(entry);
        const summary = solo ? solo.summary || (entry.synthetic ? '' : entry.topic.summary) : '';
        const open = expanded.has(entry.topic.id);
        const single = entry.sources.length === 1 ? entry.sources[0]! : undefined;
        const importance = entry.topic.importance;
        const rowCls = [cls, importance ? `digest-row--imp-${importance}` : '', solo ? 'digest-row--solo' : ''].filter(Boolean).join(' ');
        return (
          <div key={row.key} ref={selected ? selectedRef : undefined} className={rowCls}>
            <div className="digest-row__inner" onClick={() => onSelect(row)}>
              {solo ? (
                <span className="digest-row__marker">•</span>
              ) : (
                <button
                  className="digest-row__marker digest-row__toggle"
                  aria-label={open ? 'Collapse' : 'Expand'}
                  onClick={(e) => { e.stopPropagation(); onToggle(entry.topic.id); }}
                >
                  {open ? '▾' : '▸'}
                </button>
              )}
              <span className="digest-row__title">
                {importance === 'high' && <span className="digest-row__imp" title="High importance">▲</span>}
                {solo && badge(solo)}{solo ? solo.title : entry.topic.title}
                {summary && <span className="digest-row__summary">{summary}</span>}
              </span>
              <span className="digest-row__count">{solo ? '' : `×${entry.items.length}`}</span>
              <span className="digest-row__sources" style={single ? colorStyle(single) : undefined}>
                {single ? label(single) : entry.sources.map(label).join(', ')}
              </span>
              <span className="digest-row__date">{entry.latestDate.slice(0, 10)}</span>
              {readButton(row, solo ? 'Mark read' : 'Mark topic read')}
            </div>
          </div>
        );
      })}
    </div>
  );
}
