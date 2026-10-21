/* ══════════════════════════════════════════════════════════════════════════
   THE DRAWING PALETTE — colour by NAME, from the theme's own tokens
   packages/web2/src/whiteboard/palette.ts

   A mark's colour is a word (`chart2`), never a hex. The reader's theme decides what it looks like, so a drawing is
   legible in every theme. The names are the backend's board-item contract (docs/requests/backend-shapes.md "Board
   items"): `stroke` and `fill` on a shape, `color` on a text, mapped to the tokens below. A `#hex` is drawn raw ONLY
   when the item says `ownTheme: true` (an agent reproducing a diagram that has its own colours), and only if it is
   a plain hex.

   Items stored before the contract (this branch's first palette) used gold, blue, magenta, teal, bronze, indigo on a
   `color` field: they still read, as chart1..chart6.
   ══════════════════════════════════════════════════════════════════════════ */

export const WB_COLORS = ['ink', 'muted', 'accent', 'positive', 'warning', 'danger', 'info', 'chart1', 'chart2', 'chart3', 'chart4', 'chart5', 'chart6'] as const;
export type WbColor = (typeof WB_COLORS)[number];
export const WB_FILLS = [...WB_COLORS, 'surface', 'none'] as const;
export type WbFill = (typeof WB_FILLS)[number];

export const WB_COLOR_LABEL: Record<WbFill, string> = {
  ink: 'Ink',
  muted: 'Muted',
  accent: 'Accent',
  positive: 'Positive',
  warning: 'Warning',
  danger: 'Danger',
  info: 'Info',
  chart1: 'Chart 1',
  chart2: 'Chart 2',
  chart3: 'Chart 3',
  chart4: 'Chart 4',
  chart5: 'Chart 5',
  chart6: 'Chart 6',
  surface: 'Surface',
  none: 'None',
};

/** The Graphite token each name draws with (`transparent` for none). */
export const WB_COLOR_TOKEN: Record<WbFill, string> = {
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
  surface: '--surface-2',
  none: 'transparent',
};

/** The first palette's names, kept readable. */
const LEGACY: Record<string, WbColor> = { gold: 'chart1', blue: 'chart2', magenta: 'chart3', teal: 'chart4', bronze: 'chart5', indigo: 'chart6' };

export function asWbColor(value: unknown): WbColor | undefined {
  if (typeof value !== 'string') return undefined;
  if ((WB_COLORS as readonly string[]).includes(value)) return value as WbColor;
  return LEGACY[value];
}

export function asWbFill(value: unknown): WbFill | undefined {
  if (typeof value !== 'string') return undefined;
  if (value === 'surface' || value === 'none') return value;
  return asWbColor(value);
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/**
 * What a mark's colour field says, as the attribute the stylesheet reads and, for an own-theme mark, the raw hex.
 * A value that is neither a palette name nor (with ownTheme) a plain hex is no colour at all.
 */
export function paint(value: unknown, ownTheme: boolean | undefined, fill: boolean): { name?: WbFill; hex?: string } {
  if (ownTheme === true && typeof value === 'string' && HEX.test(value)) return { hex: value };
  const name = fill ? asWbFill(value) : asWbColor(value);
  return name ? { name } : {};
}
