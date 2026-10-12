/* INTERFACE FONT. Same shape as themePreference.ts: one localStorage key, one apply function, one write that also
   notifies. The choice lands as three CSS custom properties on <html> (--font-sans, --font-ui, --font-display), which every face in
   tokens/graphite.css already reads. Inter, the default, REMOVES the properties instead of setting them, so a user
   who never opens Settings paints exactly what graphite.css says. Every face is bundled (@fontsource, imported in
   tokens/graphite.css); nothing here, or in the app, asks Google Fonts for anything. */
export const FONT_KEY = 'seq.font';
export const FONT_EVENT = 'sequence:font';

export type FontId = 'inter' | 'geist' | 'plex' | 'system';

export interface FontChoice {
  id: FontId;
  label: string;
  /** The family stack, or null for the stylesheet's own (Inter). */
  stack: string | null;
}

const TAIL = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

export const FONT_CHOICES: readonly FontChoice[] = [
  { id: 'inter', label: 'Inter', stack: null },
  { id: 'geist', label: 'Geist', stack: `"Geist Sans", ${TAIL}` },
  { id: 'plex', label: 'IBM Plex Sans', stack: `"IBM Plex Sans", ${TAIL}` },
  { id: 'system', label: 'System', stack: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
];

export const DEFAULT_FONT: FontId = 'inter';
const isFont = (value: unknown): value is FontId => FONT_CHOICES.some((c) => c.id === value);

export function readFont(): FontId {
  try { const value = localStorage.getItem(FONT_KEY); return isFont(value) ? value : DEFAULT_FONT; }
  catch { return DEFAULT_FONT; }
}

export function applyFont(font: FontId = readFont()): void {
  const stack = FONT_CHOICES.find((c) => c.id === font)?.stack ?? null;
  const style = document.documentElement.style;
  if (stack === null) {
    style.removeProperty('--font-sans');
    style.removeProperty('--font-ui');
    style.removeProperty('--font-display');
  } else {
    style.setProperty('--font-sans', stack);
    style.setProperty('--font-ui', stack);
    style.setProperty('--font-display', stack);
  }
  document.documentElement.dataset.font = font;
}

export function writeFont(font: FontId): void {
  try { localStorage.setItem(FONT_KEY, font); } catch { /* The current window still changes. */ }
  applyFont(font);
  window.dispatchEvent(new CustomEvent(FONT_EVENT, { detail: font }));
}
