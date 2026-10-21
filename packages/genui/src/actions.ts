/** The way back: a click on a generated control becomes a UIAction for the agent. Only
 *  declared actions dispatch, and none while the agent is mid-turn unless the action says
 *  whileBusy (ChatGPT's DIL renderer disables actions during an active turn the same way). */
import { getAt } from './pointer.js';
import type { UIAction, UISpec } from './types.js';

export type ActionVerdict = { ok: true; action: UIAction } | { ok: false; reason: string };

export function buildAction(spec: UISpec, surfaceId: string, elementId: string, busy: boolean, now = Date.now()): ActionVerdict {
  const el = spec.elements[elementId];
  if (!el || el.type !== 'Button') return { ok: false, reason: 'not a control' };
  if (el.props.disabled === true) return { ok: false, reason: 'disabled' };
  const ref = el.props.action as { name?: string; params?: Record<string, unknown> } | undefined;
  if (!ref?.name) return { ok: false, reason: 'no action' };
  const decl = spec.actions[ref.name];
  if (!decl) return { ok: false, reason: `action "${ref.name}" is not declared` };
  if (busy && !decl.whileBusy) return { ok: false, reason: 'the agent is working' };
  /* Params may bind to state too: {"files": {"$state": "/selected"}}. */
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ref.params ?? {})) {
    params[k] = v && typeof v === 'object' && '$state' in (v as object) ? getAt(spec.state, String((v as { $state: string }).$state)) : v;
  }
  return { ok: true, action: { kind: 'ui.action', surfaceId, name: ref.name, params, elementId, state: spec.state, at: now } };
}

/** The action as a message for an agent that only reads text (a CLI agent's next turn). */
export function actionToPrompt(a: UIAction, label?: string): string {
  return `[ui.action] The person clicked "${label ?? a.name}" on surface "${a.surfaceId}". action=${a.name} params=${JSON.stringify(a.params)}. Continue: update that surface with genui ops as you work.`;
}
