/**
 * `sequence program run <file.json>` — the LOCAL, honest delivery path for a
 * Program (v16 Wave 2a). Loads a {@link Program} graph, runs it through the pure
 * `@sequence/schema` scheduler with a REAL ACP executor for `runtime:'acp'` agent
 * nodes (driving the user's own local coding agent over `@sequence/acp`), streams
 * every node's status to the terminal, and returns an HONEST exit code.
 *
 * HONESTY (the whole point):
 *  - A node is `done` only when the scheduler says so (a real turn completion);
 *    a refusal / abort / spawn failure surfaces as `error`, never a fabricated done.
 *  - `runtime:'gateway'` agent nodes need a metered provider that the CLI does NOT
 *    wire (that lives in the running app). Rather than fake them, the gateway
 *    executor here ERRORS with a clear message, so a mixed program fails loudly
 *    instead of silently skipping the billed step.
 *  - An acp node whose agent cannot be resolved (no `--agent`, no matching
 *    `agents.json` id) errors clearly — no silent no-op.
 *  - SIGINT → abort: the caller wires Ctrl-C to `opts.signal`, the scheduler
 *    abandons the in-flight await, and `dispose()` (in the finally) truly KILLS
 *    every spawned agent child (SIGTERM→SIGKILL) — no orphaned agent, no double bill.
 *
 * This module is factored out of `cli.ts` so it is unit-testable in-process
 * (the test points an agent entry at the conformant mock ACP agent and asserts a
 * real end-to-end run), exactly the injectable-spawn convention the analyzer
 * suite already uses.
 */

import fs from 'node:fs';
import childProcess from 'node:child_process';
import {
  runProgram,
  validateProgram,
  type Program,
  type NodeExecutor,
  type RunEvent,
  type RunResult,
} from '@sequence/schema';
import { AcpClient, createAcpExecutor, type AcpAgentClient } from '@sequence/acp';
import { listAgents, getAgent, type AgentEntry } from './server/agentsStore.js';
import { withTypedStateWrites } from './server/programRunner.js';
import { userStoreDir } from './server/store.js';

/** The ref the ACP executor uses for a node with no explicit `acp.agentRef`. */
const DEFAULT_AGENT_REF = 'default';

export interface RunProgramFileOptions {
  /** `--agent <id>`: the agent that satisfies a node's DEFAULT ref (no agentRef). */
  agentId?: string;
  /** `--input k=v` pairs, merged into the program's initial shared state. */
  inputs?: Record<string, string>;
  /** `--timeout <ms>`: wall-clock budget for the whole run. */
  timeoutMs?: number;
  /** Where `agents.json` lives. Defaults to `~/.sequence`. */
  storeDir?: string;
  /** Line sink (default `console.log`); tests capture it. */
  log?: (line: string) => void;
  /**
   * Emit one JSON object per line instead of prose.
   *
   * CANON names `claude -p` and Unix composition as the shape to match, and
   * the pipe half of that is genuinely shipped — `sequence ask --json` works.
   * A program run emitted `  [node] done`, which is a sentence for a human and
   * nothing a script can read, so the one command that runs a whole workflow
   * was the one that could not be composed with anything.
   *
   * NDJSON rather than a single document at the end: a run is a stream, and a
   * consumer that has to wait for the process to exit before it can parse
   * anything cannot show progress — which is the reason to pipe it at all.
   */
  json?: boolean;
  /** Ctrl-C / Stop. The scheduler threads it to the ACP turn (real cancel). */
  signal?: AbortSignal;
  /** Injectable spawn for the ACP client (default real `child_process.spawn`). */
  spawn?: typeof childProcess.spawn;
  /**
   * Test seam: build the ACP client for an entry. Defaults to a real
   * {@link AcpClient}. The e2e test can inject a client wired to the mock agent,
   * though pointing an entry's `command`/`args` at the mock fixture also works.
   */
  makeClient?: (entry: AgentEntry) => AcpAgentClient;
}

export interface RunProgramFileOutcome {
  /** completed ⇒ exit 0; failed / stopped / paused ⇒ nonzero. */
  status: 'completed' | 'failed' | 'stopped' | 'paused' | 'invalid' | 'load-error';
  exitCode: number;
  /** The scheduler result, when the program actually ran. */
  result?: RunResult;
}

