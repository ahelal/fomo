import React, { useRef, useState } from 'react';

const THRESHOLD = 50;

/** Pull-down-to-refresh for a scroll container; spread `handlers` on it and render `distance`. */
export function usePullToRefresh(scrollRef: React.RefObject<HTMLElement>, onRefresh?: () => void) {
  const [distance, setDistance] = useState(0);
  const pullRef = useRef({ startY: 0, active: false });

  const handlers = {
    onTouchStart(e: React.TouchEvent) {
      const el = scrollRef.current;
      if (el && el.scrollTop <= 0) pullRef.current = { startY: e.touches[0].clientY, active: true };
    },
    onTouchMove(e: React.TouchEvent) {
      if (!pullRef.current.active) return;
      const dy = e.touches[0].clientY - pullRef.current.startY;
      if (dy > 0 && scrollRef.current && scrollRef.current.scrollTop <= 0) {
        setDistance(Math.min(dy * 0.4, 80));
      } else {
        pullRef.current.active = false;
        setDistance(0);
      }
    },
    onTouchEnd() {
      if (distance > THRESHOLD && onRefresh) onRefresh();
      setDistance(0);
      pullRef.current.active = false;
    },
  };

  const indicator = distance > 0 ? (
    React.createElement(
      'div',
      { className: 'pull-indicator', style: { height: distance } },
      React.createElement('span', null, distance > THRESHOLD ? '↻ Release to refresh' : '↓ Pull to refresh'),
    )
  ) : null;

  return { handlers, indicator };
}
