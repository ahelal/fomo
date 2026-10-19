/**
 * Keyboard conventions shared by the TUI and the web app.
 * Shortcuts never depend on case, and Shift+↑/↓ jumps further on taller screens.
 */

/** The key a shortcut is matched against: letters in lower case, so Shift+b does what b does. */
export function shortcutKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** A screen at least this many text lines tall jumps 10 rows with Shift+↑/↓; smaller ones jump 5. */
export const TALL_SCREEN_LINES = 40;

/** Rows Shift+↑/↓ moves the selection on a screen this many text lines tall. */
export function jumpStep(screenLines: number): number {
  return screenLines >= TALL_SCREEN_LINES ? 10 : 5;
}
