/** Data binding: a prop written {"$state": "/tests/passed"} reads the surface data model.
 *  The agent then updates a number with one `set` line instead of re-sending the element,
 *  which is what makes live progress cheap (A2UI's updateDataModel, json-render's state). */
import { getAt } from './pointer.js';

export const isBinding = (v: unknown): v is { $state: string } =>
  v != null && typeof v === 'object' && !Array.isArray(v) && typeof (v as { $state?: unknown }).$state === 'string' && Object.keys(v).length === 1;

export interface Resolved {
  props: Record<string, unknown>;
  unbound: string[];
}

function resolveValue(v: unknown, state: Record<string, unknown>, unbound: string[]): unknown {
  if (isBinding(v)) {
    const got = getAt(state, v.$state);
    if (got === undefined) unbound.push(v.$state);
    return got;
  }
  if (Array.isArray(v)) return v.map((x) => resolveValue(x, state, unbound));
  if (v != null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const r = resolveValue(x, state, unbound);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return v;
}

export function resolveProps(props: Record<string, unknown>, state: Record<string, unknown>): Resolved {
  const unbound: string[] = [];
  const out = resolveValue(props ?? {}, state ?? {}, unbound) as Record<string, unknown>;
  return { props: out, unbound };
}
