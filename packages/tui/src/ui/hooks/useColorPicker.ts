import { useCallback, useState } from 'react';
import type { Key } from 'ink';
import {
  hexColorError,
  normalizeHexColor,
  pickerColor,
  pickerMove,
  pickerResult,
  pickerSelect,
  pickerState as corePickerState,
  pickerTyped,
  shortcutKey,
  vimMove,
  type ColorPickerState as CorePickerState,
  type ColorRequest,
  type GridMove,
} from '@fomo/core';
import { editText } from '../editText.js';

export { pickerColor, type ColorRequest };

export type OpenColorPicker = (request: ColorRequest) => void;

export interface ColorPickerState extends CorePickerState {
  /** Hex being typed (# or Tab). */
  hexDraft?: string;
  error?: string;
}

/** The picker opened on the request's color (or its fallback, when it has none). */
export function pickerState(request: ColorRequest): ColorPickerState {
  return corePickerState(request);
}

export type PickerStep = { state: ColorPickerState } | { pick: string } | { cancel: true };

/**
 * One key in the picker: arrows (or h j k l) move over the swatches, ↵ applies, d goes back to the
 * default, # (or Tab) types a hex color, Esc cancels.
 */
export function pickerKey(s: ColorPickerState, raw: string, key: Key): PickerStep {
  if (s.hexDraft !== undefined) {
    if (key.escape) return { state: { ...s, hexDraft: undefined, error: undefined } };
    if (key.return || key.tab) {
      const hex = normalizeHexColor(s.hexDraft);
      if (!hex) return { state: { ...s, error: hexColorError(s.hexDraft) } };
      if (key.return) return { pick: hex };
      return { state: { ...pickerSelect(s, hex), hexDraft: undefined, error: undefined } };
    }
    const next = editText(s.hexDraft, raw, key);
    if (next === undefined) return { state: s };
    const typed = pickerTyped(s, next);
    return { state: { ...typed.state, hexDraft: typed.draft, error: undefined } };
  }
  const input = shortcutKey(raw);
  if (key.escape || key.backspace || key.delete) return { cancel: true };
  if (key.return || input === ' ') return { pick: pickerResult(s) };
  if (input === 'd') return { pick: '' };
  if (input === '#' || key.tab) return { state: { ...s, hexDraft: pickerColor(s), error: undefined } };
  const move: GridMove | undefined = key.leftArrow ? 'left'
    : key.rightArrow ? 'right'
    : key.upArrow ? 'up'
    : key.downArrow ? 'down'
    : vimMove(input);
  if (move) return { state: { ...pickerMove(s, move), error: undefined } };
  return { state: s };
}

/** The color picker popup, shared by every screen that picks a color. */
export function useColorPicker() {
  const [state, setState] = useState<ColorPickerState | undefined>();
  const open = useCallback<OpenColorPicker>((request) => setState(pickerState(request)), []);
  const close = useCallback(() => setState(undefined), []);

  const handleInput = (raw: string, key: Key) => {
    if (!state) return;
    const step = pickerKey(state, raw, key);
    if ('state' in step) { setState(step.state); return; }
    setState(undefined);
    if ('pick' in step) state.onPick(step.pick);
  };

  return {
    active: state !== undefined,
    /** A hex color is being typed. */
    typing: state?.hexDraft !== undefined,
    open,
    close,
    handleInput,
    view: state,
  };
}
