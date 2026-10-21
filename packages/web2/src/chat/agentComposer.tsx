/* ══════════════════════════════════════════════════════════════════════════
   THE COMPOSER AROUND AN AGENT (S2b), ONE LAZY CHUNK
   packages/web2/src/chat/agentComposer.tsx

   V3Chat mounts these three slots only once a chat talks to an agent, so
   none of this is in the boot bundle:

     header   the agent, its model, the context ring and "25% ctx · $0.04"
              (Ramp Kit's top bar), the account's limits on hover, Compact
     strip    the agent's todo list (chat/TodoList) and its subagents,
              pinned above the composer while there is work left
     models   in the model menu: the agent's own models and reasoning
              efforts (ACP configOptions, codex model/list), and the way
              back to a Sequence model

   Everything is read from the run store (agents/agentActivity.ts); what the
   agent offers is asked of the server once per agent (agentRunner.ts
   loadCapabilities). The strip's derivation is shared with the board.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useSyncExternalStore } from 'react';

import { agentActivity, limitsText, usageChip } from '../agents/agentActivity';
import { loadCapabilities } from '../agents/agentRunner';
import { agentRuns, type AgentRunStore } from '../agents/agentRuns';
import { chatPick, setChatPick } from '../agents/chatConfig';
import { useAppState } from '../state';
import { Icon } from './Icon';
import { EffortSlider, modelEfforts } from './EffortSlider';
import { TodoList } from './TodoList';
import { displayModelName } from './modelNickname';

import './agentRun.css';

/* The board overlay (canvas/AgentOverlay.tsx) loads the strip's data from this
   chunk, so agentActivity is not a chunk of its own with a name in the boot
   preload list. */
export { agentActivity, agentDoing } from '../agents/agentActivity';

export interface AgentSlotProps {
  slot: 'header' | 'strip' | 'models';
  store?: AgentRunStore;
}

/** Stop talking to the agent in this chat: the composer goes back to the chosen model. */
export function detachAgent(store: AgentRunStore, sessionId: string | null): void {
  if (!sessionId) return;
  store.patch((s) => {
    const agents = { ...s.agents };
    delete agents[sessionId];
    return { ...s, agents };
  });
}

/* The open chat and the agent it talks to are read here, not passed in, so the boot chunk only mounts the slot. */
export default function AgentSlot({ slot, store = agentRuns }: AgentSlotProps) {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const sessionId = useAppState().session.activeId ?? null;
  const agentRef = state.agents?.[sessionId ?? ''] ?? '';
  useEffect(() => {
    if (agentRef) void loadCapabilities(store, agentRef, (input, init) => fetch(input, init));
  }, [store, agentRef]);
  const act = agentRef ? agentActivity(state, sessionId) : null;
  if (!act) return null;
  const caps = state.caps?.[agentRef];
  const config = chatPick(state, agentRef, sessionId);

  if (slot === 'header') {
    const chip = usageChip(act.usage);
    const limits = limitsText(act.limits);
    const model = config.model ? (caps?.models.find((m) => m.id === config.model)?.name ?? displayModelName(config.model)) : caps?.models.find((m) => m.isDefault)?.name;
    return (
      <div className="agchat-hd" data-testid="agent-chat-header" data-transcript-sticky="">
        <Icon name="agent" size={14} />
        <b className="agchat-who">{agentRef}</b>
        {model ? <span className="agchat-model">{model}</span> : null}
        <span className="agchat-sp" />
        {/* The context ring lives in the status bar under the chat box only (round 12). */}
        {chip ? (
          <span className="agchat-usage" data-testid="agent-usage" title={limits ?? undefined}>
            {chip}
          </span>
        ) : null}
        <button
          type="button"
          className="agbtn"
          data-testid="agent-compact"
          disabled={act.running}
          title="Summarise the conversation so far to free the context window"
          onClick={() =>
            void store.start({
              agentRef,
              sessionId,
              compact: true,
              question: 'Compact the conversation',
              ...(act.latest?.access ? { access: act.latest.access } : {}),
              ...(act.latest?.intent ? { intent: act.latest.intent } : {}),
            })
          }
        >
          Compact
        </button>
      </div>
    );
  }

  if (slot === 'strip') {
    const left = act.todos.some((t) => t.status !== 'done');
    const runningSubs = act.subagents.filter((s) => s.running);
    const latest = act.latest;
    if (!act.doing && (act.todos.length === 0 || (!left && !act.running)) && runningSubs.length === 0) return null;
    return (
      <div className="agstrip chat-scope" data-testid="agent-strip">
        {/* What the agent is doing now, and Stop. A running tool is named by
            its kind only: its row in the thread names the command. */}
        {act.doing && latest ? (
          <p className="agstrip-now" data-testid="agent-status">
            <span className="agstrip-dot" aria-hidden="true" />
            <span className="agstrip-doing" data-testid="agent-status-doing">
              {act.doing}
            </span>
            <button type="button" className="agbtn" data-testid="agent-stop" onClick={() => store.stop(latest.id)}>
              Stop
            </button>
          </p>
        ) : null}
        {act.todos.length ? <TodoList items={act.todos} streaming={act.running} /> : null}
        {runningSubs.length ? (
          <p className="agstrip-subs" data-testid="agent-subagents">
            {runningSubs.map((s) => (
              <span key={s.id} className="agstrip-sub">
                <Icon name="agent" size={12} />
                {s.label}
              </span>
            ))}
          </p>
        ) : null}
      </div>
    );
  }

  /* slot === 'models' */
  const models = caps?.models ?? [];
  const chosen = config.model ?? models.find((m) => m.isDefault)?.id ?? models[0]?.id;
  const efforts = modelEfforts(caps, chosen);
  const effort = config.effort ?? models.find((m) => m.id === chosen)?.defaultEffort;
  const set = (patch: { model?: string; effort?: string }) =>
    store.patch((s) => (sessionId ? setChatPick(s, sessionId, patch) : { ...s, config: { ...s.config, [agentRef]: { ...s.config?.[agentRef], ...patch } } }));
  return (
    <div className="agmodels" data-testid="agent-models">
      <p className="v3-pop-heading">{agentRef} model</p>
      {!caps ? <p className="v3-mode-pop-desc">Asking {agentRef} what it offers…</p> : null}
      {models.map((m) => (
        <button
          key={m.id}
          type="button"
          role="menuitemradio"
          aria-checked={m.id === chosen}
          className={m.id === chosen ? 'is-selected' : ''}
          data-testid="agent-model"
          data-model={m.id}
          title={m.description ?? m.id}
          onClick={() => set({ model: m.id })}
        >
          <span className="v3-mode-pop-label">{m.name}</span>
        </button>
      ))}
      {efforts.length ? (
        <>
          <p className="v3-pop-heading">Reasoning</p>
          <EffortSlider choices={efforts} value={effort} onChange={e => set({ effort: e })} />
        </>
      ) : null}
      <button type="button" role="menuitem" data-testid="agent-detach" onClick={() => detachAgent(store, sessionId)}>
        <span className="v3-mode-pop-label">Use a Sequence model instead</span>
      </button>
    </div>
  );
}
