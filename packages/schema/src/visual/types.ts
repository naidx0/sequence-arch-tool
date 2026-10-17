import type { Frag } from './util.js';

/** One component of the kit: validate a JSON spec, draw it. `width` is the room it has (px). */
export interface Component<S = unknown> {
  id: string;
  /** One line: what it is for. */
  blurb: string;
  /** The spec shape in a few compact lines (what `visual({help})` prints). */
  shape: string;
  /** A small valid spec (also used by the gallery and the tests). */
  example: unknown;
  parse(spec: unknown): S;
  render(spec: S, width: number): Frag;
}

export const DEFAULT_WIDTH = 440;
export const MIN_WIDTH = 280;
export const MAX_WIDTH = 1200;
