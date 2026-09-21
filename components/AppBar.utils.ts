

// ---------------------------------------------------------------------------
// AppBar – pure display-logic helpers (testable without react-native)
// ---------------------------------------------------------------------------

/**
 * Decide whether the back button should be visible.
 * Returns `false` whenever `showBack` is falsy (i.e. on root screens).
 */
export function shouldShowBack(showBack?: boolean): boolean {
  return Boolean(showBack);
}

/**
 * Decide whether the theme-toggle button should be visible.
 * Defaults to `true` when the prop is omitted so that most screens see it.
 */
export function shouldShowThemeToggle(showThemeToggle?: boolean): boolean {
  return showThemeToggle !== false;
}

/**
 * Return a human-readable emoji label for the current theme mode.
 * Defaults to ☀️ (light) when mode is undefined.
 */
export function themeLabel(mode?: 'dark' | 'light'): string {
  return mode === 'dark' ? '🌙' : '☀️';
}

/**
 * Build the accessibility-friendly title string for the app bar.
 */
export function formatTitle(title: string): string {
  return title.trim().length > 0 ? title.trim() : 'OneTag';
}
