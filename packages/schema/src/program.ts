/**
 * The Programs model — the load-bearing data contract behind v14's "agent
 * workflows as executable, live-visualized graphs".
 *
 * This module is the ANALOG of `board.ts`/`index.ts`'s ArchGraph pattern: a set
 * of typed node/edge kinds plus a PURE validator. It defines WHAT a program is
 * (a control-flow graph over typed shared state); the deterministic runtime that
 * WALKS it lives in `scheduler.ts`, and the injected work (real AI/terminal
 * calls) is supplied by the caller — never here.
 *
 * DESIGN PRINCIPLES (from the v14 research — stated so the types can't drift):
 *  - Orchestration control flow is DETERMINISTIC CODE. Branches and loops
 *    evaluate a typed {@link Predicate} over shared state — never an LLM guess.
 *    Only the bodies of `agent`/`command` nodes are non-deterministic, and those
 *    are injected executors, not modeled here.
 *  - The shared `state` is a declared-shape JSON store. Nodes read/write it;
 *    branch/loop conditions are pure functions of it (see {@link evalPredicate}).
 *  - Per-node model routing is JUST a field on an `agent` node — no model logic
 *    lives here; the executor receives it.
 *
 * Everything in this file is pure and browser-safe (no fs, no network, no LLM).
 */

/** The declared primitive shape of one shared-state slot. */
export type StateType = 'string' | 'number' | 'boolean' | 'json';

/**
 * The typed shared-state declaration for a run. `shape` names each slot and its
 * primitive type; `initial` seeds values before the walk begins. A program may
 * omit this entirely (then the store starts empty and slots are created on
 * first write).
 */
export interface StateDecl {
  shape: Record<string, StateType>;
  initial?: Record<string, unknown>;
}

/**
 * A SAFE, serializable condition over shared state — deliberately NOT `eval`.
 *
 * `left` names a state key; `op` is a fixed comparator; `right` is a literal for
 * the binary comparators (ignored by the unary `truthy`/`falsy`). This is the
 * ENTIRE decision surface for `branch`/`loop`: a small typed form a program file
 * can carry as JSON, that {@link evalPredicate} evaluates purely and totally.
 */
export interface Predicate {
  /** State key whose current value is the left-hand side. */
  left: string;
  op: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'truthy' | 'falsy';
  /** Literal right-hand side for binary ops; omitted for truthy/falsy. */
  right?: string | number | boolean;
}

export type ProgramNodeKind =
  | 'start'
  | 'end'
  | 'agent'
  | 'command'
  | 'parallel'
  | 'branch'
  | 'loop'
  | 'state'
  /** Deterministic grounded verifier (harness W1) — no LLM. */
  | 'checker';

/**
 * One node in a program graph. `kind` selects which of the optional
 * kind-specific field bags is meaningful; the validator enforces that the right
 * one is present. The shape is intentionally a single flat interface (mirroring
 * ArchNode's open-but-typed style) so a program is trivially JSON.
 */
export interface ProgramNode {
  id: string;
  title: string;
  kind: ProgramNodeKind;

  /** kind 'agent': one metered AI call. `outKey` is where to write its result. */
  agent?: {
    prompt: string;
    intent?: 'ask' | 'edit';
    /** State key to write the executor's returned value into on success. */
    outKey?: string;
    /**
     * Which execution backend runs this node (v16). Absent or `'gateway'` ⇒ the
     * shipped single metered gateway call (unchanged, byte-compatible). `'acp'`
     * ⇒ a REAL local coding-agent turn over ACP (a subprocess, real cost + repo
     * writes) — driven by `@sequence/acp`'s executor, never interpreted here.
     */
    runtime?: 'gateway' | 'acp';
    /**
     * ACP-only routing (meaningful when `runtime === 'acp'`; ignored otherwise).
     *  - `agentRef`: names WHICH configured local agent to drive; sequential acp
     *    nodes sharing a ref share one session (anti-priming). Defaults to a
     *    single default agent when omitted.
     *  - `shareSession`: opt this node out of the shared session (a fresh session
     *    breaks priming) by setting `false`. Defaults to sharing (`true`).
     */
    acp?: {
      agentRef?: string;
      shareSession?: boolean;
    };
    /*
     * ── `tools`, `requiresReview` AND `skills` WERE HERE, AND ARE GONE ───
     *
     * All three were declared with a docblock describing behaviour that does
     * not exist, and READ BY NO CODE — a grep across every package returned the
     * declaration and nothing else. Each one is worse than dead weight because
     * each is a promise:
     *
     *   tools           "a tool not listed is refused by the executor" —
     *                   no executor consults the list, so it advertised a
     *                   security boundary that was never enforced. A program
     *                   author reading this would have believed they had
     *                   sandboxed an agent.
     *   requiresReview  "the executor awaits UI approval; denied steps error
     *                   honestly" — nothing awaits anything. It promised an
     *                   agent cannot run before a human approves, when no such
     *                   gate exists anywhere in the runtime.
     *   skills          "prepended to the agent prompt" — nothing prepends
     *                   them, so an authored skill was silently ignored.
     *
     * `model` went with them, one field up, for the same reason: nothing routes
     * on it.
     *
     * REINTRODUCING ANY OF THEM NEEDS AN EXECUTION TEST proving observable
     * behaviour — a denied tool that actually fails, a step that actually
     * waits — not another optional field and another docblock. CANON's first
     * non-negotiable is grounded-not-guessed; a declared capability nothing
     * implements is the same lie one layer up from a false edge.
     */
  };

