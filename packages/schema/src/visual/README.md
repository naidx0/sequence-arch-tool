# The visual kit: look rules

Pure TypeScript, deterministic svg. These rules hold for every component; `visual.test.ts` checks them.

## One size scale

Every kit visual sits in one weight band at chat width (340-560 px), so a KPI block does not shout next to a diagram.

- Text: 11 px minimum, 12 px body, 14 px titles. The chat draws the kit at the column's width, so these are also the sizes on screen (nothing is scaled down).
- KPI tiles are compact: 20 px values (16 px when a tile is tight), 10 px padding, 50 px tall (62 px with a change line), up to 4 in a row, packed by what each tile holds.
- Heights: the most a component may be at chat width, for a typical spec (up to about 8 items). Components with a free height clamp to it; bar rows tighten; only beyond about 8 items do list-like components (bar rows, timeline, sequence, flow) grow one row per item.

| component | max height (px) |
| --- | --- |
| line | 260 |
| bar | 280 |
| kpi | 200 |
| sparkline | 64 |
| histogram | 260 |
| donut | 240 |
| flow | 400 |
| sequence | 400 |
| loadpath | 340 |
| timeline | 300 |
| capacity | 420 |
| dashboard | 420 |

The numbers live in `MAX_H` (`util.ts`); the test reads this table and fails if the two disagree.

## One line

No title, label, tile caption or legend item wraps to two lines. Layout makes room first: KPI tiles take the width their longest line needs, the timeline label column grows to half the width, the donut legend moves under the ring, a legend starts a new row, a flow changes direction or becomes an outline. Only text that still does not fit is cut with "…", and then the full text is a tooltip (`<title>`). Numbers are never cut; a value shrinks instead.

## Quiet

Tiles, panels and boxes are the ink at 4% with a 1 px hairline, never a coloured slab or a coloured side bar. Solid series marks are 78% opaque. Status colour (ok, warn, bad) appears only where it means "look here": a bar at or past the saturation line, a status delta. Utilisation under the line is a neutral ink tint; the latency budget is ink, not colour.

## Clear connections (flow)

Edges are orthogonal with an arrowhead at the target and never cross a box. Between layers each source gets its own 8 px track; several edges into one box arrive spread along its side. An edge label sits on the leg into its target, or the first place along the edge that is clear of every box and every other label. Placement: left to right if it fits the column, else top down, else an outline (one node per row, children indented under a trunk with arrowed stubs, other edges in lanes on the right).
