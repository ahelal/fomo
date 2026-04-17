import React, { useEffect, useRef } from 'react';
import type { Update } from '@fomo/core';

const STATUS_ICON: Record<string, { icon: string; cls: string }> = {
  unread: { icon: '●', cls: 'unread' },
  read:   { icon: '○', cls: 'read' },
};

interface Props {
  updates: Update[];
  selectedId: string | undefined;
  onSelect(update: Update): void;
  sourceLabels?: Record<string, string>;
}

export function UpdatesTable({ updates, selectedId, onSelect, sourceLabels = {} }: Props) {
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  if (updates.length === 0) {
    return (
      <div className="updates-table empty">
        <p>No updates found.</p>
        <p>Press <kbd>f</kbd> to fetch the latest releases.</p>
      </div>
    );
  }

  return (
    <div className="updates-table">
      <div className="updates-header">
        <span>Source</span>
        <span>Date</span>
        <span>ST</span>
        <span>Title</span>
      </div>
      {updates.map((u) => (
        <div
          key={u.id}
          ref={u.id === selectedId ? selectedRef : undefined}
          className={[
            'update-row',
            `update-row--${u.status}`,
            u.id === selectedId ? 'update-row--selected' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelect(u)}
        >
          <span className="update-row__source">{sourceLabels[u.source] ?? u.source}</span>
          <span className="update-row__date">{u.datePublished.slice(0, 10)}</span>
          <span className={`update-row__status-dot update-row__status-dot--${STATUS_ICON[u.status]?.cls ?? u.status}`}>
            {u.saved ? '⭐' : ''}{STATUS_ICON[u.status]?.icon ?? u.status}
          </span>
          <span className="update-row__title">{u.title}</span>
        </div>
      ))}
    </div>
  );
}
