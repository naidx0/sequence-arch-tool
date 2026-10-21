/* The draw palette's glyph geometry, apart from the component so a test can
   measure it. Each is drawn on the 24 grid with its ink centred on (12, 12):
   a glyph whose ink sits off the grid's centre sits off the centre of its
   button, and no CSS can centre it. `glyphCentre.test.ts` measures every one. */

export const TOOL_GLYPH_PATHS = {
  sketch: ['M5 8.5h9v7H5z', 'M14 12h5', 'M17 10l2 2-2 2'],
  select: ['M6 5l12 7-5 1.5L11 19z'],
  pen: ['M4.5 19.5l4-1 11-11-3-3L5.5 15.5z'],
  rect: [],
  ellipse: [],
  arrow: ['M5 19 19 5M10 5h9v9'],
  text: ['M6 5.5h12M12 5.5v13M9 18.5h6'],
  sticky: ['M5 4h14v10l-5 6H5zM14 20v-6h5'],
  erase: ['M8 19.5h11M5 13.5l8-9 6 6-7 8H9z'],
  done: ['m5 12 5 5 9-10'],
} as const;

/** The two tools drawn from a primitive rather than a path. */
export const TOOL_GLYPH_SHAPES = {
  rect: { x: 4, y: 6, width: 16, height: 12, rx: 2 },
  ellipse: { cx: 12, cy: 12, rx: 8, ry: 6 },
} as const;
