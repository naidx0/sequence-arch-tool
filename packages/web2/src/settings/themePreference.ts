/** Shared with index.html's pre-paint choice and the shell's startup guard. */
export const THEME_KEY = 'seq.theme';
export const THEME_EVENT = 'sequence:theme';
export type Theme = 'light' | 'dark' | 'system';
const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark' || value === 'system';

export function readTheme(): Theme {
  try { const value = localStorage.getItem(THEME_KEY); return isTheme(value) ? value : 'dark'; }
  catch { return 'dark'; }
}

export function applyTheme(theme: Theme = readTheme()): void {
  const resolved = theme === 'system' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function writeTheme(theme: Theme): void {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* The current window still changes. */ }
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
}

/** Shell mount: useEffect(() => watchTheme(), []); cleanup removes every listener. */
export function watchTheme(): () => void {
  let current = readTheme();
  applyTheme(current);
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const system = () => { if (current === 'system') applyTheme(current); };
  const changed = (event: Event) => {
    const choice: unknown = (event as CustomEvent<unknown>).detail;
    current = isTheme(choice) ? choice : readTheme();
    applyTheme(current);
  };
  const storage = (event: StorageEvent) => { if (event.key === THEME_KEY || event.key === null) changed(event); };
  window.addEventListener(THEME_EVENT, changed);
  window.addEventListener('storage', storage);
  media?.addEventListener?.('change', system);
  return () => { window.removeEventListener(THEME_EVENT, changed); window.removeEventListener('storage', storage); media?.removeEventListener?.('change', system); };
}
