/* The five-hour retry of the main agent after a usage-limit failover. Lives
   next to the run cards, not in the boot shell: it only matters once a chat
   has handed work to an agent. */
import { useEffect } from 'react';

import type { AgentRunStore } from './agentRuns';
import { decideOnTick, loadFailover, retryPrimaryAt, saveFailover } from './agentFailover';

async function primaryReady(id: string, f: typeof fetch): Promise<boolean> {
  try {
    const r = await f('/api/onboarding/providers');
    if (!r.ok) return false;
    const body = (await r.json()) as { providers?: { id: string; state: string }[] };
    const row = (body.providers ?? []).find((p) => p.id === id);
    return !!row && row.state !== 'limited';
  } catch {
    return false;
  }
}

export function FailoverWatch({
  store,
  clock = Date.now,
  fetch: f = fetch,
  storage = typeof localStorage === 'undefined' ? null : localStorage,
}: {
  store: AgentRunStore;
  clock?: () => number;
  fetch?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}) {
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const state = loadFailover(storage);
      const at = retryPrimaryAt(state);
      if (at === null) return;
      const delay = Math.max(0, Math.min(at - clock(), 2_147_000_000));
      timer = setTimeout(() => {
        void (async () => {
          if (!live) return;
          const cur = loadFailover(storage);
          const ready = cur.format.primary ? await primaryReady(cur.format.primary, f) : false;
          if (!live) return;
          const { decision, state: next } = decideOnTick({ primaryReady: ready, state: cur, now: clock() });
          saveFailover(storage, next);
          if (decision.action === 'retry-primary' && cur.off) {
            const backup = cur.format.backup;
            store.patch((s) => {
              const agents = { ...s.agents };
              for (const id of cur.off!.chats) {
                if (backup && agents[id] === backup) agents[id] = decision.agent;
              }
              return { ...s, agents };
            });
            return;
          }
          if (next.off) arm();
        })();
      }, delay);
    };
    arm();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [store, clock, f, storage]);
  return null;
}
