/* ══════════════════════════════════════════════════════════════════════════
   WORKFLOW BLOCKS (round 13, A8): ready-made blocks that compile to a Program
   packages/schema/src/workflowBlocks.ts

   Jaden: "Start fresh with ready-made verified blocks (Agent/Builder, Checker,
   Test runner, Finish, Loop), each assignable to a connected agent and model.
   Users can drag and edit blocks, and can also ask an agent in chat to edit the
   workflow graph."

   A saved workflow is an ORDERED LIST OF BLOCKS, not a free graph. That is what
   makes it dragable (reorder the list), editable (a few fields per block) and
   editable by an agent (five small ops, below). `compileWorkflow` turns the list
   into the Program the scheduler already runs, and every shape it can emit is
   validateProgram-clean (workflowBlocks.test.ts walks them all, "verified"
   meaning exactly that).

   BLOCKS
     agent    Agent / Builder: one coding-agent turn (`runtime: 'acp'`), on a chosen
              connected agent and model. "Edit the code" by default.
     test     Test runner: one allowlisted command (pnpm test ...). The command is
              run by the engine's own gate, not an ambient shell; a failing run is
              the node's error.
     checker  Checker: no model. Reads the node ids the agent said it touched and
              verifies them against the real architecture graph.
     loop     Loop: repeats the next `span` blocks until the checker passes, up to
              `maxIterations` times.
     finish   Finish: where the workflow ends. Always last, exactly one.
   ══════════════════════════════════════════════════════════════════════════ */

import type { Program, ProgramEdge, ProgramNode } from './program.js';
import { validateProgram } from './program.js';

export type BlockKind = 'agent' | 'test' | 'checker' | 'loop' | 'finish';
export const BLOCK_KINDS: readonly BlockKind[] = ['agent', 'checker', 'test', 'finish', 'loop'];

/** The commands the Test runner offers: the engine's own verify-gate allowlist (analyzer test asserts the two agree). */
export const TEST_COMMANDS = ['pnpm test', 'pnpm -r build', 'pnpm build', 'pnpm --filter @sequence/schema test'] as const;

export interface WorkflowBlock {
  id: string;
  kind: BlockKind;
  title: string;
  /** agent: what to do. */
  prompt?: string;
  /** agent: may it change files (default yes), or only read and answer. */
  intent?: 'ask' | 'edit';
  /** agent: which connected agent runs it (an id from /api/acp/agents); absent = the default agent. */
  agentRef?: string;
  /** agent: which model that agent runs it on; absent = the agent's own current model. */
  model?: string;
  /** test: the command. */
  command?: string;
  /** loop: the most repeats. */
  maxIterations?: number;
  /** loop: how many of the blocks after it are inside it. */
  span?: number;
}

