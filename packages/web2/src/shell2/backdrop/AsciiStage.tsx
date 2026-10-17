/* ══════════════════════════════════════════════════════════════════════════
   THE STAGE'S ASCII BACKGROUND (round 8, item 7)
   packages/web2/src/shell2/backdrop/AsciiStage.tsx

   Jaden: "grab these elements from our actual usebastion repository, the hero
   pages. It's the ASCII, and that's the background behind any surface that
   isn't open... If it's no surface open and it's just the chat in the
   background, it's still blurred out and more opaque, but it's that ASCII
   theme."

   SOURCE AND LICENCE. Ported from the Bastion site, Jaden's own repository
   (naidx0/premai, local checkout C:/Users/<user>/Projects/premai, read only):
   the hero is components/lab/hero-photo.tsx, drawn by
   components/lab/ascii-photo.tsx (a photograph sampled into a character
   mosaic: each cell filled with its own colour and overlaid with a glyph by
   brightness, crisp at the focal point, dissolving toward the edges). Same
   licence as that repository: Jaden's own code, no separate licence file, used
   here by its owner's instruction. The two photographs are that repository's
   public/media/photos/hero-day.jpg and hero-night.jpg, resized to 960 px wide
   for this app (Unsplash License; credits as the site gives them: Brenton
   Pearce, day; Donald Giannatti, night). See ./SOURCE.txt.

   WHAT CHANGED IN THE PORT. No cursor lens and no pointer listener: it is a
   still. It draws once per size and theme, after first paint (Shell2 loads
   this module lazily), and the blur and dim are baked into that one draw, so
   nothing large blurs live (the reskin's rule). The light room takes the day
   photo, the dark room the night one, following the app's own data-theme.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import dayUrl from './hero-day.jpg?url';
import nightUrl from './hero-night.jpg?url';

const RAMP = ' .,:;-=+*#%@';
const HEX = '0123456789abcdef';

/** The site's own settings (hero-photo.tsx). */
export const HERO = {
  light: { src: dayUrl, focusX: 0.72, focusY: 0.5, strength: 0.5 },
  dark: { src: nightUrl, focusX: 0.62, focusY: 0.85, strength: 1 },
  cell: 6,
} as const;

/** `behind-chat`: no surface open, the chat centred over it. `under`: surfaces open, it shows only in the gaps and bars. */
export type BackdropMode = 'under' | 'behind-chat';

function hash(a: number, b: number): number {
  let t = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967295;
}

