/* ══════════════════════════════════════════════════════════════════════════
   THE CHAT COLUMN'S ICON SET
   packages/web2/src/chat/Icon.tsx

   Transcribed from docs/brand/graphite/_core.html — the frozen book's own
   <symbol> sprite — and NOT redrawn. Every path below is the book's geometry on
   the book's 24x24 grid at the book's single stroke weight.

   WHY THE PATHS ARE INLINE AND NOT A <use href="#ic-…"> SPRITE. A sprite needs
   its <symbol> definitions mounted once in the document, and the only places
   that could live are index.html or the app shell — neither of which this lane
   owns. An icon that renders as an empty box because somebody else's file has
   not shipped yet is the worst possible failure for a glyph vocabulary whose
   entire job is to carry meaning (GRAPHITE-DECISIONS.md Decision 2: "one icon
   per kind, one meaning per icon — an icon that means two things means
   neither"). Inline paths cannot fail that way.

   HANDBACK. The plan's §5 skeleton puts ONE Icon.tsx in components/ for the
   whole app. When that file exists, this one is deleted and the imports move;
   the names below are already the book's `ic-*` names minus the prefix, so the
   move is a rename of the import and nothing else.

   HUE BUDGET: 0. Every glyph is stroke:currentColor. A glyph never picks its
   own colour — the row it sits in decides, and sheet 12.7 lists the six places
   on these surfaces where that colour may be a hue at all.
   ══════════════════════════════════════════════════════════════════════════ */

export type IconName =
  | 'agent'
  | 'alert'
  | 'arrowleft'
  | 'arrowright'
  | 'board'
  | 'book'
  | 'branch'
  | 'chart'
  | 'chatbox'
  | 'check'
  | 'chevdown'
  | 'chevleft'
  | 'chevright'
  | 'chevup'
  | 'clock'
  | 'cloud'
  | 'code'
  | 'commit'
  | 'copy'
  | 'cursor'
  | 'database'
  | 'dataset'
  | 'download'
  | 'entry'
  | 'erase'
  | 'eye'
  | 'file'
  | 'filter'
  | 'flow'
  | 'fn'
  | 'folder'
  | 'folderplus'
  | 'frame'
  | 'gauge'
  | 'gear'
  | 'gpu'
  | 'help'
  | 'info'
  | 'key'
  | 'link'
  | 'mic'
  | 'minus'
  | 'model'
  | 'module'
  | 'moon'
  | 'more'
  | 'newthread'
  | 'open'
  | 'oval'
  | 'pan'
  | 'panel'
  | 'panelleft'
  | 'pause'
  | 'pen'
  | 'pin'
  | 'play'
  | 'plus'
  | 'rect'
  | 'refresh'
  | 'run'
  | 'search'
  | 'send'
  | 'sensitive'
  | 'service'
  | 'skill'
  | 'sliders'
  | 'split'
  | 'spark'
  | 'stop'
  | 'sun'
  | 'terminal'
  | 'text'
  | 'thread'
  | 'topic'
  | 'trash'
  | 'upload'
  | 'user'
  | 'x';

/**
 * `d` attributes only, in the order the book draws them. A few glyphs need a
 * non-path primitive; those carry it as an explicit element instead. A path
 * may carry the book's own transform verbatim (ic-book's second stroke), and
 * ic-more's three cap-dots are filled circles per sheet 09.6's sanctioned
 * exception.
 */
type Shape =
  | { p: string; t?: string }
  | { circle: [number, number, number] }
  | { rect: [number, number, number, number, number] }
  | { ellipse: [number, number, number, number] }
  | { dot: [number, number, number] };

