/* ══════════════════════════════════════════════════════════════════════════
   WHICH PART OF THE AGENTS SURFACE TO SHOW, ASKED FROM OUTSIDE
   packages/web2/src/agents/agentsSection.ts

   "Show workflows" in the command palette and "Start a workflow" in the +
   menu used to open the Activity overlay. Workflows now live inside the
   Agents surface, so those doors open that surface on its Workflows section.
   The request is a one-shot (the surface may not be mounted yet, so it waits
   to be taken), the same shape as activity/activityLaunch.ts, which still
   carries the prefilled launch form.
   ══════════════════════════════════════════════════════════════════════════ */

import type { Store } from '../state/store';

export type AgentsSurfaceView = 'tree' | 'timeline' | 'workflows';

let pending: AgentsSurfaceView | null = null;
const subs = new Set<() => void>();

export function requestAgentsView(view: AgentsSurfaceView): void {
  pending = view;
  subs.forEach((f) => f());
}

/** Consume the pending request (once). */
export function takeAgentsViewRequest(): AgentsSurfaceView | null {
  const next = pending;
  pending = null;
  return next;
}

export function subscribeAgentsViewRequest(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/** Open the Agents surface on Workflows. A second ask while it is already forward re-fires the focus. */
export function openWorkflows(store: Pick<Store, 'dispatch' | 'getState'>): void {
  requestAgentsView('workflows');
  if (store.getState().session.surfaceFocus === 'agents') {
    store.dispatch({ type: 'surface/focus', surface: null });
    window.setTimeout(() => store.dispatch({ type: 'surface/focus', surface: 'agents' }), 0);
    return;
  }
  store.dispatch({ type: 'surface/focus', surface: 'agents' });
}
