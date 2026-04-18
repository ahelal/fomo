import React, { useEffect, useRef, useState } from 'react';
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
  sourceColors?: Record<string, string>;
  onSwipeAction?(id: string, action: 'read' | 'unread' | 'save'): void;
  onRefresh?(): void;
}

export function UpdatesTable({ updates, selectedId, onSelect, sourceLabels = {}, sourceColors = {}, onSwipeAction, onRefresh }: Props) {
  const selectedRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const pullRef = useRef({ startY: 0, active: false });

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

  // ── Pull-to-refresh handlers ──
  function handlePullStart(e: React.TouchEvent) {
    const el = tableRef.current;
    if (el && el.scrollTop <= 0) {
      pullRef.current = { startY: e.touches[0].clientY, active: true };
    }
  }

  function handlePullMove(e: React.TouchEvent) {
    if (!pullRef.current.active) return;
    const dy = e.touches[0].clientY - pullRef.current.startY;
    if (dy > 0 && tableRef.current && tableRef.current.scrollTop <= 0) {
      setPullDistance(Math.min(dy * 0.4, 80));
    } else {
      pullRef.current.active = false;
      setPullDistance(0);
    }
  }

  function handlePullEnd() {
    if (pullDistance > 50 && onRefresh) {
      onRefresh();
    }
    setPullDistance(0);
    pullRef.current.active = false;
  }

  if (updates.length === 0) {
    return (
      <div className="updates-table empty">
        <p>No updates found.</p>
        <p>Press <kbd>f</kbd> to fetch the latest releases.</p>
      </div>
    );
  }

  return (
    <div
      className="updates-table"
      ref={tableRef}
      onTouchStart={handlePullStart}
      onTouchMove={handlePullMove}
      onTouchEnd={handlePullEnd}
    >
      {/* Pull-to-refresh indicator */}
      {pullDistance > 0 && (
        <div className="pull-indicator" style={{ height: pullDistance }}>
          <span>{pullDistance > 50 ? '↻ Release to refresh' : '↓ Pull to refresh'}</span>
        </div>
      )}

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
