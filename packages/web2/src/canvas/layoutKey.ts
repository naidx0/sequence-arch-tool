/* THE LAYOUT KEY, ONE BUILDER.
   packages/web2/src/canvas/layoutKey.ts

   The key names everything an arrangement was computed from; a layout answer is applied only when its key is the
   current one. It used to be a template literal inside ConnectedBoard, and `attachFitKeyFor` (which strips the far
   band back out of it) was tested against a hand-written copy of its shape: when the font epoch was appended, the
   copy stayed green while the real key stopped matching. Both now go through this function, so a change to a segment
   moves the test that depends on it. Order is part of the contract: the far band is followed only by the epoch. */

export interface LayoutKeyParts {
  nodeIds: readonly string[];
  /** Edges the arrangement is laid out with (derived connectors included). */
  edgeCount: number;
  /** `frameAspect(width, height)`. */
  aspect: string | number;
  engine: string;
  /** 'auto' when the board picks the direction itself, else the profile's. */
  direction: string;
  /** `annotatedCountForLayout(...)`: an annotation makes its card one line taller, but only at the rungs the
   *  subtitle shows, so the count obeys the same ladder rule as the room (finding F6). */
  annotated: number;
  /** Visual changes every card's height and both ELK spacings. */
  visual: boolean;
  /** The open anatomy wall adds room to ONE card. */
  anatomyNodeId: string | null;
  /** The far band reserves a counter-scaled row. */
  farBand: boolean;
  fontEpoch: number;
}

export function layoutKeyFor(p: LayoutKeyParts): string {
  return (
    `${p.nodeIds.join(',')}|${p.edgeCount}|${p.aspect}|${p.engine}:${p.direction}|` +
    `a${p.annotated}|` +
    `v${p.visual ? 1 : 0}|` +
    `an${p.anatomyNodeId ?? ''}|` +
    `f${p.farBand ? 1 : 0}|` +
    `n${p.fontEpoch}`
  );
}
