import React, { useEffect, useRef } from 'react';
import type { DigestRow } from '@fomo/core';
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
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const pull = usePullToRefresh(listRef, onRefresh);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  const label = (s: string) => sourceLabels[s] ?? s;
  const colorStyle = (s: string) => (sourceColors[s] ? { color: sourceColors[s] } : undefined);

  if (rows.length === 0) {
    return (
      <div className="updates-table empty" ref={listRef} {...pull.handlers}>
        {pull.indicator}
        <p>All caught up 🎉</p>
        <p>Run <kbd>fomo fetch</kbd> on your computer to pull new updates and group them by topic.</p>
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
          {pending} update{pending === 1 ? '' : 's'} not grouped yet — run <kbd>fomo digest</kbd>
        </div>
      )}
      {rows.map((row) => {
        const selected = row.key === selectedKey;
        const cls = ['digest-row', `digest-row--${row.kind}`, selected ? 'digest-row--selected' : ''].filter(Boolean).join(' ');

        if (row.kind === 'item') {
          const u = row.update;
          return (
            <div key={row.key} ref={selected ? selectedRef : undefined} className={cls}>
              <div className="digest-row__inner" onClick={() => onSelect(row)}>
                <span className="digest-row__marker">└</span>
                <span className="digest-row__title">
                  {u.saved ? '⭐ ' : ''}{u.title}
                  {u.summary && <span className="digest-row__summary">{u.summary}</span>}
                </span>
                <span />
                <span className="digest-row__sources" style={colorStyle(u.source)}>{label(u.source)}</span>
                <span className="digest-row__date">{u.datePublished.slice(0, 10)}</span>
                <button className="digest-row__read" title="Mark read" onClick={(e) => { e.stopPropagation(); onMarkRead(row); }}>✓</button>
              </div>
            </div>
          );
        }

        const { entry } = row;
        const open = expanded.has(entry.topic.id);
        const single = entry.sources.length === 1 ? entry.sources[0]! : undefined;
        const importance = entry.topic.importance;
        return (
          <div
            key={row.key}
            ref={selected ? selectedRef : undefined}
            className={importance ? `${cls} digest-row--imp-${importance}` : cls}
          >
            <div className="digest-row__inner" onClick={() => onSelect(row)}>
              {entry.synthetic ? (
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
                {entry.synthetic && entry.items[0]!.saved ? '⭐ ' : ''}{entry.topic.title}
              </span>
              <span className="digest-row__count">{entry.synthetic ? '' : `×${entry.items.length}`}</span>
              <span className="digest-row__sources" style={single ? colorStyle(single) : undefined}>
                {single ? label(single) : entry.sources.map(label).join(', ')}
              </span>
              <span className="digest-row__date">{entry.latestDate.slice(0, 10)}</span>
              <button
                className="digest-row__read"
                title={entry.synthetic ? 'Mark read' : 'Mark topic read'}
                onClick={(e) => { e.stopPropagation(); onMarkRead(row); }}
              >
                ✓
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
