import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PALETTE,
  PALETTE_COLUMNS,
  colorName,
  hexColorError,
  normalizeHexColor,
  paletteIndex,
  pickerColor,
  pickerFallback,
  pickerMove,
  pickerResult,
  pickerSelect,
  pickerState,
  pickerTyped,
  readableTextColor,
  shortcutKey,
  vimMove,
  type ColorPickerState,
  type ColorRequest,
  type GridMove,
} from '@fomo/core';

export type { ColorRequest };
export type OpenColorPicker = (request: ColorRequest) => void;

interface Props {
  request: ColorRequest;
  onClose(): void;
}

interface PickerView extends ColorPickerState {
  /** The hex field's text. */
  draft: string;
  error?: string;
}

const ARROW_MOVES: Partial<Record<string, GridMove>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** The highlight moved: the hex field shows the new color. */
const follow = (s: ColorPickerState): PickerView => ({ ...s, draft: pickerColor(s), error: undefined });

/** Tab and Shift+Tab cycle through the popup's controls instead of leaving it. */
function keepFocusIn(panel: HTMLElement | null, e: KeyboardEvent) {
  if (!panel) return;
  const items = [...panel.querySelectorAll<HTMLElement>('button, input, [tabindex]')]
    .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  const outside = !panel.contains(active) || active === panel;
  if (outside || (e.shiftKey ? active === first : active === last)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

/**
 * The color picker popup, without the portal: a palette grid, a preview, a hex field and the
 * browser's own picker for any other color.
 *
 * Keys: arrows (or h j k l) move, ↵ or space applies, d goes back to the fallback, # types a hex
 * color, Esc cancels. While it is open, no key reaches anything behind it.
 */
export function ColorPickerDialog({ request, onClose }: Props) {
  const [view, setView] = useState<PickerView>(() => follow(pickerState(request)));
  const viewRef = useRef(view);
  viewRef.current = view;
  const latest = useRef({ request, onClose });
  latest.current = { request, onClose };
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const hexRef = useRef<HTMLInputElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);

  const pick = useCallback((color: string) => {
    const { request: req, onClose: close } = latest.current;
    close();
    req.onPick(color);
  }, []);
  const cancel = useCallback(() => latest.current.onClose(), []);
  const applyHex = useCallback(() => {
    const v = viewRef.current;
    const hex = normalizeHexColor(v.draft);
    if (hex) pick(hex);
    else setView({ ...v, error: hexColorError(v.draft) });
  }, [pick]);
  const focusHighlight = useCallback(() => {
    const swatch = gridRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (swatch ?? panelRef.current)?.focus();
  }, []);

  // Open with the focus on the highlighted swatch, and give it back on closing.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusHighlight();
    return () => opener?.focus({ preventScroll: true });
  }, [focusHighlight]);

  // The focus follows the highlight around the grid.
  useEffect(() => {
    const active = document.activeElement;
    if (active === panelRef.current || gridRef.current?.contains(active)) focusHighlight();
  }, [view.index, view.custom, focusHighlight]);

  useEffect(() => {
    // Capture, and stop it there: nothing behind the popup sees a key while it is open.
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (e.key === 'Tab') { keepFocusIn(panelRef.current, e); return; }
      if (target === hexRef.current) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setView((v) => follow(v));
          focusHighlight();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          applyHex();
        }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
      if (target === nativeRef.current || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Enter' || e.key === ' ') {
        // A focused button (Cancel, Apply…) does its own thing.
        if (target instanceof HTMLButtonElement && target.dataset.swatch === undefined) return;
        e.preventDefault();
        pick(pickerResult(viewRef.current));
        return;
      }
      if (e.key === 'Backspace') { e.preventDefault(); cancel(); return; }
      if (e.key === '#') {
        e.preventDefault();
        hexRef.current?.focus();
        hexRef.current?.select();
        return;
      }
      const key = shortcutKey(e.key);
      if (key === 'd') { e.preventDefault(); pick(''); return; }
      const move = ARROW_MOVES[e.key] ?? vimMove(key);
      if (move) {
        e.preventDefault();
        setView((v) => follow(pickerMove(v, move)));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [applyHex, cancel, focusHighlight, pick]);

  const current = pickerColor(view);
  const own = view.color;
  const fallback = pickerFallback(view);
  const fallbackLabel = view.fallbackLabel ?? 'default';
  const was = paletteIndex(own || fallback);
  // Until the highlight moves, applying keeps an inherited color inherited.
  const keeps = !view.moved && !own;

  return (
    <div className="color-picker__overlay" onClick={(e) => { e.stopPropagation(); cancel(); }}>
      <div
        ref={panelRef}
        className="color-picker"
        role="dialog"
        aria-modal="true"
        aria-label={`Pick a color for ${view.title}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="color-picker__header">
          <h2>🎨 Pick a color</h2>
          <span className="color-picker__for" title={view.title}>{view.title}</span>
          <button type="button" className="btn" onClick={cancel} aria-label="Close">✕</button>
        </div>

        <div
          ref={gridRef}
          className="color-picker__grid"
          role="radiogroup"
          aria-label="Palette"
          style={{ gridTemplateColumns: `repeat(${PALETTE_COLUMNS}, 1fr)` }}
        >
          {PALETTE.map((c, i) => {
            const selected = i === view.index;
            const classes = ['color-picker__swatch'];
            if (selected) classes.push('color-picker__swatch--selected');
            if (i === was) classes.push('color-picker__swatch--was');
            return (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${c.name} ${c.hex}`}
                title={`${c.name} ${c.hex}`}
                data-swatch=""
                tabIndex={i === Math.max(view.index, 0) ? 0 : -1}
                className={classes.join(' ')}
                style={{ backgroundColor: c.hex, color: readableTextColor(c.hex) }}
                onClick={() => setView((v) => follow(pickerSelect(v, c.hex)))}
                onDoubleClick={() => pick(c.hex)}
              >
                {selected ? '✓' : i === was ? '•' : ''}
              </button>
            );
          })}
        </div>

        <div className="color-picker__preview">
          <span className="color-picker__chip" style={{ backgroundColor: current, color: readableTextColor(current) }}>Aa</span>
          <span className="color-picker__now">
            <strong>{colorName(current)}</strong>
            <code>{current}{view.index < 0 ? ' · custom' : ''}</code>
            {keeps && <span className="color-picker__tag">{fallbackLabel}</span>}
          </span>
        </div>

        <dl className="color-picker__facts">
          <dt>Was</dt>
          <dd>
            {own ? (
              <><span className="color-picker__dot" style={{ backgroundColor: own }} />{colorName(own)} <code>{own}</code></>
            ) : (
              <><span className="color-picker__dot color-picker__dot--none" style={{ borderColor: fallback }} />{fallbackLabel} ({colorName(fallback)})</>
            )}
          </dd>
          {view.sample !== undefined && (
            <><dt>Sample</dt><dd className="color-picker__sample" style={{ color: current }}>{view.sample}</dd></>
          )}
        </dl>

        <div className="color-picker__custom">
          <label className="color-picker__hex">
            <span>Hex</span>
            <input
              ref={hexRef}
              value={view.draft}
              onChange={(e) => {
                const text = e.target.value;
                setView((v) => {
                  const typed = pickerTyped(v, text);
                  return { ...typed.state, draft: typed.draft, error: undefined };
                });
              }}
              maxLength={7}
              spellCheck={false}
              autoComplete="off"
              placeholder="#rrggbb"
              aria-invalid={view.error ? true : undefined}
            />
          </label>
          <label className="color-picker__native" title="Any color, from the browser's picker">
            <input
              ref={nativeRef}
              type="color"
              value={current}
              onChange={(e) => {
                const hex = e.target.value;
                setView((v) => follow(pickerSelect(v, hex)));
              }}
            />
            <span>Any color…</span>
          </label>
        </div>
        {view.error && <p className="color-picker__error">⚠ {view.error}</p>}

        <div className="color-picker__actions">
          <button type="button" className="btn" onClick={() => pick('')} title={`No color of its own: use the ${fallbackLabel}`}>
            ↺ {fallbackLabel}
          </button>
          <span className="color-picker__spacer" />
          <button type="button" className="btn" onClick={cancel}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={() => pick(pickerResult(viewRef.current))}>Apply</button>
        </div>
        <p className="color-picker__hint">
          <kbd>←↑↓→</kbd> move · <kbd>↵</kbd> apply · <kbd>#</kbd> hex · <kbd>d</kbd> {fallbackLabel} · <kbd>Esc</kbd> cancel
        </p>
      </div>
    </div>
  );
}