  /** kind 'command': one terminal command. `outKey` receives its result. */
  command?: {
    command: string;
    outKey?: string;
    /**
     * Harness W3: when true, irreversible/outward patterns always require an
     * approval gate even if the heuristic miss-fires. Executor still checks
     * irreversible heuristics when this is absent.
     */
    requiresApproval?: boolean;
  };

  /** kind 'branch': a typed predicate; the walk follows branch-true/false. */
  branch?: {
    condition: Predicate;
  };

  /** kind 'loop': repeat the body WHILE the predicate holds, capped hard. */
  loop?: {
    condition: Predicate;
    maxIterations: number;
  };

  /** kind 'state': the declared shared-state shape (usually the start's neighbor). */
  state?: StateDecl;

  /**
   * kind 'checker': grounded verify against the run's ArchGraph (RunOptions.groundedGraph).
   * Reads claimed node ids from `claimedKey`, writes 'yes'/'no' to `outKey`, and
   * optionally the violation list (joined) to `violationsKey`. Never calls an LLM.
   */
  checker?: {
    claimedKey: string;
    outKey: string;
    violationsKey?: string;
  };

  /*
   * ── `meta.serviceId` WAS HERE, AND IS GONE ─────────────────────────────
   *
   * "Optional cross-link to Architecture service cards" - the one declared
   * link between a RUN and the architecture graph, and it was SET by nothing
   * and READ by nothing. A grep across every package returned the declaration
   * alone.
   *
   * It mattered more than the other dead fields because a whole moat point
   * stood on it: "agent workflows ON THE GRAPH", a board-visible run graph.
   * With no producer there is no grounded answer to "which services did this
   * run touch", so drawing one would mean inventing the answer - which is the
   * fabrication CANON's first non-negotiable exists to forbid, arriving with
   * a run id attached to make it look measured.
   *
   * Building that surface starts by giving a run a REAL, derived link to the
   * graph - the change stats already sample the tree with git, so the honest
   * source is which files the run touched, resolved through the scan. Not an
   * optional string an author is trusted to fill in correctly.
   */
}

export type ProgramEdgeKind =
  | 'seq'
  | 'parallel'
  | 'branch-true'
  | 'branch-false'
  | 'loop-body'
  | 'loop-back';

/** A directed, kind-tagged edge. `kind` tells the scheduler how to traverse it. */
export interface ProgramEdge {
  /** Stable, unique-within-program id. */
  id: string;
  from: string;
  to: string;
  kind: ProgramEdgeKind;
  /** Snapshot/read label override (e.g. "No: revise plan" on retry arcs). */
  label?: string;
}

/** A whole program: a control-flow graph over an optional typed shared state. */
export interface Program {
  id: string;
  name: string;
  description?: string;
  nodes: ProgramNode[];
  edges: ProgramEdge[];
  state?: StateDecl;
}

/** The runtime shared store: a flat, mutable map keyed by declared slot name. */
export type ProgramState = Record<string, unknown>;

/**
 * Evaluate a {@link Predicate} against a state store. PURE, TOTAL, and it NEVER
 * throws: an unknown/undefined key is falsy, a non-comparable comparison is
 * false, `truthy`/`falsy` apply JS truthiness. This totality is load-bearing —
 * control flow must be deterministic and crash-free even on a malformed program.
 */
