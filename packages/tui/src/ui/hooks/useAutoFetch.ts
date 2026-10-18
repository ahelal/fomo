import { useEffect, useRef, useState } from 'react';

export const AUTO_FETCH_INTERVAL_MS = 15 * 60 * 1000;

/** Calls `fetch` every 15 minutes while `enabled`; returns when the next run is due (epoch ms). */
export function useAutoFetch(fetch: () => void, enabled = true): number | undefined {
  const fetchRef = useRef(fetch);
  useEffect(() => { fetchRef.current = fetch; }, [fetch]);
  const [nextAt, setNextAt] = useState<number | undefined>();

  useEffect(() => {
    if (!enabled) {
      setNextAt(undefined);
      return;
    }
    setNextAt(Date.now() + AUTO_FETCH_INTERVAL_MS);
    const timer = setInterval(() => {
      setNextAt(Date.now() + AUTO_FETCH_INTERVAL_MS);
      fetchRef.current();
    }, AUTO_FETCH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  return nextAt;
}
