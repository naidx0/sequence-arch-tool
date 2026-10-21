/* ══════════════════════════════════════════════════════════════════════════
   THE DOCUMENT AN AGENT'S ```html BLOCK RUNS IN
   packages/web2/src/chat/visualDoc.ts

   Pure: source in, a complete srcdoc string out. No React, no DOM.

   Idea and boundary after T3 Code (MIT, https://github.com/pingdotgg/t3code,
   apps/web McpAppFrame / HtmlRenderFrame, checked at b707eeb): an agent draws
   a page, the chat shows it in a frame that has an opaque origin. T3 serves the
   page from an attachment URL; Sequence has no server round trip, so the page
   rides in `srcdoc` and carries its own network-denying policy.

   THE BOUNDARY, in two lines that must stay true:
     1. The frame is `sandbox="allow-scripts"`, NEVER with `allow-same-origin`
        (the pair is no sandbox: the page reaches its own <iframe> and deletes
        the attribute). Asserted on the rendered element in the tests.
     2. The first thing the parser meets is a CSP with `default-src 'none'`:
        no fetch, XHR, WebSocket, font, frame, form post or <base>. Images are
        `data:` only. The page may compute and draw; it may not phone home.

   THEME. The page gets the app's colours as CSS custom properties
   (--seq-bg, --seq-fg, --seq-muted, --seq-accent, --seq-edge, --seq-surface)
   and `color-scheme`, so a page that uses them follows light and dark, and a
   page that sets nothing is still readable (body colour and font are defaults
   a page's own CSS overrides).

   HEIGHT. An opaque-origin frame cannot be measured from outside, so a tiny
   bootstrap posts `{seqVisualHeight}` to the parent on load and resize; the
   parent checks `event.source` is its own frame.
   ══════════════════════════════════════════════════════════════════════════ */

import { EMOJI_BOOTSTRAP } from './drawingEmoji';
import { VISUAL_FONT, VISUAL_KIT_CSS } from './visualKit';

/** The size cap for an inline preview, in UTF-16 units of the source. Over it the block shows code and "Open". */
export const VISUAL_MAX_CHARS = 200_000;

/** The frame's height bounds, in CSS px. */
export const VISUAL_MIN_HEIGHT = 48;
export const VISUAL_MAX_HEIGHT = 640;
export const VISUAL_DEFAULT_HEIGHT = 160;

/** The only message kind the bootstrap posts. */
export const VISUAL_HEIGHT_MESSAGE = 'seqVisualHeight';

/** The policy: nothing is fetched, nothing is posted, nothing re-bases. Exported so a test asserts the exact string. */
export const VISUAL_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; form-action 'none'; base-uri 'none'";

/** The `sandbox` attribute. One token. Never add `allow-same-origin`. */
export const VISUAL_SANDBOX = 'allow-scripts';

export interface VisualTheme {
  dark: boolean;
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  edge: string;
  surface: string;
}

export const FALLBACK_LIGHT: VisualTheme = { dark: false, bg: '#ffffff', fg: '#1b1b1f', muted: '#6b6b76', accent: '#3b5bdb', edge: '#d8d8e0', surface: '#f5f5f8' };
export const FALLBACK_DARK: VisualTheme = { dark: true, bg: '#181a20', fg: '#ececf1', muted: '#9a9aa6', accent: '#e8c547', edge: '#3b3d46', surface: '#272930' };

