/* ══════════════════════════════════════════════════════════════════════════
   WHICH MODEL THE AGENT IS ON (round 7, A3)
   packages/web2/src/agents/activeModel.ts

   Jaden: "In terms of Codex, it doesn't tell you which model you're using."
   The model pill and the status bar name the agent's model from what the
   agent itself said, in this order:
     1. the model the person picked in that chat for that agent (it goes on
        every turn of that chat, and no other chat's);
     2. the model the agent said its last turn in this chat ran on
        (acp:model: codex's thread/start|resume `model`, an ACP agent's model
        option);
     3. the default the agent reports in its model list (codex model/list
        isDefault).
   Some agents name their model as "default" (Claude Code: id `default`, shown
   by its picker as "Default (recommended)" with the real model, "Opus 4.5", in
   the entry's description). That placeholder is never what a person reads:
   the bar and the chip show the model the description names (owner, H4: "the
   model name, not a placeholder"). Only when nothing resolves does it fall
   back to the agent's default ("Codex default"); the status bar words that
   neutrally as "Default model" (never "<Agent> default"). Never a name the
   agent did not give: an id with no display name is shown as its short
   nickname (chat/modelNickname.ts), the id itself when nothing can be said.
   ══════════════════════════════════════════════════════════════════════════ */

import { tidyModelName } from '../chat/modelNickname';
import type { AgentRunsState } from './agentRuns';
import { chatPick, modelOffered } from './chatConfig';

/** What an agent's model is called before the agent has said which: whose default it is. */
export function defaultModelLabel(agentRef: string): string {
  return `${agentRef.charAt(0).toUpperCase()}${agentRef.slice(1)} default`;
}

export interface ActiveModel {
  /** The id the agent knows it by, or null while unknown. */
  id: string | null;
  /** What to show. */
  label: string;
  /** Where it came from (for the title and tests). */
  source: 'chosen' | 'session' | 'default' | 'unknown';
}

/** A model entry the agent calls "default": its own name is a placeholder, its description names the model. */
export function isPlaceholderModel(m: { id: string; name: string }): boolean {
  return m.id === 'default' || /^default\b/i.test(m.name);
}

/** The model a placeholder entry's description names ("Opus 4.5 - Most capable" gives "Opus 4.5"), or null. */
export function modelNamedByDescription(m: { description?: string }): string | null {
  const first = (m.description ?? '').split(/\s[\u00b7\u2022\u2014\u2013|-]\s|\.\s|[,;:(]/)[0]?.trim() ?? '';
  return first && first.length <= 28 && /[a-z]/i.test(first) ? tidyModelName(first) : null;
}

export function activeAgentModel(state: Pick<AgentRunsState, 'runs' | 'caps' | 'config' | 'chatConfig'>, agentRef: string, sessionId: string | null): ActiveModel {
  const caps = state.caps?.[agentRef];
  const nameOf = (id: string) => {
    const m = caps?.models.find((x) => x.id === id);
    if (m && isPlaceholderModel(m)) return modelNamedByDescription(m) ?? tidyModelName(m.name || id);
    return tidyModelName(m?.name || id);
  };
  /* This chat's own pick; no chat named (a board node, a test) reads the agent's last pick. A model the agent no longer offers is not shown: its default answers. */
  const chosen = sessionId === null ? state.config?.[agentRef]?.model : chatPick(state, agentRef, sessionId).model;
  if (chosen && modelOffered(caps, chosen)) return { id: chosen, label: nameOf(chosen), source: 'chosen' };
  const said = [...state.runs].reverse().find((r) => r.agentRef === agentRef && (sessionId === null || r.sessionId === sessionId) && r.model && modelOffered(caps, r.model))?.model;
  if (said) return { id: said, label: nameOf(said), source: 'session' };
  const def = caps?.models.find((m) => m.isDefault);
  if (def) return { id: def.id, label: nameOf(def.id), source: 'default' };
  return { id: null, label: defaultModelLabel(agentRef), source: 'unknown' };
}

/* ── THE MODEL THE COMPOSER HAS RESOLVED ───────────────────────────────────
   The composer chip resolves the saved model that answers (its nickname, its
   provider, whether it is hosted) from the picker's list. The status bar reads
   the same record so the bar and the chip cannot name different providers. */

import type { ModelIdentity } from '../shell2/brandIcons';

export interface ResolvedModel extends ModelIdentity {
  /** The wire id the composer's selection carries. */
  model: string;
  /** What the chip calls it. */
  label: string;
}

let resolved: ResolvedModel | null = null;
const listeners = new Set<() => void>();

export const resolvedModel = {
  get: (): ResolvedModel | null => resolved,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  set(next: ResolvedModel | null): void {
    const same =
      next === resolved ||
      (next !== null && resolved !== null && next.model === resolved.model && next.label === resolved.label && next.provider === resolved.provider && next.baseUrl === resolved.baseUrl && next.keyed === resolved.keyed && next.managed === resolved.managed);
    if (same) return;
    resolved = next;
    for (const fn of [...listeners]) fn();
  },
};
