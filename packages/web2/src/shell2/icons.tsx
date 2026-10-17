/* ══════════════════════════════════════════════════════════════════════════
   THE RESKIN'S GLYPHS (Decision 49)
   packages/web2/src/shell2/icons.tsx

   Re-drawn from the uiarc.dev-direction artboard (BArc.dc.html, the symbol
   sheet at its top): a 24 grid, round caps and joins, stroke 1.7. One set for
   the whole new shell so every glyph has the same weight and centre.
   ══════════════════════════════════════════════════════════════════════════ */

const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  branch: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7M18 10.5c0 4-6 3-11 5.5" />
    </>
  ),
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="4" width="7" height="6" rx="1.5" />
      <rect x="14" y="4" width="7" height="6" rx="1.5" />
      <rect x="8.5" y="14" width="7" height="6" rx="1.5" />
      <path d="M6.5 10v2h11v-2M12 12v2" />
    </>
  ),
  pen: <path d="M4 20l4-1 11-11-3-3L5 16z" />,
  term: <path d="m5 8 4 4-4 4M12 17h7" />,
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
  spark: <path d="M12 5l1.8 5.2L19 12l-5.2 1.8L12 19l-1.8-5.2L5 12l5.2-1.8z" />,
  chev: <path d="m7 10 5 5 5-5" />,
  chevr: <path d="m10 7 5 5-5 5" />,
  chevl: <path d="m14 7-5 5 5 5" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  check: <path d="m5 12 5 5 9-10" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  minus: <path d="M5 12h14" />,
  import: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  map: (
    <>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  /* Plan (round 13, S4): a clipboard, drawn on the Smart shield's footprint (x 4 to 20, y 3 to 21, corner
     radius 3, the same stroke) so the two read as one weight; the old fold-line map did not. */
  plan: (
    <g strokeWidth="1.4">
      <path d="M8 5H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3h-1" />
      <rect x="8" y="3" width="8" height="4" rx="1.5" />
      <path d="M8.5 12.5h7M8.5 16.5h4.5" />
    </g>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  diffi: <path d="M12 4v8M8 8h8M8 19h8" />,
  flame: <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5" />,
  nodes: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.3 11l7.4-3.8M8.3 13l7.4 3.8" />
    </>
  ),
  db: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
    </>
  ),
  box: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12v9M12 12 4 7.5" />
    </>
  ),
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
      <path d="M10 21h4" />
    </>
  ),
  split: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M12 4v16" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  /* Round 13 (S10): drawn on the 16 px pixel grid (every stroke centre lands on a half pixel at 16 px:
     multiples of 1.5 units plus 0.75), so the Workspace and Open project folders stay crisp at small sizes. */
  folder: <path d="M3.75 17.25a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5V9.75a1.5 1.5 0 0 0-1.5-1.5h-6l-1.5-3H5.25a1.5 1.5 0 0 0-1.5 1.5z" />,
  /* A repository: the bound book with its bookmark (round 8, sidebar rows). */
  repo: (
    <>
      <path d="M5 18.5V5.5A2.5 2.5 0 0 1 7.5 3H19v13H7.5A2.5 2.5 0 0 0 5 18.5 2.5 2.5 0 0 0 7.5 21H19v-5" />
      <path d="M9 16v5l1.5-1.2L12 21v-5" />
    </>
  ),
  globe2: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
    </>
  ),
  agents: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9" r="2.3" />
      <path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5" />
    </>
  ),
  /* An API key: the bow and the toothed shaft (the welcome's API key option; no vendor owns a key). */
  key: (
    <>
      <circle cx="8" cy="15" r="3.5" />
      <path d="M10.5 12.5 19 4M16 7l2.5 2.5M13.5 9.5l2 2" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  pin: <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />,
  canvas: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 15l3-3 3 2 4-5" />
    </>
  ),
} as const;

export type S2IconName = keyof typeof PATHS;

export function S2Icon({ name, small = false, className }: { name: S2IconName; small?: boolean; className?: string }) {
  return (
    <svg
      className={['s2-i', small ? 's2-i-s' : '', className ?? ''].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      {PATHS[name]}
    </svg>
  );
}