export const GLYPHS: Record<IconName, Shape[]> = {
  /*
   * TRANSCRIBED from docs/brand/graphite/_core.html, not drawn - every entry
   * below is the book's own geometry on the book's 24px grid. The book defines
   * seventy-six symbols and this file exposes all seventy-six: the thirty-
   * three that shipped first, the thirty-seven transcribed under Decision 8
   * (70 defined, 33 exposed), the four Decision 8 authored (oval, text, link,
   * erase), and the two Decision 9 authored (pan, rect).
   *
   * test/icon-book.test.ts locks this file to the sprite: one entry per book
   * symbol, no invented names.
   */
  agent: [{ p: 'm12 3.4 7.4 4.3v8.6L12 20.6 4.6 16.3V7.7z' }, { circle: [12, 12, 2.4] }],
  alert: [
    { p: 'M10.7 4.6a1.5 1.5 0 0 1 2.6 0l7.2 12.6a1.5 1.5 0 0 1-1.3 2.3H4.8a1.5 1.5 0 0 1-1.3-2.3z' },
    { p: 'M12 9.6v4' },
    { p: 'M12 16.4h.01' },
  ],
  arrowleft: [{ p: 'M19 12H5.6' }, { p: 'm11.8 5.8-6.2 6.2 6.2 6.2' }],
  arrowright: [{ p: 'M5 12h13.4' }, { p: 'm12.2 5.8 6.2 6.2-6.2 6.2' }],
  board: [
    { rect: [3.2, 4.2, 7, 5.4, 1.6] },
    { rect: [13.8, 4.2, 7, 5.4, 1.6] },
    { rect: [8.5, 14.4, 7, 5.4, 1.6] },
    { p: 'M6.7 9.6v2.6h10.6V9.6M12 12.2v2.2' },
  ],
  book: [
    { p: 'M4 5.6A1.6 1.6 0 0 1 5.6 4H11a2.6 2.6 0 0 1 2.6 2.6V20a2 2 0 0 0-2-2H5.6A1.6 1.6 0 0 1 4 16.4z' },
    { p: 'M20 5.6A1.6 1.6 0 0 0 18.4 4H13a2.6 2.6 0 0 0-2.6 2.6', t: 'translate(3.6 0)' },
  ],
  branch: [
    { circle: [6.4, 5.6, 2.2] },
    { circle: [6.4, 18.4, 2.2] },
    { circle: [17.2, 7.8, 2.2] },
    { p: 'M6.4 7.8v8.4' },
    { p: 'M17.2 10v1a4 4 0 0 1-4 4H6.4' },
  ],
  chart: [{ p: 'M4 4v15.2a.8.8 0 0 0 .8.8H20' }, { p: 'm7.6 15.4 3.4-4.4 3 2.4 4-5.8' }],
  chatbox: [
    { p: 'M4 6.4A2.4 2.4 0 0 1 6.4 4h11.2A2.4 2.4 0 0 1 20 6.4v7.2A2.4 2.4 0 0 1 17.6 16H10l-4.4 3.2V16H6.4A2.4 2.4 0 0 1 4 13.6z' },
    { p: 'M8 9.2h8M8 12h5.6' },
  ],
  check: [{ p: 'M5 12.6 9.6 17.2 19 7.2' }],
  chevdown: [{ p: 'M6.8 9.6 12 14.8l5.2-5.2' }],
  chevleft: [{ p: 'M14.4 6.8 9.2 12l5.2 5.2' }],
  chevright: [{ p: 'M9.6 6.8 14.8 12l-5.2 5.2' }],
  chevup: [{ p: 'M6.8 14.4 12 9.2l5.2 5.2' }],
  clock: [{ circle: [12, 12, 8] }, { p: 'M12 7.4v4.9l3.1 1.8' }],
  cloud: [{ p: 'M7.6 18.4h9.2a3.8 3.8 0 0 0 .5-7.57 5.4 5.4 0 0 0-10.36-1.1A4.2 4.2 0 0 0 7.6 18.4Z' }],
  code: [{ p: 'm8.8 8.4-4.4 3.6 4.4 3.6' }, { p: 'm15.2 8.4 4.4 3.6-4.4 3.6' }, { p: 'M13.6 4.6 10.4 19.4' }],
  commit: [{ circle: [12, 12, 3.4] }, { p: 'M2.8 12h5.8M15.4 12h5.8' }],
  /* TRANSCRIBED from `docs/brand/graphite/sequence-graphite.html:1517`, not
     drawn. Sheet 09 lists `ic-copy` in the vocabulary and sheet 12 line 551
     specifies this exact control — `<button class="iconbtn" aria-label="Copy">`
     on a message — so this is the book's own glyph arriving late, not a
     borrowed one. Sheet 09 ruling 3 forbids the latter. */
  copy: [
    { rect: [8.6, 8.6, 11.4, 11.4, 2.6] },
    { p: 'M15.6 8.6V6.4A2.4 2.4 0 0 0 13.2 4H6.4A2.4 2.4 0 0 0 4 6.4v6.8a2.4 2.4 0 0 0 2.4 2.4h2.2' },
  ],
  cursor: [{ p: 'm6 3.8 12.2 8.1-5.3 1.1-2.2 5.2z' }],
  database: [
    { ellipse: [12, 6.2, 7.2, 2.6] },
    { p: 'M4.8 6.2v11.6c0 1.44 3.22 2.6 7.2 2.6s7.2-1.16 7.2-2.6V6.2' },
    { p: 'M4.8 12c0 1.44 3.22 2.6 7.2 2.6s7.2-1.16 7.2-2.6' },
  ],
  dataset: [{ rect: [3.6, 5, 16.8, 14, 2.4] }, { p: 'M3.6 10h16.8M3.6 14.4h16.8M9.6 10v9' }],
  download: [{ p: 'M12 4v10.4' }, { p: 'm8 10.8 4 4 4-4' }, { p: 'M4.6 18.6h14.8' }],
  entry: [
    { p: 'M3.6 12h9.2' },
    { p: 'm9.4 8.4 3.6 3.6-3.6 3.6' },
    { p: 'M15.2 4.8h3.2a2 2 0 0 1 2 2v10.4a2 2 0 0 1-2 2h-3.2' },
  ],
  erase: [
    { p: 'm8.8 20.2-4.2-4.2a2.4 2.4 0 0 1 0-3.4l8-8a2.4 2.4 0 0 1 3.4 0l4.2 4.2a2.4 2.4 0 0 1 0 3.4L14 20.2z' },
    { p: 'M14 20.2h6.2' },
    { p: 'm7.2 10 8.2 8.2' },
  ],
  eye: [
    { p: 'M2.6 12S6.2 5.8 12 5.8 21.4 12 21.4 12 17.8 18.2 12 18.2 2.6 12 2.6 12Z' },
    { circle: [12, 12, 2.8] },
  ],
  file: [
    { p: 'M13.6 3.6H7.6A2.4 2.4 0 0 0 5.2 6v12a2.4 2.4 0 0 0 2.4 2.4h8.8a2.4 2.4 0 0 0 2.4-2.4V8.4z' },
    { p: 'M13.6 3.6v4.8h5.2' },
  ],
  filter: [{ p: 'M4.4 6.2h15.2l-5.9 6.9v5.2l-3.4 1.7v-6.9z' }],
  flow: [
    { p: 'M3.6 6.6h5.6a2.4 2.4 0 0 1 2.4 2.4v5.6a2.4 2.4 0 0 0 2.4 2.4h4.4' },
    { p: 'm16.8 14.2 3.6 2.8-3.6 2.8' },
  ],
  fn: [
    { p: 'M9.8 4.4c-1.9 0-2.5 1-2.5 2.6v2.2c0 1.6-.8 2.8-2.4 2.8 1.6 0 2.4 1.2 2.4 2.8V17c0 1.6.6 2.6 2.5 2.6' },
    { p: 'M14.2 4.4c1.9 0 2.5 1 2.5 2.6v2.2c0 1.6.8 2.8 2.4 2.8-1.6 0-2.4 1.2-2.4 2.8V17c0 1.6-.6 2.6-2.5 2.6' },
  ],
  /* Book ic-folder — keep geometry; squareness is visual weight via stroke. */
  folder: [
    { p: 'M4 7.4A2.4 2.4 0 0 1 6.4 5h2.9l2.1 2.4h6.2A2.4 2.4 0 0 1 20 9.8v6.8A2.4 2.4 0 0 1 17.6 19H6.4A2.4 2.4 0 0 1 4 16.6z' },
  ],
  folderplus: [
    { p: 'M4 7.4A2.4 2.4 0 0 1 6.4 5h2.9l2.1 2.4h6.2A2.4 2.4 0 0 1 20 9.8v6.8A2.4 2.4 0 0 1 17.6 19H6.4A2.4 2.4 0 0 1 4 16.6z' },
    { p: 'M12 11v4.6M9.7 13.3h4.6' },
  ],
  frame: [{ p: 'M8.4 3.6v16.8M15.6 3.6v16.8M3.6 8.4h16.8M3.6 15.6h16.8' }],
  gauge: [{ p: 'M4.2 17.6a8.6 8.6 0 1 1 15.6 0' }, { p: 'm12 13.4 3.6-3.6' }],
  gear: [
    { circle: [12, 12, 2.9] },
    { circle: [12, 12, 7.2] },
    { p: 'M12 3.4v1.5M12 19.1v1.5M20.6 12h-1.5M4.9 12H3.4M18.08 5.92l-1.06 1.06M6.98 17.02l-1.06 1.06M18.08 18.08l-1.06-1.06M6.98 6.98 5.92 5.92' },
  ],
  gpu: [
    { rect: [6, 6, 12, 12, 2.4] },
    { rect: [9.6, 9.6, 4.8, 4.8, 1.2] },
    { p: 'M9.2 3.2V6M14.8 3.2V6M9.2 18v2.8M14.8 18v2.8M3.2 9.2H6M3.2 14.8H6M18 9.2h2.8M18 14.8h2.8' },
  ],
  help: [
    { circle: [12, 12, 8] },
    { p: 'M9.8 9.8a2.3 2.3 0 0 1 4.47.77c0 1.53-2.3 2.3-2.3 2.3' },
    { p: 'M12 16.2h.01' },
  ],
  info: [{ circle: [12, 12, 8] }, { p: 'M12 11.2v5' }, { p: 'M12 8.1h.01' }],
  key: [{ circle: [7.8, 16.2, 3.6] }, { p: 'm10.4 13.6 8.6-8.6' }, { p: 'm15.8 8.2 2.2 2.2M18.4 5.6l2.2 2.2' }],
  link: [
    { p: 'm9.9 14.1a4.4 4.4 0 0 1 0-6.2l2.3-2.3a4.4 4.4 0 0 1 6.2 6.2l-1.2 1.2' },
    { p: 'm14.1 9.9a4.4 4.4 0 0 1 0 6.2l-2.3 2.3a4.4 4.4 0 0 1-6.2-6.2l1.2-1.2' },
    { p: 'm9.9 14.1 4.2-4.2' },
  ],
  mic: [
    { rect: [9.2, 3.2, 5.6, 10.6, 2.8] },
    { p: 'M5.8 11.6a6.2 6.2 0 0 0 12.4 0' },
    { p: 'M12 17.8V20.8' },
  ],
  minus: [{ p: 'M5.2 12h13.6' }],
  model: [
    { p: 'm12 3.4 8.4 4.2-8.4 4.2-8.4-4.2z' },
    { p: 'm3.6 12.4 8.4 4.2 8.4-4.2' },
    { p: 'm3.6 16.6 8.4 4.2 8.4-4.2' },
  ],
  module: [{ rect: [3.6, 3.6, 16.8, 16.8, 3.2] }, { rect: [8.4, 8.4, 7.2, 7.2, 1.6] }],
  moon: [{ p: 'M20 13.6A8.4 8.4 0 0 1 10.4 4a8.4 8.4 0 1 0 9.6 9.6Z' }],
  /* Sheet 09.6's sanctioned exception: ic-more is the sprite's one filled
     symbol, drawn as three cap-dots with fill="currentColor" stroke="none". */
  more: [{ dot: [5.6, 12, 0.9] }, { dot: [12, 12, 0.9] }, { dot: [18.4, 12, 0.9] }],
  newthread: [
    { p: 'M12.5 4.5H6.6A2.6 2.6 0 0 0 4 7.1v10.3A2.6 2.6 0 0 0 6.6 20h10.3a2.6 2.6 0 0 0 2.6-2.6v-5.9' },
    { p: 'M17.9 3.6a2 2 0 0 1 2.8 2.8l-7.4 7.4-3.5.7.7-3.5z' },
  ],
  oval: [{ ellipse: [12, 12, 8.4, 5.4] }],
  pan: [
    { p: 'M12 4.4v15.2M4.4 12h15.2' },
    { p: 'm8.2 8.2 3.8-3.8 3.8 3.8M8.2 15.8l3.8 3.8 3.8-3.8' },
  ],
  open: [
    { p: 'M14.2 4H20v5.8' },
    { p: 'M20 4 11.4 12.6' },
    { p: 'M17.6 14v4.4A1.6 1.6 0 0 1 16 20H5.6A1.6 1.6 0 0 1 4 18.4V8A1.6 1.6 0 0 1 5.6 6.4H10' },
  ],
  panel: [{ rect: [3.2, 5, 17.6, 14, 2.6] }, { p: 'M14.6 5v14' }],
  panelleft: [{ rect: [3.2, 5, 17.6, 14, 2.6] }, { p: 'M9.4 5v14' }],
  pause: [{ rect: [7.6, 5.6, 3.4, 12.8, 1.4] }, { rect: [13, 5.6, 3.4, 12.8, 1.4] }],
  pen: [
    { p: 'M17.2 3.8a2.4 2.4 0 0 1 3.4 3.4L9.4 18.4l-4.6 1.2 1.2-4.6z' },
    { p: 'm15.4 5.6 3.4 3.4' },
  ],
  pin: [
    { p: 'M9 3.6h6' },
    { p: 'M10.4 3.6v6.2L8 13.6h8l-2.4-3.8V3.6' },
    { p: 'M12 13.6v6.8' },
  ],
  play: [{ p: 'M8.2 5.6a.6.6 0 0 1 .9-.5l9 6.4a.6.6 0 0 1 0 1l-9 6.4a.6.6 0 0 1-.9-.5z' }],
  plus: [{ p: 'M12 5.2v13.6M5.2 12h13.6' }],
  rect: [{ rect: [4.8, 5.6, 14.4, 12.8, 1.6] }],
  refresh: [{ p: 'M19.6 12a7.6 7.6 0 1 1-2.3-5.4' }, { p: 'M19.9 4.6v4.2h-4.2' }],
  run: [{ p: 'M3.2 12h3.9l2.6-7.2 4.6 14.4 2.6-7.2h3.9' }],
  search: [{ circle: [11, 11, 6.1] }, { p: 'M15.4 15.4 20 20' }],
  /* THE SIGNATURE MARK. A bare up arrow — not a paper plane and not a chevron —
     so it can never be mistaken for "next" or "export" (sheet 12.4). */
  send: [{ p: 'M12 19V5.6' }, { p: 'm5.8 11.8 6.2-6.2 6.2 6.2' }],
  sensitive: [{ rect: [4.6, 10.4, 14.8, 9.2, 2.6] }, { p: 'M8.1 10.4V7.9a3.9 3.9 0 0 1 7.8 0v2.5' }],
  service: [
    { rect: [3.6, 5, 16.8, 5.8, 2] },
    { rect: [3.6, 13.2, 16.8, 5.8, 2] },
    { p: 'M7 7.9h.01M7 16.1h.01' },
  ],
  skill: [{ p: 'M12 3.4 20 7.7v8.6L12 20.6 4 16.3V7.7z' }, { p: 'M4 7.7 12 12l8-4.3M12 12v8.6' }],
  sliders: [
    { p: 'M4 7.4h7.6M17.2 7.4H20M4 16.6h2.8M12.4 16.6H20' },
    { circle: [14.4, 7.4, 2.4] },
    { circle: [9.6, 16.6, 2.4] },
  ],
  split: [{ rect: [3.6, 5.2, 16.8, 5.6, 2] }, { rect: [3.6, 13.2, 10.4, 5.6, 2] }],
  spark: [{ p: 'M12 3l1.6 5.8L19 10l-5.4 1.2L12 17l-1.6-5.8L5 10l5.4-1.2z' }],
  stop: [{ rect: [6.6, 6.6, 10.8, 10.8, 2.6] }],
  sun: [
    { circle: [12, 12, 4] },
    { p: 'M12 2.6v2.2M12 19.2v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6 6 18M18 6l1.6-1.6' },
  ],
  terminal: [{ rect: [3.2, 5, 17.6, 14, 2.6] }, { p: 'm7.6 9.6 2.8 2.4-2.8 2.4M12.8 14.8h4' }],
  text: [{ p: 'M5.6 5.6h12.8' }, { p: 'M12 5.6v12.8' }],
  thread: [{ p: 'M4 6.2A2.2 2.2 0 0 1 6.2 4h11.6A2.2 2.2 0 0 1 20 6.2v8.1a2.2 2.2 0 0 1-2.2 2.2H9.3L4.9 20V16.5H4V6.2' }],
  topic: [{ p: 'M3.6 8.4h6.2M3.6 12h9.6M3.6 15.6h6.2' }, { p: 'm16.4 8.4 3.6 3.6-3.6 3.6' }],
  trash: [
    { p: 'M4.8 6.6h14.4' },
    { p: 'M9.6 6.6V5.2A1.6 1.6 0 0 1 11.2 3.6h1.6A1.6 1.6 0 0 1 14.4 5.2v1.4' },
    { p: 'M6.8 6.6v11.6A2.2 2.2 0 0 0 9 20.4h6a2.2 2.2 0 0 0 2.2-2.2V6.6' },
    { p: 'M10.4 10.4v6M13.6 10.4v6' },
  ],
  upload: [{ p: 'M12 15.6V4.8' }, { p: 'm8 8.8 4-4 4 4' }, { p: 'M4.6 18.6h14.8' }],
  user: [{ circle: [12, 8.6, 3.8] }, { p: 'M4.8 19.8a7.4 7.4 0 0 1 14.4 0' }],
  x: [{ p: 'M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4' }],
};