/** Which room the app is painting: its own attribute, else the system's. */
export function roomTheme(): 'light' | 'dark' {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Draw the mosaic of `img` into `canvas` at its CSS size (ascii-photo.tsx's colour mode, no lens). */
function* mosaicSteps(canvas: HTMLCanvasElement, img: HTMLImageElement, theme: 'light' | 'dark', blur: number, size?: { w: number; h: number }): Generator<void, boolean> {
  /* `size` lets a canvas that is not on the page (the other room's, drawn ahead) be drawn at the visible one's size. */
  const r = size ? null : canvas.getBoundingClientRect();
  const w = size ? size.w : r!.width;
  const h = size ? size.h : r!.height;
  if (w < 2 || h < 2 || !img.naturalWidth) return false;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const opts = HERO[theme];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const cw = w < 640 ? HERO.cell - 1 : HERO.cell;
  const ch = Math.round(cw * 1.6);
  const cols = Math.ceil(w / cw);
  const rows = Math.ceil(h / ch);
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  const dx = (w - dw) * opts.focusX;
  const dy = (h - dh) * opts.focusY;

  /* One colour per cell. */
  const g = document.createElement('canvas');
  g.width = cols;
  g.height = rows;
  const gc = g.getContext('2d', { willReadFrequently: true });
  if (!gc) return false;
  gc.imageSmoothingQuality = 'high';
  gc.drawImage(img, (0 - dx) / s, (0 - dy) / s, (cols * cw) / s, (rows * ch) / s, 0, 0, cols, rows);
  const colors = gc.getImageData(0, 0, cols, rows).data;

  const base = document.createElement('canvas');
  base.width = canvas.width;
  base.height = canvas.height;
  const b = base.getContext('2d');
  if (!b) return false;
  b.setTransform(dpr, 0, 0, dpr, 0, 0);
  b.drawImage(img, dx, dy, dw, dh);
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace';
  b.font = `${Math.round(ch * 0.92)}px ${mono}, monospace`;
  b.textBaseline = 'top';
  const S = opts.strength;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const R = colors[i]!;
      const G = colors[i + 1]!;
      const B = colors[i + 2]!;
      const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
      const k = Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length));
      const ddx = (x / cols - opts.focusX) * 1.3;
      const ddy = (y / rows - opts.focusY) * 1.0;
      const edge = Math.min(1, Math.max(0, (Math.hypot(ddx, ddy) - 0.14) / 0.45));
      const wgt = Math.min(1, (0.3 + 0.7 * edge * edge) * (0.5 + S));
      b.fillStyle = `rgba(${R},${G},${B},${0.1 + 0.85 * wgt})`;
      b.fillRect(x * cw, y * ch, cw, ch);
      const darkCell = lum < 0.5;
      const lift = darkCell ? 60 + 70 * S : -(40 + 30 * S);
      const r2 = Math.max(0, Math.min(255, R + lift));
      const g2 = Math.max(0, Math.min(255, G + lift));
      const b2 = Math.max(0, Math.min(255, B + lift * 1.1));
      const glyph = lum > 0.12 && hash(x, y) < 0.18 + 0.3 * S ? HEX[Math.floor(hash(y, x) * 16)]! : RAMP[Math.max(1, k)]!;
      b.globalAlpha = Math.min(1, 0.25 + 0.75 * wgt);
      b.fillStyle = `rgb(${r2},${g2},${b2})`;
      b.fillText(glyph, x * cw + 0.5, y * ch);
      b.globalAlpha = 1;
    }
    /* One row done: a caller that wants the thread back may take it here. */
    yield;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.filter = blur > 0 ? `blur(${blur * dpr}px)` : 'none';
  ctx.drawImage(base, 0, 0);
  ctx.filter = 'none';
  return true;
}

/** Draw the mosaic of `img` into `canvas` at its CSS size (ascii-photo.tsx's colour mode, no lens). */
export function drawMosaic(canvas: HTMLCanvasElement, img: HTMLImageElement, theme: 'light' | 'dark', blur: number, size?: { w: number; h: number }): boolean {
  const run = mosaicSteps(canvas, img, theme, blur, size);
  for (;;) {
    const step = run.next();
    if (step.done) return step.value;
  }
}

/** Longest the mosaic holds the main thread before giving it back, in ms (under half a 60 Hz frame). */
const SLICE_MS = 8;
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The same picture as `drawMosaic`, drawn in slices of SLICE_MS with the thread handed back between them. The whole
 * draw is 160-210 ms of one task at 1440x900; in slices the boot has no long task from it, and input, the board's
 * first paint and the composer all get their frames in between. `live` is asked between slices: false abandons the draw.
 */
export async function drawMosaicSliced(canvas: HTMLCanvasElement, img: HTMLImageElement, theme: 'light' | 'dark', blur: number, size: { w: number; h: number }, live: () => boolean = () => true): Promise<boolean> {
  const run = mosaicSteps(canvas, img, theme, blur, size);
  let since = performance.now();
  for (;;) {
    const step = run.next();
    if (step.done) return step.value;
    if (performance.now() - since >= SLICE_MS) {
      await nextTask();
      if (!live()) return false;
      since = performance.now();
    }
  }
}

/** How long after the first draw the other room is made ahead of a switch: past the boot window. */
const AHEAD_DELAY_MS = 4000;

