import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SEQ_DIAGRAM_EDGE_FAMILIES, SEQ_DIAGRAM_NODE_KINDS } from '@sequence/schema';

import { ASK_MUTATING_TOOLS, ASK_TOOL_ALLOWLIST, executeAskTool } from '../server/askTools.js';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * `propose_topology` — THE AGENT PROPOSES ARCHITECTURE
 *
 * The board's ghost layer shipped complete: a proposed service drawn dashed,
 * an Accept that runs back through the same edit funnel a human rename uses, a
 * Deny that drops the layer, fourteen tests over the reducer. And no answer
 * could enter it — `canvas/proposal` was dispatched by nothing in the entire
 * client, and the prompt asked the model for a fenced `seqd` block that no code
 * anywhere parsed.
 *
 * This is the producer. A TOOL CALL, not a fence, for the reason `propose_files`
 * already recorded: a proposal must not be scraped out of the model's prose.
 * ══════════════════════════════════════════════════════════════════════════
 */

/** Enough context for a tool that reads nothing from disk. */
/* A repo root, because `executeAskTool` gates every tool on one before the
   tool itself runs - and this tool reads nothing from disk, so the value only
   has to exist. */
const CTX = {
  repoRoot: '/repo',
  resolveReadable: () => null,
  topologyNodeIds: new Set(['svc:gateway']),
} as unknown as Parameters<typeof executeAskTool>[2];

function run(args: Record<string, unknown>) {
  return executeAskTool('propose_topology', args, CTX);
}

const NODE = { id: 'svc:limiter', label: 'limiter', kind: 'service' };

describe('the belt admits it', () => {
  it('is an allowed tool name', () => {
    assert.ok(ASK_TOOL_ALLOWLIST.includes('propose_topology'));
  });

  it('COUNTS AS A MUTATION, so plan mode refuses it', () => {
    /*
     * It writes nothing to disk, and it is still a mutation by exactly the
     * argument `propose_files` is: plan mode's contract is that the turn ends
     * in WORDS, and a turn that ends with a dashed service sitting on the
     * reader's board has ended in something else. Someone who asked for a plan
     * and found a pending change to their architecture did not get what they
     * chose.
     */
    assert.ok(ASK_MUTATING_TOOLS.includes('propose_topology'));
  });
});

describe('what it accepts', () => {
  it('a service, and the proposal comes back structured', async () => {
    const result = await run({ title: 'Add a rate limiter', nodes: [NODE] });
    assert.equal(result.ok, true, result.evidence);
    assert.deepEqual(result.topology?.nodes, [NODE]);
    assert.equal(result.topology?.title, 'Add a rate limiter');
    assert.match(result.evidence, /1 node/);
  });

  it('carries the rationale through unchanged, and absent stays absent', async () => {
    /* The board renders it. A model with nothing to add beyond the title must
       not have prose invented for it here. */
    const withWhy = await run({ nodes: [NODE], rationale: 'the gateway has no backpressure' });
    assert.equal(withWhy.topology?.rationale, 'the gateway has no backpressure');
    const without = await run({ nodes: [NODE] });
    assert.equal(without.topology?.rationale, undefined);
  });

  it('an edge onto a node the SCAN already found', async () => {
    /* The common real case: a proposed service in front of a real one. The
       board drops proposed ids that already exist, because "an agent proposing
       a node the repo has is proposing an EDGE to it". */
    const result = await run({
      nodes: [NODE],
      edges: [{ id: 'e1', from: 'svc:gateway', to: 'svc:limiter', family: 'http' }],
    });
    assert.equal(result.ok, true, result.evidence);
    assert.equal(result.topology?.edges.length, 1);
  });

  it('feeds what it proposed back to the model', async () => {
    /* Without a body the next round cannot see its own proposal, and the client
       echoing it back would be the surface inventing prompt content. */
    const result = await run({ nodes: [NODE] });
    assert.match(String(result.content), /limiter/);
  });

  it('carries optional detail.whatItDoes through to the topology payload', async () => {
    const result = await run({
      nodes: [
        {
          ...NODE,
          detail: { whatItDoes: 'Throttles inbound HTTP before the gateway fans out.' },
        },
      ],
    });
    assert.equal(result.ok, true, result.evidence);
    assert.deepEqual(result.topology?.nodes[0]?.detail, {
      whatItDoes: 'Throttles inbound HTTP before the gateway fans out.',
    });
  });
});