/** The color picker popup, over everything else. */
export function ColorPicker(props: Props) {
  return createPortal(<ColorPickerDialog {...props} />, document.body);
}

/** A component's color picker: `open` it for something, and render `element`. */
export function useColorPicker() {
  const [request, setRequest] = useState<ColorRequest | undefined>();
  const open = useCallback<OpenColorPicker>((r) => setRequest(r), []);
  const close = useCallback(() => setRequest(undefined), []);
  return {
    open,
    /** It is open, so the component's own shortcuts wait. */
    active: request !== undefined,
    element: request ? <ColorPicker request={request} onClose={close} /> : null,
  };
}

interface ColorButtonProps {
  /** Its own color, or ''/unset for none. */
  color?: string;
  /** What it shows without one. */
  fallback?: string;
  fallbackLabel?: string;
  /** A bare chip, without the color's name. */
  compact?: boolean;
  title?: string;
  onClick(): void;
}

/** A color chip that opens the picker; without a color of its own it shows the fallback as a ring. */
export function ColorButton({ color, fallback, fallbackLabel = 'default', compact, title, onClick }: ColorButtonProps) {
  const own = normalizeHexColor(color);
  const shown = own ?? pickerFallback({ fallback });
  const label = own ? colorName(own) : fallbackLabel;
  const describe = own ? `${label} ${own}` : `${fallbackLabel} (${colorName(shown)})`;
  return (
    <button
      type="button"
      className={`color-button${compact ? ' color-button--compact' : ''}`}
      onClick={onClick}
      title={title ?? `Color: ${describe} — click to change`}
      aria-label={`Color: ${describe}`}
    >
      <span
        className={`color-button__chip${own ? '' : ' color-button__chip--none'}`}
        style={own ? { backgroundColor: own } : { borderColor: shown }}
      />
      {!compact && (
        <span className="color-button__label">
          {label}
          {own && <code>{own}</code>}
        </span>
      )}
    </button>
  );
}