export function evalPredicate(pred: Predicate, state: ProgramState): boolean {
  const left = state[pred.left];

  switch (pred.op) {
    case 'truthy':
      return Boolean(left);
    case 'falsy':
      return !left;
    case '==':
      return left === pred.right;
    case '!=':
      return left !== pred.right;
    case '<':
    case '<=':
    case '>':
    case '>=': {
      // Only meaningful for two numbers; anything else is honestly false.
      if (typeof left !== 'number' || typeof pred.right !== 'number') return false;
      const r = pred.right;
      if (pred.op === '<') return left < r;
      if (pred.op === '<=') return left <= r;
      if (pred.op === '>') return left > r;
      return left >= r;
    }
    default:
      // Unknown operator — total, so false rather than throw.
      return false;
  }
}

/** The result of {@link validateProgram}: ok plus a list of human-readable errors. */
export interface ValidateProgramResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a program's structure. PURE — no side effects, returns every problem
 * it finds (not just the first). The checks, in order:
 *
 *  - node ids are unique; edge ids are unique;
 *  - every edge's `from`/`to` references a real node;
 *  - kind-specific fields are present (agent has a prompt, loop has
 *    maxIterations > 0, branch has a condition, etc.);
 *  - exactly one `start` node, and it exists;
 *  - every node is reachable from that start (following edges);
 *  - a `branch` node has BOTH a branch-true and a branch-false outgoing edge;
 *  - a `loop` node has a loop-body edge AND a loop-back edge returning to it,
 *    and maxIterations > 0;
 *  - the ONLY cycles allowed are those closed by a `loop-back` or `branch-false`
 *    edge (gate retry / loop return) — any cycle over other edge kinds is malformed.
 */