/** Load + JSON-parse a program file; a clear Error on either failure. */
function loadProgram(file: string): Program {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`cannot read program file '${file}': ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text) as Program;
  } catch (e) {
    throw new Error(`program file '${file}' is not valid JSON: ${(e as Error).message}`);
  }
}

/**
 * Run a program file end-to-end. Never throws for a program-level failure — it
 * prints the honest reason and returns a nonzero {@link RunProgramFileOutcome}
 * (throwing is reserved for truly unexpected internal faults). The caller maps
 * `exitCode` to `process.exit`.
 */
export async function runProgramFile(
  file: string,
  opts: RunProgramFileOptions = {}
): Promise<RunProgramFileOutcome> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const storeDir = opts.storeDir ?? userStoreDir();
  const spawn = opts.spawn ?? childProcess.spawn;

  // ---- 1. Load + validate (honest error + nonzero exit on invalid) ----
  let program: Program;
  try {
    program = loadProgram(file);
  } catch (e) {
    /*
     * EVEN A FAILURE IS JSON UNDER --json. A consumer that receives prose on
     * the one path it most needs to parse — the failure — has to guess, and
     * the guess it makes is usually "the stream is empty". One unparseable
     * line makes the whole stream unusable.
     */
    const message = (e as Error).message;
    log(opts.json ? JSON.stringify({ type: 'error', stage: 'load', message, exitCode: 2 }) : `error: ${message}`);
    return { status: 'load-error', exitCode: 2 };
  }
  /*
   * VALIDATION CAN THROW, and it did. `validateProgram` assumes a
   * program-shaped object: hand it `{ nodes: 'not an array' }` — which is
   * perfectly good JSON — and it throws out of here, so
   * `sequence program run bad.json` died with a stack trace instead of a clean
   * exit 2 and a sentence.
   *
   * A malformed file is the most ordinary thing a person can hand this
   * command, and a crash is the least useful answer to it.
   */
  let validation: ReturnType<typeof validateProgram>;
  try {
    validation = validateProgram(program);
  } catch (e) {
    const message = `'${file}' is not a valid program (${(e as Error).message})`;
    log(
      opts.json
        ? JSON.stringify({ type: 'error', stage: 'validate', message, exitCode: 2 })
        : `error: ${message}`,
    );
    return { status: 'invalid', exitCode: 2 };
  }
  if (!validation.ok) {
    if (opts.json) {
      /* Every problem, in one object — a consumer should not have to
         reassemble a list from N prose lines it has to recognise by indent. */
      log(
        JSON.stringify({
          type: 'error',
          stage: 'validate',
          message: `'${file}' is not a valid program`,
          problems: validation.errors,
          exitCode: 2,
        }),
      );
      return { status: 'invalid', exitCode: 2 };
    }
    log(`error: '${file}' is not a valid program (${validation.errors.length} problem${validation.errors.length === 1 ? '' : 's'}):`);
    for (const err of validation.errors) log(`  - ${err}`);
    return { status: 'invalid', exitCode: 2 };
  }

  // ---- 2. Merge --input k=v into the program's initial shared state ----
  if (opts.inputs && Object.keys(opts.inputs).length > 0) {
    program = {
      ...program,
      state: {
        shape: program.state?.shape ?? {},
        initial: { ...program.state?.initial, ...opts.inputs },
      },
    };
  }

  // ---- 3. Resolve a node's agentRef to a launch config, build its client ----
  // The DEFAULT ref maps to `--agent <id>` (or, when exactly one agent is
  // registered and no --agent was given, that sole agent). A named ref maps to
  // the agents.json id of the same name. An unresolved ref throws a clear error,
  // which the scheduler records as the node's honest `error`.
  const createdClients: AcpAgentClient[] = [];
  const makeClient =
    opts.makeClient ??
    ((entry: AgentEntry): AcpAgentClient =>
      new AcpClient({
        command: entry.command,
        ...(entry.args ? { args: entry.args } : {}),
        ...(entry.cwd ? { cwd: entry.cwd } : {}),
        spawn,
      }));

  const resolveEntry = (agentRef: string): AgentEntry => {
    let targetId = agentRef;
    if (agentRef === DEFAULT_AGENT_REF) {
      if (opts.agentId) {
        targetId = opts.agentId;
      } else {
        const all = listAgents(storeDir);
        if (all.length === 1) {
          targetId = all[0].id;
        } else {
          throw new Error(
            'this program has an ACP agent node but no agent was resolved — pass --agent <id> ' +
              '(configure one with: sequence agent add <id> --command <bin>)'
          );
        }
      }
    }
    const entry = getAgent(storeDir, targetId);
    if (!entry) {
      throw new Error(
        `no local agent '${targetId}' in agents.json — add one with: sequence agent add ${targetId} --command <bin>`
      );
    }
    return entry;
  };

  const acpExecutor = createAcpExecutor({
    getClient: (agentRef: string): AcpAgentClient => {
      const client = makeClient(resolveEntry(agentRef));
      createdClients.push(client);
      return client;
    },
  });

  // A gateway agent node has no provider in the CLI — fail loudly, never fake it.
  const gatewayExecutor: NodeExecutor = async (node) =>
    ({
      ok: false,
      error:
        `agent node '${node.id}' uses runtime 'gateway', which needs a metered AI provider ` +
        `the CLI does not configure. Set runtime:'acp' to drive a local agent, or run this ` +
        `program in the app.`,
    });

  // Dispatch each agent node on its runtime. Command nodes are not run by the CLI.
  const agentExecutor: NodeExecutor = (node, state, ctx) =>
    node.agent?.runtime === 'acp'
      ? acpExecutor(node, state, ctx)
      : gatewayExecutor(node, state, ctx);

  const commandExecutor: NodeExecutor = async (node) =>
    ({
      ok: false,
      error: `command node '${node.id}' is not executed by 'sequence program run' (run command nodes in the app terminal).`,
    });

  // ---- 4. Stream node status lines; run; honest final state + exit code ----
  const titleOf = new Map(program.nodes.map((n) => [n.id, n.title || n.id]));
  const onEvent = (evt: RunEvent): void => {
    const name = titleOf.get(evt.nodeId) ?? evt.nodeId;
    if (opts.json) {
      /* The node's TITLE as well as its id: a consumer should not have to load
         the program file to render a line. */
      log(
        JSON.stringify({
          type: 'node',
          nodeId: evt.nodeId,
          title: name,
          status: evt.status,
          ...(evt.error !== undefined ? { error: evt.error } : {}),
        }),
      );
      return;
    }
    if (evt.status === 'error') {
      log(`  [${name}] error: ${evt.error ?? 'failed'}`);
    } else {
      log(`  [${name}] ${evt.status}`);
    }
  };

  if (opts.json) {
    /* The denominator, stated once and first — the same thing `run:started`
       does on the server's event stream, so a consumer can show progress from
       the first line rather than discovering the total as it goes. */
    log(
      JSON.stringify({
        type: 'start',
        programId: program.id,
        programName: program.name || program.id,
        nodeIds: program.nodes.map((n) => n.id),
      }),
    );
  } else {
    log(`running program: ${program.name || program.id}`);
  }
  let result: RunResult;
  try {
    result = await runProgram(
      program,
      /* The same seam the server run uses: a STRING answered into a state slot
         the program declares as `json` is extracted (fenced, prefaced or
         repairable) before the scheduler stores it, and an unreadable one is
         the node's honest error rather than prose in a typed slot. A local
         agent is exactly the case that emits fenced JSON as its normal shape. */
      withTypedStateWrites(program, { agent: agentExecutor, command: commandExecutor }),
      {
        onEvent,
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      }
    );
  } finally {
    // Whatever happened — completion, failure, or a Ctrl-C abort — tear down every
    // agent subprocess we started (SIGTERM→SIGKILL). No orphan, no double bill.
    await Promise.all(createdClients.map((c) => c.dispose().catch(() => {})));
  }

  const exitCode = result.status === 'completed' ? 0 : 1;

  if (opts.json) {
    /* One terminal line carrying everything a consumer needs to stop reading:
       the status, the work done, the exit code the process will use, and the
       final state. A stream that just stopped would leave a reader unable to
       tell "finished" from "the pipe broke". */
    log(
      JSON.stringify({
        type: 'result',
        status: result.status,
        steps: result.steps,
        exitCode,
        finalState: result.finalState,
      }),
    );
    return { status: result.status, exitCode, result };
  }

  log('');
  log(`result: ${result.status} (${result.steps} step${result.steps === 1 ? '' : 's'})`);
  const stateKeys = Object.keys(result.finalState);
  if (stateKeys.length > 0) {
    log('final state:');
    for (const k of stateKeys) {
      log(`  ${k} = ${JSON.stringify(result.finalState[k])}`);
    }
  }

  return { status: result.status, exitCode, result };
}
