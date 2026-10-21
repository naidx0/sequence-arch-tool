/*
 * A WORKFLOW LOOP DRAWN IN PROSE (B12). A ```workflow fence carries a small
 * JSON spec; the chat draws it as a node diagram with its loop-back edge, so a
 * model can show a loop without opening the Agents surface. Untrusted text:
 * every field is checked and clipped, and anything off returns null so the
 * caller shows the raw block.
 */

export interface WorkflowLoopSpec {
  name: string;
  steps: { id: string; label: string }[];
  loop: { from: string; to: string; until?: string } | null;
}

export const WORKFLOW_FENCE_MAX_STEPS = 12;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,31}$/;

// eslint-disable-next-line no-control-regex
const clean = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) || null : null);

export function parseWorkflowFence(text: string): WorkflowLoopSpec | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = clean(o.name, 80);
  if (!name || !Array.isArray(o.steps)) return null;
  if (o.steps.length < 2 || o.steps.length > WORKFLOW_FENCE_MAX_STEPS) return null;
  const steps: WorkflowLoopSpec['steps'] = [];
  for (const s of o.steps) {
    if (!s || typeof s !== 'object') return null;
    const id = (s as Record<string, unknown>).id;
    const label = clean((s as Record<string, unknown>).label, 40);
    if (typeof id !== 'string' || !ID.test(id) || !label || steps.some((x) => x.id === id)) return null;
    steps.push({ id, label });
  }
  let loop: WorkflowLoopSpec['loop'] = null;
  if (o.loop !== undefined && o.loop !== null) {
    if (typeof o.loop !== 'object' || Array.isArray(o.loop)) return null;
    const l = o.loop as Record<string, unknown>;
    const ids = steps.map((s) => s.id);
    if (typeof l.from !== 'string' || typeof l.to !== 'string') return null;
    const f = ids.indexOf(l.from);
    const t = ids.indexOf(l.to);
    if (f < 0 || t < 0 || t > f) return null;
    const until = l.until === undefined ? undefined : clean(l.until, 120);
    if (l.until !== undefined && !until) return null;
    loop = { from: l.from, to: l.to, ...(until ? { until } : {}) };
  }
  return { name, steps, loop };
}

/** The instruction the author form is prefilled with when a loop is run from the chat. */
export function workflowInstruction(spec: WorkflowLoopSpec): string {
  const label = (id: string): string => spec.steps.find((s) => s.id === id)?.label ?? id;
  const list = spec.steps.map((s, i) => `${i + 1}. ${s.label}`).join('; ');
  const back = spec.loop ? ` Then loop from "${label(spec.loop.from)}" back to "${label(spec.loop.to)}"${spec.loop.until ? ` until ${spec.loop.until}` : ''}.` : '';
  return `Run the workflow "${spec.name}". Steps: ${list}.${back}`;
}