/** A value that is safe to put inside a <style> declaration: no braces, quotes, angle brackets or semicolons. */
const safeCss = (v: string, fallback: string): string => (/^[#\w\s.,%()/+-]{1,80}$/.test(v) ? v : fallback);

/** The variables a theme sets, as name to value (also what is posted into a live frame on a theme flip). */
export function themeVars(t: VisualTheme): Record<string, string> {
  const base = t.dark ? FALLBACK_DARK : FALLBACK_LIGHT;
  return {
    '--seq-bg': safeCss(t.bg, base.bg),
    '--seq-fg': safeCss(t.fg, base.fg),
    '--seq-muted': safeCss(t.muted, base.muted),
    '--seq-accent': safeCss(t.accent, base.accent),
    '--seq-edge': safeCss(t.edge, base.edge),
    '--seq-surface': safeCss(t.surface, base.surface),
  };
}

/** The message that re-themes a live frame without reloading it. */
export const VISUAL_THEME_MESSAGE = 'seqVisualTheme';
export const themeMessage = (t: VisualTheme): Record<string, unknown> => ({ [VISUAL_THEME_MESSAGE]: { dark: t.dark, vars: themeVars(t) } });

export function themeStyle(t: VisualTheme): string {
  const decl = Object.entries(themeVars(t)).map(([k, v]) => `${k}:${v}`).join(';');
  return (
    `<style>:root{color-scheme:${t.dark ? 'dark' : 'light'};${decl}}` +
    `html,body{margin:0}body{padding:8px;background:transparent;color:var(--seq-fg);font:14px/1.5 ${VISUAL_FONT}}${VISUAL_KIT_CSS}</style>`
  );
}

const BOOTSTRAP =
  `<script>(function(){function h(){var b=document.body;if(!b)return;var r=b.getBoundingClientRect();var s=getComputedStyle(b);` +
  `var n=Math.ceil(r.bottom+(window.scrollY||0)+(parseFloat(s.marginBottom)||0));` +
  `try{parent.postMessage({${VISUAL_HEIGHT_MESSAGE}:n},"*")}catch(e){}}` +
  `addEventListener("message",function(e){if(e.source!==parent)return;var m=e.data&&e.data.${VISUAL_THEME_MESSAGE};if(!m||!m.vars)return;var r=document.documentElement;` +
  `for(var k in m.vars){var v=m.vars[k];if(/^--seq-[a-z]+$/.test(k)&&typeof v==="string"&&/^[#\\w\\s.,%()\\/+-]{1,80}$/.test(v))r.style.setProperty(k,v)}r.style.colorScheme=m.dark?"dark":"light"});` +
  `addEventListener("load",h);addEventListener("resize",h);` +
  `if(window.ResizeObserver&&document.body){new ResizeObserver(h).observe(document.body)}setTimeout(h,60)})()</script>`;

/** The complete srcdoc: policy first, then the theme, then the agent's page, then the height reporter. */
export function visualDocument(html: string, theme: VisualTheme): string {
  const body = html.replace(/^\s*<!doctype[^>]*>/i, ''); // the source is left as written; EMOJI_BOOTSTRAP strips emoji from the drawn page
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${VISUAL_CSP}">${themeStyle(theme)}${body}${EMOJI_BOOTSTRAP}${BOOTSTRAP}`;
}

/** Clamp a reported height to the frame's bounds. */
export function clampVisualHeight(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : VISUAL_DEFAULT_HEIGHT;
  return Math.min(VISUAL_MAX_HEIGHT, Math.max(VISUAL_MIN_HEIGHT, v));
}

/** Is this source over the inline cap? */
export function overVisualCap(source: string): boolean {
  return source.length > VISUAL_MAX_CHARS;
}

/** "212 KB" for a note. */
export function kb(chars: number): string {
  return `${Math.round(chars / 1000)} KB`;
}

export function isVisualLanguage(language: string | null): language is 'svg' | 'html' {
  return language === 'svg' || language === 'html';
}

/** The first opaque background colour at or above `el`: the surface the block sits on. */
function surfaceOf(el: Element | null): string | null {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    const m = /^rgba?\(([^)]*)\)$/.exec(bg);
    if (!m) continue;
    const parts = m[1]!.split(/[ ,/]+/).filter(Boolean);
    const alpha = parts.length >= 4 ? Number(parts[3]) : 1;
    if (alpha >= 0.9) return `rgb(${parts.slice(0, 3).join(',')})`;
  }
  return null;
}

/** The theme as the app shows it now: the surface the block sits on and the app's tokens, else the light/dark fallback. DOM only. */
export function readVisualTheme(host?: Element | null): VisualTheme {
  if (typeof document === 'undefined') return FALLBACK_LIGHT;
  const root = document.documentElement;
  const attr = root.getAttribute('data-theme');
  const dark = attr === 'dark' || (attr !== 'light' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  const base = dark ? FALLBACK_DARK : FALLBACK_LIGHT;
  const cs = getComputedStyle(root);
  const tok = (name: string, fb: string): string => cs.getPropertyValue(name).trim() || fb;
  return {
    dark,
    bg: surfaceOf(host ?? null) ?? tok('--bg-base', base.bg),
    fg: tok('--ink-1', base.fg),
    muted: tok('--ink-3', base.muted),
    accent: tok('--accent', base.accent),
    edge: tok('--edge-strong', base.edge),
    surface: tok('--surface-2', base.surface),
  };
}
