/**
 * The fixed palette agents draw with, derived from the Graphite tokens
 * (docs/brand/graphite/_core.html). A board item stores a palette NAME, never a
 * hex value, so the board follows the app theme (light/dark) for free: the
 * renderer maps a name to its CSS variable. A raw hex is accepted only on an
 * item that says `ownTheme: true` (a user's own project, own style).
 */

/** name -> the Graphite custom property the renderer reads (`var(--ink-1)`). */
export const BOARD_PALETTE = {
  ink: '--ink-1',
  muted: '--ink-3',
  accent: '--accent',
  positive: '--fits',
  warning: '--spills',
  danger: '--wont',
  info: '--info',
  chart1: '--viz-1',
  chart2: '--viz-2',
  chart3: '--viz-3',
  chart4: '--viz-4',
  chart5: '--viz-5',
  chart6: '--viz-6',
} as const;

export type BoardColorName = keyof typeof BOARD_PALETTE;

/** Colour names a stroke may take. */
export const STROKE_COLORS = Object.keys(BOARD_PALETTE) as BoardColorName[];
/** A fill takes the same names plus `surface` (the card colour) and `none`. */
export const FILL_COLORS = [...STROKE_COLORS, 'surface', 'none'] as const;
export type BoardFillName = (typeof FILL_COLORS)[number];

/** The fill name -> property map for the two extras. */
export const FILL_EXTRA_TOKENS = { surface: '--surface-2' } as const;

export const DASHES = ['solid', 'dashed', 'dotted'] as const;
export type BoardDash = (typeof DASHES)[number];
export const ARROWHEADS = ['none', 'arrow', 'dot', 'bar'] as const;
export type BoardArrowhead = (typeof ARROWHEADS)[number];
export const FONT_SIZES = ['sm', 'md', 'lg'] as const;
export type BoardFontSize = (typeof FONT_SIZES)[number];
export const LABEL_POSITIONS = ['center', 'top', 'bottom', 'left', 'right'] as const;
export type BoardLabelPos = (typeof LABEL_POSITIONS)[number];

/** Graphite px sizes for fontSize: --t-12, --t-14, --t-17. */
export const FONT_SIZE_PX: Record<BoardFontSize, number> = { sm: 12, md: 14, lg: 17 };

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && HEX_RE.test(v);
