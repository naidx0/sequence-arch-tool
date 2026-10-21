/**
 * P4 — ACP readiness BEFORE Start, not only after a 403.
 *
 * `@sequence/api-types` says a client must feature-detect through
 * `/api/acp/available`. Activity used to POST `/api/program/run` blind and only
 * surface "ACP is not available" after the refusal. That is still honest; this
 * probe tells the reader the same sentence before they commit a form.
 *
 * PURE. Wire results in → note out. No fetch.
 */

import { agentSetupPrompt, draftIntoComposer } from '../onboarding/agentSetupPrompt';
import { modelConfigured } from '../onboarding/setupFallback';
import type { ModelSelection } from '../state/types';

/** A button under the no-agent note. `copyText` makes it a Copy button for that text (nothing can answer a drafted prompt). */
export interface AcpAction {
  label: string;
  onClick: () => void;
  testid: string;
  copyText?: string;
}

export type AcpReadiness =
  | { kind: 'unknown' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'no-agents' }
  | { kind: 'ready'; count: number };

/**
 * Calm copy for the author form. `null` when there is nothing useful to say
 * (probe still pending, or agents are registered — do not invent a green bar).
 */
export function acpReadinessNote(readiness: AcpReadiness): string | null {
  switch (readiness.kind) {
    case 'unknown':
      return null;
    case 'unavailable':
      return readiness.reason;
    case 'no-agents':
      return 'No agent is connected yet. Workflows need one. Connect an agent, then start again.';
    case 'ready':
      return null;
  }
}

interface ReadinessStore {
  getState(): { composer: { draft?: string | null; model?: ModelSelection } };
  dispatch(action: any): unknown;
}

/**
 * The buttons under the "No agent is connected yet" note: one opens Settings on the agents list (every agent there
 * connects with a click), one drafts the whole setup into the chat for the agent to do. Nothing without a store.
 */
export function acpReadinessActions(readiness: AcpReadiness, store: ReadinessStore | null): AcpAction[] {
  if (readiness.kind !== 'no-agents' || !store) return [];
  return [
    {
      label: 'Connect an agent',
      testid: 'activity-acp-connect',
      onClick: () => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'agents' } }),
    },
    /* A model that is connected can answer a drafted prompt; with none, the prompt is for the person to paste elsewhere. */
    ...(modelConfigured(store.getState().composer.model)
      ? [
          {
            label: 'Set up in chat',
            testid: 'activity-acp-chat',
            onClick: () => {
              draftIntoComposer(store, agentSetupPrompt({ need: 'none' }));
              store.dispatch({ type: 'shell/overlay', overlay: null });
            },
          },
        ]
      : [
          { label: 'Copy setup prompt', testid: 'activity-acp-copy', onClick: () => {}, copyText: agentSetupPrompt({ need: 'none' }) },
          {
            label: 'Connect a model',
            testid: 'activity-acp-model',
            onClick: () => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'models' } }),
          },
        ]),
  ];
}