/**
 * The backdrop: a still canvas filling its parent. `behind-chat` is blurred
 * and dimmed further (no surface open, the chat centred over it).
 */
export function AsciiStage({ mode }: { mode: BackdropMode }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => roomTheme());
  const [drawn, setDrawn] = useState(false);
  /* Which room the visible canvas holds right now (data-room-drawn). */
  const [shown, setShown] = useState<'light' | 'dark' | null>(null);
  /* Both rooms' mosaics, by room and size. The one on screen is drawn first; the other is drawn while the app is
     idle, so the light / dark switch is a copy of a finished picture, not a ~170 ms redraw on the main thread. */
  const rooms = useRef(new Map<string, HTMLCanvasElement>());
  const photos = useRef(new Map<string, HTMLImageElement>());

  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(roomTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    let live = true;
    let timer = 0;
    let idle = 0;
    let idleCb = 0;
    let lastKey = '';
    const other = theme === 'light' ? 'dark' : 'light';
    const photo = (room: 'light' | 'dark'): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const have = photos.current.get(room);
        if (have?.complete && have.naturalWidth) return resolve(have);
        const img = have ?? new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('backdrop photo'));
        if (!have) {
          photos.current.set(room, img);
          img.src = HERO[room].src;
        }
      });
    const sizeNow = () => {
      const r = canvas.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };
    const keyOf = (room: 'light' | 'dark', s: { w: number; h: number }) => `${room}:${Math.round(s.w)}x${Math.round(s.h)}@${window.devicePixelRatio || 1}`;
    /* The finished mosaic for a room at the visible size: from the store, else drawn now (offscreen). */
    const mosaic = async (room: 'light' | 'dark'): Promise<HTMLCanvasElement | null> => {
      const s = sizeNow();
      if (s.w < 2 || s.h < 2) return null;
      const key = keyOf(room, s);
      const have = rooms.current.get(key);
      if (have) return have;
      const img = await photo(room);
      const off = document.createElement('canvas');
      if (!(await drawMosaicSliced(off, img, room, 1.2, s, () => live))) return null;
      rooms.current.set(key, off);
      return off;
    };
    const show = async () => {
      try {
        const off = await mosaic(theme);
        if (!live || !off) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        if (canvas.width !== off.width || canvas.height !== off.height) {
          canvas.width = off.width;
          canvas.height = off.height;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(off, 0, 0);
        lastKey = keyOf(theme, sizeNow());
        setDrawn(true);
        setShown(theme);
        /* Then, when nothing else wants the thread, draw the other room ahead of the switch. */
        const ahead = () => {
          if (live) void mosaic(other).catch(() => {});
        };
        /* Not inside the boot window: the other room's photo is a request nothing on the first frame needs, so it waits
           AHEAD_DELAY_MS first (a theme switch before then draws it on demand). */
        idle = window.setTimeout(() => {
          idleCb = typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(ahead, { timeout: 2500 }) : 0;
          if (!idleCb) ahead();
        }, AHEAD_DELAY_MS);
      } catch {
        if (live) setDrawn(false);
      }
    };
    void show();
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        /* Only a real change of size redraws: the observer also speaks once on attach. */
        if (keyOf(theme, sizeNow()) === lastKey) return;
        rooms.current.clear();
        void show();
      }, 150);
    };
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    ro?.observe(canvas);
    return () => {
      live = false;
      window.clearTimeout(timer);
      if (idle) window.clearTimeout(idle);
      if (idleCb && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleCb);
      ro?.disconnect();
    };
  }, [theme, mode]);

  return (
    <div className="s2-backdrop" data-mode={mode} data-theme-variant={theme} data-drawn={drawn ? 'true' : 'false'} data-room-drawn={shown ?? undefined} data-testid="s2-ascii-backdrop" aria-hidden="true">
      <canvas ref={ref} className="s2-backdrop-c" />
    </div>
  );
}

export default AsciiStage;
