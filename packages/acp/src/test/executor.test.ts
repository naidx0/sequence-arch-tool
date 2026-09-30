import assert from 'node:assert';
import { test } from 'node:test';
import {
  runProgram,
  type Program,
  type ProgramExecutors,
  type NodeExecutor,
} from '@sequence/schema';
import { createAcpExecutor } from '../executor.js';
import type { AcpAgentClient, AcpPromptOptions, AcpPromptResult } from '../client.js';

/**
 * A recording mock of the AcpAgentClient contract — no subprocess. Proves the
 * executor's honesty mapping, session sharing, and abort behavior in isolation.
 */
class MockClient implements AcpAgentClient {
  starts = 0;
  sessionCount = 0;
  sessionId?: string;
  prompts: Array<{ sessionId: string | undefined; text: string }> = [];
  cancels = 0;
  disposed = 0;
  hangUntilAbort = false;
  onPromptStart?: (text: string, signal?: AbortSignal) => void;
  stopReason: AcpPromptResult['stopReason'] = 'end_turn';
  /** Live prompt concurrency — proves the executor serializes turns on a client. */
  inFlight = 0;
  maxInFlight = 0;

  async start(): Promise<void> {
    this.starts++;
  }
  async newSession(): Promise<string> {
    this.sessionCount++;
    this.sessionId = `s${this.sessionCount}`;
    return this.sessionId;
  }
  async prompt(text: string, opts: AcpPromptOptions = {}): Promise<AcpPromptResult> {
    this.prompts.push({ sessionId: this.sessionId, text });
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      const signal = opts.signal;
      this.onPromptStart?.(text, signal);
      if (signal?.aborted) {
        this.cancels++;
        return { stopReason: 'cancelled', text: '' };
      }
      if (this.hangUntilAbort) {
        return await new Promise<AcpPromptResult>((resolve) => {
          signal?.addEventListener(
            'abort',
            () => {
              this.cancels++;
              resolve({ stopReason: 'cancelled', text: '' });
            },
            { once: true }
          );
        });
      }
      // Yield a macrotask so overlapping turns would be observable if the executor
      // failed to serialize — the concurrency tracker above would then exceed 1.
      await new Promise((r) => setTimeout(r, 5));
      return { stopReason: this.stopReason, text: `answer:${text}` };
    } finally {
      this.inFlight--;
    }
  }
  async dispose(): Promise<void> {
    this.disposed++;
  }
}

const noopCommand: NodeExecutor = async () => ({ ok: true, value: 'noop' });

/** A `[start -> acp -> acp -> end]` program. */
function twoAcpProgram(): Program {
  return {
    id: 'p1',
    name: 'two acp nodes',
    nodes: [
      { id: 'start', title: 'start', kind: 'start' },
      {
        id: 'a1',
        title: 'first',
        kind: 'agent',
        agent: { prompt: 'first prompt', runtime: 'acp', outKey: 'r1' },
      },
      {
        id: 'a2',
        title: 'second',
        kind: 'agent',
        agent: { prompt: 'second prompt', runtime: 'acp', outKey: 'r2' },
      },
      { id: 'end', title: 'end', kind: 'end' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'a1', kind: 'seq' },
      { id: 'e2', from: 'a1', to: 'a2', kind: 'seq' },
      { id: 'e3', from: 'a2', to: 'end', kind: 'seq' },
    ],
  };
}

test('a [start->acp->acp->end] run lights every node done and shares one session', async () => {
  const mock = new MockClient();
  const acp = createAcpExecutor({ getClient: () => mock });
  const executors: ProgramExecutors = { agent: acp, command: noopCommand };

  const result = await runProgram(twoAcpProgram(), executors);

  assert.strictEqual(result.status, 'completed');
  for (const id of ['start', 'a1', 'a2', 'end']) {
    assert.strictEqual(result.nodeResults[id]?.status, 'done', `${id} should be done`);
  }
  // Honest structured values written to each outKey.
  assert.deepStrictEqual(result.finalState.r1, { stopReason: 'end_turn', text: 'answer:first prompt' });
  assert.deepStrictEqual(result.finalState.r2, { stopReason: 'end_turn', text: 'answer:second prompt' });

  // Anti-priming: ONE client, ONE session, both turns on it.
  assert.strictEqual(mock.starts, 1, 'client started once');
  assert.strictEqual(mock.sessionCount, 1, 'exactly one session opened (shared)');
  assert.strictEqual(mock.prompts.length, 2);
  assert.strictEqual(mock.prompts[0].sessionId, mock.prompts[1].sessionId);
  assert.strictEqual(mock.prompts[0].sessionId, 's1');
});

