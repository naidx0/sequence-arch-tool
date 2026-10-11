/* ══════════════════════════════════════════════════════════════════════════
   THE AGENT TREE — AgentEvents folded into one tree per session
   packages/web2/src/agents/agentTree.ts

     session ─ turn ─ tool_call
                  └ subagent ─ tool_call

   A turn opens with the first event after a stop and closes on `stop`. A call
   made inside a subagent (`agentId`) hangs off that subagent. A tool_end with
   no tool_start (an async PreToolUse that lost the race) still makes a call.
   PURE: the same events always fold to the same tree.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentEvent, AgentNode } from './agentTypes.js';

export interface TreeState {
  nodes: Map<string, AgentNode>;
  openTurn: Map<string, string>;
  turnCount: Map<string, number>;
}

export const emptyTree = (): TreeState => ({ nodes: new Map(), openTurn: new Map(), turnCount: new Map() });

/** Fold one event in; returns the nodes it changed (new objects, never mutated in place). */
export function foldEvent(t: TreeState, ev: AgentEvent): AgentNode[] {
  const changed = new Map<string, AgentNode>();
  const put = (n: AgentNode): AgentNode => {
    t.nodes.set(n.id, n);
    changed.set(n.id, n);
    return n;
  };
  const sid = ev.sessionId;
  const at = ev.at;
  const rootId = `session:${sid}`;

  const session = (): AgentNode => {
    const have = t.nodes.get(rootId);
    if (have) return have;
    return put({ id: rootId, sessionId: sid, parentId: null, rootId, kind: 'session', status: 'running', title: `Session ${sid.slice(0, 8)}`, toolKind: null, stepKind: null, locations: [], startedAt: at, endedAt: null });
  };
  const turn = (): AgentNode => {
    const root = session();
    const open = t.openTurn.get(sid);
    const have = open ? t.nodes.get(open) : undefined;
    if (have) return have;
    const n = (t.turnCount.get(sid) ?? 0) + 1;
    t.turnCount.set(sid, n);
    const id = `turn:${sid}:${n}`;
    t.openTurn.set(sid, id);
    if (root.status !== 'running') put({ ...root, status: 'running', endedAt: null });
    return put({ id, sessionId: sid, parentId: rootId, rootId, kind: 'turn', status: 'running', title: `Turn ${n}`, toolKind: null, stepKind: null, locations: [], startedAt: at, endedAt: null });
  };
  const agent = (agentId: string): AgentNode => {
    const id = `agent:${sid}:${agentId}`;
    const have = t.nodes.get(id);
    if (have) return have;
    const parent = ev.parentAgentId ? t.nodes.get(`agent:${sid}:${ev.parentAgentId}`) : undefined;
    return put({ id, sessionId: sid, parentId: (parent ?? turn()).id, rootId, kind: 'subagent', status: 'running', title: ev.title ?? 'Subagent', toolKind: ev.title ?? null, stepKind: null, locations: [], startedAt: at, endedAt: null });
  };
  const isUnder = (n: AgentNode, ancestor: string): boolean => {
    let cur: AgentNode | undefined = n;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      if (cur.parentId === ancestor) return true;
      seen.add(cur.id);
      cur = cur.parentId ? t.nodes.get(cur.parentId) : undefined;
    }
    return false;
  };

  switch (ev.kind) {
    case 'session_start': {
      const s = session();
      if (ev.title && s.title !== ev.title) put({ ...s, title: ev.title });
      break;
    }
    case 'subagent_start':
      if (ev.agentId) agent(ev.agentId);
      break;
    case 'subagent_stop':
      if (ev.agentId) put({ ...agent(ev.agentId), status: 'completed', endedAt: at });
      break;
    case 'stop': {
      const tn = turn();
      /* A turn that stopped failed says so, and why; a step it cut short is failed, not green. */
      const bad = ev.status === 'failed';
      put({
        ...tn,
        status: bad ? 'failed' : 'completed',
        endedAt: at,
        ...(ev.usage ? { usage: ev.usage, tokens: ev.usage.total } : ev.tokens !== undefined ? { tokens: ev.tokens } : {}),
        ...(bad ? { error: ev.error ?? 'The turn ended with an error.' } : {}),
      });
      t.openTurn.delete(sid);
      for (const n of [...t.nodes.values()]) {
        if (n.sessionId === sid && n.status === 'running' && n.kind !== 'session' && isUnder(n, tn.id)) {
          put(bad ? { ...n, status: 'failed', endedAt: at, error: ev.error ?? 'The turn ended before this step finished.' } : { ...n, status: 'completed', endedAt: at });
        }
      }
      const root = t.nodes.get(rootId);
      if (root) put({ ...root, status: bad ? 'failed' : 'completed', endedAt: at });
      break;
    }
    case 'tool_start':
    case 'tool_end': {
      const id = `tool:${sid}:${ev.toolUseId ?? ev.id}`;
      const parent = ev.agentId ? agent(ev.agentId) : turn();
      const prior = t.nodes.get(id);
      const done = ev.kind === 'tool_end';
      put({
        id,
        sessionId: sid,
        parentId: parent.id,
        rootId,
        kind: 'tool_call',
        status: done ? (ev.status === 'failed' ? 'failed' : 'completed') : 'running',
        title: ev.title ?? ev.tool ?? 'tool',
        toolKind: ev.tool ?? null,
        stepKind: ev.toolKind ?? null,
        locations: ev.board?.length ? ev.board : (prior?.locations ?? []),
        startedAt: prior?.startedAt ?? at,
        endedAt: done ? at : null,
        ...(ev.tokens !== undefined ? { tokens: ev.tokens } : prior?.tokens !== undefined ? { tokens: prior.tokens } : {}),
        ...(ev.error ? { error: ev.error } : {}),
        ...(ev.result ? { result: ev.result } : prior?.result ? { result: prior.result } : {}),
      });
      break;
    }
  }
  return [...changed.values()];
}
