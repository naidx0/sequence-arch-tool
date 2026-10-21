/* Card resize and collapse: the pure rules and where they are remembered. packages/web2/src/chat/cardState.ts
   A drawing card (svg, html, visual, mermaid) has a drag bar on its bottom edge. Dragging up shrinks the body;
   inside CARD_SNAP of the minimum it locks there; further up it collapses to a one-line row. Dragging down grows
   it back, never past its natural height. The state is kept per drawing id, under the chat that showed it. */

import { stripEmoji } from './drawingEmoji';

/** The height a shrunk card locks at (px). A drawing shorter than this has no room to shrink and locks at its own height. */
export const CARD_MIN = 96;
/** Dragging the edge above this height (px, before it is committed) collapses the card; between this and CARD_MIN it stays locked at the minimum. */
export const CARD_COLLAPSE_AT = 40;
/** One arrow key press, and one with Shift (px). */
export const CARD_STEP = 24;
export const CARD_STEP_BIG = 96;
/** The default height cap (px) when the page has no tokens (a bare test tree). The live value is `--col-min`, read by cardCap(). */
export const CARD_CAP_FALLBACK = 420;
/** Stored as `h` for "opened to the natural height" when that is taller than the cap (a plain null means the default). */
export const CARD_FULL = 20000;

/** The default maximum height of a card body: `--col-min` (420px), the narrowest the chat column goes. A card is never taller than it is wide at that width. */
export function cardCap(host: Element | null): number {
  if (!host || typeof getComputedStyle === 'undefined') return CARD_CAP_FALLBACK;
  const n = parseFloat(getComputedStyle(host).getPropertyValue('--col-min'));
  return n > 0 ? n : CARD_CAP_FALLBACK;
}

/** The height a body is shown at, or null for "unclipped". Default (h null): the natural height up to the cap. A saved height at or past the natural height means the natural one. */
export function shownHeight(h: number | null, natural: number, cap: number): number | null {
  if (!(natural > 0)) return h === null || h >= CARD_FULL ? null : h;
  if (h === null) return natural > cap ? cap : null;
  return h >= natural ? null : h;
}

export interface CardState {
  /** The clipped height in px, or null for the natural height. Kept while collapsed, so expanding returns to it. */
  h: number | null;
  /** Collapsed to the one-line row. */
  c: boolean;
}
export const CARD_DEFAULT: CardState = { h: null, c: false };

export const lockHeight = (natural: number): number => Math.max(1, Math.min(CARD_MIN, natural));

/** What a drag of the edge to `raw` px means for a body whose natural height is `natural`. */
export function resolveDrag(raw: number, natural: number, cap = Infinity): { h: number | null; collapse: boolean; locked: boolean } {
  const lock = lockHeight(natural);
  if (raw >= natural) return { h: natural > cap ? CARD_FULL : null, collapse: false, locked: false };
  if (raw >= lock) return { h: Math.round(raw), collapse: false, locked: Math.round(raw) <= lock };
  if (raw >= CARD_COLLAPSE_AT) return { h: lock, collapse: false, locked: true };
  return { h: lock, collapse: true, locked: true };
}

/** The title a card shows: capitalised, and never a file name or a slug. */
export function cardTitle(title: string | undefined | null, fallback: string): string {
  let t = stripEmoji(title ?? '').replace(/\s+/g, ' ').trim();
  if (/\.(svg|html?)$/i.test(t) || /^(d?\d+[-_ ])?[a-z0-9]+([-_][a-z0-9]+)+$/.test(t)) {
    t = t.replace(/\.(svg|html?)$/i, '').replace(/^(d?\d+[-_ ]\s*)+/i, '').replace(/[-_]+/g, ' ').trim();
  }
  if (t === '') return fallback;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The tooltip that carries what the header no longer shows: `d14 v2`. A file name is never shown in the chat (it lives in the workspace files); "Copy file name" in the actions copies it. */
export function cardTooltip(saved: { id: string; version: number } | null | undefined): string | undefined {
  if (!saved) return undefined;
  return `${saved.id}${saved.version > 1 ? ` v${saved.version}` : ''}`;
}

/* ── memory ─────────────────────────────────────────────────────────────── */

const PREFIX = 'seq.cards.v1:';
const MAX_PER_CHAT = 200;
const mem = new Map<string, Record<string, CardState>>();

function clean(v: unknown): CardState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const h = typeof o.h === 'number' && Number.isFinite(o.h) && o.h >= 1 && o.h <= 20000 ? Math.round(o.h) : null;
  return { h, c: o.c === true };
}

function loadChat(chat: string): Record<string, CardState> {
  const hit = mem.get(chat);
  if (hit) return hit;
  let out: Record<string, CardState> = {};
  try {
    const raw = localStorage.getItem(PREFIX + chat);
    if (raw) {
      const j = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(j)) {
        const s = clean(v);
        if (s) out[k] = s;
      }
    }
  } catch {
    out = {};
  }
  mem.set(chat, out);
  return out;
}

export function readCard(chat: string | null, id: string | null): CardState {
  if (!id) return CARD_DEFAULT;
  return loadChat(chat ?? '-')[id] ?? CARD_DEFAULT;
}

export function writeCard(chat: string | null, id: string | null, s: CardState): void {
  if (!id) return;
  const m = loadChat(chat ?? '-');
  if (s.h === null && !s.c) delete m[id];
  else m[id] = { h: s.h, c: s.c };
  const keys = Object.keys(m);
  if (keys.length > MAX_PER_CHAT) for (const k of keys.slice(0, keys.length - MAX_PER_CHAT)) delete m[k];
  try {
    localStorage.setItem(PREFIX + (chat ?? '-'), JSON.stringify(m));
  } catch {
    /* storage blocked: the in-memory copy still holds for this session */
  }
}

/** Test hook: forget the in-memory copy so the next read goes to storage (a reload). */
export function forgetCardMemory(): void {
  mem.clear();
}
