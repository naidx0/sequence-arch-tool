import type { AgentRunStore } from '../agents/agentRuns';
import { setChatPick } from '../agents/chatConfig';
import { advanceSwitchRule, type SwitchCompletion } from './switchRule';

export interface SwitchReadiness { registered: string[]; ready: string[] }
export type SwitchResult = { ok: boolean; message: string };

/** Only reads the registry and probe. It never connects, installs, signs in or sends a prompt. */
export async function readSwitchReadiness(f: typeof fetch = fetch): Promise<SwitchReadiness> {
  const [registry, probe] = await Promise.all([f('/api/acp/agents'), f('/api/onboarding/providers')]);
  if (!registry.ok || !probe.ok) throw new Error('Could not check agent readiness.');
  const a = await registry.json() as { agents?: { id: string }[] };
  const p = await probe.json() as { providers?: { id: string; state: string; bridgeMissing?: boolean }[] };
  if (!Array.isArray(a.agents) || !Array.isArray(p.providers)) throw new Error('Could not check agent readiness.');
  /* The probe only knows the vendors' own CLIs. An agent the user registered by command (a local model, a custom ACP agent) is not in it: registered is all that can be said, so it is ready. A listed agent is ready only when the probe says so. */
  const registered = a.agents.map(x => x.id);
  const listed = new Map(p.providers.map(x => [x.id, x]));
  return { registered, ready: registered.filter(id => { const x = listed.get(id); return !x || (x.state === 'ready' && !x.bridgeMissing); }) };
}

export function createAgentSwitcher(deps: {
  runs: AgentRunStore;
  check?: () => Promise<SwitchReadiness>;
  busy: (sid: string) => boolean;
  clock?: () => number;
  liveIds?: (sid: string) => string[];
}) {
  const { runs } = deps;
  const revisions = new Map<string, number>();
  const revision = (sid: string) => { const n = (revisions.get(sid) ?? 0) + 1; revisions.set(sid, n); return n; };
  const cancel = (sid: string): void => {
    revision(sid);
    if (runs.get().chatConfig?.[sid]?.switchRule) runs.patch(s => setChatPick(s, sid, { switchRule: undefined }));
  };
  const request = async (sid: string, target: string, turns?: number, valid: () => boolean = () => true): Promise<SwitchResult> => {
    const n = revision(sid);
    const previous = runs.get().agents?.[sid];
    const oldRule = runs.get().chatConfig?.[sid]?.switchRule;
    const fail = (message: string): SwitchResult => ({ ok: false, message });
    if (!sid) return fail('Open a chat before switching agents.');
    if (turns === undefined && deps.busy(sid)) return fail('Wait for this turn to finish before switching agents.');
    if (turns !== undefined && (!Number.isInteger(turns) || turns < 1 || turns > 10000)) return fail('Choose 1–10000 successful turns.');
    if (previous === target && turns !== undefined) return fail(`This chat already uses ${target}.`);
    try {
      const availability = await (deps.check ?? readSwitchReadiness)();
      if (revisions.get(sid) !== n || !valid() || runs.get().agents?.[sid] !== previous || runs.get().chatConfig?.[sid]?.switchRule !== oldRule) return fail('The chat changed; switch cancelled.');
      if (turns === undefined && deps.busy(sid)) return fail('A turn started; switch cancelled.');
      if (!availability.registered.includes(target)) return fail(`Agent “${target}” is not connected. Choose a connected agent.`);
      if (!availability.ready.includes(target)) return fail(`Agent “${target}” is not ready. Check its connection before switching.`);
      runs.patch(s => {
        if (turns !== undefined) return setChatPick(s, sid, { switchRule: { target, remaining: turns, createdAt: (deps.clock ?? Date.now)(), counted: [...s.runs.filter(r => r.sessionId === sid && r.status === 'running').map(r => r.id), ...(deps.liveIds?.(sid) ?? [])] } });
        /* The server's next prompt still owns context handoff. Only the selection changes here. */
        return { ...s, agents: { ...s.agents, [sid]: target }, chatConfig: { ...s.chatConfig, [sid]: previous === target ? { ...s.chatConfig?.[sid], switchRule: undefined } : {} } };
      });
      return { ok: true, message: turns === undefined ? `This chat now uses ${target}.` : `Switch to ${target} after ${turns} successful turns.` };
    } catch {
      return fail('Could not check agent readiness. The current agent is unchanged.');
    }
  };
  const complete = (sid: string, turn: SwitchCompletion): void => {
    const rule = runs.get().chatConfig?.[sid]?.switchRule;
    if (!rule) return;
    const next = advanceSwitchRule(rule, turn);
    if (next !== rule) runs.patch(s => setChatPick(s, sid, { switchRule: next }));
  };
  return { request, cancel, complete };
}
