import { useCallback, useState } from 'react';
import type { Key } from 'ink';
import { shortcutKey } from '@fomo/core';
import { connectionStringProblem, profileNameProblem, type ProfileInfo } from '../../config.js';
import { editText } from '../editText.js';

/** What the profile picker can do. Root owns the config and implements it. */
export interface ProfileControls {
  /** Profile in use. */
  active: string;
  profiles: ProfileInfo[];
  /** Switch to another profile; returns why it can't. The app that opens for it shows the confirmation. */
  switchTo(name: string): string | undefined;
  /** Check a storage account, create a profile for it and switch to it; resolves to why it can't. */
  add(name: string, connectionString: string, skipCheck: boolean): Promise<string | undefined>;
  rename(from: string, to: string): string | undefined;
  remove(name: string): string | undefined;
}

export type ProfileMode =
  | { kind: 'list' }
  /** Typing the name of a new profile. */
  | { kind: 'name'; value: string; error?: string }
  /** Typing its connection string; `failed` is a value that didn't connect, which ↵ again saves anyway. */
  | { kind: 'connection'; name: string; value: string; checking: boolean; error?: string; failed?: string }
  | { kind: 'rename'; from: string; value: string; error?: string }
  | { kind: 'remove'; name: string };

interface PickerState {
  focus: number;
  mode: ProfileMode;
  /** Why the last key did nothing; the next key clears it. */
  note?: string;
}

/** What the picker screen draws. */
export interface ProfilePickerView {
  profiles: ProfileInfo[];
  active: string;
  focusIndex: number;
  mode: ProfileMode;
  note?: string;
}

interface Options {
  /** Without it (tests, embedding) the picker never opens. */
  controls?: ProfileControls;
  /** A fetch, digest or restore is running; the account can't change under it. */
  busy(): boolean;
  /** Show a message in the main status bar. */
  notify(message: string, ms?: number): void;
  /** Rows Shift+↑/↓ moves (5, or 10 on a tall terminal). */
  jump: number;
}

const LIST: ProfileMode = { kind: 'list' };
const BUSY = '⏳ A run is still going — switch when it finishes';
const IN_USE = 'Can’t remove the profile in use — switch to another one first';
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The profile picker (w): switch between storage accounts, add, rename and remove profiles. */
export function useProfilePicker({ controls, busy, notify, jump }: Options) {
  // One state object, so each key changes the picker in a single render.
  const [state, setState] = useState<PickerState | undefined>();

  const open = useCallback(() => {
    if (!controls) return;
    setState({ focus: Math.max(0, controls.profiles.findIndex((p) => p.name === controls.active)), mode: LIST });
  }, [controls]);

  const close = useCallback(() => setState(undefined), []);

  const handleInput = useCallback((raw: string, key: Key) => {
    if (!controls || !state) return;
    const { mode } = state;
    const input = shortcutKey(raw);
    const names = controls.profiles.map((p) => p.name);
    const last = Math.max(0, controls.profiles.length - 1);
    const focus = Math.min(state.focus, last);
    const go = (next: ProfileMode, note?: string, at = focus) => setState({ focus: at, mode: next, note });

    if (mode.kind === 'list') {
      if (key.escape || key.backspace || key.delete || input === 'w') { close(); return; }
      const step = key.shift && (key.upArrow || key.downArrow) ? jump : 1;
      if (key.upArrow || input === 'k') { go(LIST, undefined, Math.max(0, focus - step)); return; }
      if (key.downArrow || input === 'j') { go(LIST, undefined, Math.min(last, focus + step)); return; }
      const target = controls.profiles[focus];
      if (!target) return;
      if (key.return) {
        if (target.name === controls.active) { close(); return; }
        if (busy()) { go(LIST, BUSY); return; }
        const problem = controls.switchTo(target.name);
        if (problem) { go(LIST, problem); return; }
        // The app is replaced by the new profile's; Root shows the confirmation there.
        close();
        return;
      }
      if (input === 'a') { go({ kind: 'name', value: '' }); return; }
      if (input === 'e') { go({ kind: 'rename', from: target.name, value: target.name }); return; }
      if (input === 'x') {
        if (target.name === controls.active) go(LIST, IN_USE);
        else go({ kind: 'remove', name: target.name });
      }
      return;
    }

    if (mode.kind === 'name') {
      if (key.escape) { go(LIST); return; }
      if (key.return) {
        const name = mode.value.trim();
        const problem = profileNameProblem(name, names);
        if (problem) go({ ...mode, error: problem });
        else go({ kind: 'connection', name, value: '', checking: false });
        return;
      }
      const value = editText(mode.value, raw, key);
      if (value !== undefined) go({ ...mode, value });
      return;
    }

    if (mode.kind === 'connection') {
      if (mode.checking) return;
      if (key.escape) { go(LIST); return; }
      if (key.return) {
        // A connection string never has whitespace; a pasted one may have wrapped.
        const connectionString = mode.value.replace(/\s+/g, '');
        if (!connectionString) return;
        const problem = connectionStringProblem(connectionString);
        if (problem) { go({ ...mode, error: problem, failed: undefined }); return; }
        if (busy()) { go({ ...mode, error: BUSY }); return; }
        // A second ↵ on a value that failed the check saves it anyway (e.g. storage temporarily unreachable).
        const skipCheck = mode.failed === connectionString;
        go({ ...mode, checking: true, error: undefined });
        const done = (error?: string) => {
          if (!error) {
            close();
            return;
          }
          setState((s) => (s?.mode.kind === 'connection'
            ? { ...s, mode: { ...s.mode, checking: false, error, failed: connectionString } }
            : s));
        };
        controls.add(mode.name, connectionString, skipCheck).then(done, (err) => done(errorText(err)));
        return;
      }
      const value = editText(mode.value, raw, key);
      if (value !== undefined) go({ ...mode, value });
      return;
    }

    if (mode.kind === 'rename') {
      if (key.escape) { go(LIST); return; }
      if (key.return) {
        const to = mode.value.trim();
        if (to === mode.from) { go(LIST); return; }
        const problem = profileNameProblem(to, names, mode.from) ?? controls.rename(mode.from, to);
        if (problem) { go({ ...mode, error: problem }); return; }
        go(LIST);
        notify(`Renamed “${mode.from}” to “${to}”`);
        return;
      }
      const value = editText(mode.value, raw, key);
      if (value !== undefined) go({ ...mode, value });
      return;
    }

    // Confirming a removal: x, y or ↵ removes it, any other key keeps it.
    if (input === 'x' || input === 'y' || key.return) {
      const problem = controls.remove(mode.name);
      go(LIST, problem);
      if (!problem) notify(`Removed profile “${mode.name}”`);
      return;
    }
    go(LIST);
  }, [controls, state, busy, notify, jump, close]);

  const view: ProfilePickerView | undefined = state && controls
    ? {
      profiles: controls.profiles,
      active: controls.active,
      focusIndex: Math.min(state.focus, Math.max(0, controls.profiles.length - 1)),
      mode: state.mode,
      note: state.note,
    }
    : undefined;

  return {
    active: view !== undefined,
    /** A text field has the keyboard: letters such as q must not act as shortcuts. */
    typing: state !== undefined && (state.mode.kind === 'name' || state.mode.kind === 'connection' || state.mode.kind === 'rename'),
    view,
    open,
    close,
    handleInput,
  };
}