export interface WorkflowDoc {
  version: 1;
  id: string;
  name: string;
  blocks: WorkflowBlock[];
  /** Bumped on every write, so a reader can tell its copy is stale. */
  rev: number;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowOp =
  | { op: 'add'; kind: BlockKind; id?: string; at?: number; afterId?: string; title?: string; prompt?: string; intent?: 'ask' | 'edit'; agentRef?: string; model?: string; command?: string; maxIterations?: number; span?: number }
  | { op: 'update'; id: string; title?: string; prompt?: string; intent?: 'ask' | 'edit'; agentRef?: string | null; model?: string | null; command?: string; maxIterations?: number; span?: number }
  | { op: 'move'; id: string; to: number }
  | { op: 'remove'; id: string }
  | { op: 'rename'; name: string };

export class WorkflowEditError extends Error {}

export const BLOCK_LIMITS = { title: 80, prompt: 4000, name: 80, blocks: 40, maxIterations: 20, command: 200 } as const;

/** What each block is, for the palette. */
export const BLOCK_INFO: Record<BlockKind, { label: string; blurb: string }> = {
  agent: { label: 'Agent', blurb: 'A coding agent edits the code' },
  checker: { label: 'Checker', blurb: 'Checks the agent\'s changes against the real graph' },
  test: { label: 'Test runner', blurb: 'Runs your tests' },
  finish: { label: 'Finish', blurb: 'Ends the workflow' },
  loop: { label: 'Loop', blurb: 'Repeats the blocks after it until the checker passes' },
};

/** A ready-made block, with its words filled in. */
export function readyBlock(kind: BlockKind, id: string): WorkflowBlock {
  switch (kind) {
    case 'agent':
      return {
        id,
        kind,
        title: 'Edit the code',
        intent: 'edit',
        prompt:
          'Make the change the task asks for by editing the code. Keep it small and match the existing style. ' +
          'When you are done, reply with only a JSON array of the architecture node ids you changed.',
      };
    case 'checker':
      return { id, kind, title: 'Check against the graph' };
    case 'test':
      return { id, kind, title: 'Run the tests', command: TEST_COMMANDS[0] };
    case 'loop':
      return { id, kind, title: 'Repeat until it passes', maxIterations: 3, span: 2 };
    case 'finish':
      return { id, kind, title: 'Finish' };
  }
}

/** The ready-made starting workflow: edit, check, run the tests, finish. */
export function freshWorkflowBlocks(): WorkflowBlock[] {
  return [readyBlock('agent', 'b1'), readyBlock('checker', 'b2'), readyBlock('test', 'b3'), readyBlock('finish', 'b4')];
}

const str = (v: unknown, what: string, cap: number, allowEmpty = false): string => {
  if (typeof v !== 'string') throw new WorkflowEditError(`${what} must be text`);
  const t = v.trim();
  if (!allowEmpty && t === '') throw new WorkflowEditError(`${what} cannot be empty`);
  if (t.length > cap) throw new WorkflowEditError(`${what} is longer than ${cap} characters`);
  return t;
};
const int = (v: unknown, what: string, lo: number, hi: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new WorkflowEditError(`${what} must be a whole number from ${lo} to ${hi}`);
  return v;
};

function nextId(blocks: readonly WorkflowBlock[]): string {
  let n = blocks.length + 1;
  while (blocks.some((b) => b.id === `b${n}`)) n += 1;
  return `b${n}`;
}

/** Where blocks may be inserted or moved to: anywhere before the Finish block. */
const limit = (blocks: readonly WorkflowBlock[]): number => blocks.filter((b) => b.kind !== 'finish').length;

function setFields(b: WorkflowBlock, op: Record<string, unknown>): WorkflowBlock {
  const next: WorkflowBlock = { ...b };
  const apply = (key: 'title' | 'prompt' | 'command', cap: number): void => {
    if (op[key] !== undefined) next[key] = str(op[key], key, cap);
  };
  apply('title', BLOCK_LIMITS.title);
  if (op.prompt !== undefined) {
    if (b.kind !== 'agent') throw new WorkflowEditError(`a ${BLOCK_INFO[b.kind].label} block has no prompt`);
    apply('prompt', BLOCK_LIMITS.prompt);
  }
  if (op.command !== undefined) {
    if (b.kind !== 'test') throw new WorkflowEditError(`a ${BLOCK_INFO[b.kind].label} block has no command`);
    const c = str(op.command, 'command', BLOCK_LIMITS.command);
    if (!(TEST_COMMANDS as readonly string[]).includes(c)) throw new WorkflowEditError(`command must be one of: ${TEST_COMMANDS.join(', ')}`);
    next.command = c;
  }
  if (op.intent !== undefined) {
    if (b.kind !== 'agent') throw new WorkflowEditError(`a ${BLOCK_INFO[b.kind].label} block has no intent`);
    if (op.intent !== 'ask' && op.intent !== 'edit') throw new WorkflowEditError('intent must be ask or edit');
    next.intent = op.intent;
  }
  for (const key of ['agentRef', 'model'] as const) {
    if (op[key] === undefined) continue;
    if (b.kind !== 'agent') throw new WorkflowEditError(`a ${BLOCK_INFO[b.kind].label} block has no ${key}`);
    if (op[key] === null) delete next[key];
    else next[key] = str(op[key], key, 200);
  }
  if (op.maxIterations !== undefined) {
    if (b.kind !== 'loop') throw new WorkflowEditError(`a ${BLOCK_INFO[b.kind].label} block has no repeat count`);
    next.maxIterations = int(op.maxIterations, 'maxIterations', 1, BLOCK_LIMITS.maxIterations);
  }
  if (op.span !== undefined) {
    if (b.kind !== 'loop') throw new WorkflowEditError(`a ${BLOCK_INFO[b.kind].label} block has no span`);
    next.span = int(op.span, 'span', 1, BLOCK_LIMITS.blocks);
  }
  return next;
}

/**
 * Where a Loop added with no place named goes, and how much it wraps. It wraps from the first agent
 * not already inside a loop through the checker/test run after it (Start fresh: agent, checker, tests);
 * with no checker or test after that agent, through the last block before Finish. It never takes a
 * block another loop holds, so a second click cannot empty the first loop: when every block is
 * already looped it is refused. With nothing to wrap at all it goes before Finish (and says it is empty).
 */
export function clickedLoopPlace(blocks: readonly WorkflowBlock[]): { at: number; span: number } | null {
  const looped = new Set<number>();
  for (const [i, body] of loopBodies(blocks)) {
    looped.add(i);
    body.forEach((j) => looped.add(j));
  }
  const free = (i: number): boolean => !looped.has(i) && blocks[i]!.kind !== 'finish' && blocks[i]!.kind !== 'loop';
  let start = blocks.findIndex((b, i) => b.kind === 'agent' && free(i));
  if (start < 0) start = blocks.findIndex((_, i) => free(i));
  if (start < 0) {
    if (blocks.some((b) => b.kind === 'loop')) throw new WorkflowEditError('every block is already inside a loop, so there is nothing left for a new Loop to repeat');
    return null;
  }
  /* The run it may take: from start up to the next loop, looped block or Finish. */
  let end = start;
  while (end + 1 < blocks.length && free(end + 1)) end += 1;
  let stop = end;
  const check = (b: WorkflowBlock): boolean => b.kind === 'checker' || b.kind === 'test';
  let k = start + 1;
  while (k <= end && !check(blocks[k]!)) k += 1;
  if (k <= end) {
    stop = k;
    while (stop + 1 <= end && check(blocks[stop + 1]!)) stop += 1;
  }
  return { at: start, span: stop - start + 1 };
}

/** Apply ops to a doc, returning the new blocks and name. Pure; throws WorkflowEditError and applies nothing on a bad op. */
export function applyWorkflowOps(doc: Pick<WorkflowDoc, 'name' | 'blocks'>, ops: readonly WorkflowOp[]): { name: string; blocks: WorkflowBlock[] } {
  let name = doc.name;
  let blocks = doc.blocks.map((b) => ({ ...b }));
  if (!Array.isArray(ops) || ops.length === 0) throw new WorkflowEditError('ops must be a non-empty list');
  if (ops.length > 50) throw new WorkflowEditError('at most 50 ops at a time');
  for (const raw of ops) {
    const op = raw as Record<string, unknown>;
    switch (op.op) {
      case 'rename':
        name = str(op.name, 'name', BLOCK_LIMITS.name);
        break;
      case 'add': {
        if (!BLOCK_KINDS.includes(op.kind as BlockKind)) throw new WorkflowEditError(`kind must be one of: ${BLOCK_KINDS.join(', ')}`);
        const kind = op.kind as BlockKind;
        if (blocks.length >= BLOCK_LIMITS.blocks) throw new WorkflowEditError(`a workflow holds at most ${BLOCK_LIMITS.blocks} blocks`);
        if (kind === 'finish' && blocks.some((b) => b.kind === 'finish')) throw new WorkflowEditError('the workflow already has a Finish block');
        const id = op.id !== undefined ? str(op.id, 'id', 40) : nextId(blocks);
        if (blocks.some((b) => b.id === id)) throw new WorkflowEditError(`there is already a block '${id}'`);
        const made = setFields(readyBlock(kind, id), Object.fromEntries(Object.entries(op).filter(([k]) => k !== 'op' && k !== 'kind' && k !== 'id' && k !== 'at' && k !== 'afterId')));
        const max = limit(blocks);
        let at = kind === 'finish' ? blocks.length : max;
        /* A clicked Loop (no place named) wraps the work it should repeat: see clickedLoopPlace. */
        if (kind === 'loop' && op.afterId === undefined && op.at === undefined) {
          const place = clickedLoopPlace(blocks);
          if (place) {
            at = place.at;
            if (op.span === undefined) made.span = place.span;
          }
        }
        if (kind !== 'finish') {
          if (op.afterId !== undefined) {
            const i = blocks.findIndex((b) => b.id === op.afterId);
            if (i < 0) throw new WorkflowEditError(`no block '${String(op.afterId)}'`);
            at = Math.min(i + 1, max);
          } else if (op.at !== undefined) at = int(op.at, 'at', 0, max);
        }
        blocks.splice(at, 0, made);
        break;
      }
      case 'update': {
        const i = blocks.findIndex((b) => b.id === op.id);
        if (i < 0) throw new WorkflowEditError(`no block '${String(op.id)}'`);
        blocks[i] = setFields(blocks[i]!, Object.fromEntries(Object.entries(op).filter(([k]) => k !== 'op' && k !== 'id')));
        break;
      }
      case 'move': {
        const i = blocks.findIndex((b) => b.id === op.id);
        if (i < 0) throw new WorkflowEditError(`no block '${String(op.id)}'`);
        if (blocks[i]!.kind === 'finish') throw new WorkflowEditError('the Finish block stays last');
        const to = int(op.to, 'to', 0, limit(blocks) - 1);
        const [b] = blocks.splice(i, 1);
        blocks.splice(to, 0, b!);
        break;
      }
      case 'remove': {
        const i = blocks.findIndex((b) => b.id === op.id);
        if (i < 0) throw new WorkflowEditError(`no block '${String(op.id)}'`);
        if (blocks[i]!.kind === 'finish') throw new WorkflowEditError('a workflow always has a Finish block');
        blocks.splice(i, 1);
        break;
      }
      default:
        throw new WorkflowEditError(`unknown op '${String(op.op)}': use add, update, move, remove or rename`);
    }
  }
  /* The Finish block is always last (a hand-written file may not have it; compile adds one). */
  blocks = [...blocks.filter((b) => b.kind !== 'finish'), ...blocks.filter((b) => b.kind === 'finish')];
  return { name, blocks };
}

/** Where each loop's body is: block indices strictly after the loop, never crossing another loop or the Finish. */
export function loopBodies(blocks: readonly WorkflowBlock[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  blocks.forEach((b, i) => {
    if (b.kind !== 'loop') return;
    const body: number[] = [];
    for (let j = i + 1; j < blocks.length && body.length < (b.span ?? 1); j += 1) {
      if (blocks[j]!.kind === 'loop' || blocks[j]!.kind === 'finish') break;
      body.push(j);
    }
    out.set(i, body);
  });
  return out;
}

/** Plain-words notes on things that will not do what the author likely meant. Never blocks a save. */
export function workflowNotes(doc: Pick<WorkflowDoc, 'blocks'>): string[] {
  const notes: string[] = [];
  const bodies = loopBodies(doc.blocks);
  doc.blocks.forEach((b, i) => {
    if (b.kind !== 'loop') return;
    const body = bodies.get(i) ?? [];
    if (body.length === 0) notes.push(`"${b.title}" has nothing inside it, so it is skipped.`);
    else if (!body.some((j) => doc.blocks[j]!.kind === 'checker')) notes.push(`"${b.title}" has no Checker inside it, so it repeats ${b.maxIterations ?? 3} times.`);
  });
  if (!doc.blocks.some((b) => b.kind === 'agent')) notes.push('There is no Agent block, so nothing will edit the code.');
  if (doc.blocks.some((b) => b.kind === 'checker') && !doc.blocks.some((b) => b.kind === 'agent')) notes.push('The Checker has no agent to check.');
  return notes;
}

const STATE = {
  shape: { claimedNodeIds: 'json', checkerOk: 'string', violations: 'string', testResult: 'json' },
  initial: { checkerOk: 'no', claimedNodeIds: [], violations: '' },
} as const;

/** The Program the scheduler runs for this workflow. Always validateProgram-clean for any list of blocks the ops can produce. */
export function compileWorkflow(doc: Pick<WorkflowDoc, 'id' | 'name' | 'blocks'>): Program {
  const nodes: ProgramNode[] = [{ id: 'start', title: 'Start', kind: 'start' }];
  const edges: ProgramEdge[] = [];
  const edge = (from: string, to: string, kind: ProgramEdge['kind']): void => {
    edges.push({ id: `e-${kind === 'seq' ? '' : `${kind}-`}${from}-${to}`, from, to, kind });
  };
  const nodeFor = (b: WorkflowBlock): ProgramNode => {
    switch (b.kind) {
      case 'agent':
        return {
          id: b.id,
          title: b.title,
          kind: 'agent',
          agent: {
            prompt: b.prompt && b.prompt.trim() ? b.prompt : readyBlock('agent', b.id).prompt!,
            intent: b.intent ?? 'edit',
            outKey: 'claimedNodeIds',
            runtime: 'acp',
            acp: { ...(b.agentRef ? { agentRef: b.agentRef } : {}), ...(b.model ? { model: b.model } : {}) },
          },
        };
      case 'test':
        return { id: b.id, title: b.title, kind: 'command', command: { command: b.command ?? TEST_COMMANDS[0], outKey: 'testResult' } };
      case 'checker':
        return { id: b.id, title: b.title, kind: 'checker', checker: { claimedKey: 'claimedNodeIds', outKey: 'checkerOk', violationsKey: 'violations' } };
      case 'loop':
        return { id: b.id, title: b.title, kind: 'loop', loop: { condition: { left: 'checkerOk', op: '!=', right: 'yes' }, maxIterations: b.maxIterations ?? 3 } };
      case 'finish':
        return { id: 'end', title: b.title, kind: 'end' };
    }
  };
  const blocks = doc.blocks.filter((b) => b.kind !== 'finish');
  const finish = doc.blocks.find((b) => b.kind === 'finish') ?? { id: 'end', kind: 'finish' as const, title: 'Finish' };
  const bodies = loopBodies(blocks);
  const inBody = new Set<number>();
  for (const [i, body] of bodies) if (body.length) body.forEach((j) => inBody.add(j));
  let prev = 'start';
  for (let i = 0; i < blocks.length; i += 1) {
    if (inBody.has(i)) continue;
    const b = blocks[i]!;
    const body = bodies.get(i);
    if (b.kind === 'loop') {
      if (!body || body.length === 0) continue;
      nodes.push(nodeFor(b));
      edge(prev, b.id, 'seq');
      let p = b.id;
      body.forEach((j, k) => {
        nodes.push(nodeFor(blocks[j]!));
        edge(p, blocks[j]!.id, k === 0 ? 'loop-body' : 'seq');
        p = blocks[j]!.id;
      });
      edge(p, b.id, 'loop-back');
      prev = b.id;
      continue;
    }
    nodes.push(nodeFor(b));
    edge(prev, b.id, 'seq');
    prev = b.id;
  }
  nodes.push(nodeFor(finish as WorkflowBlock));
  edge(prev, 'end', 'seq');
  return { id: doc.id, name: doc.name, nodes, edges, state: { shape: { ...STATE.shape }, initial: { ...STATE.initial } } };
}

/** compileWorkflow plus the validator's verdict, for a caller that wants to say why a run would be refused. */
export function checkWorkflow(doc: Pick<WorkflowDoc, 'id' | 'name' | 'blocks'>): { program: Program; ok: boolean; errors: string[] } {
  const program = compileWorkflow(doc);
  const v = validateProgram(program);
  /* A hand-edited file can name any command; only the verify-gate list ever runs, so say so instead of calling it valid. */
  const bad = doc.blocks
    .filter((b) => b.kind === 'test' && b.command !== undefined && !(TEST_COMMANDS as readonly string[]).includes(b.command))
    .map((b) => `"${b.title}" runs "${b.command}", which is not one of: ${TEST_COMMANDS.join(', ')}.`);
  return { program, ok: v.ok && bad.length === 0, errors: [...v.errors, ...bad] };
}