test('abort during node 1 truly cancels it, errors the node, and node 2 never runs', async () => {
  const mock = new MockClient();
  mock.hangUntilAbort = true;
  const ac = new AbortController();
  // Abort as node 1's turn begins.
  mock.onPromptStart = () => ac.abort();

  let agentCalls = 0;
  const acp = createAcpExecutor({ getClient: () => mock });
  const countingAgent: NodeExecutor = (node, state, ctx) => {
    agentCalls++;
    return acp(node, state, ctx);
  };
  const executors: ProgramExecutors = { agent: countingAgent, command: noopCommand };

  const result = await runProgram(twoAcpProgram(), executors, { signal: ac.signal });

  assert.strictEqual(result.status, 'stopped', 'an aborted run is honestly stopped');
  assert.strictEqual(result.nodeResults.a1?.status, 'error', 'node 1 truly cancelled -> error');
  assert.strictEqual(result.nodeResults.a2, undefined, 'node 2 must never run');
  assert.strictEqual(agentCalls, 1, 'the agent executor is invoked exactly once (node 2 = 0)');
  assert.strictEqual(mock.cancels, 1, 'the in-flight turn received a cancel');
});

test('a refused turn surfaces {ok:false} — never a fabricated done', async () => {
  const mock = new MockClient();
  mock.stopReason = 'refusal';
  const acp = createAcpExecutor({ getClient: () => mock });
  const result = await runProgram(twoAcpProgram(), { agent: acp, command: noopCommand });

  assert.strictEqual(result.status, 'failed', 'a refusal fails the run');
  assert.strictEqual(result.nodeResults.a1?.status, 'error');
  assert.match(result.nodeResults.a1?.error ?? '', /did not complete/i);
  assert.strictEqual(result.nodeResults.a2, undefined, 'run halts on the refusal (stop-run)');
  // No fabricated value written.
  assert.strictEqual(result.finalState.r1, undefined);
});

/** A `[start -> parallel(3 acp on the SAME agentRef) -> join -> end]` program. */
function parallelAcpProgram(): Program {
  const mkProbe = (id: string): Program['nodes'][number] => ({
    id,
    title: id,
    kind: 'agent',
    agent: { prompt: `${id} prompt`, runtime: 'acp', outKey: id },
  });
  return {
    id: 'p-par',
    name: 'three parallel acp nodes on one ref',
    nodes: [
      { id: 'start', title: 'start', kind: 'start' },
      { id: 'fan', title: 'fan', kind: 'parallel' },
      mkProbe('p1'),
      mkProbe('p2'),
      mkProbe('p3'),
      { id: 'join', title: 'join', kind: 'end' },
    ],
    edges: [
      { id: 'e-start-fan', from: 'start', to: 'fan', kind: 'seq' },
      { id: 'e-fan-p1', from: 'fan', to: 'p1', kind: 'parallel' },
      { id: 'e-fan-p2', from: 'fan', to: 'p2', kind: 'parallel' },
      { id: 'e-fan-p3', from: 'fan', to: 'p3', kind: 'parallel' },
      { id: 'e-fan-join', from: 'fan', to: 'join', kind: 'seq' },
    ],
  };
}

test('parallel acp nodes on one agentRef: exactly ONE client + ONE session; turns serialize', async () => {
  let created = 0;
  const mock = new MockClient();
  const acp = createAcpExecutor({
    getClient: () => {
      created++; // must be called AT MOST once despite 3 concurrent parallel nodes
      return mock;
    },
  });

  const result = await runProgram(parallelAcpProgram(), { agent: acp, command: noopCommand });

  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(created, 1, 'exactly one client created for the shared agentRef');
  assert.strictEqual(mock.starts, 1, 'the client started exactly once');
  assert.strictEqual(mock.sessionCount, 1, 'exactly ONE session opened (shared across the 3 nodes)');
  assert.strictEqual(mock.prompts.length, 3, 'all three turns ran');
  // All three turns ran on the same shared session, one at a time (no interleave).
  assert.ok(mock.prompts.every((p) => p.sessionId === 's1'), 'every turn used the shared session');
  assert.strictEqual(mock.maxInFlight, 1, 'turns serialized on the client — never two at once');
  for (const id of ['p1', 'p2', 'p3']) {
    assert.strictEqual(result.nodeResults[id]?.status, 'done', `${id} completed`);
    assert.deepStrictEqual(result.finalState[id], { stopReason: 'end_turn', text: `answer:${id} prompt` });
  }
});

test('shareSession:false opens a fresh session for that node (breaks priming)', async () => {
  const mock = new MockClient();
  const prog = twoAcpProgram();
  // Opt node 2 out of session sharing.
  prog.nodes[2].agent!.acp = { shareSession: false };
  const acp = createAcpExecutor({ getClient: () => mock });
  const result = await runProgram(prog, { agent: acp, command: noopCommand });

  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(mock.sessionCount, 2, 'node 2 opened its own session');
  assert.strictEqual(mock.prompts[0].sessionId, 's1');
  assert.strictEqual(mock.prompts[1].sessionId, 's2');
});
