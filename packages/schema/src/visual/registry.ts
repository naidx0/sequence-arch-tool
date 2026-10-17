/* ══════════════════════════════════════════════════════════════════════════
   THE VISUAL KIT: REGISTRY AND ENTRY POINTS
   packages/schema/src/visual/registry.ts

     renderVisual('line', spec)  -> { svg, title, summary, width, height }
     listVisuals() / helpVisual('line')   what an agent asks before it calls

   The only functions the MCP tool, the chat's ```visual fence and the tests use.
   ══════════════════════════════════════════════════════════════════════════ */

import { SpecError } from './check.js';
import { CHARTS } from './charts.js';
import { capacity, makeDashboard } from './composite.js';
import { DIAGRAMS } from './diagrams.js';
import { DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, type Component } from './types.js';
import { cap, root } from './util.js';

const base: Component[] = [...CHARTS, ...DIAGRAMS, capacity as unknown as Component];
const dashboard = makeDashboard((id) => base.find((c) => c.id === id), () => base.map((c) => c.id));
export const COMPONENTS: readonly Component[] = [...base, dashboard];

/** Words an agent might use for a component. */
const ALIASES: Record<string, string> = {
  area: 'line', timeseries: 'line', trend: 'line', chart: 'line', forecast: 'line', 'line-forecast': 'line',
  column: 'bar', columns: 'bar', stacked: 'bar', 'stacked-bar': 'bar', barchart: 'bar',
  stat: 'kpi', stats: 'kpi', tiles: 'kpi', metrics: 'kpi', scorecard: 'kpi',
  spark: 'sparkline', latency: 'histogram', percentiles: 'histogram', distribution: 'histogram',
  pie: 'donut', doughnut: 'donut',
  diagram: 'flow', architecture: 'flow', flowchart: 'flow', graph: 'flow',
  seq: 'sequence', 'sequence-diagram': 'sequence',
  'load-path': 'loadpath', path: 'loadpath', 'request-path': 'loadpath', requestpath: 'loadpath',
  gantt: 'timeline', roadmap: 'timeline', schedule: 'timeline',
  'load-forecast': 'capacity', 'capacity-forecast': 'capacity', 'capacity-planning': 'capacity', load: 'capacity', sizing: 'capacity',
  dash: 'dashboard', panels: 'dashboard',
};

export function findComponent(name: string): Component | undefined {
  const key = name.trim().toLowerCase();
  return COMPONENTS.find((c) => c.id === key) ?? COMPONENTS.find((c) => c.id === ALIASES[key]);
}

export const MAX_SVG_CHARS = 150_000;
/** The spec travels inside the drawing (an svg comment) so a later turn can read and change the few-hundred-token spec instead of the multi-kilobyte picture. */
const MAX_EMBED = 20_000;

function embeddedSource(component: string, spec: unknown, title?: string): string | undefined {
  try {
    /* JSON cannot contain "--" in a comment: -- becomes -\u002d, which parses back to the same text. */
    const j = JSON.stringify({ component, ...(title ? { title } : {}), spec }).replace(/--/g, '-\\u002d');
    return j.length <= MAX_EMBED ? j : undefined;
  } catch {
    return undefined;
  }
}

/** The component and spec a kit drawing was made from, or null (a hand-written svg, or a spec too large to embed). */
export function visualSourceOf(svg: string): { component: string; spec: unknown; title?: string } | null {
  const m = /^<svg [^>]*>\s*<!--visual (\{[^]*?\})-->/.exec(svg.slice(0, MAX_EMBED + 600));
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]!) as { component?: unknown; spec?: unknown; title?: unknown };
    /* The comment is text any svg can carry: only a real component, printed by its canonical id, gets through. */
    const known = typeof j.component === 'string' ? findComponent(j.component) : undefined;
    return known && j.spec !== undefined ? { component: known.id, spec: j.spec, ...(typeof j.title === 'string' ? { title: j.title.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 120) } : {}) } : null;
  } catch {
    return null;
  }
}

export interface VisualResult {
  component: string;
  title: string;
  svg: string;
  summary: string;
  width: number;
  height: number;
}

export function renderVisual(component: string, spec: unknown, o: { title?: string; width?: number } = {}): VisualResult {
  const c = findComponent(String(component ?? ''));
  if (!c) throw new SpecError(String(component ?? ''), [`unknown component "${component}"; choose one of: ${COMPONENTS.map((x) => x.id).join(', ')}`]);
  const parsed = c.parse(spec);
  const asked = (parsed as { title?: unknown }).title;
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(Number.isFinite(o.width) ? (o.width as number) : DEFAULT_WIDTH)));
  const frag = c.render(parsed, width);
  const title = cap((o.title ?? (typeof asked === 'string' ? asked : '')).trim()) || cap(c.id);
  const svg = root(frag, title, embeddedSource(c.id, spec, o.title));
  if (svg.length > MAX_SVG_CHARS) throw new SpecError(c.id, [`the drawing would be ${Math.round(svg.length / 1000)} KB (limit ${MAX_SVG_CHARS / 1000} KB); use fewer points or items`]);
  return { component: c.id, title, svg, summary: frag.summary, width: Math.ceil(frag.w), height: Math.ceil(frag.h) };
}

export const listVisuals = (): { id: string; blurb: string }[] => COMPONENTS.map((c) => ({ id: c.id, blurb: c.blurb }));

/** The component's spec shape and a small example, as the text an agent reads. */
export function helpVisual(name: string): string {
  const c = findComponent(name);
  if (!c) return `unknown component "${name}"; choose one of: ${COMPONENTS.map((x) => x.id).join(', ')}`;
  return `${c.blurb}\n${c.shape}\nexample: ${JSON.stringify(c.example)}`;
}
