/* ══════════════════════════════════════════════════════════════════════════
   NODE-LINK — nine kinds, one renderer
   packages/web2/src/charts/NodeLinkChart.tsx

   system-architecture · network-map · ecosystem-map · concept-map · mind-map ·
   relationship-map · dependency-map · stakeholder-map · cause-and-effect

   chart.ts states the compression this file is: "A 'dependency map', a 'concept
   map' and a 'stakeholder map' are one node-link renderer with different labels
   and accents."

   LAYERED, NOT FORCE-DIRECTED. A force simulation is the reflex for this family
   and it is disqualified by the contract's third reason: it is iterative,
   seeded, and converges differently on a different machine, so "same spec,
   same pixels" would be false. A layered sweep is a pure function of the item
   order and the link list.

   THE ARROWHEADS ARE OFF UNLESS THE KIND IS DIRECTIONAL. A stakeholder map's
   link means "these two are related"; a cause-and-effect chart's link means
   "this one produced that one". Drawing the second arrow on the first chart
   invents a direction the author never claimed, which is the fabrication the
   whole contract exists to prevent.
   ══════════════════════════════════════════════════════════════════════════ */

import { ChartFrame, type FamilyChartProps } from './ChartFrame.js';
import { EdgeLayer, NodeBox } from './ChartPrimitives.js';
import { assignLayers, laidEdges, placeLayered } from './chartLayout.js';

/** The kinds whose links carry a direction the reader is meant to follow. */
const DIRECTED = new Set(['cause-and-effect', 'dependency-map', 'system-architecture']);

export function NodeLinkChart({ chart, note }: FamilyChartProps) {
  const layers = assignLayers(chart.items, chart.links);
  const placement = placeLayered(layers);
  const edges = laidEdges(chart.links, placement.byId);

  return (
    <ChartFrame chart={chart} width={placement.width} height={placement.height} note={note}>
      <EdgeLayer
        edges={edges}
        orientation="horizontal"
        directed={DIRECTED.has(chart.kind)}
        focusItemId={chart.focusItemId}
      />
      {placement.nodes.map((node) => (
        <NodeBox key={node.item.id} node={node} focusItemId={chart.focusItemId} />
      ))}
    </ChartFrame>
  );
}
