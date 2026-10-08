import React, { useEffect, useRef, useState } from 'react';

export interface SourceOption {
  id: string;
  label: string;
  color?: string;
  /** Updates from this source in the current view (with the search applied). */
  count: number;
}

interface Props {
  /** Undefined while the counts load. */
  options: SourceOption[] | undefined;
  /** Applied filter; undefined means every source is shown. */
  current: string[] | undefined;
  /** Undefined when every option is ticked (no filter). */
  onApply(ids: string[] | undefined): void;
  onClose(): void;
}

/** Pop-up to pick which sources the views show. Keys: ↑/↓ j/k, space toggle, a all, n none, ↵ apply, Esc cancel. */
export function SourcePicker({ options, current, onApply, onClose }: Props) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(current ?? []));
  const [focus, setFocus] = useState(0);
  const [warning, setWarning] = useState<string | undefined>();
  const listRef = useRef<HTMLDivElement>(null);

  // Start with every source ticked when no filter is applied.
  useEffect(() => {
    if (options && !current) setChecked(new Set(options.map((o) => o.id)));
  }, [options, current]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${focus}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  const update = (next: ReadonlySet<string>) => { setChecked(next); setWarning(undefined); };
  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  const apply = () => {
    if (!options) return;
    const chosen = options.filter((o) => checked.has(o.id)).map((o) => o.id);
    if (options.length > 0 && chosen.length === 0) {
      setWarning('Tick at least one source, or pick All');
      return;
    }
    onApply(chosen.length === options.length ? undefined : chosen);
  };

  const keys = useRef({ apply, toggle, update, options, focus });
  keys.current = { apply, toggle, update, options, focus };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = keys.current;
      if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); onClose(); return; }
      if (!k.options) return;
      const last = Math.max(0, k.options.length - 1);
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setFocus((i) => Math.min(last, i + 1)); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setFocus((i) => Math.max(0, i - 1)); }
      else if (e.key === ' ') { e.preventDefault(); const o = k.options[k.focus]; if (o) k.toggle(o.id); }
      else if (e.key === 'a') k.update(new Set(k.options.map((o) => o.id)));
      else if (e.key === 'n') k.update(new Set());
      else if (e.key === 'Enter') { e.preventDefault(); k.apply(); }
    }
    // Capture so the app's own shortcuts don't also run while the picker is open.
    const handler = (e: KeyboardEvent) => { e.stopPropagation(); onKey(e); };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-panel source-picker" onClick={(e) => e.stopPropagation()}>
        <div className="help-panel__header">
          <h2>⧩ Show sources</h2>
          <span className="help-panel__context">
            {options ? `${checked.size} of ${options.length} selected` : 'Counting…'}
          </span>
          <button className="btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="source-picker__bulk">
          <button className="btn" disabled={!options} onClick={() => options && update(new Set(options.map((o) => o.id)))}>All <kbd>a</kbd></button>
          <button className="btn" disabled={!options} onClick={() => update(new Set())}>None <kbd>n</kbd></button>
          <span className="source-picker__note">Counts are for this view and search</span>
        </div>
        <div className="source-picker__list" ref={listRef} role="listbox" aria-multiselectable="true">
          {options?.length === 0 && <p className="source-picker__note">No updates in this view</p>}
          {options?.map((o, i) => (
            <label
              key={o.id}
              data-index={i}
              className={['source-picker__row', i === focus ? 'source-picker__row--focus' : ''].join(' ')}
              onMouseEnter={() => setFocus(i)}
            >
              <input type="checkbox" checked={checked.has(o.id)} onChange={() => toggle(o.id)} />
              <span className="source-picker__label" style={o.color ? { color: o.color } : undefined}>{o.label}</span>
              <span className="source-picker__count">{o.count}</span>
            </label>
          ))}
        </div>
        {warning && <p className="source-picker__warning">{warning}</p>}
        <div className="source-picker__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={!options} onClick={apply}>Apply <kbd>↵</kbd></button>
        </div>
      </div>
    </div>
  );
}

interface ChipProps {
  filter: string[] | undefined;
  /** Source names (or a count) when filtered. */
  label: string | undefined;
  onOpen(): void;
  onClear(): void;
}

/** Shows the applied source filter (v / click to change, ✕ to clear) next to the search box. */
export function SourceFilterChip({ filter, label, onOpen, onClear }: ChipProps) {
  return (
    <div className={['source-chip', filter ? 'source-chip--active' : ''].join(' ')}>
      <button
        type="button"
        className="source-chip__open"
        onClick={onOpen}
        title={filter ? `Showing ${label} — change sources (v)` : 'Pick which sources to show (v)'}
      >
        ⧩ <span className="source-chip__label">{filter ? label : 'Sources'}</span>
        {!filter && <kbd className="search__hint">v</kbd>}
      </button>
      {filter && (
        <button type="button" className="search__clear" aria-label="Clear source filter" title="Clear source filter" onClick={onClear}>
          ✕
        </button>
      )}
    </div>
  );
}
