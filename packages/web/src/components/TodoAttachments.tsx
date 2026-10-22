import React, { useEffect, useRef, useState } from 'react';
import { attachmentTarget, shortcutKey, type Todo } from '@fomo/core';
import { useWindowKeys } from '../hooks/useKeys.js';
import { errorText } from '../hooks/useFolderTree.js';

export function TodoAttachments({ todo, onClose }: { todo: Todo; onClose(): void }) {
  const targets = todo.attachments ?? [];
  const [index, setIndex] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const actions = useRef<(HTMLAnchorElement | HTMLButtonElement | null)[]>([]);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  useEffect(() => { actions.current[index]?.focus(); }, [index]);

  useWindowKeys(true, (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = shortcutKey(e.key);
    const delta = key === 'ArrowUp' || key === 'k' ? -1 : key === 'ArrowDown' || key === 'j' ? 1 : 0;
    if (delta) {
      e.preventDefault();
      setIndex((i) => Math.max(0, Math.min(targets.length - 1, i + delta)));
    } else if (key === 'o') {
      e.preventDefault();
      actions.current[index]?.click();
    } else if (e.key === 'Tab') {
      const buttons = panel.current?.querySelectorAll<HTMLElement>('button, a[href]');
      if (!buttons?.length) return;
      const first = buttons[0]!;
      const last = buttons[buttons.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, true);

  const copyPath = async (path: string) => {
    setMessage('');
    setError('');
    try {
      if (!navigator.clipboard) throw new Error('Copying paths requires a secure (HTTPS or localhost) page');
      await navigator.clipboard.writeText(path);
      setMessage('Copied the path');
    } catch (err) {
      setError(`Could not copy the path: ${errorText(err)}`);
    }
  };

  return (
    <div className="help-overlay" onClick={onClose}>
      <div ref={panel} className="help-panel todo-attachments" role="dialog" aria-modal="true" aria-label={`Attachments for ${todo.subject}`} onClick={(e) => e.stopPropagation()}>
        <div className="help-panel__header">
          <h2>Attachments · {todo.subject}</h2>
          <button type="button" className="btn" onClick={onClose} aria-label="Close attachments">✕</button>
        </div>
        <p className="todo-attachments__hint">URLs open in a new tab. Copy local paths to use on the computer where the file exists, or open them from the TUI.</p>
        <ul className="todo-attachments__list">
          {targets.map((target, i) => {
            const { kind, value } = attachmentTarget(target);
            return (
              <li key={`${i}:${target}`} className={index === i ? 'todo-attachments__selected' : undefined}>
                <span className="todo-attachments__kind">{kind === 'url' ? 'URL' : 'FILE'}</span>
                {kind === 'url' ? (
                  <a ref={(el) => { actions.current[i] = el; }} href={value} target="_blank" rel="noopener noreferrer" onFocus={() => setIndex(i)}>{value}</a>
                ) : (
                  <>
                    <code>{value}</code>
                    <button ref={(el) => { actions.current[i] = el; }} type="button" className="btn" onFocus={() => setIndex(i)} onClick={() => void copyPath(value)} aria-label={`Copy path ${value}`}>Copy path</button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <p className={error ? 'todo-attachments__message tree-error' : 'todo-attachments__message'} role={error ? 'alert' : 'status'}>{error || message}</p>
        <p className="todo-attachments__hint">↑↓ selects · Enter/o opens a URL or copies a path · Esc closes</p>
      </div>
    </div>
  );
}
