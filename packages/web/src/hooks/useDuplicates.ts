import { useEffect, useState } from 'react';
import type { FomoService, Update } from '@fomo/core';

const NONE: Update[] = [];

/**
 * The other updates of the duplicate group `id` belongs to (its original first), wherever they are
 * stored, so the preview can show them even when they are not in the current view.
 * Pass `undefined` while there is nothing to show them for. They are read again when `stamp` changes,
 * for example when a refresh has added updates. The preview is complete without them, so a failed
 * read is ignored.
 */
export function useDuplicates(
  service: Pick<FomoService, 'getDuplicates'>,
  id: string | undefined,
  stamp?: unknown,
): Update[] {
  const [loaded, setLoaded] = useState<{ id: string; updates: Update[] }>({ id: '', updates: NONE });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    service.getDuplicates(id).then(
      (updates) => { if (!cancelled) setLoaded({ id, updates }); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [service, id, stamp]);

  return loaded.id === id ? loaded.updates : NONE;
}
