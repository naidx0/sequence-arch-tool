import type { Program, WorkflowBlock, WorkflowDoc, WorkflowOp } from '@sequence/schema';

/* ══════════════════════════════════════════════════════════════════════════
   THE WORKFLOW EDITOR'S TRANSPORT (round 13, A8)
   packages/web2/src/activity/workflowClient.ts

   `/api/workflows` stores and edits (the same ops the chat agent's
   `edit_workflow` tool sends); running one is the existing `/api/program/run`
   with the program the server compiled, so there is no second way to start work.
   Same-origin paths only. Every answer is `{ ok: true, body }` or
   `{ ok: false, message }` with the engine's own sentence.
   ══════════════════════════════════════════════════════════════════════════ */

/** A saved workflow with what the page needs to draw and run it (analyzer `describeWorkflow`). */
export interface WorkflowView extends WorkflowDoc {
  program: Program;
  valid: boolean;
  errors: string[];
  /** Plain-words notes on things that will not do what the author likely meant. */
  notes: string[];
}

export type Answer<T> = { ok: true; body: T } | { ok: false; message: string; status?: number };

export interface ConnectedAgent {
  id: string;
  label?: string;
}
export interface AgentModelChoice {
  id: string;
  name: string;
}

export interface WorkflowApi {
  list(signal?: AbortSignal): Promise<Answer<WorkflowView[]>>;
  get(id: string, signal?: AbortSignal): Promise<Answer<WorkflowView>>;
  /** With a chat id: that chat's one workflow, made on first use (the same one every time). */
  create(name: string, from?: 'fresh' | 'empty', chatId?: string): Promise<Answer<WorkflowView>>;
  /** The chat's workflow (zero or one) and the older project workflows no chat owns yet. */
  chatList(chatId: string, signal?: AbortSignal): Promise<Answer<{ workflows: WorkflowView[]; legacy: WorkflowView[] }>>;
  /** Give an older project workflow to this chat. */
  adopt(id: string, chatId: string): Promise<Answer<WorkflowView>>;
  ops(id: string, ops: readonly WorkflowOp[], expectedRev?: number): Promise<Answer<WorkflowView>>;
  remove(id: string): Promise<Answer<true>>;
  agents(signal?: AbortSignal): Promise<Answer<ConnectedAgent[]>>;
  models(agentRef: string, signal?: AbortSignal): Promise<Answer<AgentModelChoice[]>>;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

export function createWorkflowApi(injected?: typeof fetch): WorkflowApi {
  const f: typeof fetch = (...a) => (injected ?? globalThis.fetch)(...a);
  async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Answer<T>> {
    let res: Response;
    try {
      res = await f(path, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal,
      });
    } catch (e) {
      return { ok: false, message: `nothing answered: ${(e as Error).message}` };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      return { ok: false, message: `the engine answered HTTP ${res.status} with something that is not JSON` };
    }
    if (!res.ok) {
      const named = (parsed as { error?: unknown } | null)?.error;
      return { ok: false, status: res.status, message: typeof named === 'string' ? named : `the engine refused with HTTP ${res.status}` };
    }
    return { ok: true, body: parsed as T };
  }
  const seg = (id: string): string => {
    if (!SAFE_ID.test(id)) throw new Error(`not a workflow id: ${id}`);
    return encodeURIComponent(id);
  };
  return {
    list: async (signal) => {
      const r = await call<{ workflows: WorkflowView[] }>('GET', '/api/workflows', undefined, signal);
      return r.ok ? { ok: true, body: r.body.workflows } : r;
    },
    get: (id, signal) => call<WorkflowView>('GET', `/api/workflows/${seg(id)}`, undefined, signal),
    create: (name, from = 'fresh', chatId) => call<WorkflowView>('POST', '/api/workflows', { name, from, ...(chatId !== undefined ? { chatId } : {}) }),
    chatList: (chatId, signal) => {
      if (!SAFE_ID.test(chatId)) throw new Error(`not a chat id: ${chatId}`);
      return call<{ workflows: WorkflowView[]; legacy: WorkflowView[] }>('GET', `/api/workflows?chat=${encodeURIComponent(chatId)}`, undefined, signal);
    },
    adopt: (id, chatId) => call<WorkflowView>('POST', `/api/workflows/${seg(id)}/adopt`, { chatId }),
    ops: (id, ops, expectedRev) => call<WorkflowView>('POST', `/api/workflows/${seg(id)}/ops`, { ops, ...(expectedRev !== undefined ? { expectedRev } : {}) }),
    remove: async (id) => {
      const r = await call<unknown>('DELETE', `/api/workflows/${seg(id)}`);
      return r.ok ? { ok: true, body: true } : r;
    },
    agents: async (signal) => {
      const r = await call<{ agents: ConnectedAgent[] }>('GET', '/api/acp/agents', undefined, signal);
      return r.ok ? { ok: true, body: r.body.agents } : r;
    },
    models: async (agentRef, signal) => {
      const r = await call<{ models?: { id: string; name?: string }[] }>('GET', `/api/acp/capabilities?agentRef=${encodeURIComponent(agentRef)}`, undefined, signal);
      return r.ok ? { ok: true, body: (r.body.models ?? []).map((m) => ({ id: m.id, name: m.name ?? m.id })) } : r;
    },
  };
}

/** Where a block of this list sits relative to the drop position, as the op that puts it there. */
/**
 * After a 409 the change is re-applied on the other writer's version. A position ("move to 2", "add at 1") meant a place
 * between two named blocks in OUR copy; on theirs the same number can be somewhere else. So a positioned op is turned into
 * the same place by block id: after the block that was just before it in our result (or before the one just after it).
 */
export function rebaseOps(ops: readonly WorkflowOp[], ours: readonly WorkflowBlock[], theirs: readonly WorkflowBlock[]): WorkflowOp[] {
  const movable = (bs: readonly WorkflowBlock[]) => bs.filter((b) => b.kind !== 'finish');
  const placeIn = (list: readonly WorkflowBlock[], prev: string | undefined, next: string | undefined, fallback: number): number => {
    const m = movable(list);
    const pi = prev ? m.findIndex((b) => b.id === prev) : -1;
    if (pi >= 0) return pi + 1;
    const ni = next ? m.findIndex((b) => b.id === next) : -1;
    if (ni >= 0) return ni;
    return Math.min(fallback, m.length);
  };
  return ops.map((op) => {
    if (op.op === 'move') {
      const mine = movable(ours).filter((b) => b.id !== op.id);
      const prev = mine[op.to - 1]?.id;
      const next = mine[op.to]?.id;
      const rest = theirs.filter((b) => b.id !== op.id);
      return { ...op, to: Math.max(0, placeIn(rest, prev, next, op.to)) };
    }
    if (op.op === 'add' && op.at !== undefined) {
      const mine = movable(ours);
      return { ...op, at: placeIn(theirs, mine[op.at - 1]?.id, mine[op.at]?.id, op.at) };
    }
    return op;
  });
}

export function dropOp(dragged: { id: string } | { kind: string }, index: number): WorkflowOp {
  return 'id' in dragged ? { op: 'move', id: dragged.id, to: index } : { op: 'add', kind: dragged.kind as never, at: index };
}
