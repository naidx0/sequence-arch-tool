/* ══════════════════════════════════════════════════════════════════════════
   "SEVERAL AGENTS AT ONCE" (best of N)
   packages/web2/src/fanout/FanoutMenu.tsx

   Opened from the composer's + menu. Tick two or more registered agents (a
   Shift-click on a row ticks the range from the last one) and the message in
   the composer goes to all of them, each in its own chat and its own git
   worktree. Nothing is sent until the button is pressed; a refusal says why
   and leaves nothing behind.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';

import { S2Icon } from '../shell2/icons';
import { agentRuns, type AgentRunStore, type StartRunOptions } from '../agents/agentRuns';
import type { Store } from '../state';
import { sendToAgents } from './fanoutClient';
import './fanout.css';

export function FanoutMenu({
  store,
  draft,
  start,
  runs = agentRuns,
  onClose,
}: {
  store: Store;
  draft: string;
  start?: Omit<StartRunOptions, 'question' | 'sessionId' | 'agentRef'>;
  runs?: AgentRunStore;
  onClose: () => void;
}) {
  const [agents, setAgents] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [last, setLast] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetch('/api/acp/agents')
      .then((r) => r.json() as Promise<{ agents?: { id: string }[] }>)
      .then((j) => live && setAgents((j.agents ?? []).map((a) => a.id)))
      .catch(() => live && setAgents([]));
    return () => {
      live = false;
    };
  }, []);

  const toggle = (i: number, shift: boolean): void => {
    if (!agents) return;
    setPicked((cur) => {
      const on = !cur.includes(agents[i]!);
      const span = shift && last !== null ? agents.slice(Math.min(last, i), Math.max(last, i) + 1) : [agents[i]!];
      const next = on ? [...new Set([...cur, ...span])] : cur.filter((a) => !span.includes(a));
      return agents.filter((a) => next.includes(a));
    });
    setLast(i);
  };

  const text = draft.trim();
  const can = picked.length >= 2 && text !== '' && !busy;
  const send = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const r = await sendToAgents({ store, runs, prompt: text, agents: picked, ...(start ? { start } : {}) });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    store.dispatch({ type: 'composer/draft', text: '' });
    onClose();
  };

  return (
    <section className="s2-notice fo-menu" role="dialog" aria-label="Send to several agents" data-testid="fanout-menu">
      <header className="fo-hd">
        <b>Send to several agents</b>
        <button type="button" className="s2-ibtn s2-ibtn-sm" aria-label="Close" onClick={onClose}>
          <S2Icon name="x" small />
        </button>
      </header>
      <p className="fo-line">Each agent gets this message in its own chat and its own git worktree. You compare them, then merge the one you want.</p>
      {agents === null ? <p className="fo-line">Looking for agents…</p> : null}
      {agents && agents.length < 2 ? <p className="fo-line" data-testid="fanout-few">Connect a second agent to compare two. You have {agents.length}.</p> : null}
      <ul className="fo-list">
        {(agents ?? []).map((a, i) => (
          <li key={a}>
            <label>
              <input type="checkbox" checked={picked.includes(a)} data-testid="fanout-agent" onChange={() => {}} onClick={(e) => toggle(i, e.shiftKey)} />
              {a}
            </label>
          </li>
        ))}
      </ul>
      {text === '' ? <p className="fo-line">Type the message first.</p> : null}
      {error ? (
        <p className="fo-line fo-error" role="alert" data-testid="fanout-error">
          {error}
        </p>
      ) : null}
      <div className="s2-notice-acts">
        <button type="button" className="s2-btn s2-btn-sm s2-blue" disabled={!can} data-testid="fanout-send" onClick={() => void send()}>
          {busy ? 'Sending…' : picked.length >= 2 ? `Send to ${picked.length} agents` : 'Pick two or more'}
        </button>
      </div>
    </section>
  );
}