describe('WHAT IT REFUSES, AND THE ONE THAT IS NOT ABOUT SHAPE', () => {
  it('REFUSES A PROPOSED NODE CARRYING EVIDENCE', async () => {
    /*
     * THE SAFETY PROPERTY OF THIS WHOLE FEATURE.
     *
     * `SeqDiagramNode.evidenceRef` is "grounded evidence pointer, e.g.
     * `scan:src/handler.ts:41`", and the board's Generate gate keys off its
     * ABSENCE to decide a node is unproven. A model that supplied one would
     * make a node it invented indistinguishable from a node the scanner found —
     * in a product whose first non-negotiable is that every claim traces to
     * real evidence, and whose own incident log records a false edge arriving
     * with `origin: 'deterministic'` attached.
     *
     * Refused, not stripped. A model that tried to attach evidence to something
     * it made up has said something about the answer we are about to draw.
     */
    const result = await run({
      nodes: [{ ...NODE, evidenceRef: 'scan:src/limiter.ts:1' }],
    });
    assert.equal(result.ok, false);
    assert.match(result.evidence, /evidenceRef/);
    assert.equal(result.topology, undefined);
  });

  it('refuses a node kind the diagram does not have', async () => {
    /* Checked against the schema's own list rather than a copy, so a kind that
       does not exist cannot reach the reducer. */
    const result = await run({ nodes: [{ ...NODE, kind: 'microservice' }] });
    assert.equal(result.ok, false);
    assert.match(result.evidence, /microservice/);
    for (const kind of SEQ_DIAGRAM_NODE_KINDS) assert.match(result.evidence, new RegExp(kind));
  });

  it('refuses an edge family the diagram does not have', async () => {
    const result = await run({
      nodes: [NODE],
      edges: [{ id: 'e1', from: 'svc:limiter', to: 'svc:x', family: 'websocket' }],
    });
    assert.equal(result.ok, false);
    assert.match(result.evidence, /websocket/);
    for (const family of SEQ_DIAGRAM_EDGE_FAMILIES) assert.match(result.evidence, new RegExp(family));
  });

  it('refuses an edge whose endpoint is neither proposed nor in the attached graph', async () => {
    /* The pipeline supplies the real graph's id set. Requiring an endpoint to
       be proposed or real stops a dangling edge before the proposal bar
       promises it can be applied. */
    const result = await run({
      nodes: [NODE],
      edges: [{ id: 'e1', from: 'svc:missing', to: NODE.id, family: 'http' }],
    });
    assert.equal(result.ok, false);
    assert.match(result.evidence, /endpoint|svc:missing/);
    assert.equal(result.topology, undefined);
  });

  it('refuses an empty proposal', async () => {
    assert.equal((await run({})).ok, false);
    assert.equal((await run({ nodes: [] })).ok, false);
  });

  it('refuses a repeated node id', async () => {
    /* Two cards with one id is a board that cannot say which one was clicked. */
    const result = await run({ nodes: [NODE, NODE] });
    assert.equal(result.ok, false);
    assert.match(result.evidence, /repeats/);
  });

  it('refuses a node with no label', async () => {
    /* A card with no name is a box the reader cannot act on. */
    const result = await run({ nodes: [{ id: 'svc:x', kind: 'service' }] });
    assert.equal(result.ok, false);
    assert.match(result.evidence, /label/);
  });

  it('CAPS THE SIZE — a proposal is a sketch, not a redesign', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `svc:n${i}`,
      label: `n${i}`,
      kind: 'service',
    }));
    const result = await run({ nodes: many });
    assert.equal(result.ok, false);
    assert.match(result.evidence, /exceeds/);
  });

  it('names the tool in every refusal, so a round is not spent guessing', async () => {
    for (const args of [{}, { nodes: [] }, { nodes: [NODE, NODE] }]) {
      const result = await run(args);
      assert.match(result.evidence, /propose_topology/);
    }
  });
});

describe('a refusal the model can act on', () => {
  //
  // MEASURED on the owner's run, 2026-08-24:
  //
  //   Called propose_topology
  //   refused: propose_topology edge "e2" endpoint "svc:api" is not present
  //            in the proposal or attached graph
  //
  // The guard is right - a dangling endpoint is exactly what it exists to stop.
  // But the refusal handed the model nothing to repair WITH, and the code's own
  // comment says repair is the point: "Refusal reaches the MODEL while it can
  // still repair the call, instead of disappearing after Accept."
  //
  // So the model guessed `svc:api` again, or gave up and wrote prose - and half
  // of every proposal was discarded on the way to the board. A guard that
  // refuses without teaching is a loop, not a gate.
  //
  it('NAMES REAL IDS when an endpoint is unknown', async () => {
    const ctx = {
      repoRoot: '/repo',
      resolveReadable: () => null,
      topologyNodeIds: new Set(['svc:gateway', 'svc:analyzer', 'ds:analyzer-db']),
    } as unknown as Parameters<typeof executeAskTool>[2];

    const result = await executeAskTool(
      'propose_topology',
      {
        nodes: [NODE],
        edges: [{ id: 'e2', from: 'svc:api', to: NODE.id, family: 'http' }],
      },
      ctx,
    );

    assert.equal(result.ok, false);
    assert.match(result.evidence, /svc:api/, 'it still names what was wrong');

    // The part that was missing: something to try instead.
    assert.match(
      result.evidence,
      /svc:gateway|svc:analyzer/,
      `the refusal must name ids that exist - got: ${result.evidence}`,
    );
  });

  it('says so plainly when there is nothing to suggest', async () => {
    /* An empty graph is a different situation from a typo, and saying "did you
       mean:" with nothing after it is how a hint becomes noise. */
    const ctx = {
      repoRoot: '/repo',
      resolveReadable: () => null,
      topologyNodeIds: new Set<string>(),
    } as unknown as Parameters<typeof executeAskTool>[2];

    const result = await executeAskTool(
      'propose_topology',
      { nodes: [NODE], edges: [{ id: 'e3', from: 'svc:ghost', to: NODE.id, family: 'http' }] },
      ctx,
    );

    assert.equal(result.ok, false);
    assert.match(result.evidence, /svc:ghost/);
    /* The proposal's own node is still a legal endpoint, so it is named. */
    assert.match(result.evidence, /svc:limiter/);
  });
});
