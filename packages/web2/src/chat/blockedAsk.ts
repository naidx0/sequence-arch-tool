/* ══════════════════════════════════════════════════════════════════════════
   A BLOCKED ASK IS KEPT AND RUNS AFTER CONNECT (P0-4)
   packages/web2/src/chat/blockedAsk.ts

   A send with no model and no agent came back 400 `fix: 'provider'`. What was
   sent is captured once, with the chat it was sent in: the words, the chips
   (an "Ask about this" board reference rides as one) and the attachments. The
   card above the composer (ConnectToRun.tsx) shows only in that chat, opens
   the connect flow in place, and this runs that same ask once something is
   connected, so nobody types it twice:

     an agent   becomes THAT chat's agent and gets the ask as a run
     a model    the composer follows the server's now-active model, then the
                ask is sent again in that chat, with its chips and attachments
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentRunStore, RunAttachment, RunRef, StartRunOptions } from '../agents/agentRuns';
import type { SettingsClient } from '../settings/settingsClient';
import { bumpModelGen, composerPropsFrom, syncComposerModelFromConfig } from '../state/connect';
import type { Store } from '../state/store';
import type { AppState, ComposerAttachment, ContextChip } from '../state/types';

/** The ask a refusal blocked, pinned to the chat it was sent in. */
export interface BlockedAsk {
  sessionId: string | null;
  turnId: string;
  text: string;
  chips: ContextChip[];
  attachments: ComposerAttachment[];
  /** The turn object itself: a chat switch replaces the turns, so this tells "the same chat, now named" from "another chat". */
  source: object;
}

/**
 * The ask the refusal blocked: the active chat's last user turn, with the attachments that went with it
 * (`sentAttachments`, the composer's attachments as they stood when it was sent; a sent turn does not keep them).
 */
export function captureBlockedAsk(state: AppState, sentAttachments: readonly ComposerAttachment[]): BlockedAsk | null {
  for (let i = state.session.turns.length - 1; i >= 0; i--) {
    const turn = state.session.turns[i]!;
    if (turn.role === 'user' && turn.text.trim()) {
      return { sessionId: state.session.activeId, turnId: turn.id, text: turn.text, chips: [...turn.chips], attachments: [...sentAttachments], source: turn };
    }
  }
  return null;
}

export interface ReplayDeps {
  runs: Pick<AgentRunStore, 'patch' | 'start'>;
  settings: Pick<SettingsClient, 'read'>;
  access: StartRunOptions['access'];
  intent: StartRunOptions['intent'];
}

/** The ask as an agent run's attachments and board references (the same mapping the chat's own send uses). */
function forAgent(ask: BlockedAsk): { attachments: RunAttachment[]; refs: RunRef[] } {
  const attachments: RunAttachment[] = [
    ...ask.attachments.map((a): RunAttachment => (a.kind === 'image' ? { kind: 'image', id: a.id } : { kind: 'text', id: a.id })),
    ...ask.chips.flatMap((c): RunAttachment[] =>
      c.kind === 'node' ? [{ kind: 'node', nodeId: c.ref }] : c.kind === 'file' ? [{ kind: 'file', path: c.ref }] : c.kind === 'function' && /^fn:([^#]+)#/.test(c.ref) ? [{ kind: 'file', path: /^fn:([^#]+)#/.exec(c.ref)![1]! }] : [],
    ),
  ];
  const refs = ask.chips.filter((c) => c.kind === 'board-ref').map((c) => ({ label: c.label, block: c.detail ?? c.label }));
  return { attachments, refs };
}

/**
 * Run the blocked ask on what was just connected, in the chat it was blocked in. Returns false (and runs
 * nothing) when that chat is no longer the one on screen: the ask stays pending for it.
 */
export async function replayBlockedAsk(store: Store, ask: BlockedAsk, connected: { agent?: string; model?: string }, deps: ReplayDeps): Promise<boolean> {
  if (connected.agent) {
    const agent = connected.agent;
    const sid = ask.sessionId ?? '';
    deps.runs.patch((s) => ({ ...s, agents: { ...s.agents, [sid]: agent } }));
    if (store.getState().session.activeId === ask.sessionId) store.dispatch({ type: 'net/clear' });
    const { attachments, refs } = forAgent(ask);
    void deps.runs.start({ agentRef: agent, question: ask.text, sessionId: ask.sessionId, access: deps.access, intent: deps.intent, ...(attachments.length ? { attachments } : {}), ...(refs.length ? { refs } : {}) });
    return true;
  }
  /* A model: the composer names the model the server will now answer with, then the ask goes again. */
  const gen = bumpModelGen();
  const cfg = await deps.settings.read();
  if (cfg.outcome === 'ok') syncComposerModelFromConfig(store, cfg.body, gen);
  if (store.getState().session.activeId !== ask.sessionId) return false;
  const { dispatch } = store;
  const kept = store.getState().composer;
  dispatch({ type: 'net/clear' });
  /* The ask exactly as it went: words, chips, attachments. What the composer held is put back after. */
  for (const c of ask.chips) if (!kept.chips.some((k) => k.id === c.id)) dispatch({ type: 'composer/chip-add', chip: c });
  for (const a of ask.attachments) if (!kept.attachments.some((k) => k.id === a.id)) dispatch({ type: 'composer/attachment-add', attachment: a });
  dispatch({ type: 'composer/draft', text: ask.text });
  composerPropsFrom(store.getState(), store).onSend();
  if (kept.draft !== '' && kept.draft !== ask.text) dispatch({ type: 'composer/draft', text: kept.draft });
  return true;
}
