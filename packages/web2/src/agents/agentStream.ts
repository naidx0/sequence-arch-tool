/* ══════════════════════════════════════════════════════════════════════════
   THE AGENT STREAM — one client-side model of what coding agents are doing
   packages/web2/src/agents/agentStream.ts

   Reads GET /api/agent-events (packages/analyzer/src/server/agentEvents.ts):
   every buffered AgentEvent, then each new one, folded into ONE tree
   (agentTree.ts). Every view of agents — the board overlay, the roster, the
   tree, the timeline — reads THIS store, so the trace graph and the step list
   are two views of one model (the Langfuse / LangGraph Studio shape), never
   two models that can disagree.

   One EventSource per page, opened by the first subscriber and closed by the
   last. A reconnect replays the log; events already folded are skipped by id.
   ══════════════════════════════════════════════════════════════════════════ */

import { emptyTree, foldEvent } from './agentTree.js';
import type { AgentEvent, AgentNode } from './agentTypes.js';
export type { AgentEvent, AgentNode, AgentNodeKind, AgentNodeStatus, BoardHit } from './agentTypes.js';

export const AGENT_STREAM_URL = '/api/agent-events';

export interface AgentStreamState {
  nodes: ReadonlyMap<string, AgentNode>;
  /** The step a view selected; the overlay holds its locations lit. */
  focusId: string | null;
  connected: boolean;
}

type Listener = (state: AgentStreamState, changed: readonly AgentNode[]) => void;

export interface AgentStore {
  get(): AgentStreamState;
  subscribe(fn: Listener): () => void;
  /** Fold one wire event in. Exposed so tests (and a replay) drive the same path. */
  apply(ev: AgentEvent): void;
  focus(id: string | null): void;
}

export interface EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null;
  onopen: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}

export function createAgentStore(open?: (url: string) => EventSourceLike | null): AgentStore {
  const tree = emptyTree();
  const seen = new Set<string>();
  let nodes: ReadonlyMap<string, AgentNode> = new Map<string, AgentNode>();
  let focusId: string | null = null;
  let connected = false;
  const listeners = new Set<Listener>();
  let source: EventSourceLike | null = null;
  /* One snapshot object per change, so useSyncExternalStore sees a stable value between changes. */
  let snapshot: AgentStreamState = { nodes, focusId, connected };
  const state = (): AgentStreamState => snapshot;
  const emit = (changed: readonly AgentNode[]): void => {
    snapshot = { nodes, focusId, connected };
    for (const l of [...listeners]) l(snapshot, changed);
  };
  const opener =
    open ??
    ((url: string): EventSourceLike | null =>
      typeof EventSource === 'undefined' ? null : (new EventSource(url) as unknown as EventSourceLike));

  const store: AgentStore = {
    get: state,
    subscribe(fn) {
      listeners.add(fn);
      if (!source) {
        source = opener(AGENT_STREAM_URL);
        if (source) {
          source.onmessage = (m) => {
            try {
              store.apply(JSON.parse(m.data) as AgentEvent);
            } catch {
              /* a malformed frame is dropped; the next one stands on its own */
            }
          };
          source.onopen = () => {
            connected = true;
            emit([]);
          };
          /* EventSource reconnects by itself; the replay on reconnect re-syncs. */
          source.onerror = () => {
            connected = false;
            emit([]);
          };
        }
      }
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0 && source) {
          source.close();
          source = null;
          connected = false;
        }
      };
    },
    apply(ev) {
      if (!ev || typeof ev.id !== 'string' || seen.has(ev.id)) return;
      seen.add(ev.id);
      const changed = foldEvent(tree, ev);
      if (!changed.length) return;
      /* A new Map per change so a React view can compare by identity. */
      nodes = new Map(tree.nodes);
      emit(changed);
    },
    focus(id) {
      focusId = id;
      emit([]);
    },
  };
  return store;
}

/** The page's one store. */
export const agentStore: AgentStore = createAgentStore();

/** Oldest first; id breaks a tie so the order is stable. */
const byStart = (a: AgentNode, b: AgentNode): number => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1);

/** Children of `id`, oldest first. */
export function childrenOf(nodes: ReadonlyMap<string, AgentNode>, id: string | null): AgentNode[] {
  return [...nodes.values()].filter((n) => n.parentId === id).sort(byStart);
}

/** The agents the roster lists: every session (main agent) and subagent. */
export function agentsOf(nodes: ReadonlyMap<string, AgentNode>): AgentNode[] {
  return [...nodes.values()]
    .filter((n) => n.kind === 'session' || n.kind === 'subagent')
    .sort(byStart);
}

/** The tool calls that belong to one agent row: its own, not a nested subagent's. */
export function callsOf(nodes: ReadonlyMap<string, AgentNode>, agent: AgentNode): AgentNode[] {
  const out: AgentNode[] = [];
  const walk = (id: string): void => {
    for (const c of childrenOf(nodes, id)) {
      if (c.kind === 'tool_call') out.push(c);
      else if (c.kind === 'turn') walk(c.id);
    }
  };
  walk(agent.id);
  return out;
}

/** The running tool call of an agent, if any (the roster's "current tool"). */
export function currentCall(nodes: ReadonlyMap<string, AgentNode>, agent: AgentNode): AgentNode | null {
  const calls = callsOf(nodes, agent);
  for (let i = calls.length - 1; i >= 0; i--) if (calls[i].status === 'running') return calls[i];
  return calls.length ? calls[calls.length - 1] : null;
}

/** "1m 04s" / "12.3s" / "840ms". */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
