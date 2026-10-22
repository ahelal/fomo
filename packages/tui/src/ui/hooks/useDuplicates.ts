import { useEffect, useRef, useState } from 'react';
import type { FomoService, Update } from '@fomo/core';

const NONE: Update[] = [];

/**
 * The other updates of the duplicate group `id` belongs to (its original first), wherever they are
 * stored, so the preview can show them even when they are not in the current view.
 * Pass `undefined` while there is nothing to show them for. They are read again when `stamp` changes,
 * for example when a fetch has added updates.
 */
export function useDuplicates(
  service: Pick<FomoService, 'getDuplicates'>,
  id: string | undefined,
  onError: (err: unknown) => void,
  stamp?: unknown,
): Update[] {
  const [loaded, setLoaded] = useState<{ id: string; updates: Update[] }>({ id: '', updates: NONE });
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    // `then` turns a missing or throwing service into a rejection instead of breaking the render.
    Promise.resolve()
      .then(() => service.getDuplicates(id))
      .then(
        (updates) => { if (!cancelled) setLoaded({ id, updates }); },
        (err) => { if (!cancelled) onErrorRef.current(err); },
      );
    return () => { cancelled = true; };
  }, [service, id, stamp]);

  return loaded.id === id ? loaded.updates : NONE;
}
