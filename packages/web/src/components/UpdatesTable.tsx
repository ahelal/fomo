import React, { useEffect, useRef, useState } from 'react';
import type { Update } from '@fomo/core';
import { usePullToRefresh } from '../hooks/usePullToRefresh.js';

const STATUS_ICON: Record<string, { icon: string; cls: string }> = {
  unread: { icon: '●', cls: 'unread' },
  read:   { icon: '○', cls: 'read' },
};

interface Props {
  updates: Update[];
  selectedId: string | undefined;
  onSelect(update: Update): void;
  sourceLabels?: Record<string, string>;
  sourceColors?: Record<string, string>;
  onSwipeAction?(id: string, action: 'read' | 'unread' | 'save'): void;
  onRefresh?(): void;
}

export function UpdatesTable({ updates, selectedId, onSelect, sourceLabels = {}, sourceColors = {}, onSwipeAction, onRefresh }: Props) {
  const selectedRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);

  const pull = usePullToRefresh(tableRef, onRefresh);

  // Row swipe tracking
  const rowTouchRef = useRef({ startX: 0, startY: 0 });

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  // Close swiped row on outside tap
  useEffect(() => {
    if (!swipedId) return;
    function onClick() { setSwipedId(null); }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [swipedId]);

  // ── Row swipe handlers ──
  function handleRowTouchStart(e: React.TouchEvent) {
    rowTouchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY };
  }

  function handleRowTouchEnd(e: React.TouchEvent, id: string) {
    const dx = e.changedTouches[0].clientX - rowTouchRef.current.startX;
    const dy = e.changedTouches[0].clientY - rowTouchRef.current.startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < -50) {
        setSwipedId((prev) => (prev === id ? null : id));
      } else if (dx > 50 && swipedId === id) {
        setSwipedId(null);
      }
    }
  }

  if (updates.length === 0) {
    return (
      <div className="updates-table empty">
        <p>No updates found.</p>
        <p>Run <kbd>fomo</kbd> on your computer and press <kbd>f</kbd> to pull the latest releases.</p>
      </div>
    );
  }

  return (
    <div
      className="updates-table"
      ref={tableRef}
      {...pull.handlers}
    >
      {pull.indicator}

      <div className="updates-header">
        <span>Source</span>
        <span>Date</span>
        <span>ST</span>
        <span>Title</span>
      </div>
      {updates.map((u) => {
        const isSwiped = swipedId === u.id;
        return (
          <div
            key={u.id}
            ref={u.id === selectedId ? selectedRef : undefined}
            className={[
              'update-row',
              `update-row--${u.status}`,
              u.id === selectedId ? 'update-row--selected' : '',
              isSwiped ? 'update-row--swiped' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onTouchStart={handleRowTouchStart}
            onTouchEnd={(e) => handleRowTouchEnd(e, u.id)}
          >
            <div className="update-row__inner" onClick={() => onSelect(u)}>
              <span className="update-row__source" style={sourceColors[u.source] ? { color: sourceColors[u.source] } : undefined}>{sourceLabels[u.source] ?? u.source}</span>
              <span className="update-row__date">{u.datePublished.slice(0, 10)}</span>
              <span className={`update-row__status-dot update-row__status-dot--${STATUS_ICON[u.status]?.cls ?? u.status}`}>
                {u.saved ? '⭐' : ''}{STATUS_ICON[u.status]?.icon ?? u.status}
              </span>
              <span className="update-row__title">{u.title}</span>
            </div>
            {isSwiped && (
              <div className="update-row__actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className={`swipe-btn swipe-btn--${u.status === 'unread' ? 'read' : 'unread'}`}
                  onClick={() => { onSwipeAction?.(u.id, u.status === 'unread' ? 'read' : 'unread'); setSwipedId(null); }}
                >
                  {u.status === 'unread' ? '✓' : '●'}
                </button>
                <button
                  className="swipe-btn swipe-btn--save"
                  onClick={() => { onSwipeAction?.(u.id, 'save'); setSwipedId(null); }}
                >
                  {u.saved ? '★' : '☆'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
