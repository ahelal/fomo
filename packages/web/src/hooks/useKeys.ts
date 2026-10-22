import { useEffect, useRef, type RefObject } from 'react';

/** Calls the latest `handler` for every key pressed while `active` (after the popups above have had theirs). */
export function useWindowKeys(active: boolean, handler: (e: KeyboardEvent) => void, capture = false) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!active) return;
    const listener = (e: KeyboardEvent) => latest.current(e);
    window.addEventListener('keydown', listener, capture);
    return () => window.removeEventListener('keydown', listener, capture);
  }, [active, capture]);
}

/**
 * A dialog's keys: Esc closes it, ↵ in a text area saves the form (⇧↵ adds a line), and no key
 * reaches the app behind it. With `multiline`, Enter adds a line and Ctrl/Cmd+S saves instead.
 * While `paused` (its color picker is open) the keys are left to the
 * popup: a window capture listener can't stop the others on the window, so the dialog steps aside.
 */
export function useDialogKeys(formRef: RefObject<HTMLFormElement>, onClose: () => void, paused = false, multiline = false) {
  const latest = useRef({ onClose, paused, multiline });
  latest.current = { onClose, paused, multiline };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (latest.current.paused) return;
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); latest.current.onClose(); return; }
      if (latest.current.multiline && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        formRef.current?.requestSubmit();
        return;
      }
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (e.key === 'Enter' && !e.shiftKey && target?.tagName === 'TEXTAREA' && (!latest.current.multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [formRef]);
}
