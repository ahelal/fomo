import { useEffect, useRef } from 'react';

export const AUTO_FETCH_INTERVAL_MS = 15 * 60 * 1000;

export function useAutoFetch(fetch: () => void): void {
  const fetchRef = useRef(fetch);
  useEffect(() => { fetchRef.current = fetch; }, [fetch]);

  useEffect(() => {
    const timer = setInterval(() => fetchRef.current(), AUTO_FETCH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
