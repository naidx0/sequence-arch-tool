/**
 * The graph as the scan worker sends it to the server: one JSON text per top-level member (the server parses one per tick),
 * plus the node detail as text. Posting copies both at once, and the worker then goes on for seconds to build the function
 * graph with these strings still in its frame: the whole graph a second time as text at the worker's peak.
 * {@link releaseGraphWire} empties them the moment they are on the wire.
 */
export interface GraphWire {
  parts: Array<[string, string]>;
  detail: string;
}

export function cutGraphWire(graph: object, detailOf: (graph: never) => unknown): GraphWire {
  const parts: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(graph)) {
    const s = JSON.stringify(v);
    if (s !== undefined) parts.push([k, s]);
  }
  return { parts, detail: JSON.stringify(detailOf(graph as never)) };
}

/** Drop the texts. Call after `postMessage` (which has already copied them). */
export function releaseGraphWire(wire: GraphWire): void {
  wire.parts.length = 0;
  wire.detail = '';
}
