import { useEffect, useRef, useState } from 'react';

/** Calls `fetch` every `minutes` (none when undefined); returns when the next run is due (epoch ms). */
export function useAutoFetch(fetch: () => void, minutes: number | undefined): number | undefined {
  const fetchRef = useRef(fetch);
  useEffect(() => { fetchRef.current = fetch; }, [fetch]);
  const [nextAt, setNextAt] = useState<number | undefined>();

  useEffect(() => {
    if (!minutes) {
      setNextAt(undefined);
      return;
    }
    const intervalMs = minutes * 60_000;
    setNextAt(Date.now() + intervalMs);
    const timer = setInterval(() => {
      setNextAt(Date.now() + intervalMs);
      fetchRef.current();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [minutes]);

  return nextAt;
}