export function validateProgram(program: Program): ValidateProgramResult {
  const errors: string[] = [];
  const { nodes, edges } = program;

  // --- unique ids -----------------------------------------------------------
  const nodeIds = new Set<string>();
  for (const n of nodes) {
    if (nodeIds.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    nodeIds.add(n.id);
  }
  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (edgeIds.has(e.id)) errors.push(`duplicate edge id: ${e.id}`);
    edgeIds.add(e.id);
  }

  // --- edges reference real nodes ------------------------------------------
  for (const e of edges) {
    if (!nodeIds.has(e.from)) errors.push(`edge ${e.id} has unknown from-node ${e.from}`);
    if (!nodeIds.has(e.to)) errors.push(`edge ${e.id} has unknown to-node ${e.to}`);
  }

  // --- kind-specific field presence ----------------------------------------
  for (const n of nodes) {
    switch (n.kind) {
      case 'agent':
        if (!n.agent || typeof n.agent.prompt !== 'string' || n.agent.prompt.length === 0) {
          errors.push(`agent node ${n.id} is missing agent.prompt`);
        }
        // v16: an agent node's runtime is 'gateway' (default) or 'acp'. When
        // present it must be one of those; when 'acp', the optional acp bag's
        // fields must have the right shape (all fields optional, but typed).
        if (n.agent?.runtime !== undefined && n.agent.runtime !== 'gateway' && n.agent.runtime !== 'acp') {
          errors.push(`agent node ${n.id} has invalid runtime '${String(n.agent.runtime)}' (expected 'gateway' or 'acp')`);
        }
        if (n.agent?.runtime === 'acp' && n.agent.acp !== undefined) {
          const acp = n.agent.acp;
          if (typeof acp !== 'object' || acp === null) {
            errors.push(`agent node ${n.id} has a malformed agent.acp bag`);
          } else {
            if (acp.agentRef !== undefined && typeof acp.agentRef !== 'string') {
              errors.push(`agent node ${n.id} agent.acp.agentRef must be a string`);
            }
            if (acp.shareSession !== undefined && typeof acp.shareSession !== 'boolean') {
              errors.push(`agent node ${n.id} agent.acp.shareSession must be a boolean`);
            }
          }
        }
        break;
      case 'command':
        if (!n.command || typeof n.command.command !== 'string' || n.command.command.length === 0) {
          errors.push(`command node ${n.id} is missing command.command`);
        }
        break;
      case 'branch':
        if (!n.branch || !n.branch.condition) {
          errors.push(`branch node ${n.id} is missing branch.condition`);
        }
        break;
      case 'loop':
        if (!n.loop || !n.loop.condition) {
          errors.push(`loop node ${n.id} is missing loop.condition`);
        }
        if (!n.loop || typeof n.loop.maxIterations !== 'number' || n.loop.maxIterations <= 0) {
          errors.push(`loop node ${n.id} must have maxIterations > 0`);
        }
        break;
      case 'state':
        if (!n.state || typeof n.state.shape !== 'object' || n.state.shape === null) {
          errors.push(`state node ${n.id} is missing state.shape`);
        }
        break;
      case 'checker':
        if (!n.checker || typeof n.checker.claimedKey !== 'string' || n.checker.claimedKey.length === 0) {
          errors.push(`checker node ${n.id} is missing checker.claimedKey`);
        }
        if (!n.checker || typeof n.checker.outKey !== 'string' || n.checker.outKey.length === 0) {
          errors.push(`checker node ${n.id} is missing checker.outKey`);
        }
        break;
      case 'parallel':
        // A parallel node carries no kind-specific fields; its fan-out is defined
        // entirely by its outgoing 'parallel' edges (validated in the edge pass).
        break;
      case 'start':
      case 'end':
        break;
      default:
        errors.push(`node ${n.id} has unknown kind: ${(n as ProgramNode).kind}`);
    }
  }

  // --- exactly one start ----------------------------------------------------
  const starts = nodes.filter((n) => n.kind === 'start');
  if (starts.length === 0) errors.push('program has no start node');
  if (starts.length > 1) {
    errors.push(`program has ${starts.length} start nodes (expected exactly 1)`);
  }

  // Group outgoing edges per node (only over edges with real endpoints).
  const outByNode = new Map<string, ProgramEdge[]>();
  for (const e of edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue;
    const list = outByNode.get(e.from);
    if (list) list.push(e);
    else outByNode.set(e.from, [e]);
  }

  // --- branch nodes need both true and false targets -----------------------
  for (const n of nodes) {
    if (n.kind !== 'branch') continue;
    const outs = outByNode.get(n.id) ?? [];
    if (!outs.some((e) => e.kind === 'branch-true')) {
      errors.push(`branch node ${n.id} has no branch-true edge`);
    }
    if (!outs.some((e) => e.kind === 'branch-false')) {
      errors.push(`branch node ${n.id} has no branch-false edge`);
    }
  }

  // --- loop nodes need a body edge AND a back edge returning to them --------
  const incomingLoopBack = new Map<string, number>();
  for (const e of edges) {
    if (e.kind === 'loop-back' && nodeIds.has(e.to)) {
      incomingLoopBack.set(e.to, (incomingLoopBack.get(e.to) ?? 0) + 1);
    }
  }
  for (const n of nodes) {
    if (n.kind !== 'loop') continue;
    const outs = outByNode.get(n.id) ?? [];
    if (!outs.some((e) => e.kind === 'loop-body')) {
      errors.push(`loop node ${n.id} has no loop-body edge`);
    }
    if ((incomingLoopBack.get(n.id) ?? 0) === 0) {
      errors.push(`loop node ${n.id} has no loop-back edge returning to it`);
    }
  }

  // --- reachability from the single start ----------------------------------
  if (starts.length === 1) {
    const startId = starts[0].id;
    const seen = new Set<string>();
    const stack = [startId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const e of outByNode.get(cur) ?? []) {
        if (!seen.has(e.to)) stack.push(e.to);
      }
    }
    for (const n of nodes) {
      if (!seen.has(n.id)) errors.push(`node ${n.id} is not reachable from start`);
    }
  }

  // --- cycles are legal ONLY via loop-back or branch-false (gate retry) -------
  // Detect any cycle reachable over edges that are NOT intentional return/retry
  // arcs; such a cycle is a malformed graph (an unintended infinite walk).
  {
    const nonBack = new Map<string, string[]>();
    for (const e of edges) {
      if (e.kind === 'loop-back' || e.kind === 'branch-false') continue;
      if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue;
      const list = nonBack.get(e.from);
      if (list) list.push(e.to);
      else nonBack.set(e.from, [e.to]);
    }
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const n of nodes) color.set(n.id, WHITE);
    let cycleReported = false;
    const visit = (id: string): void => {
      if (cycleReported) return;
      color.set(id, GRAY);
      for (const to of nonBack.get(id) ?? []) {
        const c = color.get(to) ?? WHITE;
        if (c === GRAY) {
          errors.push(`illegal cycle (not via loop-back or branch-false retry) involving ${to}`);
          cycleReported = true;
          return;
        }
        if (c === WHITE) visit(to);
        if (cycleReported) return;
      }
      color.set(id, BLACK);
    };
    for (const n of nodes) {
      if ((color.get(n.id) ?? WHITE) === WHITE) visit(n.id);
      if (cycleReported) break;
    }
  }

  return { ok: errors.length === 0, errors };
}
