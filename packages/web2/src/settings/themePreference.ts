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
  const root = document.documentElement;
  /* Already there: touching the attribute again would wake every observer of it for nothing. */
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
  if (root.style.colorScheme !== resolved) root.style.colorScheme = resolved;
}

/** How long the old room takes to melt into the new one (base.css ::view-transition rules and [data-theme-fade]). */
export const THEME_FADE_MS = 120;

type ViewTransitionDoc = Document & { startViewTransition?: (update: () => void) => { finished: Promise<unknown> } };

/**
 * 0.1.6 G2 (owner: the switch is "rough, takes a lot of time"). The change is made in ONE step and blended once:
 *  - `data-theme-switching` on the root turns off every control's own colour easing (base.css), so nothing changes in
 *    stages, and the whole screen is the one cross-fade;
 *  - the View Transitions API blends the old picture into the new (120 ms); where it is missing, a short opacity
 *    keyframe on the body does the same job (`data-theme-fade`);
 *  - reduced motion, or no change at all, switches at once with neither.
 * `update` runs exactly once, and synchronously on the fallback paths.
 */
let switchGeneration = 0;
function switchRoom(update: () => void): void {
  const root = document.documentElement;
  const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { update(); return; }
  const doc = document as ViewTransitionDoc;
  root.setAttribute('data-theme-switching', '');
  /* Only the latest switch clears the flag: an earlier one finishing during a quick second toggle must not. */
  const mine = ++switchGeneration;
  const done = () => { if (mine === switchGeneration) root.removeAttribute('data-theme-switching'); };
  if (typeof doc.startViewTransition === 'function') {
    try {
      const vt = doc.startViewTransition(update);
      void vt.finished.then(done, done);
      return;
    } catch { /* fall through to the plain path */ }
  }
  update();
  root.setAttribute('data-theme-fade', '');
  window.setTimeout(() => { if (mine === switchGeneration) root.removeAttribute('data-theme-fade'); done(); }, THEME_FADE_MS + 40);
}

export function writeTheme(theme: Theme): void {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* The current window still changes. */ }
  switchRoom(() => {
    applyTheme(theme);
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
  });
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
