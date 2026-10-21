import { useEffect, useMemo, useRef, useState } from 'react';
import { agentRuns } from '../agents/agentRuns';
import { setChatPick } from '../agents/chatConfig';
import type { Store } from './store';
import { createAgentSwitcher } from './agentSwitch';
import { parseSwitchCommand, SWITCH_USAGE } from './switchRule';

/** Observes live transitions, not counts of historical rows. Subscription runs before a queued prompt drains. */
export function useChatSwitch(store: Store) {
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ sid: string; text: string } | null>(null);
  const alive = useRef(true);
  const seat = `${store.getState().session.activeId ?? ''}:${agentRuns.everyRun().shown ?? ''}`;
  const generation = useRef({ seat, value: 0 });
  if (generation.current.seat !== seat) generation.current = { seat, value: generation.current.value + 1 };
  const ticket = useRef(0);
  const switcher = useMemo(() => createAgentSwitcher({
    runs: agentRuns,
    liveIds: sid => {
      const session = store.getState().session;
      return session.activeId === sid && session.inFlight ? [`builtin:${session.inFlight.turnId}`] : [];
    },
    busy: sid => {
      const state = store.getState();
      return (state.session.activeId === sid && state.session.inFlight !== null) || agentRuns.get().runs.some(r => r.sessionId === sid && r.status === 'running');
    },
  }), [store]);
  useEffect(() => {
    alive.current = true;
    let before = agentRuns.get();
    const offRuns = agentRuns.subscribe(() => {
      const next = agentRuns.get();
      const prev = before;
      before = next; // advance before the completion write emits recursively
      for (const r of next.runs) {
        if (r.sessionId && !r.nodeId && r.status !== 'running' && prev.runs.some(p => p.id === r.id && p.status === 'running')) switcher.complete(r.sessionId, r);
      }
    });
    let previous = store.getState().session;
    const offStore = store.subscribe(() => {
      const next = store.getState().session;
      const prev = previous;
      previous = next;
      if (prev.activeId !== next.activeId) generation.current.value++;
      const live = prev.inFlight;
      if (!live || prev.activeId !== next.activeId || !next.activeId || next.inFlight?.turnId === live.turnId || live.phase === 'stopping') return;
      const landed = next.turns.find(t => t.id === live.turnId && t.role === 'assistant');
      if (landed?.role === 'assistant' && !landed.failure) switcher.complete(next.activeId, { id: `builtin:${live.turnId}`, startedAt: live.startedAt, status: 'done' });
    });
    return () => { alive.current = false; generation.current.value++; offRuns(); offStore(); };
  }, [store, switcher]);

  const sid = store.getState().session.activeId ?? '';
  const rule = agentRuns.get().chatConfig?.[sid]?.switchRule;
  const inflight = store.getState().session.inFlight;
  const agentBusy = agentRuns.get().runs.some(r => r.sessionId === sid && r.status === 'running');
  const attempted = useRef<object | null>(null);
  useEffect(() => {
    if (!rule || rule.remaining !== 0 || rule.error || inflight || agentBusy || pending || attempted.current === rule) return;
    attempted.current = rule;
    const epoch = generation.current.value;
    const requestId = ++ticket.current;
    setPending(sid);
    void switcher.request(sid, rule.target, undefined, () => alive.current && generation.current.value === epoch && store.getState().session.activeId === sid).then(result => {
      if (!alive.current || requestId !== ticket.current) return;
      setPending(null);
      if (generation.current.value !== epoch) { attempted.current = null; return; }
      if (agentRuns.get().chatConfig?.[sid]?.switchRule === rule && !result.ok) agentRuns.patch(s => setChatPick(s, sid, { switchRule: { ...rule, error: result.message } }));
      setNotice({ sid, text: result.message });
    });
  }, [sid, rule, inflight, agentBusy, pending, store, switcher]);

  const pick = async (target: string, turns?: number): Promise<boolean> => {
    const chat = store.getState().session.activeId ?? '';
    const epoch = generation.current.value;
    const requestId = ++ticket.current;
    setPending(chat);
    const result = await switcher.request(chat, target, turns, () => alive.current && generation.current.value === epoch && store.getState().session.activeId === chat);
    if (alive.current && requestId === ticket.current) { setPending(null); if (generation.current.value === epoch) setNotice(result.ok && turns !== undefined ? null : { sid: chat, text: result.message }); }
    return result.ok;
  };
  const cancel = () => {
    const chat = store.getState().session.activeId ?? '';
    ++ticket.current;
    const existed = !!agentRuns.get().chatConfig?.[chat]?.switchRule;
    switcher.cancel(chat);
    setPending(null);
    setNotice({ sid: chat, text: existed ? 'Scheduled switch cancelled.' : 'No scheduled switch in this chat.' });
  };
  const take = (text: string): boolean => {
    const cmd = parseSwitchCommand(text);
    if (!cmd) return false;
    if (cmd.kind === 'cancel') cancel();
    else if (cmd.kind === 'invalid') setNotice({ sid, text: SWITCH_USAGE });
    else void pick(cmd.target, cmd.kind === 'schedule' ? cmd.turns : undefined);
    return true;
  };
  return { rule, pick, cancel, take, pending: pending === sid || (!!rule && rule.remaining === 0 && !rule.error), notice: notice?.sid === sid ? notice.text : null };
}
