/* ══════════════════════════════════════════════════════════════════════════
   THE ```visual FENCE
   packages/schema/src/visual/fence.ts

   For agents without the MCP tool (local models, plain CLIs): the block body
   is the same JSON the tool takes.
       ```visual
       {"component":"line","spec":{...},"title":"optional"}
       ```
   or, to show a drawing the tool already saved: {"id":"d5"}.
   ══════════════════════════════════════════════════════════════════════════ */

export type VisualFence =
  | { kind: 'spec'; component: string; spec: unknown; title?: string; width?: number }
  | { kind: 'ref'; id: string }
  | { kind: 'error'; message: string };

export function parseVisualFence(body: string): VisualFence {
  const src = body.trim();
  if (src === '') return { kind: 'error', message: 'the visual block is empty; expected {"component": ..., "spec": {...}}' };
  let j: unknown;
  try {
    j = JSON.parse(src);
  } catch (e) {
    return { kind: 'error', message: `the visual block is not valid JSON (${e instanceof Error ? e.message.slice(0, 80) : 'parse error'})` };
  }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return { kind: 'error', message: 'the visual block must be a JSON object: {"component": ..., "spec": {...}}' };
  const o = j as Record<string, unknown>;
  if (typeof o.id === 'string' && o.component === undefined) {
    return /^d[0-9]{1,6}$/.test(o.id) ? { kind: 'ref', id: o.id } : { kind: 'error', message: `"${o.id}" is not a drawing id like d5` };
  }
  if (typeof o.component !== 'string') return { kind: 'error', message: 'the visual block needs "component" (for example "line") and "spec"' };
  if (o.spec === undefined) return { kind: 'error', message: `the visual block needs "spec" for ${o.component}` };
  return { kind: 'spec', component: o.component, spec: o.spec, ...(typeof o.title === 'string' ? { title: o.title } : {}), ...(typeof o.width === 'number' ? { width: o.width } : {}) };
}
