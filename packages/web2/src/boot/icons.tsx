/**
 * ITEM 2.4 — THE GLYPHS THIS LANE NEEDS, LIFTED VERBATIM FROM THE FROZEN BOOK.
 *
 * Every path below is copied character for character out of the sprite in
 * `docs/brand/graphite/_core.html` (the `<symbol id="ic-…">` block), and the
 * geometry that carries them is the book's own `.i` rule at `_core.html:619`:
 * a 24-unit viewBox, `stroke: currentColor`, `fill: none`, stroke-width 1.5,
 * round caps and joins.
 *
 * TWO PROPERTIES ARE LOAD-BEARING, NOT DECORATIVE.
 *
 *   currentColor and no fill. A coloured glyph puts meaning on the one channel
 *   Decision 2 forbids (`GRAPHITE-DECISIONS.md`: node kinds differentiate
 *   WITHOUT hue) and spends a hue on something that is not a claim. The colour
 *   of every icon on this surface is decided by the CSS `color` of the element
 *   it sits in, which is exactly one place per tone.
 *
 *   One stroke weight. The book's icon sheet is a single-weight set; mixing
 *   weights is how an icon starts reading as emphasis.
 *
 * THIS FILE IS TEMPORARY AND SAYS SO. Item 2.5 builds `components/Icon.tsx` —
 * one inline SVG set for the whole app. When it lands, this file is deleted and
 * these six names resolve there. It exists at all because the shared component
 * does not, and because a lane may only write inside its own directory: an
 * `<img>` or a webfont would have been the alternative, and both are a network
 * request on a surface whose entire point is booting without one.
 */

import type { ReactElement } from 'react';

export type GlyphName =
  | 'board'
  | 'folder'
  | 'chevright'
  | 'chevup'
  | 'refresh'
  | 'x'
  | 'info'
  | 'alert'
  | 'key'
  | 'user';

/** The sprite, keyed by the book's own id minus its `ic-` prefix. */
const PATHS: Record<GlyphName, ReactElement> = {
  board: (
    <>
      <rect x="3.2" y="4.2" width="7" height="5.4" rx="1.6" />
      <rect x="13.8" y="4.2" width="7" height="5.4" rx="1.6" />
      <rect x="8.5" y="14.4" width="7" height="5.4" rx="1.6" />
      <path d="M6.7 9.6v2.6h10.6V9.6M12 12.2v2.2" />
    </>
  ),
  folder: (
    <path d="M4 7.4A2.4 2.4 0 0 1 6.4 5h2.9l2.1 2.4h6.2A2.4 2.4 0 0 1 20 9.8v6.8A2.4 2.4 0 0 1 17.6 19H6.4A2.4 2.4 0 0 1 4 16.6z" />
  ),
  chevright: <path d="M9.6 6.8 14.8 12l-5.2 5.2" />,
  chevup: <path d="M6.8 14.4 12 9.2l5.2 5.2" />,
  refresh: (
    <>
      <path d="M19.6 12a7.6 7.6 0 1 1-2.3-5.4" />
      <path d="M19.9 4.6v4.2h-4.2" />
    </>
  ),
  x: <path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11.2v5" />
      <path d="M12 8.1h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M10.7 4.6a1.5 1.5 0 0 1 2.6 0l7.2 12.6a1.5 1.5 0 0 1-1.3 2.3H4.8a1.5 1.5 0 0 1-1.3-2.3z" />
      <path d="M12 9.6v4" />
      <path d="M12 16.4h.01" />
    </>
  ),
  key: (
    <>
      <circle cx="7.8" cy="16.2" r="3.6" />
      <path d="m10.4 13.6 8.6-8.6" />
      <path d="m15.8 8.2 2.2 2.2M18.4 5.6l2.2 2.2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.6" r="3.8" />
      <path d="M4.8 19.8a7.4 7.4 0 0 1 14.4 0" />
    </>
  ),
};

/**
 * A glyph, at one of the three sizes this lane uses.
 *
 * `aria-hidden` always: every icon here sits beside its own label, and an
 * announced icon reads the same word twice.
 */
export function Glyph({ name, size }: { name: GlyphName; size?: 12 | 16 | 20 }) {
  const cls = size === 12 ? 'startup-i sz-12' : size === 20 ? 'startup-i sz-20' : 'startup-i';
  return (
    <svg className={cls} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