export interface IconProps {
  name: IconName;
  /** The book's three rungs. 14 is the tool-row and control glyph. */
  size?: 12 | 14 | 16;
  className?: string;
}

/**
 * One inline SVG. `aria-hidden` on every instance: a glyph in this product
 * always sits beside the words it illustrates — a tool row's verb, a menu
 * item's label, a button's aria-label — so announcing it again would read the
 * same fact twice.
 */
export function Icon({ name, size = 14, className }: IconProps) {
  const classes = ['i', `i-${size}`, className].filter(Boolean).join(' ');

  return (
    <svg
      className={classes}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      {GLYPHS[name].map((shape, index) => {
        if ('p' in shape) {
          return <path key={index} d={shape.p} transform={shape.t} />;
        }
        if ('circle' in shape) {
          const [cx, cy, r] = shape.circle;
          return <circle key={index} cx={cx} cy={cy} r={r} />;
        }
        if ('ellipse' in shape) {
          const [cx, cy, rx, ry] = shape.ellipse;
          return <ellipse key={index} cx={cx} cy={cy} rx={rx} ry={ry} />;
        }
        if ('dot' in shape) {
          const [cx, cy, r] = shape.dot;
          return <circle key={index} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;
        }
        const [x, y, width, height, rx] = shape.rect;
        return <rect key={index} x={x} y={y} width={width} height={height} rx={rx} />;
      })}
    </svg>
  );
}
